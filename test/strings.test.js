"use strict";
// The two language tables have to stay in step: a key present in one and missing
// from the other shows up in the UI as a blank label, silently.
const assert = require("node:assert");
const s = require("../src/renderer/strings.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (err) { console.log("  FAIL " + name + "\n       " + err.message); fail++; }
}

console.log("\nTables de chaines");
t("both languages define exactly the same keys", function () {
  const en = Object.keys(s.en).sort();
  const fr = Object.keys(s.fr).sort();
  const missingFr = en.filter(function (k) { return fr.indexOf(k) === -1; });
  const missingEn = fr.filter(function (k) { return en.indexOf(k) === -1; });
  assert.deepEqual(missingFr, [], "missing from fr: " + missingFr.join(", "));
  assert.deepEqual(missingEn, [], "missing from en: " + missingEn.join(", "));
});
t("matching keys hold matching types", function () {
  for (const k of Object.keys(s.en)) {
    assert.equal(typeof s.fr[k], typeof s.en[k], k + " is " + typeof s.en[k] + " in en, " + typeof s.fr[k] + " in fr");
  }
});
t("no value is left empty", function () {
  for (const table of [s.en, s.fr]) {
    for (const k of Object.keys(table)) {
      const v = table[k];
      if (typeof v === "string") assert.ok(v.length > 0, k + " is empty");
      if (Array.isArray(v)) assert.ok(v.length > 0, k + " is an empty list");
    }
  }
});
t("the genre lists are the same length in both languages", function () {
  assert.equal(s.fr.genres.length, s.en.genres.length);
});
t("the sentence builders produce a sentence in both languages", function () {
  for (const table of [s.en, s.fr]) {
    assert.ok(table.alreadySet("tempo").indexOf("tempo") !== -1);
    assert.ok(table.nothingToAdd("titre").indexOf("titre") !== -1);
    assert.ok(table.errSaveGeneric("boom").indexOf("boom") !== -1);
  }
});
t("singular and plural differ where the language needs it", function () {
  assert.notEqual(s.fr.alreadySet("tempo"), s.fr.alreadySet("tempo, titre"));
  assert.notEqual(s.en.alreadySet("tempo"), s.en.alreadySet("tempo, title"));
});

console.log("\nChoix de la langue");
t("a French locale selects French, in any casing or region", function () {
  for (const tag of ["fr", "fr-FR", "FR-fr", "fr-CA"]) {
    assert.equal(s.pick(tag), s.fr, tag);
  }
});
t("anything else falls back to English", function () {
  for (const tag of ["en", "en-US", "de-DE", "ja", "", null, undefined, "zz"]) {
    assert.equal(s.pick(tag), s.en, String(tag));
  }
});
t("the app name is the same in both languages", function () {
  assert.equal(s.fr.appName, "Balise");
  assert.equal(s.en.appName, "Balise");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
