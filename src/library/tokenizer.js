var SW_EN_STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "cannot",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "etc",
  "even",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "more",
  "most",
  "my",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
]);

var SW_ZH_STOPCHARS = new Set([
  "的",
  "了",
  "和",
  "是",
  "就",
  "都",
  "而",
  "及",
  "与",
  "著",
  "或",
  "一",
  "个",
  "们",
  "中",
  "上",
  "下",
  "也",
  "很",
  "到",
  "说",
  "要",
  "会",
  "着",
  "没",
  "看",
  "好",
  "这",
  "那",
  "你",
  "我",
  "他",
  "她",
  "它",
  "在",
  "有",
  "不",
  "人",
  "被",
  "把",
  "从",
  "对",
  "但",
  "因",
  "所",
  "以",
  "果",
  "如",
  "且",
  "之",
  "于",
  "等",
  "各",
  "其",
  "此",
  "该",
  "为",
  "之",
  "等",
]);

var SW_JA_STOPCHARS = new Set([
  "の",
  "に",
  "は",
  "を",
  "た",
  "が",
  "で",
  "と",
  "も",
  "れ",
  "さ",
  "す",
  "あ",
  "こ",
  "そ",
  "う",
  "い",
  "か",
  "っ",
  "な",
  "ん",
  "だ",
  "で",
  "る",
  "ら",
  "り",
  "る",
]);

var SW_CJK_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
var SW_TOKEN_RE = /([\p{L}\p{N}]+)/gu;
var SW_SPLIT_RE =
  /([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+)|([^\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+)/g;
var SW_MAX_TOKENS = 400000;

function swIsStopChar(ch) {
  return SW_ZH_STOPCHARS.has(ch) || SW_JA_STOPCHARS.has(ch);
}

/** @param {string} text @param {{ minLength?: number }} [opts] @returns {string[]} */
function swTokenizeText(text, opts) {
  var minLength = (opts && opts.minLength) || 2;
  var tokens = [];
  if (!text) {
    return tokens;
  }
  var low = String(text).toLowerCase();
  for (var m of low.matchAll(SW_TOKEN_RE)) {
    if (tokens.length >= SW_MAX_TOKENS) {
      break;
    }
    var word = m[1];
    if (SW_CJK_RE.test(word)) {
      SW_SPLIT_RE.lastIndex = 0;
      var seg;
      while ((seg = SW_SPLIT_RE.exec(word)) !== null) {
        if (seg[1]) {
          var chars = seg[1];
          if (chars.length == 1) {
            if (!swIsStopChar(chars)) {
              tokens.push(chars);
            }
          } else {
            for (var i = 0; i < chars.length - 1; i++) {
              var a = chars[i];
              var b = chars[i + 1];
              if (!swIsStopChar(a) && !swIsStopChar(b)) {
                tokens.push(a + b);
              }
            }
          }
        } else if (seg[2]) {
          swTokenizeLatin(seg[2], minLength, tokens);
        }
      }
    } else {
      swTokenizeLatin(word, minLength, tokens);
    }
  }
  return tokens;
}

/** @param {string} word @param {number} minLength @param {string[]} tokens */
function swTokenizeLatin(word, minLength, tokens) {
  if (/^[0-9]+$/.test(word)) {
    return;
  }
  if (word.length < minLength) {
    return;
  }
  if (SW_EN_STOPWORDS.has(word)) {
    return;
  }
  if (/^[a-z]+$/.test(word)) {
    tokens.push(swPorterStem(word));
  } else {
    tokens.push(word);
  }
}

/** @param {string} text @param {{ minLength?: number }} [opts] @returns {Map<string, number>} */
function swTermFreq(text, opts) {
  var tf = new Map();
  var tokens = swTokenizeText(text, opts);
  for (var t of tokens) {
    var c = tf.get(t);
    tf.set(t, (c || 0) + 1);
  }
  return tf;
}

/** @param {string} str @returns {string} */
function swFnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** @param {string} word @returns {boolean} */
function swIsStopword(word) {
  return SW_EN_STOPWORDS.has(word);
}

var SWTokenizer = {
  termFreq: swTermFreq,
  tokenize: swTokenizeText,
  swFnv1a: swFnv1a,
  isStopword: swIsStopword,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    swTokenizeText: swTokenizeText,
    swTermFreq: swTermFreq,
    swFnv1a: swFnv1a,
    swIsStopword: swIsStopword,
  };
}
