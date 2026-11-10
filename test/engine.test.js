"use strict";
const assert = require("node:assert");
const e = require("../src/metadataEngine.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (err) { console.log("  FAIL " + name + "\n       " + err.message); fail++; }
}

// --- helpers to forge input files -------------------------------------------
const FAKE_MPEG = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
function concat(arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function latin1(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
function synchsafe(n) { return new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]); }

// a raw ID3v2.3 text frame with arbitrary payload (to simulate other taggers)
function rawTextFrame(id, payloadBytes) {
  const h = new Uint8Array(10);
  h.set(latin1(id), 0);
  new DataView(h.buffer).setUint32(4, payloadBytes.length, false);
  return concat([h, payloadBytes]);
}
function id3Tag(frames) {
  const body = concat(frames);
  const h = new Uint8Array(10);
  h.set(latin1("ID3"), 0); h[3] = 3; h[4] = 0; h[5] = 0;
  h.set(synchsafe(body.length), 6);
  return concat([h, body]);
}
function riff(chunks) {
  const body = concat([latin1("WAVE"), concat(chunks)]);
  const h = new Uint8Array(8);
  h.set(latin1("RIFF"), 0);
  new DataView(h.buffer).setUint32(4, body.length, true);
  return concat([h, body]);
}
function chunk(id, data) {
  const pad = data.length % 2;
  const h = new Uint8Array(8);
  h.set(latin1(id.padEnd(4, " ")), 0);
  new DataView(h.buffer).setUint32(4, data.length, true);
  return concat([h, data, new Uint8Array(pad)]);
}
const PCM_FMT = (function () {
  const d = new Uint8Array(16); const dv = new DataView(d.buffer);
  dv.setUint16(0, 1, true); dv.setUint16(2, 2, true); dv.setUint32(4, 44100, true);
  dv.setUint32(8, 176400, true); dv.setUint16(12, 4, true); dv.setUint16(14, 16, true); return d;
})();
const PCM_DATA = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0]);

const META = {
  fields: {
    TIT2: "Nuit blanche", TPE1: "L\u00e9a Marchand", TALB: "Ateliers", TPE2: "Divers",
    TYER: "2026", TCON: "\u00c9lectro", TRCK: "3/12"
  },
  comment: "Note de session",
  picture: { mime: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), pictureType: 3 },
};

console.log("\nMP3");
t("round-trip: all fields, accents, cover survive", function () {
  const out = e.writeMp3(FAKE_MPEG, META);
  const r = e.readExistingId3v2(out);
  assert.equal(r.fields.TIT2, "Nuit blanche");
  assert.equal(r.fields.TPE1, "L\u00e9a Marchand");
  assert.equal(r.fields.TCON, "\u00c9lectro");
  assert.equal(r.fields.TRCK, "3/12");
  assert.equal(r.fields.COMM.text, "Note de session");
  assert.equal(r.picture.mime, "image/jpeg");
  assert.deepEqual(Array.from(r.picture.data), Array.from(META.picture.data));
});
t("audio payload is preserved byte-for-byte", function () {
  const out = e.writeMp3(FAKE_MPEG, META);
  const r = e.readExistingId3v2(out);
  assert.deepEqual(Array.from(out.subarray(r.tagSize)), Array.from(FAKE_MPEG));
});
t("re-saving twice does not stack tags or grow the file", function () {
  const once = e.writeMp3(FAKE_MPEG, META);
  const twice = e.writeMp3(once, META);
  assert.deepEqual(Array.from(twice), Array.from(once));
});
t("existing ID3v1 trailer is stripped", function () {
  const v1 = concat([latin1("TAG"), new Uint8Array(125)]);
  const out = e.writeMp3(concat([FAKE_MPEG, v1]), META);
  const r = e.readExistingId3v2(out);
  assert.deepEqual(Array.from(out.subarray(r.tagSize)), Array.from(FAKE_MPEG));
});
t("NUL-terminated text frame from another tagger reads clean", function () {
  // ID3v2 spec: strings MAY be NUL-terminated. Many taggers do this.
  const payload = concat([new Uint8Array([0]), latin1("Autre outil"), new Uint8Array([0])]);
  const file = concat([id3Tag([rawTextFrame("TIT2", payload)]), FAKE_MPEG]);
  const r = e.readExistingId3v2(file);
  assert.equal(r.fields.TIT2, "Autre outil", "got " + JSON.stringify(r.fields.TIT2));
});
t("NUL-padded UTF-16 text frame reads clean", function () {
  const body = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00, 0x00, 0x00]); // BOM "AB" NUL
  const file = concat([id3Tag([rawTextFrame("TPE1", concat([new Uint8Array([1]), body]))]), FAKE_MPEG]);
  const r = e.readExistingId3v2(file);
  assert.equal(r.fields.TPE1, "AB", "got " + JSON.stringify(r.fields.TPE1));
});
t("clearing every field yields a readable file with no fields", function () {
  const tagged = e.writeMp3(FAKE_MPEG, META);
  const cleared = e.writeMp3(tagged, { fields: {}, comment: "", picture: null });
  const r = e.readExistingId3v2(cleared);
  assert.equal(Object.keys(r.fields).length, 0);
  assert.equal(r.picture, null);
  assert.deepEqual(Array.from(cleared.subarray(r.tagSize)), Array.from(FAKE_MPEG));
});

console.log("\nMP3 - studio frames");
const STUDIO = {
  fields: Object.assign({}, META.fields, {
    TBPM: "128", TKEY: "Am", TCOM: "J. Dupont", TPUB: "Label Maison", TSRC: "FRXXX2600001"
  }),
  comment: META.comment, picture: null,
};
t("BPM, key, composer, publisher and ISRC round-trip", function () {
  const r = e.readExistingId3v2(e.writeMp3(FAKE_MPEG, STUDIO));
  assert.equal(r.fields.TBPM, "128");
  assert.equal(r.fields.TKEY, "Am");
  assert.equal(r.fields.TCOM, "J. Dupont");
  assert.equal(r.fields.TPUB, "Label Maison");
  assert.equal(r.fields.TSRC, "FRXXX2600001");
});
t("studio frames do not disturb the ordinary ones", function () {
  const r = e.readExistingId3v2(e.writeMp3(FAKE_MPEG, STUDIO));
  assert.equal(r.fields.TIT2, "Nuit blanche");
  assert.equal(r.fields.TRCK, "3/12");
  assert.equal(r.fields.COMM.text, "Note de session");
});
t("a decimal BPM survives as written", function () {
  const meta = { fields: { TBPM: "128.5" }, comment: "", picture: null };
  assert.equal(e.readExistingId3v2(e.writeMp3(FAKE_MPEG, meta)).fields.TBPM, "128.5");
});
t("sharp/flat keys survive (they are not stripped as accidentals)", function () {
  for (const k of ["C#m", "Bbm", "F#", "Eb", "Am", "C"]) {
    const meta = { fields: { TKEY: k }, comment: "", picture: null };
    assert.equal(e.readExistingId3v2(e.writeMp3(FAKE_MPEG, meta)).fields.TKEY, k, "key " + k);
  }
});
t("clearing a studio frame removes it rather than writing an empty one", function () {
  const tagged = e.writeMp3(FAKE_MPEG, STUDIO);
  const cleared = e.writeMp3(tagged, { fields: { TIT2: "x" }, comment: "", picture: null });
  const r = e.readExistingId3v2(cleared);
  assert.equal(r.fields.TBPM, undefined);
  assert.equal(r.fields.TKEY, undefined);
});

console.log("\nWAV");
const BASE_WAV = riff([chunk("fmt ", PCM_FMT), chunk("data", PCM_DATA)]);
t("round-trip through id3 chunk", function () {
  const out = e.writeWav(BASE_WAV, META);
  const r = e.readWav(out);
  assert.equal(r.fields.TIT2, "Nuit blanche");
  assert.equal(r.fields.TPE1, "L\u00e9a Marchand");
  assert.equal(r.comment, "Note de session");
  assert.ok(r.picture, "cover lost");
});
t("LIST/INFO written for Windows Explorer", function () {
  const out = e.writeWav(BASE_WAV, META);
  const r = e.readWav(out);
  assert.equal(r.infoFields.INAM, "Nuit blanche");
  assert.equal(r.infoFields.IART, "L\u00e9a Marchand");
  assert.equal(r.infoFields.ICMT, "Note de session");
});
t("fmt/data chunks survive untouched", function () {
  const out = e.writeWav(BASE_WAV, META);
  const chunks = e.parseChunks(out);
  const data = chunks.find(function (c) { return c.id === "data"; });
  assert.ok(data, "data chunk gone");
  assert.deepEqual(Array.from(out.subarray(data.dataStart, data.dataEnd)), Array.from(PCM_DATA));
  assert.ok(chunks.find(function (c) { return c.id === "fmt "; }), "fmt chunk gone");
});
t("RIFF size header matches actual byte length", function () {
  const out = e.writeWav(BASE_WAV, META);
  const declared = new DataView(out.buffer, out.byteOffset).getUint32(4, true);
  assert.equal(declared + 8, out.length);
});
t("re-saving twice is stable", function () {
  const once = e.writeWav(BASE_WAV, META);
  const twice = e.writeWav(once, META);
  assert.deepEqual(Array.from(twice), Array.from(once));
});
t("odd-sized foreign chunk keeps RIFF word alignment", function () {
  const odd = riff([chunk("fmt ", PCM_FMT), chunk("cue ", new Uint8Array([1, 2, 3])), chunk("data", PCM_DATA)]);
  const out = e.writeWav(odd, META);
  const chunks = e.parseChunks(out);
  const data = chunks.find(function (c) { return c.id === "data"; });
  assert.ok(data, "data chunk lost after odd-sized chunk");
  assert.deepEqual(Array.from(out.subarray(data.dataStart, data.dataEnd)), Array.from(PCM_DATA));
});
t("studio frames survive in a WAV through the id3 chunk", function () {
  const out = e.writeWav(BASE_WAV, STUDIO);
  const r = e.readWav(out);
  assert.equal(r.fields.TBPM, "128");
  assert.equal(r.fields.TKEY, "Am");
  assert.equal(r.fields.TSRC, "FRXXX2600001");
});
t("WAV tagged only with LIST/INFO exposes its title to the app", function () {
  // Explorer / Audacity write INFO only, no id3 chunk.
  const info = concat([latin1("INFO"),
    chunk("INAM", concat([latin1("Titre existant"), new Uint8Array([0])])),
    chunk("IART", concat([latin1("Artiste existant"), new Uint8Array([0])]))]);
  const wav = riff([chunk("fmt ", PCM_FMT), chunk("LIST", info), chunk("data", PCM_DATA)]);
  const r = e.readWav(wav);
  assert.equal(r.infoFields.INAM, "Titre existant");
  // the app reads meta.fields - if INFO does not feed it, the editor opens blank
  assert.equal(r.fields.TIT2, "Titre existant",
    "fields.TIT2 is " + JSON.stringify(r.fields.TIT2) + " while INFO holds the title");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
