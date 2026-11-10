"use strict";
const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const engine = require("./metadataEngine.js");
const strings = require("./renderer/strings.js");

// Language follows the machine: French on a French Windows, English elsewhere.
// app.getLocale() is only valid once the app is ready, so this is filled in then.
let T = strings.pick("en");

// A cover is copied whole into the file's ID3 tag, so its weight is the file's
// weight. A 2000 px PNG export adds 3.4 MB to a 7.5 MB track — it stops being
// mailable for a picture nothing will ever display that large. 600 px covers
// every real case (Explorer tops out at 256 px, players sit around 300-600) and
// lands near 57 KB, which is what the tags in a normal library already weigh.
const COVER_MAX_PX = 600;
const COVER_QUALITY = 80;
// Below this, an image is already cheap and re-encoding it would only add
// generation loss for a few kilobytes. The whole library's median cover is 67 KB.
const COVER_OK_BYTES = 150 * 1024;

// Returns { mime, data, note } — the original bytes when re-encoding would not
// actually help, so a small tight JPEG is never degraded for nothing.
function fitCover(bytes, mime) {
  let img;
  try { img = nativeImage.createFromBuffer(Buffer.from(bytes)); } catch (e) { img = null; }
  if (!img || img.isEmpty()) return { mime: mime, data: bytes, note: null };

  const size = img.getSize();
  const longest = Math.max(size.width, size.height);

  // Only step in when there is something to gain: too many pixels for anything
  // that will ever display it, or too many bytes for a file meant to be mailed.
  if (longest <= COVER_MAX_PX && bytes.length <= COVER_OK_BYTES) {
    return { mime: mime, data: bytes, note: null };
  }

  let scaled = img;
  if (longest > COVER_MAX_PX) {
    scaled = size.width >= size.height
      ? img.resize({ width: COVER_MAX_PX, quality: "good" })
      : img.resize({ height: COVER_MAX_PX, quality: "good" });
  }

  let jpeg;
  try { jpeg = scaled.toJPEG(COVER_QUALITY); } catch (e) { jpeg = null; }
  if (!jpeg || !jpeg.length || jpeg.length >= bytes.length) {
    return { mime: mime, data: bytes, note: null };
  }
  return {
    mime: "image/jpeg",
    data: new Uint8Array(jpeg),
    note: { from: bytes.length, to: jpeg.length, px: Math.min(longest, COVER_MAX_PX) },
  };
}

function audioFilters() { return [{ name: T.filterAudio, extensions: ["mp3", "wav"] }]; }
function imageFilters() { return [{ name: T.filterImages, extensions: ["jpg", "jpeg", "png"] }]; }

function detectType(name, bytes) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".wav") || engine.isRiffWave(bytes)) return "wav";
  if (lower.endsWith(".mp3")) return "mp3";
  if (bytes.length > 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "mp3";
  if (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

function splitTrack(trck) {
  if (!trck) return { n: "", total: "" };
  const parts = String(trck).split("/");
  return { n: parts[0] || "", total: parts[1] || "" };
}

function readMetaFromDisk(filePath) {
  const buf = fs.readFileSync(filePath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const name = path.basename(filePath);
  const type = detectType(name, bytes);
  if (!type) {
    const err = new Error(T.errUnsupported);
    err.code = "UNSUPPORTED_FORMAT";
    throw err;
  }
  let parsed;
  try {
    parsed = type === "wav" ? engine.readWav(bytes) : engine.readExistingId3v2(bytes);
  } catch (e) {
    const err = new Error(T.errParse);
    err.code = "PARSE_ERROR";
    throw err;
  }
  const fields = parsed.fields || {};
  const comment = type === "wav" ? parsed.comment : (fields.COMM ? fields.COMM.text : null);
  const picture = parsed.picture || null;
  const t = splitTrack(fields.TRCK);

  return {
    path: filePath,
    name,
    size: bytes.length,
    type,
    title: fields.TIT2 || "",
    artist: fields.TPE1 || "",
    albumArtist: fields.TPE2 || "",
    album: fields.TALB || "",
    year: fields.TYER || "",
    genre: fields.TCON || "",
    trackNo: t.n,
    trackTotal: t.total,
    bpm: fields.TBPM || "",
    key: fields.TKEY || "",
    composer: fields.TCOM || "",
    publisher: fields.TPUB || "",
    isrc: fields.TSRC || "",
    comment: comment || "",
    picture: picture ? { mime: picture.mime, data: Array.from(picture.data) } : null,
  };
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    // Sized to the form: everything fits with no scrolling, which is the point.
    width: 720,
    height: 468,
    minWidth: 620,
    minHeight: 430,
    backgroundColor: "#f0f0f0",
    title: T.appName,
    // Packaged builds take the icon from the exe; this is so `npm start` does
    // not show the default Electron logo.
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
}

app.whenReady().then(() => {
  T = strings.pick(app.getLocale());
  // Without this, Electron installs its default menu: Alt reveals a menu bar and
  // Ctrl+Shift+I / F12 open the DevTools — the app then reads as a browser window.
  // Kept in development, where the inspector is the point.
  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---------------- IPC ---------------- */

ipcMain.handle("dialog:openAudio", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: T.dlgOpenAudio,
    properties: ["openFile"],
    filters: audioFilters(),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return openAudioPath(res.filePaths[0]);
});

ipcMain.handle("file:openAudioPath", async (_evt, filePath) => openAudioPath(filePath));

function openAudioPath(filePath) {
  try {
    return { ok: true, meta: readMetaFromDisk(filePath) };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || "UNKNOWN" };
  }
}

ipcMain.handle("dialog:openImage", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: T.dlgOpenImage,
    properties: ["openFile"],
    filters: imageFilters(),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return readImagePath(res.filePaths[0]);
});

ipcMain.handle("file:openImagePath", async (_evt, filePath) => readImagePath(filePath));

function readImagePath(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!isJpeg && !isPng) {
      return { ok: false, error: T.errImageFormat, code: "UNSUPPORTED_IMAGE" };
    }
    const fitted = fitCover(bytes, isJpeg ? "image/jpeg" : "image/png");
    return {
      ok: true,
      mime: fitted.mime,
      data: Array.from(fitted.data),
      note: fitted.note,
    };
  } catch (e) {
    return { ok: false, error: T.errImageRead, code: "READ_ERROR" };
  }
}

ipcMain.handle("file:save", async (_evt, payload) => {
  const { filePath, type, fields, comment, cover } = payload;
  try {
    const buf = fs.readFileSync(filePath);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    let picture = null;
    if (cover && cover.action === "replace") {
      picture = { mime: cover.mime, data: Uint8Array.from(cover.data), pictureType: 3 };
    } else if (cover && cover.action === "keep") {
      const existing = type === "wav" ? engine.readWav(bytes).picture : engine.readExistingId3v2(bytes).picture;
      picture = existing;
    } // action === "remove" -> picture stays null

    const meta = { fields, comment, picture };
    const outBytes = type === "wav" ? engine.writeWav(bytes, meta) : engine.writeMp3(bytes, meta);
    fs.writeFileSync(filePath, Buffer.from(outBytes.buffer, outBytes.byteOffset, outBytes.byteLength));

    return { ok: true, size: outBytes.length };
  } catch (e) {
    let message = T.errSaveGeneric(e.message);
    if (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES") {
      message = T.errLocked;
    } else if (e.code === "ENOENT") {
      message = T.errMissing;
    } else if (e.code === "NOT_RIFF") {
      message = T.errNotRiff;
    }
    return { ok: false, error: message, code: e.code || "UNKNOWN" };
  }
});
