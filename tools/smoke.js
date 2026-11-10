"use strict";
// Starts a built Balise and checks its window comes up with the interface
// loaded. Run on the packaged app, not on `npm start`: it is the copy people
// download that has to open.
//
//   node tools/smoke.js <path to the Balise executable>
//
// Same approach as the UI tests: the app is driven over the DevTools protocol,
// with nothing but Node's own fetch and WebSocket.
const { spawn } = require("node:child_process");
const net = require("node:net");

const bin = process.argv[2];
if (!bin) {
  console.error("usage: node tools/smoke.js <executable>");
  process.exit(2);
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// A fixed port can already be taken by another debugger, and the check would
// then read that program's pages instead of Balise's: ask the system for one.
function freePort() {
  return new Promise(function (resolve, reject) {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", function () { const p = srv.address().port; srv.close(function () { resolve(p); }); });
  });
}

function evaluate(url, expression) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket(url);
    ws.onerror = function () { reject(new Error("could not attach to the page")); };
    ws.onopen = function () {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expression, returnByValue: true } }));
    };
    ws.onmessage = function (e) {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      ws.close();
      resolve(m.result && m.result.result ? m.result.result.value : undefined);
    };
  });
}

(async function main() {
  const PORT = await freePort();
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  // a CI runner has no setuid sandbox helper; a person's Linux does
  const args = ["--remote-debugging-port=" + PORT].concat(process.platform === "linux" ? ["--no-sandbox"] : []);
  const child = spawn(bin, args, { env: env, stdio: "ignore" });
  let exited = null;
  child.on("exit", function (code) { exited = code; });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      if (exited !== null) throw new Error("Balise quit on start, code " + exited);
      try {
        const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
        page = list.find(function (t) { return t.type === "page" && t.title === "Balise"; });
      } catch (e) { /* not up yet */ }
      if (!page) await sleep(500);
    }
    if (!page) throw new Error("no Balise window after 45 s");
    // the window exists; the interface has to be there too, scripts included
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      ready = await evaluate(page.webSocketDebuggerUrl,
        "document.readyState === 'complete' && !!window.api && document.querySelectorAll('input').length > 5");
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error("the window opened but the interface never loaded");
    console.log("Balise opened, interface loaded");
  } finally {
    child.kill();
  }
  process.exit(0);
})().catch(function (e) {
  console.error("smoke test failed: " + e.message);
  process.exit(1);
});
