global.swPorterStem = require("../../src/library/stemmer.js").swPorterStem;
const tok = require("../../src/library/tokenizer.js");
global.SWSearch = require("../../src/library/search.js").SWSearch;
const { SWCorpus } = require("../../src/library/corpus.js");

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(
      `FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function ok(cond, label) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

const porter = [
  ["caresses", "caress"],
  ["ponies", "poni"],
  ["ties", "ti"],
  ["caress", "caress"],
  ["cats", "cat"],
  ["feed", "feed"],
  ["agreed", "agre"],
  ["plastered", "plaster"],
  ["bled", "bled"],
  ["motoring", "motor"],
  ["sing", "sing"],
  ["conflated", "conflat"],
  ["troubled", "troubl"],
  ["sized", "size"],
  ["hopping", "hop"],
  ["tanned", "tan"],
  ["falling", "fall"],
  ["hissing", "hiss"],
  ["failing", "fail"],
  ["filing", "file"],
  ["happy", "happi"],
  ["sky", "sky"],
  ["relational", "relat"],
  ["conditional", "condit"],
  ["rational", "ration"],
  ["valenci", "valenc"],
  ["digitizer", "digit"],
  ["radicalli", "radic"],
  ["differentli", "differ"],
  ["analogousli", "analog"],
  ["vietnamization", "vietnam"],
  ["predication", "predic"],
  ["operator", "oper"],
  ["feudalism", "feudal"],
  ["decisiveness", "decis"],
  ["hopefulness", "hope"],
  ["callousness", "callous"],
  ["formaliti", "formal"],
  ["sensitiviti", "sensit"],
  ["sensibiliti", "sensibl"],
  ["triplicate", "triplic"],
  ["formative", "form"],
  ["formalize", "formal"],
  ["electriciti", "electr"],
  ["hopeful", "hope"],
  ["goodness", "good"],
  ["revival", "reviv"],
  ["allowance", "allow"],
  ["inference", "infer"],
  ["airliner", "airlin"],
  ["gyroscopic", "gyroscop"],
  ["adjustable", "adjust"],
  ["defensible", "defens"],
  ["irritant", "irrit"],
  ["replacement", "replac"],
  ["adjustment", "adjust"],
  ["dependent", "depend"],
  ["adoption", "adopt"],
  ["communism", "commun"],
  ["activate", "activ"],
  ["effective", "effect"],
  ["bowdlerize", "bowdler"],
  ["probate", "probat"],
  ["rate", "rate"],
  ["cease", "ceas"],
  ["controll", "control"],
  ["roll", "roll"],
];
for (const [w, expect] of porter) {
  eq(global.swPorterStem(w), expect, `porter ${w}`);
}

const toks = tok.swTokenizeText(
  "The quick brown foxes were running and jumping, repeatedly running.",
);
ok(toks.includes("fox"), "foxes -> fox");
ok(toks.includes("run"), "running -> run");
ok(toks.includes("jump"), "jumping -> jump");
ok(
  !toks.includes("the") && !toks.includes("and") && !toks.includes("were"),
  "stopwords removed",
);

const zh = tok.swTermFreq("机器学习方法与深度学习方法");
ok(zh.get("机器") === 1, "zh bigram 机器");
ok(zh.get("学习") === 2, "zh bigram 学习 x2");
ok(zh.get("方法") === 2, "zh bigram 方法 x2");
ok(!zh.has("法与") && !zh.has("与深"), "stopchar-spanning bigrams dropped");

function tf(text) {
  return tok.swTermFreq(text, { minLength: 2 });
}

(async () => {
  const c = new SWCorpus();
  await c.upsertDoc(
    "1/AAAA",
    "h1",
    false,
    tf(
      "machine learning optimizes neural network parameters machine learning neural",
    ),
  );
  await c.upsertDoc(
    "1/BBBB",
    "h2",
    false,
    tf(
      "deep learning and neural network training deep learning neural network",
    ),
  );
  await c.upsertDoc(
    "1/CCCC",
    "h3",
    false,
    tf(
      "cooking network recipes for italian pasta dishes with tomato sauce cooking",
    ),
  );

  let top = c.scoreTopK("1/AAAA", 3);
  eq(top.length, 2, "topk length (zero-overlap docs excluded)");
  eq(top[0].key, "1/BBBB", "similar doc ranks first");
  eq(top[1].key, "1/CCCC", "weak-overlap doc ranks second");
  ok(top[0].score > 0 && top[0].score <= 1, "score in (0,1]");
  ok(top[0].score > top[1].score, "similarity ordering");

  await c.upsertDoc(
    "1/BBBB",
    "h2b",
    false,
    tf("quantum chemistry molecular orbitals spectroscopy quantum chemistry"),
  );
  top = c.scoreTopK("1/AAAA", 3);
  eq(top[0].key, "1/CCCC", "incremental update changes ranking");
  ok(
    top.every((r) => r.key !== "1/BBBB"),
    "replaced doc no longer matches",
  );

  await c.removeDoc("1/CCCC");
  top = c.scoreTopK("1/AAAA", 3);
  eq(top.length, 0, "removal shrinks results");

  const d = c.docs.get("1/AAAA");
  await c.upsertDoc(
    "1/AAAA",
    d.hash,
    false,
    tf("ignored because hash unchanged"),
  );
  eq(c.n, 2, "same-hash upsert is a no-op");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
