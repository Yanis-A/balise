"use strict";
// UI tests against the real running app, driven over the Chrome DevTools Protocol.
// Launches Electron itself, runs the suites, shuts it down. No dependencies:
// Node's global fetch and WebSocket are enough.
//
//   npm run test:ui
//
// Everything goes through window.__test / window.api — the same entry points the
// native dialog and drag & drop use — so these exercise the real code paths.
// Expected wording is read from window.__test.strings rather than hard-coded, so
// the suite passes whatever language the machine resolves to.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 9223; // not 9222, so a hand-opened debug session does not collide
const APP_DIR = path.join(__dirname, "..");
const engine = require("../src/metadataEngine.js");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); pass++; }
  else { console.log("  FAIL " + name + (detail ? "\n       " + detail : "")); fail++; }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------------- CDP driver ---------------- */

function launch() {
  // VS Code exports ELECTRON_RUN_AS_NODE=1, which makes require("electron")
  // return a path string instead of the module — strip it or the app cannot boot.
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const bin = require(path.join(APP_DIR, "node_modules", "electron"));
  // a CI runner has no setuid sandbox helper, and Electron will not start without one
  const extra = process.platform === "linux" && process.env.CI ? ["--no-sandbox"] : [];
  return spawn(bin, [APP_DIR, "--remote-debugging-port=" + PORT].concat(extra), { env: env, stdio: "ignore" });
}

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://127.0.0.1:" + PORT + "/json/list");
      const t = (await res.json()).find(function (x) { return x.type === "page" && x.webSocketDebuggerUrl; });
      if (t) return t;
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("the app never became debuggable on port " + PORT);
}

function connect(url) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket(url);
    ws.onopen = function () { resolve(ws); };
    ws.onerror = function () { reject(new Error("could not attach to the renderer")); };
  });
}

let msgId = 1;
function evaluator(ws) {
  return function evaluate(expression) {
    return new Promise(function (resolve, reject) {
      const id = msgId++;
      function onMsg(ev) {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.id !== id) return;
        ws.removeEventListener("message", onMsg);
        if (m.error) return reject(new Error(JSON.stringify(m.error)));
        if (m.result && m.result.exceptionDetails) {
          return reject(new Error("page threw: " + JSON.stringify(m.result.exceptionDetails.exception || m.result.exceptionDetails)));
        }
        resolve(m.result && m.result.result ? m.result.result.value : undefined);
      }
      ws.addEventListener("message", onMsg);
      ws.send(JSON.stringify({
        id: id, method: "Runtime.evaluate",
        params: { expression: expression, returnByValue: true, awaitPromise: true }
      }));
    });
  };
}

// The page target exists as soon as the document does, which is before the
// scripts have run. Wait for the renderer to actually be ready, or the first
// suite races it and fails on an undefined window.__test.
async function waitForRenderer(ev) {
  for (let i = 0; i < 40; i++) {
    const ready = await ev("typeof window.__test === 'object' && typeof window.tagGuess === 'object' && typeof window.strings === 'object'");
    if (ready === true) return;
    await sleep(250);
  }
  throw new Error("the renderer never finished loading (window.__test missing)");
}

function fakeMeta(extra) {
  return JSON.stringify(Object.assign({
    path: "D:\\musique\\Sample.mp3", name: "Sample.mp3", size: 1024, type: "mp3",
    title: "Titre", artist: "Artiste", albumArtist: "", album: "", year: "", genre: "",
    trackNo: "", trackTotal: "", bpm: "", key: "", composer: "", publisher: "", isrc: "",
    comment: "", picture: null
  }, extra));
}

/* ---------------- suites ---------------- */

async function suiteLayout(ev, T) {
  console.log("\nMise en page");
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({}) + "})");
  await sleep(200);

  const m = await ev(`(function(){
    var s = document.getElementById('sheet');
    return { scrollH: s.scrollHeight, clientH: s.clientHeight,
             winH: window.innerHeight, winW: window.innerWidth,
             fields: document.querySelectorAll('#sheet input[type=text]').length };
  })()`);
  // The whole point of this direction: every field visible at once, no scrolling.
  check("all 14 tag inputs are present", m.fields === 14, JSON.stringify(m));
  check("the form fits with no scrolling", m.scrollH <= m.clientH + 1, JSON.stringify(m));

  const blank = await ev(`(function(){
    window.__test.handleAudioOpen(null);
    return null;
  })()`);
  void blank;

  const led = await ev("document.getElementById('led').className");
  check("the state light is lit for a clean file", led === "led", JSON.stringify(led));

  await ev("(function(){var e=document.getElementById('fTitle');e.value='autre';e.dispatchEvent(new Event('input'));})()");
  await sleep(120);
  const led2 = await ev("({cls:document.getElementById('led').className,status:document.getElementById('statusText').textContent})");
  check("editing turns the state light amber", /dirty/.test(led2.cls), JSON.stringify(led2));
  check("the status line says so too", led2.status === T.dirty, JSON.stringify(led2.status));
}

async function suiteCombo(ev, T) {
  console.log("\nCombobox genre / tonalite");
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({ name: "Track_128_Am.mp3", path: "D:\\musique\\Track_128_Am.mp3", title: "" }) + "})");
  await sleep(150);

  await ev("(function(){var i=document.getElementById('fGenre');i.focus();i.dispatchEvent(new Event('focus'));})()");
  await sleep(150);
  const m = await ev(`(function(){
    var el=document.getElementById('genreListbox'), r=el.getBoundingClientRect(), cs=getComputedStyle(el);
    return { hidden:el.hidden, top:Math.round(r.top), bottom:Math.round(r.bottom), height:Math.round(r.height),
             winH:window.innerHeight, scrollH:el.scrollHeight, clientH:el.clientHeight,
             overflowY:cs.overflowY, options:el.querySelectorAll('.combo-option').length };
  })()`);
  check("the list opens with every genre", m.hidden === false && m.options === T.genres.length, JSON.stringify(m));
  check("it stays inside the window", m.bottom <= m.winH && m.top >= 0,
    "top=" + m.top + " bottom=" + m.bottom + " window=" + m.winH);
  check("it is height-capped", m.height <= 210, "height=" + m.height);
  check("it scrolls instead of overflowing", m.overflowY === "auto" && m.scrollH > m.clientH,
    "scrollH=" + m.scrollH + " clientH=" + m.clientH);

  await ev("(function(){var el=document.getElementById('genreListbox');el.scrollTop=90;el.dispatchEvent(new Event('scroll',{bubbles:true}));})()");
  await sleep(120);
  const s = await ev("(function(){var el=document.getElementById('genreListbox');return {hidden:el.hidden,scrollTop:Math.round(el.scrollTop)};})()");
  check("scrolling inside it does not close it", s.hidden === false && s.scrollTop > 0, JSON.stringify(s));

  // accent-insensitive filtering, which only matters in the French list
  const accented = T.genres.filter(function (g) { return /[^\x00-\x7F]/.test(g); });
  if (accented.length) {
    const probe = accented[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3).toLowerCase();
    await ev("(function(){var i=document.getElementById('fGenre');i.value=" + JSON.stringify(probe) + ";i.dispatchEvent(new Event('input'));})()");
    await sleep(120);
    const n = await ev("document.getElementById('genreListbox').querySelectorAll('.combo-option').length");
    check("typing without accents still matches (" + probe + " -> " + accented[0] + ")",
      n > 0 && n < T.genres.length, "options=" + n);
  } else {
    check("no accented genre in this language, nothing to check", true);
  }

  await ev(`(function(){var i=document.getElementById('fGenre');
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
  await sleep(120);
  const committed = await ev("document.getElementById('fGenre').value");
  check("arrows + Enter commit a value", T.genres.indexOf(committed) !== -1, JSON.stringify(committed));

  // the key combo sits low in the form and must flip above the field
  await ev("(function(){var i=document.getElementById('fKey');i.focus();i.dispatchEvent(new Event('focus'));})()");
  await sleep(200);
  const k = await ev(`(function(){var el=document.getElementById('keyListbox'), r=el.getBoundingClientRect();
    return {top:Math.round(r.top),bottom:Math.round(r.bottom),winH:window.innerHeight,
            options:el.querySelectorAll('.combo-option').length,above:el.classList.contains('above')};})()`);
  check("the key list also stays inside the window", k.bottom <= k.winH && k.top >= 0, JSON.stringify(k));
  check("all 24 keys are offered", k.options === 24, "options=" + k.options);
}

async function suiteCleanOpen(ev, T) {
  console.log("\nEtat propre a l'ouverture");
  const cases = [
    ["a plain file", {}],
    ["a lower-case ISRC", { isrc: "frxxx2600001" }],
    ["an upper-case ISRC", { isrc: "FRXXX2600001" }],
    ["a tempo and a key", { bpm: "128", key: "Am" }],
    ["every studio field", { bpm: "174", key: "F#m", composer: "X", publisher: "Y", isrc: "frzzz2600009" }],
    ["an accented genre", { genre: T.genres[4] }],
  ];
  for (const [label, extra] of cases) {
    await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta(extra) + "})");
    await sleep(120);
    const st = await ev(`({disabled:document.getElementById('exportBtn').disabled,
                           reset:document.getElementById('resetBtn').disabled,
                           status:document.getElementById('statusText').textContent,
                           led:document.getElementById('led').className})`);
    check("opens unmodified with " + label,
      st.disabled === true && st.reset === true && st.status === T.clean && st.led === "led",
      JSON.stringify(st));
  }
}

async function suiteDetect(ev, T) {
  console.log("\nRemplissage depuis le nom");

  // The dominant real case: the exporter already wrote TBPM but never TKEY, and
  // the file name carries both. Detection must add the key and leave the rest.
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({
    name: "papa prod vesper 145bpm Dsharpmin.mp3",
    path: "D:\\musique\\papa prod vesper 145bpm Dsharpmin.mp3",
    bpm: "145", key: ""
  }) + "})");
  await sleep(150);
  await ev("document.getElementById('detectBtn').click()");
  await sleep(150);
  const dd = await ev(`(function(){
    var n = document.getElementById('detectNote');
    return {
      bpm: document.getElementById('fBpm').value,
      key: document.getElementById('fKey').value,
      title: document.getElementById('fTitle').value,
      chips: Array.from(n.querySelectorAll('.dn-chip')).map(function(c){
        return { label: c.querySelector('em').textContent, value: c.querySelector('span').textContent };
      }),
      skip: (n.querySelector('.dn-skip') || {}).textContent || ""
    };
  })()`);
  check("detection adds the missing key", dd.key === "D#m", JSON.stringify(dd));
  check("detection leaves the already-tagged tempo untouched", dd.bpm === "145", JSON.stringify(dd));
  check("detection leaves the already-tagged title untouched", dd.title === "Titre", JSON.stringify(dd));
  check("the result is one labelled chip per filled field",
    dd.chips.length === 1 && dd.chips[0].label === T.key.toLowerCase() && dd.chips[0].value === "D#m",
    JSON.stringify(dd.chips));
  check("the fields left alone are named separately",
    dd.skip.indexOf(T.title.toLowerCase()) !== -1 && dd.skip.indexOf(T.tempo.toLowerCase()) !== -1,
    JSON.stringify(dd.skip));

  // A downloaded file: no tags, the name carries "ARTIST - TITLE".
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({
    name: "annette peacock - nothing outside us.mp3",
    path: "D:\\musique\\annette peacock - nothing outside us.mp3",
    title: "", artist: ""
  }) + "})");
  await sleep(150);
  await ev("document.getElementById('detectBtn').click()");
  await sleep(150);
  const dl = await ev("({title:document.getElementById('fTitle').value,artist:document.getElementById('fArtist').value})");
  check("a downloaded file gets its artist and title from the name",
    dl.artist === "annette peacock" && dl.title === "nothing outside us", JSON.stringify(dl));

  // The same shape, written by a downloader that puts the artist last.
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({
    name: "SpotiDownloader.com - Innerbloom - RÜFÜS DU SOL.mp3",
    path: "D:\\musique\\SpotiDownloader.com - Innerbloom - RÜFÜS DU SOL.mp3",
    title: "", artist: ""
  }) + "})");
  await sleep(150);
  await ev("document.getElementById('detectBtn').click()");
  await sleep(150);
  const sp = await ev("({title:document.getElementById('fTitle').value,artist:document.getElementById('fArtist').value})");
  check("the inverted downloader convention is read the right way round",
    sp.artist === "RÜFÜS DU SOL" && sp.title === "Innerbloom", JSON.stringify(sp));

  // An own production: title, producer, tempo and key at once.
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({
    name: "knocks prod vesper 140bpm Gsharpmin.mp3",
    path: "D:\\musique\\knocks prod vesper 140bpm Gsharpmin.mp3",
    title: "", artist: "", bpm: "", key: ""
  }) + "})");
  await sleep(150);
  await ev("document.getElementById('detectBtn').click()");
  await sleep(150);
  const pr = await ev(`({title:document.getElementById('fTitle').value,artist:document.getElementById('fArtist').value,
                         bpm:document.getElementById('fBpm').value,key:document.getElementById('fKey').value})`);
  check("a production name fills all four fields at once",
    pr.title === "knocks" && pr.artist === "vesper" && pr.bpm === "140" && pr.key === "G#m", JSON.stringify(pr));

  const chips = await ev(`Array.from(document.querySelectorAll('#detectNote .dn-chip')).map(function(c){
    return c.querySelector('em').textContent + '=' + c.querySelector('span').textContent; }).join('|')`);
  const want = [T.title, T.artist, T.tempo, T.key].map(function (s) { return s.toLowerCase(); });
  check("four fields give four chips, each carrying its own label",
    chips === want[0] + "=knocks|" + want[1] + "=vesper|" + want[2] + "=140|" + want[3] + "=G#m",
    JSON.stringify(chips));

  // a value taken from a file name is user data and must not inject markup
  await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({
    name: "<img src=x onerror=alert(1)> - evil.mp3",
    path: "D:\\musique\\x.mp3", title: "", artist: ""
  }) + "})");
  await sleep(150);
  await ev("document.getElementById('detectBtn').click()");
  await sleep(150);
  const esc = await ev(`(function(){
    var n = document.getElementById('detectNote');
    return { imgs: n.querySelectorAll('img').length, artist: document.getElementById('fArtist').value };
  })()`);
  check("a file name cannot inject markup into the result",
    esc.imgs === 0 && esc.artist.indexOf("<img") === 0, JSON.stringify(esc));
}

async function suiteCover(ev, T) {
  console.log("\nPochette : poids et recompression");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "balise-cover-"));
  try {
    // A big PNG export is the case that matters: copied whole into the tag it
    // would add megabytes to a file that has to stay mailable.
    const bigPng = await ev(`(function(){
      var c = document.createElement('canvas'); c.width = 2000; c.height = 2000;
      var x = c.getContext('2d');
      var g = x.createLinearGradient(0,0,2000,2000);
      g.addColorStop(0,'#c2410c'); g.addColorStop(1,'#0c4a6e');
      x.fillStyle = g; x.fillRect(0,0,2000,2000);
      for (var i=0;i<9000;i++){ x.fillStyle='rgba('+((i*37)%255)+','+((i*91)%255)+',180,.35)';
        x.fillRect((i*613)%2000,(i*271)%2000,7,7); }
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    const pngPath = path.join(dir, "cover.png");
    fs.writeFileSync(pngPath, Buffer.from(bigPng, "base64"));
    const originalBytes = fs.statSync(pngPath).size;
    check("the test cover really is heavy", originalBytes > 1000000, originalBytes + " o");

    await ev("window.__test.handleAudioOpen({ok:true,meta:" + fakeMeta({}) + "})");
    await sleep(150);
    const res = await ev("window.api.openImagePath(" + JSON.stringify(pngPath) + ").then(function(r){window.__test.handleImageOpen(r);return {ok:r.ok,mime:r.mime,len:r.data.length,note:r.note};})");
    check("the cover was accepted", res.ok === true, JSON.stringify(res && res.mime));
    check("it was re-encoded to JPEG", res.mime === "image/jpeg", JSON.stringify(res.mime));
    check("it got much lighter", res.len < originalBytes / 10,
      humanish(originalBytes) + " -> " + humanish(res.len));
    check("the app reports what it did", res.note && res.note.from === originalBytes && res.note.px === 600,
      JSON.stringify(res.note));

    const shown = await ev("({text:document.getElementById('coverSize').textContent,title:document.getElementById('coverSize').title})");
    check("the weight is on screen, not silent", /\d/.test(shown.text), JSON.stringify(shown.text));
    check("the tooltip explains the reduction", shown.title.length > 30, JSON.stringify(shown.title));

    // a small tight JPEG must not be re-encoded and degraded for nothing
    const smallJpeg = path.join(dir, "small.jpg");
    const tiny = await ev(`(function(){
      var c=document.createElement('canvas'); c.width=120; c.height=120;
      var x=c.getContext('2d'); x.fillStyle='#333'; x.fillRect(0,0,120,120);
      return c.toDataURL('image/jpeg',0.5).split(',')[1];
    })()`);
    fs.writeFileSync(smallJpeg, Buffer.from(tiny, "base64"));
    const before = fs.statSync(smallJpeg).size;
    const r2 = await ev("window.api.openImagePath(" + JSON.stringify(smallJpeg) + ").then(function(r){return {len:r.data.length,note:r.note};})");
    check("a small cover is left exactly as it was",
      r2.len === before && !r2.note, before + " -> " + r2.len + " note=" + JSON.stringify(r2.note));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function humanish(n) { return (n / 1024).toFixed(0) + " Ko"; }

async function suiteRoundTrip(ev, T) {
  console.log("\nAller-retour sur un vrai fichier");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "balise-"));
  const file = path.join(dir, "Nuit_Blanche_128_Am.mp3");
  const audio = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(2048, 0x55)]);
  const seeded = engine.writeMp3(new Uint8Array(audio), {
    fields: { TIT2: "Ancien titre", TPE1: "Ancien artiste" }, comment: "", picture: null,
  });
  fs.writeFileSync(file, Buffer.from(seeded));

  try {
    const opened = await ev("window.api.openAudioPath(" + JSON.stringify(file) + ").then(function(r){window.__test.handleAudioOpen(r);return r;})");
    check("the app opens the file from disk", opened && opened.ok === true, JSON.stringify(opened && opened.error));
    check("its existing tags are read back", opened.meta.title === "Ancien titre");
    check("the studio fields cross the IPC bridge",
      "bpm" in opened.meta && "key" in opened.meta && "isrc" in opened.meta);
    await sleep(150);

    await ev("document.getElementById('detectBtn').click()");
    await sleep(150);
    const d = await ev("({bpm:document.getElementById('fBpm').value,key:document.getElementById('fKey').value})");
    check("tempo and key are recovered from the file name", d.bpm === "128" && d.key === "Am", JSON.stringify(d));

    await ev(`(function(){function set(i,v){var e=document.getElementById(i);e.value=v;e.dispatchEvent(new Event('input'));}
      set('fTitle','Nuit blanche'); set('fGenre',${JSON.stringify(T.genres[4])}); set('fComposer','J. Dupont'); set('fIsrc','frxxx2600001');})()`);
    await sleep(100);
    await ev("document.getElementById('exportBtn').click()");
    await sleep(700);

    const onDisk = new Uint8Array(fs.readFileSync(file));
    const r = engine.readExistingId3v2(onDisk);
    check("the title reached the file", r.fields.TIT2 === "Nuit blanche", JSON.stringify(r.fields.TIT2));
    check("a non-ASCII genre survived", r.fields.TCON === T.genres[4], JSON.stringify(r.fields.TCON));
    check("the tempo reached the file", r.fields.TBPM === "128", JSON.stringify(r.fields.TBPM));
    check("the key reached the file", r.fields.TKEY === "Am", JSON.stringify(r.fields.TKEY));
    check("the composer reached the file", r.fields.TCOM === "J. Dupont", JSON.stringify(r.fields.TCOM));
    check("the ISRC was upper-cased on the way", r.fields.TSRC === "FRXXX2600001", JSON.stringify(r.fields.TSRC));
    check("the untouched artist survived", r.fields.TPE1 === "Ancien artiste", JSON.stringify(r.fields.TPE1));
    check("the audio payload is byte-identical",
      Buffer.compare(Buffer.from(onDisk.subarray(r.tagSize)), audio) === 0);
    check("no second file was created (in-place contract)",
      fs.readdirSync(dir).length === 1, fs.readdirSync(dir).join(", "));

    const after = await ev("({led:document.getElementById('led').className,status:document.getElementById('statusText').textContent})");
    check("the state light turns green once saved", /ok/.test(after.led) && after.status === T.saved, JSON.stringify(after));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------- runner ---------------- */

(async function main() {
  const child = launch();
  let ws;
  try {
    ws = await connect((await findPage()).webSocketDebuggerUrl);
    const ev = evaluator(ws);
    await waitForRenderer(ev);
    await ev("window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});");

    const T = await ev("window.__test.strings");
    console.log("  langue resolue : " + (T.clean === "No changes" ? "en" : "fr"));

    await suiteLayout(ev, T);
    await suiteCombo(ev, T);
    await suiteCleanOpen(ev, T);
    await suiteDetect(ev, T);
    await suiteCover(ev, T);
    await suiteRoundTrip(ev, T);

    console.log("");
    const errs = await ev("(window.__errs||[]).join(' | ')");
    check("no JavaScript error along the way", !errs, errs);
  } catch (e) {
    console.error("\ndriver error: " + e.message);
    fail++;
  } finally {
    if (ws) { try { ws.close(); } catch (e) {} }
    child.kill();
  }
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
