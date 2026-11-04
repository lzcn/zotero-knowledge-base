const test = require("node:test");
const assert = require("node:assert/strict");
const { SWTagPolicy: policy } = require("../../src/library/tag-policy.js");

test("colored is an explicit flag and names keep the existing normalization", () => {
  const plain = policy.exclusions("colored, DeepLearning");
  assert.equal(plain.colored, false);
  assert.equal(policy.excludes("colored", plain), true);
  assert.equal(policy.excludes("#deep-learning", plain), true);
  const rules = policy.exclusions("@colored，reading*\n#Todo", [
    "Special Status",
  ]);
  assert.equal(rules.colored, true);
  assert.equal(policy.excludes("#SpecialStatus", rules), true);
  assert.equal(policy.excludes("colored", rules), false);
  assert.equal(policy.excludes("Readings", rules), true);
  assert.equal(policy.excludes("Todo", rules), true);
  assert.equal(policy.excludes("Keep", rules), false);
});

test("wildcards cover the complete normalized name and treat regex punctuation literally", () => {
  const rules = policy.exclusions(
    "reading/*, *review, C++*, model(v2)*, plain",
  );
  for (const name of [
    "reading/paper",
    "#Peer Review",
    "C++ library",
    "model(v2) notes",
    "plain",
  ])
    assert.equal(policy.excludes(name, rules), true, name);
  for (const name of [
    "unreading/paper",
    "review later",
    "C library",
    "modelv2 notes",
    "plaintext",
  ])
    assert.equal(policy.excludes(name, rules), false, name);
  assert.deepEqual(policy.visible(["plain", "Keep"], rules), ["Keep"]);
});
