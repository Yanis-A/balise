"use strict";
// Builds src/icon.png and src/icon.ico from src/icon.svg.
//
//   node tools/make-icons.js
//
// Rendering goes through the Electron already in devDependencies, driven over
// the DevTools protocol — no image library, no native module, nothing new to
// install. The .ico is assembled by hand: the format is a small header plus one
// PNG per size, which is a dozen lines of Buffer work.
//
// Sizes below 32 px use the "small" variant from the SVG: the waves close up
// into a smudge down there, so they are dropped and the mast is fattened.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SVG = path.join(ROOT, "src", "icon.svg");
const OUT_PNG = path.join(ROOT, "src", "icon.png");
const OUT_ICO = path.join(ROOT, "src", "icon.ico");
// macOS builds its .icns from one large PNG and refuses anything under 512 px
const OUT_MAC = path.join(ROOT, "src", "icon-1024.png");
const MAC_SIZE = 1024;
const PORT = 9271;

// what Windows actually asks for, plus 256 for the installer and shell
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_UNDER = 32;

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// The master SVG holds both variants side by side in a 96x48 box; each is
// extracted by shifting the root viewBox onto its half. Done here in Node, not
// in the page: a template literal eats the backslashes out of any regex written
// inside it, which silently turns \s into s.
function variantSvg(raw, variant) {
  const box = variant === "small" ? "48 0 48 48" : "0 0 48 48";
  return raw.replace(/<svg[^>]*>/, function (tag) {
    return tag
      .replace(/viewBox="[^"]*"/, 'viewBox="' + box + '"')
      .replace(/\s(?:width|height)="[^"]*"/g, "");
  });
}

function page(full, small) {
  return "<!doctype html><meta charset=\"utf-8\">" +
    "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}" +
    "svg{display:block;width:100vw;height:100vh}</style>" +
    "<div id=\"host\"></div><script>" +
    "var ART={full:" + JSON.stringify(full) + ",small:" + JSON.stringify(small) + "};" +
    "window.render=function(v){document.getElementById('host').innerHTML=ART[v];" +
    "return document.querySelector('svg').getAttribute('viewBox');};" +
    "<\/script>";
}

let msgId = 1;
function send(ws, method, params) {
  return new Promise(function (res, rej) {
    const id = msgId++;
    function on(e) {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.id !== id) return;
      ws.removeEventListener("message", on);
      if (m.error) return rej(new Error(JSON.stringify(m.error)));
      res(m.result);
    }
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}
async function evaluate(ws, expr) {
  const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}

// A screenshot silently composited onto white produces a PNG with no alpha and
// four white corners in the taskbar. Cheap to check, so check: colour type 6 is
// RGBA, and byte 25 of the IHDR is where it lives.
function assertHasAlpha(png, size) {
  const colourType = png.readUInt8(25);
  if (colourType !== 6) {
    throw new Error(size + " px: PNG colour type " + colourType +
      " (expected 6, RGBA) — the rounded corners would render white");
  }
}

/* ---------- ICO container ----------
   ICONDIR: reserved(2)=0, type(2)=1, count(2)
   ICONDIRENTRY x count, 16 bytes each: w(1) h(1) colours(1) reserved(1)
     planes(2)=1 bpp(2)=32 bytes(4) offset(4)   — 0 in w/h means 256
   then the images back to back, each a complete PNG. */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach(function (img, i) {
    const at = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    dir.writeUInt8(0, at + 2);
    dir.writeUInt8(0, at + 3);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(img.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir].concat(images.map(function (i) { return i.data; })));
}

(async function main() {
  const svgText = fs.readFileSync(SVG, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  const tmp = path.join(ROOT, "tools", ".icon-render.html");
  fs.writeFileSync(tmp, page(variantSvg(svgText, "full"), variantSvg(svgText, "small")), "utf8");

  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const bin = require(path.join(ROOT, "node_modules", "electron"));
  const child = spawn(bin, [
    "--remote-debugging-port=" + PORT,
    "--headless=new",
    "--disable-gpu",
    "file://" + tmp.replace(/\\/g, "/")
  ], { env: env, stdio: "ignore" });

  let ws;
  try {
    let target;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch("http://127.0.0.1:" + PORT + "/json/list");
        const t = (await r.json()).find(function (x) { return x.type === "page"; });
        if (t && t.webSocketDebuggerUrl) { target = t; break; }
      } catch (e) { /* not up yet */ }
      await sleep(400);
    }
    if (!target) throw new Error("the renderer never came up on port " + PORT);

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (r, j) { ws.onopen = r; ws.onerror = function () { j(new Error("attach failed")); }; });

    for (let i = 0; i < 40; i++) {
      if (await evaluate(ws, "typeof window.render === 'function'")) break;
      await sleep(200);
    }

    // Without this, Chromium composites the screenshot onto an opaque white
    // backdrop: the PNG comes out with no alpha channel at all and the rounded
    // corners of the plate show up as four white pixels in the taskbar.
    await send(ws, "Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 }
    });

    const images = [];
    for (const size of SIZES) {
      const variant = size < SMALL_UNDER ? "small" : "full";
      await send(ws, "Emulation.setDeviceMetricsOverride", {
        width: size, height: size, deviceScaleFactor: 1, mobile: false
      });
      const seen = await evaluate(ws, "window.render(" + JSON.stringify(variant) + ")");
      const want = variant === "small" ? "48 0 48 48" : "0 0 48 48";
      if (seen !== want) throw new Error("viewBox is " + seen + ", expected " + want);
      await sleep(60);
      const shot = await send(ws, "Page.captureScreenshot", {
        format: "png", captureBeyondViewport: false, fromSurface: true
      });
      const data = Buffer.from(shot.data, "base64");
      assertHasAlpha(data, size);
      images.push({ size: size, data: data, variant: variant });
      console.log("  " + String(size).padStart(3) + " px  " + variant.padEnd(5) + "  " + data.length + " o");
      if (size === 256) fs.writeFileSync(OUT_PNG, data);
    }

    fs.writeFileSync(OUT_ICO, buildIco(images));

    await send(ws, "Emulation.setDeviceMetricsOverride", {
      width: MAC_SIZE, height: MAC_SIZE, deviceScaleFactor: 1, mobile: false
    });
    await evaluate(ws, "window.render(\"full\")");
    await sleep(60);
    const big = Buffer.from((await send(ws, "Page.captureScreenshot", {
      format: "png", captureBeyondViewport: false, fromSurface: true
    })).data, "base64");
    assertHasAlpha(big, MAC_SIZE);
    fs.writeFileSync(OUT_MAC, big);
    console.log("\n  src/icon.png  " + fs.statSync(OUT_PNG).size + " o");
    console.log("  src/icon.ico  " + fs.statSync(OUT_ICO).size + " o (" + images.length + " tailles)");
    console.log("  src/icon-1024.png  " + fs.statSync(OUT_MAC).size + " o (macOS, Linux)");
  } finally {
    if (ws) { try { ws.close(); } catch (e) {} }
    child.kill();
    fs.rmSync(tmp, { force: true });
  }
  process.exit(0);
})().catch(function (e) {
  console.error("erreur: " + e.message);
  process.exit(1);
});
