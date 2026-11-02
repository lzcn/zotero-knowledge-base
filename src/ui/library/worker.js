import { env, AutoTokenizer } from "@huggingface/transformers";

// Tokenization stays off the UI thread; inference runs in the native helper.
// Tokenizer files are served exclusively from the add-on disk cache.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
let sequence = 0;
const assets = new Map();
function asset(url) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    assets.set(id, { resolve, reject });
    self.postMessage({ type: "asset", id, url });
  });
}
env.customCache = {
  async match(url) {
    const bytes = await asset(url);
    return new Response(bytes, { status: 200 });
  },
  async put() {},
};
let tokenizer;
self.onmessage = async ({ data }) => {
  if (data.type === "asset-result") {
    const pending = assets.get(data.id);
    assets.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.bytes);
    return;
  }
  try {
    if (data.type === "init") {
      tokenizer = await AutoTokenizer.from_pretrained(data.model, {
        revision: data.revision,
      });
      self.postMessage({ id: data.id, ready: true });
    } else if (data.type === "tokenize") {
      if (!tokenizer) throw new Error("Tokenizer is not ready");
      const inputs = data.texts.map((text) => {
        const tokens = tokenizer(text, {
          padding: "max_length",
          truncation: true,
          max_length: 256,
        });
        return Object.fromEntries(
          Object.entries(tokens).map(([name, tensor]) => [
            name,
            Array.from(tensor.data, Number),
          ]),
        );
      });
      self.postMessage({ id: data.id, inputs });
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
