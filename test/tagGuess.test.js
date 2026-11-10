"use strict";
const assert = require("node:assert");
const g = require("../src/renderer/tagGuess.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (err) { console.log("  FAIL " + name + "\n       " + err.message); fail++; }
}
function bpm(s) { return g.findBpm(s); }
function key(s) { return g.findKey(s); }

console.log("\nBPM - detection");
t("labelled, both orders and spellings", function () {
  assert.equal(bpm("Track 128 BPM"), "128");
  assert.equal(bpm("Track 174bpm"), "174");
  assert.equal(bpm("BPM 92 - rough mix"), "92");
  assert.equal(bpm("bpm: 140"), "140");
});
t("delimiter-isolated number in a file name", function () {
  assert.equal(bpm("Track_128_Am"), "128");
  assert.equal(bpm("Loop - 174 - Dm"), "174");
  assert.equal(bpm("Bounce [96] final"), "96");
});
t("decimal tempo survives, integer stays integer", function () {
  assert.equal(bpm("groove 128.5 bpm"), "128.5");
  assert.equal(bpm("groove 128,5 bpm"), "128.5");
  assert.equal(bpm("groove 128.0 bpm"), "128");
});

console.log("\nBPM - false positives that must NOT match");
t("a year is not a tempo", function () {
  assert.equal(bpm("Sunset Remix 2026"), null);
  assert.equal(bpm("Live 1997"), null);
});
t("a track number is not a tempo", function () {
  assert.equal(bpm("01 - Intro"), null);
  assert.equal(bpm("07 Interlude"), null);
});
t("a bitrate or sample rate is not a tempo", function () {
  assert.equal(bpm("podcast 160kbps"), null);
  assert.equal(bpm("podcast 160 kbps"), null);
  assert.equal(bpm("master 96 kHz"), null);
  assert.equal(bpm("master 24 bit"), null);
});

console.log("\nTonalite - detection");
t("plain notation with mode", function () {
  assert.equal(key("Track_128_Am"), "Am");
  assert.equal(key("Nuit Bb minor"), "Bbm");
  assert.equal(key("Ballade C major"), "C");
  assert.equal(key("Rise F#m version"), "F#m");
});
t("accidental alone is enough", function () {
  assert.equal(key("Intro C# take2"), "C#");
  assert.equal(key("Theme Eb"), "Eb");
});
t("explicit label, French or English", function () {
  assert.equal(key("Key: Am"), "Am");
  assert.equal(key("key - F#min"), "F#m");
  assert.equal(key("tonalite - Dm"), "Dm");
});
t("Camelot wheel maps to ID3 keys", function () {
  assert.equal(key("Deep House 8A 124"), "Am");   // canonical anchor
  assert.equal(key("Loop - 9A - 174"), "Em");
  assert.equal(key("Set 12B final"), "E");
  assert.equal(key("Roller [11A]"), "F#m");
});
t("Open Key notation maps too", function () {
  assert.equal(key("Track 8m"), "Am");   // 8m == Camelot 8A
  assert.equal(key("Track 8d"), "C");    // 8d == Camelot 8B
});

console.log("\nTonalite - false positives that must NOT match");
t("a key letter inside a word is not a key", function () {
  assert.equal(key("Amsterdam Nights"), null);
  assert.equal(key("Dance Macabre"), null);
  assert.equal(key("Gmbh Session"), null);
});
t("a bare letter with no mode and no accidental is not a key", function () {
  assert.equal(key("Vitamin F"), null);
  assert.equal(key("Plan B"), null);
});
t("a digit followed by a spaced letter is not Camelot", function () {
  assert.equal(key("Song 5 A Day"), null);
  assert.equal(key("Take 12 B roll"), null);
});

console.log("\nguess() - source priority");
t("file name wins over title and comment", function () {
  const r = g.guess({ fileName: "Track_128_Am.wav", title: "Autre 90 BPM Dm", comment: "" });
  assert.equal(r.bpm, "128");
  assert.equal(r.key, "Am");
  assert.equal(r.bpmFrom, "nom du fichier");
});
t("falls through to the title when the file name is silent", function () {
  const r = g.guess({ fileName: "final_master_v3.wav", title: "Horizon 92 BPM Fm" });
  assert.equal(r.bpm, "92");
  assert.equal(r.key, "Fm");
  assert.equal(r.bpmFrom, "titre");
  assert.equal(r.keyFrom, "titre");
});
t("BPM and key may come from different sources", function () {
  const r = g.guess({ fileName: "Track_128_master.wav", comment: "enregistre en Gm" });
  assert.equal(r.bpm, "128");
  assert.equal(r.bpmFrom, "nom du fichier");
  assert.equal(r.key, "Gm");
  assert.equal(r.keyFrom, "commentaire");
});
t("extension never leaks into the result", function () {
  const r = g.guess({ fileName: "Track.mp3" });
  assert.equal(r.bpm, null);
  assert.equal(r.key, null);
});
t("nothing to find yields nulls, not throws", function () {
  const r = g.guess({});
  assert.deepEqual([r.bpm, r.key, r.bpmFrom, r.keyFrom], [null, null, null, null]);
});

// Real names from a 2600-file beat library. These are the conventions the
// detector actually has to survive; the invented cases above only cover the
// textbook spellings. Each line below broke an earlier version of the module.
console.log("\nNoms reels - bibliotheque de beats");
function both(name) { const r = g.guess({ fileName: name }); return [r.bpm, r.key]; }

t("the house style: '<titre> prod <qui> <NNN>bpm <CLE>'", function () {
  assert.deepEqual(both("papa prod vesper + 4minchrono 145bpm Dsharpmin.mp3"), ["145", "D#m"]);
  assert.deepEqual(both("occultation prod vesper + 4minchrono 140bpm GsharpMaj.mp3"), ["140", "G#"]);
  assert.deepEqual(both("cries prod vesper 130bpm EbMaj.mp3"), ["130", "Eb"]);
  assert.deepEqual(both("kunai prod vesper 132bpm AMaj.mp3"), ["132", "A"]);
});
t("'sharp' spelled out, which outnumbers '#' eight to one", function () {
  assert.equal(g.findKey("145bpm Dsharpmin"), "D#m");
  assert.equal(g.findKey("140bpm GsharpMaj"), "G#");
  assert.equal(g.findKey("156bpm Fsharpmin"), "F#m");
});
t("key glued straight onto the tempo, no separator", function () {
  assert.deepEqual(both("NORTHBELL - 120bpmDmin - dunmore + 4minchrono + vesper.mp3"), ["120", "Dm"]);
  assert.deepEqual(both("LUTINERIE - 150bpmGbmin - 4minchrono + vesper + dunmore.mp3"), ["150", "Gbm"]);
  assert.deepEqual(both("SUBKEEPER - 126bpmG#min - dunmore + vesper + 4min.mp3"), ["126", "G#m"]);
});
t("tempo glued after the key, and with no 'bpm' word at all", function () {
  assert.deepEqual(both("WREN - Emaj128bpm - dunmore + vesper.mp3"), ["128", "E"]);
  assert.deepEqual(both("regalia w unclebac 122Emin.mp3"), ["122", "Em"]);
  assert.deepEqual(both("reprod siwah 128ebmin 2.wav"), ["128", "Ebm"]);
});
t("a cents offset is dropped, the key survives", function () {
  assert.deepEqual(both("stacked prod vesper centsflp 153bpm Gsharpmin-44cents.mp3"), ["153", "G#m"]);
  assert.deepEqual(both("frail prod vesper nasty 143bpm Gmin+44cents.mp3"), ["143", "Gm"]);
});
t("'s' as a shorthand for sharp", function () {
  assert.deepEqual(both("ouailletouquet p vesper 4minchrono 93bpm Csmin.mp3"), ["93", "C#m"]);
});
t("decimal tempos, comma or dot", function () {
  assert.equal(g.findBpm("demitempo prod 4min x vesper 118.5bpm"), "118.5");
  assert.equal(g.findBpm("cedarwood 120,9bpm prod vesper"), "120.9");
});
t("a labelled tempo outranks a trailing sample index in brackets", function () {
  assert.deepEqual(both("beijing prod vesper 129bpm Amin_[HiH4T] - $$$ (@demo.handle)  (22).wav"), ["129", "Am"]);
});
t("'4min' in a collaborator name is never a key", function () {
  assert.equal(g.findKey("sedation prod vesper 135bpm"), null);
  assert.equal(g.findKey("prod à decouper si t'es sur les nerfs (vesper 4min)"), null);
  assert.equal(g.findKey("2303 - 102bpm w vesper"), null);
});
t("'3am' is a time of day, not the key of A minor", function () {
  assert.deepEqual(both("3am oldschool.wav"), [null, null]);
  assert.deepEqual(both("3AM HARD FLIP.mp3"), [null, null]);
});
t("'min' inside an ordinary word is not a key", function () {
  assert.equal(g.findKey("ragazzaa w austin_@Terminator - (Xero) Vexxed Open Hat"), null);
});
t("names carrying nothing yield nothing", function () {
  assert.deepEqual(both("fallingstarr_2.wav"), [null, null]);
  assert.deepEqual(both("nothingmatters edit video.wav"), [null, null]);
  assert.deepEqual(both("trippisse.mp3"), [null, null]);
});

// Titles and artists. Two opposite conventions coexist in a real library and
// both are "X - Y", so the only signal separating them is the downloader prefix.
console.log("\nTitre / artiste");
function names(n) { const r = g.findNames(n); return [r.artist, r.title]; }

t("the universal convention: 'ARTISTE - TITRE'", function () {
  assert.deepEqual(names("annette peacock - nothing outside us.mp3"), ["annette peacock", "nothing outside us"]);
  assert.deepEqual(names("Kotton the Cutie - I Just Wanna.mp3"), ["Kotton the Cutie", "I Just Wanna"]);
  assert.deepEqual(names("A primary industry - At Gunpoint (1984).mp3"), ["A primary industry", "At Gunpoint (1984)"]);
});
t("SpotiDownloader inverts it: '<site> - TITRE - ARTISTE'", function () {
  assert.deepEqual(names("SpotiDownloader.com - Innerbloom - RÜFÜS DU SOL.mp3"), ["RÜFÜS DU SOL", "Innerbloom"]);
  assert.deepEqual(names("SpotiDownloader.com - S.O.S - Indila.mp3"), ["Indila", "S.O.S"]);
  assert.deepEqual(names("SpotiDownloader.com - Don't You Worry Child - Radio Edit - Swedish House Mafia.mp3"),
    ["Swedish House Mafia", "Don't You Worry Child"]);
});
t("own productions: 'TITRE prod <qui> <bpm> <cle>'", function () {
  assert.deepEqual(names("papa prod vesper + 4minchrono 145bpm Dsharpmin.mp3"), ["vesper + 4minchrono", "papa"]);
  assert.deepEqual(names("etrange prod vesper 122bpm Cmin.mp3"), ["vesper", "etrange"]);
  assert.deepEqual(names("padstage prod vesper + dunmore 156bpm Fsharpmin.mp3"), ["vesper + dunmore", "padstage"]);
});
t("a dash before the tempo still means 'ARTISTE - TITRE'", function () {
  assert.deepEqual(names("elouan et vesper - la vie est dure GsharpMaj 140bpm.wav"),
    ["elouan et vesper", "la vie est dure"]);
});
t("'w <qui>' and @handles name the artist too", function () {
  assert.deepEqual(names("2303 - 102bpm w vesper.mp3"), ["vesper", "2303"]);
  assert.deepEqual(names("imakebeats 140 bpm c# minor @santanajuug.mp3"), ["santanajuug", "imakebeats"]);
});
t("the ' - Part_N' split marker is stripped", function () {
  assert.deepEqual(names("annette peacock - nothing outside us - Part_3.wav"),
    ["annette peacock", "nothing outside us"]);
  assert.deepEqual(names("SpotiDownloader.com - Language - Porter Robinson - Part_4.wav"),
    ["Porter Robinson", "Language"]);
});
t("downloader watermarks and promo tags are stripped", function () {
  assert.deepEqual(names("TWERL & Ekko - Under Bright Lights - JPKy - SoundLoadMate.com.mp3"),
    ["TWERL & Ekko", "Under Bright Lights - JPKy"]);
  assert.equal(g.findNames("BAD BUNNY - TURiSTA (Visualizer).mp3").title, "TURiSTA");
  assert.equal(g.findNames("Some Band - Real Title [Official Video].mp3").title, "Real Title");
});
t("a leading track number is not part of the title", function () {
  assert.deepEqual(names("09 Swedish Ivy.mp3"), [null, "Swedish Ivy"]);
});
t("slug names get their separators back", function () {
  assert.deepEqual(names("i-believe-i-can-fly-mcro-edit.mp3"), [null, "i believe i can fly mcro edit"]);
});
t("a name with no separator yields a title and no artist", function () {
  assert.deepEqual(names("fallingstarr.wav"), [null, "fallingstarr"]);
  assert.deepEqual(names("Claire Thomas & Susan Vezey Bright Waves.mp3"),
    [null, "Claire Thomas & Susan Vezey Bright Waves"]);
});
t("tempo and key never leak into the title", function () {
  const r = g.guess({ fileName: "knocks prod vesper 140bpm Gsharpmin.mp3" });
  assert.equal(r.title, "knocks");
  assert.equal(r.artist, "vesper");
  assert.equal(r.bpm, "140");
  assert.equal(r.key, "G#m");
});

console.log("\nCamelot table integrity");
t("24 codes, all valid ID3 TKEY strings (max 3 chars)", function () {
  const codes = Object.keys(g.CAMELOT);
  assert.equal(codes.length, 24);
  for (const c of codes) {
    const v = g.CAMELOT[c];
    assert.ok(v.length <= 3, c + " -> " + v + " exceeds the 3-char TKEY limit");
    assert.ok(/^[A-G][#b]?m?$/.test(v), c + " -> " + v + " is not a valid TKEY");
  }
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
