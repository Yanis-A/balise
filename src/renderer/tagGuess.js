// Recovers BPM and musical key from what is already written on a file:
// the file name first, then the title, then the comment. Producers routinely
// carry that information in the file name only, and it is lost otherwise.
//
// The patterns below were tuned against a real 2600-file beat library rather
// than invented examples, which is why they look the way they do. The dominant
// convention there is "<title> prod <who> <NNN>bpm <KEY>", with the key written
// as "Dsharpmin" / "EbMaj" / "F#min" / "Cmin", frequently glued straight onto
// the tempo ("120bpmDmin", "122Emin"). Accidentals are spelled out far more
// often than they are written as symbols: in that library, 242 names use
// "sharp" against 29 using "#".
//
// Loaded as a plain <script> by the renderer and required directly by the tests,
// so it must stay dependency-free and touch no DOM.
"use strict";

(function (root) {
  // Camelot wheel -> ID3 TKEY. 8A/8B are the canonical anchors (A minor / C major).
  var CAMELOT = {
    "1A": "Abm", "1B": "B", "2A": "Ebm", "2B": "F#", "3A": "Bbm", "3B": "Db",
    "4A": "Fm", "4B": "Ab", "5A": "Cm", "5B": "Eb", "6A": "Gm", "6B": "Bb",
    "7A": "Dm", "7B": "F", "8A": "Am", "8B": "C", "9A": "Em", "9B": "G",
    "10A": "Bm", "10B": "D", "11A": "F#m", "11B": "A", "12A": "C#m", "12B": "E"
  };

  // A bare number is only a tempo inside this range; outside it we are almost
  // certainly looking at a year, a track number or a bitrate.
  var BPM_MIN = 40;
  var BPM_MAX = 300;

  // Shared fragments. The accidental may be a symbol or spelled out ("sharp"
  // dominates, "s" is an occasional shorthand as in "Csmin"); the mode is
  // min/minor/maj/major or a bare "m".
  var ACC = "(#|b|sharp|flat|s)?";
  var MODE = "(min(?:or)?|maj(?:or)?|m)";
  // A key may start after a delimiter, straight after "bpm", or straight after a
  // two-or-three-digit tempo. The digit count matters: allowing a single digit
  // would read "3am oldschool" as A minor.
  var PRE = "(?:^|[\\s\\-_\\[\\]()]|bpm|(?:^|[\\s\\-_\\[\\]()])\\d{2,3})";
  // What may follow: end, a delimiter, a digit ("Emaj128bpm"), or the sign of a
  // cents offset ("Gsharpmin-44cents", "Gmin+44cents") — which is then dropped,
  // TKEY having no room for it.
  var POST = "(?=$|[\\s\\-_\\[\\]()\\d+])";

  function plausibleBpm(n) {
    return isFinite(n) && n >= BPM_MIN && n <= BPM_MAX;
  }

  function normaliseBpm(raw) {
    var v = parseFloat(String(raw).replace(",", "."));
    // ID3 TBPM is a numeric string; keep decimals only when they carry something.
    return (Math.round(v * 1000) % 1000 === 0) ? String(Math.round(v)) : String(v);
  }

  function findBpm(text) {
    if (!text) return null;
    var m;

    // 1. explicitly labelled, either order: "128 BPM", "BPM 128", "128bpm".
    //    No \b after "bpm": the key is often glued straight onto it
    //    ("120bpmDmin", "195bpmw"), and \b fails between two word characters.
    m = text.match(/(\d{2,3}(?:[.,]\d+)?)\s*bpm/i);
    if (m && plausibleBpm(parseFloat(m[1].replace(",", ".")))) return normaliseBpm(m[1]);
    m = text.match(/\bbpm\s*[-:_ ]?\s*(\d{2,3}(?:[.,]\d+)?)/i);
    if (m && plausibleBpm(parseFloat(m[1].replace(",", ".")))) return normaliseBpm(m[1]);

    // 2. a tempo glued straight onto the key, with no "bpm" word at all
    //    ("122Emin", "128ebmin"). Anchored on the key shape that follows, so a
    //    stray number cannot be swept up by accident.
    m = text.match(/(?:^|[\s\-_\[\]()])(\d{2,3})(?=[A-Ga-g](?:#|b|sharp|flat|s)?(?:min|maj|m))/i);
    if (m && plausibleBpm(parseFloat(m[1]))) return normaliseBpm(m[1]);

    // 3. a delimiter-isolated number, as in "Track_128_Am" or "beat 130".
    //    Numbers in round brackets are ranked last: in sample packs, "808 (60)"
    //    and "clap (58)" are variation indexes, not tempos.
    var re = /(^|[\s\-_\[\]()])(\d{2,3}(?:[.,]\d+)?)(?=$|[\s\-_\[\]()])/g;
    var best = null, parenthesised = null;
    while ((m = re.exec(text)) !== null) {
      var tail = text.slice(m.index + m[0].length);
      if (/^\s*(k?bps|k?hz|bits?|ko|mo|mb|kb)\b/i.test(tail)) continue;
      if (!plausibleBpm(parseFloat(m[2].replace(",", ".")))) continue;
      if (m[1] === "(" || tail.charAt(0) === ")") {
        if (parenthesised === null) parenthesised = m[2];
      } else if (best === null) {
        best = m[2];
      }
    }
    if (best !== null) return normaliseBpm(best);
    if (parenthesised !== null) return normaliseBpm(parenthesised);
    return null;
  }

  // Accidentals come spelled out far more often than as symbols in practice
  // ("Dsharpmin", "Gbmin", "F#m", "Csmin"), so every spelling is accepted.
  function normaliseKey(letter, accidental, mode) {
    var k = letter.toUpperCase();
    var a = (accidental || "").toLowerCase();
    if (a === "#" || a === "sharp" || a === "s") k += "#";
    else if (a === "b" || a === "flat") k += "b";
    return isMinor(mode) ? k + "m" : k;
  }

  // "min"/"minor"/"m" are minor; "maj"/"major" are major. Case varies wildly in
  // the wild ("Maj", "min", "MAJ"), so this must not be case-sensitive.
  function isMinor(mode) {
    return !!mode && /^m(?!aj)/i.test(mode);
  }

  function findKey(text) {
    if (!text) return null;
    var m;

    // 1. Camelot ("8A") or Open Key ("8m" / "8d") notation, delimiter-isolated.
    //    The letter must touch the digit — allowing a space would turn an
    //    innocent "5 A Day" into a key.
    m = text.match(/(?:^|[\s\-_\[\]()])(1[0-2]|[1-9])([ABab])(?=$|[\s\-_\[\]()])/);
    if (m && CAMELOT[m[1] + m[2].toUpperCase()]) return CAMELOT[m[1] + m[2].toUpperCase()];
    m = text.match(/(?:^|[\s\-_\[\]()])(1[0-2]|[1-9])([md])(?=$|[\s\-_\[\]()])/);
    if (m) {
      // Open Key: Nm == Camelot NA (minor), Nd == Camelot NB (major)
      var open = m[1] + (m[2].toLowerCase() === "m" ? "A" : "B");
      if (CAMELOT[open]) return CAMELOT[open];
    }

    // 2. explicitly labelled: "Key: Am", "key - F#min", "tonalite Dm"
    m = text.match(/\b(?:key|tonalit[ée]|cl[ée])\s*[-:_ ]\s*([A-Ga-g])\s*(#|b|sharp|flat)?\s*(min(?:or)?|maj(?:or)?|m)?\b/i);
    if (m) return normaliseKey(m[1], m[2], m[3]);

    // 3. a key with its mode attached — the overwhelmingly common case:
    //    "Dsharpmin", "EbMaj", "F#min", "Cmin", "Am", "120bpmDmin", "122Emin".
    //    At most one space is tolerated inside the key, so a fragment like
    //    "d 4min" cannot masquerade as D minor.
    m = text.match(new RegExp(PRE + "([A-Ga-g])\\s?" + ACC + "\\s?" + MODE + POST, "i"));
    if (m) return normaliseKey(m[1], m[2], m[3]);

    // 4. an accidental with no mode at all: "C#", "Eb". A bare letter is never
    //    enough — an "F" in a title is far more likely to be a word than a key.
    m = text.match(/(?:^|[\s\-_\[\]()]|bpm)([A-Ga-g])(#|sharp|flat)(?=$|[\s\-_\[\]()\d+])/i);
    if (m) return normaliseKey(m[1], m[2], null);
    m = text.match(/(?:^|[\s\-_\[\]()])([A-G])(b)(?=$|[\s\-_\[\]()\d+])/);
    if (m) return normaliseKey(m[1], m[2], null);

    return null;
  }

  // Strips the extension so ".mp3" cannot be mistaken for anything.
  function baseName(name) {
    return String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  }

  /* ---------------- title and artist ----------------
     Two opposite conventions live side by side in a real library:
       - downloads:  "ARTISTE - TITRE"           (the near-universal one)
       - SpotiDownloader: "<site> - TITRE - ARTISTE"  (artist LAST)
       - own productions: "TITRE prod <qui> <bpm> <cle>"
     The site prefix is what tells the first two apart; there is no other signal,
     both being "X - Y". Everything else is noise stripping. */

  var SITE_TAIL = /\s*[-_]\s*[A-Za-z0-9][A-Za-z0-9-]*\.(?:com|net|org|io|cc|me|to)\b\s*/gi;
  var SITE_HEAD = /^\s*[A-Za-z0-9][A-Za-z0-9-]*\.(?:com|net|org|io|cc|me|to)\s*-\s*/i;
  // WAV exports get split into numbered parts by some editors
  var PART_TAIL = /\s*[-_]\s*Part[_ ]?\d+\s*$/i;
  var PROMO = /[\[(]\s*(?:official[^\])]*|lyrics?(?:\s+video)?|lyric video|audio|hd|hq|4k|visuali[sz]er|music video|clip officiel|paroles)\s*[\])]/gi;
  var TRACK_NO = /^\s*\d{1,2}\s*[.\-_]\s*(?=\D)|^\s*\d{1,2}\s+(?=[A-Za-z])/;
  var PROD_RE = /\b(?:re)?prod(?:\.|uced|uit|by)?\b/i;
  var BPM_TOKEN = /\d{2,3}(?:[.,]\d+)?\s*bpm|\bbpm\s*[-:_ ]?\s*\d{2,3}/i;
  var KEY_TOKEN = new RegExp(PRE + "[A-Ga-g]\\s?(?:#|b|sharp|flat|s)?\\s?(?:min(?:or)?|maj(?:or)?|m)" + POST, "i");

  function tidy(s) {
    return String(s || "")
      .replace(/[\s_]+/g, " ")
      .replace(/^[\s\-–—_,.+&]+/, "")
      .replace(/[\s\-–—_,.+&]+$/, "")
      .trim();
  }

  function cleanName(name) {
    var s = baseName(name);
    var fromSite = SITE_HEAD.test(s);
    s = s.replace(PART_TAIL, "");
    s = s.replace(SITE_HEAD, "");
    s = s.replace(SITE_TAIL, " ");
    s = s.replace(PROMO, " ");
    s = s.replace(TRACK_NO, "");
    // slug-style names carry separators instead of spaces
    if (!/\s/.test(s) && s.indexOf("_") !== -1) s = s.replace(/_/g, " ");
    if (!/\s/.test(s) && (s.match(/-/g) || []).length >= 3) s = s.replace(/-/g, " ");
    return { text: s.replace(/\s{2,}/g, " ").trim(), fromSite: fromSite };
  }

  function indexOfMatch(text, re) {
    var m = text.match(re);
    return m ? m.index : -1;
  }

  // A production name: the title leads, then prod / tempo / key markers.
  function productionSplit(text) {
    var candidates = [];
    var a = indexOfMatch(text, PROD_RE), b = indexOfMatch(text, BPM_TOKEN), c = indexOfMatch(text, KEY_TOKEN);
    if (a > 0) candidates.push(a);
    if (b > 0) candidates.push(b);
    if (c > 0) candidates.push(c);
    if (!candidates.length) return null;

    var cut = Math.min.apply(null, candidates);
    var head = text.slice(0, cut), tail = text.slice(cut);

    // "elouan et vesper - la vie est dure ... 140bpm": here the artist really is first
    var dash = head.match(/^(.{2,}?)\s+[-–—]\s+(.+)$/);
    if (dash) return { title: tidy(dash[2]), artist: tidy(dash[1]) };

    var title = tidy(head), artist = null;
    var pm = tail.match(PROD_RE);
    if (pm) {
      var after = tail.slice(pm.index + pm[0].length).split(BPM_TOKEN)[0].replace(KEY_TOKEN, " ");
      artist = tidy(after.replace(/@/g, ""));
    }
    if (!artist) {
      var handles = text.match(/@[A-Za-z0-9._-]+/g);
      if (handles) artist = handles.map(function (h) { return h.slice(1); }).join(", ");
    }
    if (!artist) {
      var w = tail.match(/\bw\s+([A-Za-z0-9@._][^\d]*)$/i);
      if (w) artist = tidy(w[1].replace(/@/g, ""));
    }
    return { title: title || null, artist: artist || null };
  }

  // Returns { title, artist } — either may be null when the name does not say.
  function findNames(name) {
    var c = cleanName(name);
    if (!c.text) return { title: null, artist: null };

    var prod = productionSplit(c.text);
    if (prod && prod.title) return prod;

    var segs = c.text.split(/\s+[-–—]\s+/).map(tidy).filter(Boolean);
    if (segs.length >= 2) {
      if (c.fromSite) return { title: segs[0], artist: segs[segs.length - 1] };
      return { title: segs.slice(1).join(" - "), artist: segs[0] };
    }
    return { title: tidy(c.text) || null, artist: null };
  }

  // sources: { fileName, title, comment, album }
  // Returns { bpm, key, bpmFrom, keyFrom } — null for whatever could not be found.
  function guess(sources) {
    sources = sources || {};
    var ordered = [
      { label: "nom du fichier", text: baseName(sources.fileName) },
      { label: "titre", text: sources.title },
      { label: "album", text: sources.album },
      { label: "commentaire", text: sources.comment }
    ];
    var out = { bpm: null, key: null, title: null, artist: null, bpmFrom: null, keyFrom: null };
    for (var i = 0; i < ordered.length; i++) {
      var src = ordered[i];
      if (!src.text) continue;
      if (out.bpm === null) {
        var b = findBpm(src.text);
        if (b !== null) { out.bpm = b; out.bpmFrom = src.label; }
      }
      if (out.key === null) {
        var k = findKey(src.text);
        if (k !== null) { out.key = k; out.keyFrom = src.label; }
      }
    }
    // Title and artist come from the file name only: a title tag that already
    // exists is not evidence about the artist, and re-parsing it would just
    // shuffle what the user already has.
    if (sources.fileName) {
      var names = findNames(sources.fileName);
      out.title = names.title;
      out.artist = names.artist;
    }
    return out;
  }

  var api = {
    guess: guess, findBpm: findBpm, findKey: findKey, findNames: findNames, CAMELOT: CAMELOT
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.tagGuess = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
