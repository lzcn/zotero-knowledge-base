// Adapted from the Porter JavaScript stemmer by Andargor (2004)
// and Christopher McKenzie (2009). See THIRD-PARTY-NOTICES.
var step2list = {
  ational: "ate",
  tional: "tion",
  enci: "ence",
  anci: "ance",
  izer: "ize",
  bli: "ble",
  alli: "al",
  entli: "ent",
  eli: "e",
  ousli: "ous",
  ization: "ize",
  ation: "ate",
  ator: "ate",
  alism: "al",
  iveness: "ive",
  fulness: "ful",
  ousness: "ous",
  aliti: "al",
  iviti: "ive",
  biliti: "ble",
  logi: "log",
};

var step3list = {
  icate: "ic",
  ative: "",
  alize: "al",
  iciti: "ic",
  ical: "ic",
  ful: "",
  ness: "",
};

var swC = "[^aeiou]";
var swV = "[aeiouy]";
var swCSeq = swC + "[^aeiouy]*";
var swVSeq = swV + "[aeiou]*";
var swMgr0 = new RegExp("^(" + swCSeq + ")?" + swVSeq + swCSeq);
var swMeq1 = new RegExp(
  "^(" + swCSeq + ")?" + swVSeq + swCSeq + "(" + swVSeq + ")?$",
);
var swMgr1 = new RegExp(
  "^(" + swCSeq + ")?" + swVSeq + swCSeq + swVSeq + swCSeq,
);
var swSv = new RegExp("^(" + swCSeq + ")?" + swV);

function swPorterStem(w) {
  var stem;
  var suffix;
  var firstch;
  var re;
  var re2;
  var re3;
  var re4;
  var fp;
  if (w.length < 3) {
    return w;
  }
  firstch = w.substr(0, 1);
  if (firstch == "y") {
    w = firstch.toUpperCase() + w.substr(1);
  }
  re = /^(.+?)(ss|i)es$/;
  re2 = /^(.+?)([^s])s$/;
  if (re.test(w)) {
    w = w.replace(re, "$1$2");
  } else if (re2.test(w)) {
    w = w.replace(re2, "$1$2");
  }
  re = /^(.+?)eed$/;
  re2 = /^(.+?)(ed|ing)$/;
  if (re.test(w)) {
    fp = re.exec(w);
    if (swMgr0.test(fp[1])) {
      re3 = /.$/;
      w = w.replace(re3, "");
    }
  } else if (re2.test(w)) {
    fp = re2.exec(w);
    stem = fp[1];
    if (swSv.test(stem)) {
      w = stem;
      re2 = /(at|bl|iz)$/;
      re3 = new RegExp("([^aeiouylsz])\\1$");
      re4 = new RegExp("^" + swCSeq + swV + "[^aeiouwxy]$");
      if (re2.test(w)) {
        w = w + "e";
      } else if (re3.test(w)) {
        re4 = /.$/;
        w = w.replace(re4, "");
      } else if (re4.test(w)) {
        w = w + "e";
      }
    }
  }
  re = /^(.+?)y$/;
  if (re.test(w)) {
    fp = re.exec(w);
    stem = fp[1];
    if (swSv.test(stem)) {
      w = stem + "i";
    }
  }
  re =
    /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(w)) {
    fp = re.exec(w);
    stem = fp[1];
    suffix = fp[2];
    if (swMgr0.test(stem)) {
      w = stem + step2list[suffix];
    }
  }
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(w)) {
    fp = re.exec(w);
    stem = fp[1];
    suffix = fp[2];
    if (swMgr0.test(stem)) {
      w = stem + step3list[suffix];
    }
  }
  re =
    /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
  re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(w)) {
    fp = re.exec(w);
    stem = fp[1];
    if (swMgr1.test(stem)) {
      w = stem;
    }
  } else if (re2.test(w)) {
    fp = re2.exec(w);
    stem = fp[1] + fp[2];
    if (swMgr1.test(stem)) {
      w = stem;
    }
  }
  re = /^(.+?)e$/;
  if (re.test(w)) {
    fp = re.exec(w);
    stem = fp[1];
    re2 = new RegExp("^" + swCSeq + swV + "[^aeiouwxy]$");
    if (swMgr1.test(stem) || (swMeq1.test(stem) && !re2.test(stem))) {
      w = stem;
    }
  }
  re = /ll$/;
  if (re.test(w) && swMgr1.test(w)) {
    re2 = /.$/;
    w = w.replace(re2, "");
  }
  if (firstch == "y") {
    w = firstch.toLowerCase() + w.substr(1);
  }
  return w;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { swPorterStem: swPorterStem };
}
