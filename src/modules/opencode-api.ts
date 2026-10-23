export type OpenCodeProtocol = "chat" | "responses" | "messages" | "gemini";

/** Route OpenCode Go models to their supported inference protocol. */
export function openCodeRequest(model: string, prompt: string) {
  const base = "https://opencode.ai/inference/go";
  let protocol: OpenCodeProtocol = "chat";
  if (/^(gpt-|grok-|muse-)/.test(model)) protocol = "responses";
  else if (
    model.startsWith("claude-") ||
    model.startsWith("qwen") ||
    model === "minimax-m3"
  )
    protocol = "messages";
  else if (model.startsWith("gemini-")) protocol = "gemini";
  if (protocol === "responses")
    return {
      protocol,
      url: `${base}/openai/v1/responses`,
      body: { model, input: prompt, max_output_tokens: 4096, store: false },
    };
  if (protocol === "messages")
    return {
      protocol,
      url: `${base}/anthropic/v1/messages`,
      body: {
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      },
    };
  if (protocol === "gemini")
    return {
      protocol,
      url: `${base}/google/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      },
    };
  return {
    protocol,
    url: `${base}/openai/v1/chat/completions`,
    body: {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      ...(model.startsWith("deepseek-")
        ? { thinking: { type: "disabled" } }
        : {}),
    },
  };
}

export function apiResponseText(
  protocol: OpenCodeProtocol,
  value: unknown,
): string {
  const result = value as {
    status?: string;
    incomplete_details?: { reason?: string };
    choices?: { finish_reason: string; message?: { content?: string } }[];
    output?: {
      type: string;
      phase?: string;
      content?: { type: string; text?: string }[];
    }[];
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    candidates?: {
      finishReason: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };
  if (!result || typeof result !== "object")
    throw new Error("AI_RESPONSE_INVALID");
  if (
    result.choices?.[0]?.finish_reason === "length" ||
    result.incomplete_details?.reason === "max_output_tokens" ||
    result.stop_reason === "max_tokens" ||
    result.candidates?.[0]?.finishReason === "MAX_TOKENS"
  )
    throw new Error("AI_RESPONSE_TRUNCATED");
  let text: string | undefined;
  if (protocol === "chat" && result.choices?.[0]?.finish_reason === "stop")
    text = result.choices[0].message?.content;
  if (
    protocol === "responses" &&
    result.status === "completed" &&
    Array.isArray(result.output)
  )
    text = result.output
      .filter((item) => item?.type === "message" && item.phase !== "commentary")
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter(
        (part) => part?.type === "output_text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("");
  if (
    protocol === "messages" &&
    result.stop_reason === "end_turn" &&
    Array.isArray(result.content)
  )
    text = result.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  const candidate = result.candidates?.[0];
  if (
    protocol === "gemini" &&
    candidate?.finishReason === "STOP" &&
    Array.isArray(candidate.content?.parts)
  )
    text = candidate.content.parts
      .filter((part) => part && !part.thought && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  if (typeof text === "string" && text.trim()) return text;
  throw new Error("AI_RESPONSE_INVALID");
}
