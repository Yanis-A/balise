// ID3v2.3 (MP3) + RIFF/WAVE metadata engine — pure JS, no dependencies.
// Shared between the Electron main process (for file I/O) — validated with
// the same test suite as the browser prototype (self round-trip + music-metadata).
"use strict";

function synchsafe(n) {
  return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
}
function unsynchsafe(bytes) {
  return ((bytes[0] & 0x7f) << 21) | ((bytes[1] & 0x7f) << 14) | ((bytes[2] & 0x7f) << 7) | (bytes[3] & 0x7f);
}
const textEnc = new TextEncoder();

function readExistingId3v2(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return { tagSize: 0, fields: {}, picture: null };
  }
  const majorVersion = bytes[3];
  const flags = bytes[5];
  const hasExtHeader = !!(flags & 0x40);
  const size = unsynchsafe(bytes.subarray(6, 10));
  const tagSize = 10 + size;
  let offset = 10;
  const end = tagSize;

  if (hasExtHeader) {
    const extSize = majorVersion >= 4
      ? unsynchsafe(bytes.subarray(offset, offset + 4))
      : new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    offset += extSize;
  }

  const fields = {};
  let picture = null;

  while (offset + 10 <= end) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    if (id === "\0\0\0\0") break;
    let frameSize;
    if (majorVersion >= 4) {
      frameSize = unsynchsafe(bytes.subarray(offset + 4, offset + 8));
    } else {
      frameSize = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, false);
    }
    const frameFlags = (bytes[offset + 8] << 8) | bytes[offset + 9];
    const contentStart = offset + 10;
    const contentEnd = contentStart + frameSize;
    if (frameSize < 0 || contentEnd > end) break;
    const content = bytes.subarray(contentStart, contentEnd);

    if (frameFlags & 0x0009) { offset = contentEnd; continue; }

    if (id[0] === "T" && id !== "TXXX") {
      fields[id] = decodeTextFrame(content);
    } else if (id === "COMM") {
      fields.COMM = decodeCommFrame(content);
    } else if (id === "APIC") {
      picture = decodeApicFrame(content);
    }
    offset = contentEnd;
  }
  return { tagSize, fields, picture };
}

function decodeTextEncodingString(encodingByte, bytes) {
  if (encodingByte === 0) return new TextDecoder("iso-8859-1").decode(bytes);
  if (encodingByte === 1) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (encodingByte === 2) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}
// ID3v2 strings may be NUL-terminated, NUL-padded, or (v2.4) NUL-separated for
// multi-value frames. Keep the first value and drop the padding other taggers add.
function cleanTagText(s) { return s.replace(/\0[\s\S]*$/, "").replace(/ +$/, ""); }

function decodeTextFrame(content) {
  const encodingByte = content[0];
  return cleanTagText(decodeTextEncodingString(encodingByte, content.subarray(1)));
}

function findNullTerminatorIndex(bytes, encodingByte, start) {
  if (encodingByte === 1 || encodingByte === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  return bytes.length;
}

function decodeCommFrame(content) {
  const encodingByte = content[0];
  const language = new TextDecoder("iso-8859-1").decode(content.subarray(1, 4));
  const descStart = 4;
  const descEnd = findNullTerminatorIndex(content, encodingByte, descStart);
  const termLen = (encodingByte === 1 || encodingByte === 2) ? 2 : 1;
  const textStart = descEnd + termLen;
  const text = decodeTextEncodingString(encodingByte, content.subarray(textStart));
  return { language, text: cleanTagText(text) };
}

function decodeApicFrame(content) {
  const encodingByte = content[0];
  let offset = 1;
  let mimeEnd = offset;
  while (mimeEnd < content.length && content[mimeEnd] !== 0) mimeEnd++;
  const mime = new TextDecoder("iso-8859-1").decode(content.subarray(offset, mimeEnd));
  offset = mimeEnd + 1;
  const pictureType = content[offset];
  offset += 1;
  const descEnd = findNullTerminatorIndex(content, encodingByte, offset);
  const termLen = (encodingByte === 1 || encodingByte === 2) ? 2 : 1;
  offset = descEnd + termLen;
  const data = content.subarray(offset);
  return { mime, pictureType, data };
}

function encodeUtf16leWithBom(str) {
  const buf = new Uint8Array(2 + str.length * 2);
  buf[0] = 0xff; buf[1] = 0xfe;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf[2 + i * 2] = code & 0xff;
    buf[2 + i * 2 + 1] = (code >> 8) & 0xff;
  }
  return buf;
}
function isLatin1(str) {
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 0xff) return false;
  return true;
}
function encodeLatin1(str) {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i) & 0xff;
  return buf;
}
function encodeTextContent(str) {
  if (isLatin1(str)) {
    const body = encodeLatin1(str);
    const out = new Uint8Array(1 + body.length);
    out[0] = 0; out.set(body, 1);
    return out;
  }
  const body = encodeUtf16leWithBom(str);
  const out = new Uint8Array(1 + body.length);
  out[0] = 1; out.set(body, 1);
  return out;
}
function buildFrame(id, content) {
  const idBytes = textEnc.encode(id);
  const header = new Uint8Array(10);
  header.set(idBytes, 0);
  new DataView(header.buffer).setUint32(4, content.length, false);
  const frame = new Uint8Array(10 + content.length);
  frame.set(header, 0); frame.set(content, 10);
  return frame;
}
function buildTextFrame(id, value) {
  if (value === undefined || value === null || value === "") return null;
  return buildFrame(id, encodeTextContent(String(value)));
}
function buildCommFrame(text) {
  if (!text) return null;
  const langBytes = encodeLatin1("eng");
  const body = encodeTextContent(text);
  const encodingByte = body[0];
  const textPart = body.subarray(1);
  const descTerm = (encodingByte === 1) ? new Uint8Array([0xff, 0xfe, 0, 0]) : new Uint8Array([0]);
  const content = new Uint8Array(1 + 3 + descTerm.length + textPart.length);
  let o = 0;
  content[o++] = encodingByte;
  content.set(langBytes, o); o += 3;
  content.set(descTerm, o); o += descTerm.length;
  content.set(textPart, o);
  return buildFrame("COMM", content);
}
function buildApicFrame(picture) {
  if (!picture || !picture.data || picture.data.length === 0) return null;
  const mime = picture.mime || "image/jpeg";
  const mimeBytes = encodeLatin1(mime);
  const pictureType = picture.pictureType != null ? picture.pictureType : 3;
  const content = new Uint8Array(1 + mimeBytes.length + 1 + 1 + 1 + picture.data.length);
  let o = 0;
  content[o++] = 0;
  content.set(mimeBytes, o); o += mimeBytes.length;
  content[o++] = 0;
  content[o++] = pictureType;
  content[o++] = 0;
  content.set(picture.data, o);
  return buildFrame("APIC", content);
}
function buildId3v2Tag(meta) {
  const fields = (meta && meta.fields) || {};
  const comment = meta ? meta.comment : null;
  const picture = meta ? meta.picture : null;
  const frames = [];
  // TBPM/TKEY carry tempo and initial key — what DJ and mastering tools read.
  const order = ["TIT2", "TPE1", "TALB", "TPE2", "TYER", "TCON", "TRCK",
                 "TBPM", "TKEY", "TCOM", "TPUB", "TSRC"];
  for (const id of order) {
    const f = buildTextFrame(id, fields[id]);
    if (f) frames.push(f);
  }
  const commFrame = buildCommFrame(comment);
  if (commFrame) frames.push(commFrame);
  const apicFrame = buildApicFrame(picture);
  if (apicFrame) frames.push(apicFrame);

  let total = 0;
  for (const f of frames) total += f.length;

  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33;
  header[3] = 0x03; header[4] = 0x00; header[5] = 0x00;
  const sizeBytes = synchsafe(total);
  header[6] = sizeBytes[0]; header[7] = sizeBytes[1]; header[8] = sizeBytes[2]; header[9] = sizeBytes[3];

  const tag = new Uint8Array(10 + total);
  tag.set(header, 0);
  let o = 10;
  for (const f of frames) { tag.set(f, o); o += f.length; }
  return tag;
}
function stripExistingTags(bytes) {
  let start = 0;
  const { tagSize } = readExistingId3v2(bytes);
  if (tagSize > 0) start = tagSize;
  let end = bytes.length;
  if (end - start >= 128) {
    const maybeTag = bytes.subarray(end - 128, end - 128 + 3);
    if (maybeTag[0] === 0x54 && maybeTag[1] === 0x41 && maybeTag[2] === 0x47) end -= 128;
  }
  return bytes.subarray(start, end);
}
function writeMp3(bytes, meta) {
  const audio = stripExistingTags(bytes);
  const tag = buildId3v2Tag(meta);
  const out = new Uint8Array(tag.length + audio.length);
  out.set(tag, 0); out.set(audio, tag.length);
  return out;
}

/* ---------------- WAV (RIFF) ---------------- */

function ascii(bytes, start, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
  return s;
}
function isRiffWave(bytes) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
}
function parseChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = dv.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    let dataEnd = dataStart + size;
    if (dataEnd > bytes.length) dataEnd = bytes.length;
    chunks.push({ id, dataStart, dataEnd });
    let next = dataEnd;
    if (size % 2 === 1) next += 1;
    offset = next;
  }
  return chunks;
}
function isId3ChunkId(id) { return id.trim().toUpperCase() === "ID3"; }

function readWav(bytes) {
  if (!isRiffWave(bytes)) return { fields: {}, comment: null, picture: null, infoFields: {} };
  const chunks = parseChunks(bytes);
  let fields = {}, comment = null, picture = null, infoFields = {};
  const wavDec = new TextDecoder("utf-8");

  for (const c of chunks) {
    if (isId3ChunkId(c.id)) {
      const tagBytes = bytes.subarray(c.dataStart, c.dataEnd);
      const parsed = readExistingId3v2(tagBytes);
      fields = Object.assign({}, fields, parsed.fields);
      if (parsed.fields.COMM) comment = parsed.fields.COMM.text;
      if (parsed.picture) picture = parsed.picture;
    } else if (c.id === "LIST") {
      const listData = bytes.subarray(c.dataStart, c.dataEnd);
      if (ascii(listData, 0, 4) === "INFO") {
        let o = 4;
        while (o + 8 <= listData.length) {
          const subId = ascii(listData, o, 4);
          const subSize = new DataView(listData.buffer, listData.byteOffset + o + 4, 4).getUint32(0, true);
          const subStart = o + 8;
          let subEnd = subStart + subSize;
          if (subEnd > listData.length) subEnd = listData.length;
          const raw = listData.subarray(subStart, subEnd);
          infoFields[subId] = wavDec.decode(raw).replace(/\0+$/, "");
          let next = subEnd;
          if (subSize % 2 === 1) next += 1;
          o = next;
        }
      }
    }
  }
  // Explorer, Audacity and many recorders write LIST/INFO only, with no id3 chunk.
  // Without this fallback the editor would open blank on such a file and saving
  // would wipe the tags it never showed. The id3 chunk stays authoritative.
  for (const id3id in INFO_MAP) {
    if (fields[id3id]) continue;
    const v = infoFields[INFO_MAP[id3id]];
    if (!v) continue;
    // ICRD is often a full date (2026-05-01) while TYER holds four digits.
    fields[id3id] = id3id === "TYER" ? (v.match(/\d{4}/) || [v])[0] : v;
  }
  if (!comment && infoFields.ICMT) comment = infoFields.ICMT;
  return { fields, comment, picture, infoFields };
}

function chunkFromParts(id, dataBytes) {
  const idBytes = textEnc.encode(id.padEnd(4, " ").slice(0, 4));
  const pad = dataBytes.length % 2 === 1 ? 1 : 0;
  const out = new Uint8Array(8 + dataBytes.length + pad);
  out.set(idBytes, 0);
  new DataView(out.buffer).setUint32(4, dataBytes.length, true);
  out.set(dataBytes, 8);
  return out;
}
function buildInfoSubchunk(id, text) {
  const strBytes = textEnc.encode(text);
  const withNull = new Uint8Array(strBytes.length + 1);
  withNull.set(strBytes, 0);
  return chunkFromParts(id, withNull);
}
const INFO_MAP = { TIT2: "INAM", TPE1: "IART", TALB: "IPRD", TYER: "ICRD", TCON: "IGNR" };
function buildListInfoChunk(fields, comment, existingInfoFields) {
  const merged = Object.assign({}, existingInfoFields);
  for (const id3id in INFO_MAP) {
    const infoId = INFO_MAP[id3id];
    const v = fields[id3id];
    if (v) merged[infoId] = v; else delete merged[infoId];
  }
  if (comment) merged.ICMT = comment; else delete merged.ICMT;

  const subEntries = Object.entries(merged).filter(function (e) { return e[1]; });
  if (subEntries.length === 0) return null;
  let subTotal = 0;
  const subChunks = subEntries.map(function (e) {
    const c = buildInfoSubchunk(e[0], e[1]);
    subTotal += c.length;
    return c;
  });
  const infoTag = textEnc.encode("INFO");
  const listData = new Uint8Array(4 + subTotal);
  listData.set(infoTag, 0);
  let o = 4;
  for (const c of subChunks) { listData.set(c, o); o += c.length; }
  return chunkFromParts("LIST", listData);
}
function writeWav(bytes, meta) {
  // Coded, not phrased: the main process owns the wording so it can be localised.
  if (!isRiffWave(bytes)) {
    const err = new Error("not a RIFF/WAVE stream");
    err.code = "NOT_RIFF";
    throw err;
  }
  const chunks = parseChunks(bytes);
  const existing = readWav(bytes);

  const kept = [];
  for (const c of chunks) {
    if (isId3ChunkId(c.id)) continue;
    if (c.id === "LIST" && ascii(bytes, c.dataStart, 4) === "INFO") continue;
    kept.push(chunkFromParts(c.id, bytes.subarray(c.dataStart, c.dataEnd)));
  }
  const listChunk = buildListInfoChunk(meta.fields, meta.comment, existing.infoFields);
  const id3Tag = buildId3v2Tag(meta);
  const id3Chunk = id3Tag.length > 10 ? chunkFromParts("id3 ", id3Tag) : null;

  const parts = kept.slice();
  if (listChunk) parts.push(listChunk);
  if (id3Chunk) parts.push(id3Chunk);

  let bodySize = 4;
  for (const p of parts) bodySize += p.length;

  const out = new Uint8Array(8 + bodySize);
  out.set(textEnc.encode("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, bodySize, true);
  out.set(textEnc.encode("WAVE"), 8);
  let o = 12;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

module.exports = {
  readExistingId3v2, buildId3v2Tag, stripExistingTags, writeMp3,
  readWav, writeWav, isRiffWave, parseChunks,
};
