(function () {
  "use strict";

  // Language follows the machine. navigator.language reflects Electron's locale
  // in the renderer, so no IPC round-trip is needed just to pick a table.
  const T = window.strings.pick(navigator.language);

  // Keys listed in Camelot order so harmonically adjacent keys sit together —
  // the order a DJ expects. The note column shows the Camelot code itself.
  const KEYS = (function () {
    const table = window.tagGuess.CAMELOT;
    const out = [];
    for (let n = 1; n <= 12; n++) {
      out.push({ value: table[n + "A"], note: n + "A" });
      out.push({ value: table[n + "B"], note: n + "B" });
    }
    return out;
  })();

  const $ = function (id) { return document.getElementById(id); };
  const led = $("led"), fileMeta = $("fileMeta"), fileNameEl = $("fileName");
  const sheet = $("sheet"), dzError = $("dzError");
  const browseBtn = $("browseBtn"), detectBtn = $("detectBtn"), detectNote = $("detectNote");
  const coverDrop = $("coverDrop"), coverImg = $("coverImg"), coverEmpty = $("coverEmpty");
  const coverChangeBtn = $("coverChangeBtn"), coverRemoveBtn = $("coverRemoveBtn");
  const coverSize = $("coverSize");
  const fTitle = $("fTitle"), fArtist = $("fArtist"), fAlbumArtist = $("fAlbumArtist"), fAlbum = $("fAlbum"),
        fYear = $("fYear"), fGenre = $("fGenre"), fTrack = $("fTrack"), fTrackTotal = $("fTrackTotal"),
        fComment = $("fComment");
  const fBpm = $("fBpm"), fKey = $("fKey"), fComposer = $("fComposer"),
        fPublisher = $("fPublisher"), fIsrc = $("fIsrc");
  const resetBtn = $("resetBtn"), exportBtn = $("exportBtn"), statusText = $("statusText");
  const toast = $("toast"), toastText = $("toastText");

  // state.cover: { action: "keep"|"replace"|"remove", mime, data(Uint8Array) } describes what to do on save
  // state.coverPreviewData: Uint8Array currently shown (for dirty-comparison + blob preview)
  let state = null;

  /* ---- localisation ---- */
  function applyStrings() {
    document.documentElement.lang = (T === window.strings.fr) ? "fr" : "en";
    document.title = T.appName;
    const nodes = document.querySelectorAll("[data-t]");
    for (let i = 0; i < nodes.length; i++) {
      const k = nodes[i].getAttribute("data-t");
      if (T[k]) nodes[i].textContent = T[k];
    }
    const titles = document.querySelectorAll("[data-ttitle]");
    for (let i = 0; i < titles.length; i++) {
      const k = titles[i].getAttribute("data-ttitle");
      if (T[k]) { titles[i].title = T[k]; titles[i].setAttribute("aria-label", T[k]); }
    }
    const phs = document.querySelectorAll("[data-tp]");
    for (let i = 0; i < phs.length; i++) {
      const k = phs[i].getAttribute("data-tp");
      if (T[k]) phs[i].placeholder = T[k];
    }
  }

  /* ---- combobox ----------------------------------------------------------
     A free-text input with a suggestion list we fully control: the list is
     height-capped and scrolls, and it flips above the field when there is not
     enough room below. The native <datalist> could do none of that — Chromium
     draws it as an OS popup that ignores CSS and runs off the bottom of the
     window when the field sits low in the form. */
  const MAX_LIST_H = 210;
  const openCombos = [];

  // Matching has to ignore accents: the French genre list has "Électro" and
  // "Chanson française", and nobody types accents into a search field.
  function fold(s) {
    return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function makeCombo(rootId, options, onCommit) {
    const root = $(rootId);
    const input = root.querySelector("input");
    const listEl = root.querySelector(".combo-list");
    const toggle = root.querySelector(".combo-toggle");
    const items = options.map(function (o) {
      return typeof o === "string" ? { value: o, note: "" } : o;
    });
    let activeIndex = -1;
    let shown = [];

    function isOpen() { return !listEl.hidden; }

    function place() {
      // Room is measured against the window, so the list is never drawn outside it.
      const r = input.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const useAbove = below < Math.min(MAX_LIST_H, 120) && above > below;
      listEl.classList.toggle("above", useAbove);
      listEl.classList.toggle("below", !useAbove);
      listEl.style.maxHeight = Math.max(70, Math.min(MAX_LIST_H, useAbove ? above : below)) + "px";
    }

    function render(filter) {
      const q = fold(filter);
      shown = q ? items.filter(function (it) { return fold(it.value).indexOf(q) !== -1; }) : items.slice();
      if (shown.length === 0) {
        listEl.innerHTML = '<li class="combo-empty">' + escapeHtml(T.noSuggestion) + "</li>";
        activeIndex = -1;
        return;
      }
      listEl.innerHTML = shown.map(function (it, i) {
        return '<li class="combo-option" role="option" data-i="' + i + '"><span>' +
          escapeHtml(it.value) + "</span>" +
          (it.note ? '<span class="combo-note">' + escapeHtml(it.note) + "</span>" : "") +
          "</li>";
      }).join("");
      if (activeIndex >= shown.length) activeIndex = shown.length - 1;
      paintActive();
    }

    function paintActive() {
      const nodes = listEl.querySelectorAll(".combo-option");
      for (let i = 0; i < nodes.length; i++) nodes[i].classList.toggle("active", i === activeIndex);
      if (activeIndex >= 0 && nodes[activeIndex]) nodes[activeIndex].scrollIntoView({ block: "nearest" });
    }

    function open(filter) {
      render(filter);
      listEl.hidden = false;
      input.setAttribute("aria-expanded", "true");
      place();
    }

    function close() {
      listEl.hidden = true;
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }

    function commit(i) {
      if (i < 0 || i >= shown.length) return;
      input.value = shown[i].value;
      close();
      if (onCommit) onCommit();
    }

    input.addEventListener("input", function () {
      open(input.value);
      activeIndex = -1;
      paintActive();
    });
    input.addEventListener("focus", function () { if (!isOpen()) open(input.value); });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!isOpen()) open(input.value);
        if (shown.length === 0) return;
        activeIndex = ev.key === "ArrowDown"
          ? (activeIndex + 1) % shown.length
          : (activeIndex <= 0 ? shown.length - 1 : activeIndex - 1);
        paintActive();
      } else if (ev.key === "Enter") {
        if (isOpen() && activeIndex >= 0) { ev.preventDefault(); commit(activeIndex); }
        else close();
      } else if (ev.key === "Escape") {
        if (isOpen()) { ev.stopPropagation(); close(); }
      } else if (ev.key === "Tab") {
        close();
      }
    });
    listEl.addEventListener("mousedown", function (ev) {
      // mousedown, not click: the input must not blur before we read the target
      const li = ev.target.closest(".combo-option");
      if (!li) return;
      ev.preventDefault();
      commit(parseInt(li.getAttribute("data-i"), 10));
    });
    toggle.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      if (isOpen()) close(); else { input.focus(); open(""); }
    });
    input.addEventListener("blur", function () { setTimeout(close, 0); });

    const handle = { close: close, isOpen: isOpen, reposition: function () { if (isOpen()) place(); } };
    openCombos.push(handle);
    return handle;
  }

  /* ---- helpers ---- */
  const humanSize = T.bytes;

  // The cover is the only field whose weight lands in the file, so show it.
  function showCoverSize(note) {
    const data = state && state.coverPreviewData;
    if (!data || !data.length) {
      coverSize.textContent = "";
      coverSize.removeAttribute("title");
      coverSize.classList.remove("shrunk");
      return;
    }
    coverSize.textContent = humanSize(data.length);
    if (note) {
      coverSize.title = T.coverShrunk(humanSize(note.from), humanSize(note.to), note.px);
      coverSize.classList.add("shrunk");
    } else {
      coverSize.title = T.coverKept(humanSize(data.length));
      coverSize.classList.remove("shrunk");
    }
  }

  function showDzError(msg) {
    dzError.textContent = msg;
    clearTimeout(showDzError._t);
    showDzError._t = setTimeout(function () { dzError.textContent = ""; }, 5000);
  }

  function showToast(msg, isError) {
    toastText.textContent = msg;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("show"); }, 3200);
  }

  /* ---- state ---- */
  function loadMetaIntoState(meta) {
    state = {
      path: meta.path,
      name: meta.name,
      size: meta.size,
      type: meta.type,
      original: {
        fields: {
          TIT2: meta.title || "", TPE1: meta.artist || "", TALB: meta.album || "",
          TPE2: meta.albumArtist || "", TYER: meta.year || "", TCON: meta.genre || "",
          TRCK: meta.trackNo ? (meta.trackTotal ? meta.trackNo + "/" + meta.trackTotal : meta.trackNo) : "",
          TBPM: meta.bpm || "", TKEY: meta.key || "", TCOM: meta.composer || "",
          // upper-cased here too, or a file holding a lower-case ISRC would open
          // already "modified" against currentFormFields(), which upper-cases it
          TPUB: meta.publisher || "", TSRC: (meta.isrc || "").toUpperCase()
        },
        comment: meta.comment || "",
        picture: meta.picture ? { mime: meta.picture.mime, data: Uint8Array.from(meta.picture.data) } : null,
      },
      cover: { action: "keep" },
      coverPreviewData: meta.picture ? Uint8Array.from(meta.picture.data) : null,
      coverPreviewMime: meta.picture ? meta.picture.mime : null,
    };
    applyStateToForm(meta);
    showFile();
  }

  function applyStateToForm(meta) {
    fTitle.value = meta.title || "";
    fArtist.value = meta.artist || "";
    fAlbumArtist.value = meta.albumArtist || "";
    fAlbum.value = meta.album || "";
    fYear.value = meta.year || "";
    fGenre.value = meta.genre || "";
    fTrack.value = meta.trackNo || "";
    fTrackTotal.value = meta.trackTotal || "";
    fComment.value = meta.comment || "";
    fBpm.value = meta.bpm || "";
    fKey.value = meta.key || "";
    fComposer.value = meta.composer || "";
    fPublisher.value = meta.publisher || "";
    fIsrc.value = (meta.isrc || "").toUpperCase();
    detectNote.innerHTML = "";
    detectNote.classList.remove("found");
    setCoverPreview(state.coverPreviewData, state.coverPreviewMime);
    showCoverSize(null);
    updateStatus();
  }

  function showFile() {
    sheet.classList.remove("blank");
    detectBtn.disabled = false;
    fileNameEl.textContent = state.name;
    fileNameEl.title = state.path;
    fileNameEl.classList.remove("none");
    fileMeta.textContent = (state.type === "wav" ? "WAV · id3 + LIST INFO" : "MP3 · ID3v2.3") +
                           " · " + humanSize(state.size);
  }

  function showBlank() {
    state = null;
    sheet.classList.add("blank");
    detectBtn.disabled = true;
    resetBtn.disabled = true;
    exportBtn.disabled = true;
    fileNameEl.textContent = T.noFile;
    fileNameEl.removeAttribute("title");
    fileNameEl.classList.add("none");
    fileMeta.textContent = "";
    detectNote.innerHTML = "";
    statusText.textContent = "";
    led.className = "led";
  }

  let coverObjectUrl = null;
  function setCoverPreview(data, mime) {
    if (coverObjectUrl) { URL.revokeObjectURL(coverObjectUrl); coverObjectUrl = null; }
    if (data && data.length) {
      const blob = new Blob([data], { type: mime || "image/jpeg" });
      coverObjectUrl = URL.createObjectURL(blob);
      coverImg.src = coverObjectUrl;
      coverImg.hidden = false;
      coverEmpty.hidden = true;
    } else {
      coverImg.hidden = true;
      coverImg.removeAttribute("src");
      coverEmpty.hidden = false;
    }
  }

  function currentFormFields() {
    const n = fTrack.value.trim(), total = fTrackTotal.value.trim();
    let trck = "";
    if (n && total) trck = n + "/" + total; else if (n) trck = n;
    return {
      TIT2: fTitle.value.trim(), TPE1: fArtist.value.trim(), TALB: fAlbum.value.trim(),
      TPE2: fAlbumArtist.value.trim(), TYER: fYear.value.trim(), TCON: fGenre.value.trim(), TRCK: trck,
      TBPM: fBpm.value.trim(), TKEY: fKey.value.trim(), TCOM: fComposer.value.trim(),
      TPUB: fPublisher.value.trim(), TSRC: fIsrc.value.trim().toUpperCase()
    };
  }

  function bytesKey(bytes) {
    return bytes ? bytes.length + ":" + (bytes[0] || 0) + ":" + (bytes[bytes.length - 1] || 0) : "none";
  }

  function isDirty() {
    if (!state) return false;
    const cur = currentFormFields();
    const orig = state.original.fields;
    for (const k in cur) if ((cur[k] || "") !== (orig[k] || "")) return true;
    if (fComment.value.trim() !== (state.original.comment || "")) return true;
    const curKey = bytesKey(state.coverPreviewData);
    const origKey = bytesKey(state.original.picture ? state.original.picture.data : null);
    if (curKey !== origKey) return true;
    return false;
  }

  function updateStatus() {
    if (!state) return;
    const dirty = isDirty();
    exportBtn.disabled = !dirty;
    resetBtn.disabled = !dirty;
    statusText.textContent = dirty ? T.dirty : T.clean;
    led.className = "led" + (dirty ? " dirty" : "");
  }

  [fTitle, fArtist, fAlbumArtist, fAlbum, fYear, fGenre, fTrack, fTrackTotal, fComment,
   fBpm, fKey, fComposer, fPublisher, fIsrc].forEach(function (el) {
    el.addEventListener("input", updateStatus);
  });

  applyStrings();
  makeCombo("genreCombo", T.genres, updateStatus);
  makeCombo("keyCombo", KEYS, updateStatus);

  window.addEventListener("resize", function () {
    openCombos.forEach(function (c) { c.reposition(); });
  });
  // Scrolling the page closes the lists, but scrolling *inside* a list must not
  // — that is the whole point of it being scrollable.
  document.addEventListener("scroll", function (ev) {
    if (ev.target && ev.target.classList && ev.target.classList.contains("combo-list")) return;
    openCombos.forEach(function (c) { c.close(); });
  }, true);

  /* ---- opening an audio file ---- */
  async function openResultToState(result) {
    if (!result) return; // dialog canceled
    if (!result.ok) {
      showDzError(result.error || T.openFailed);
      return;
    }
    loadMetaIntoState(result.meta);
  }

  async function pickAudio() {
    if (state && isDirty() && !confirm(T.confirmSwitch)) return;
    const result = await window.api.openAudioDialog();
    openResultToState(result);
  }
  browseBtn.addEventListener("click", pickAudio);

  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  ["dragenter", "dragover", "dragleave", "drop"].forEach(function (evt) {
    window.addEventListener(evt, preventDefaults, false);
  });
  // The whole window is the drop target; there is no separate landing screen.
  window.addEventListener("dragover", function () { sheet.classList.add("drag-over"); });
  window.addEventListener("dragleave", function () { sheet.classList.remove("drag-over"); });
  window.addEventListener("drop", async function (e) {
    sheet.classList.remove("drag-over");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const filePath = window.api.getPathForFile(file);
    if (!filePath) { showDzError(T.dropUnavailable); return; }
    if (state && /\.(jpe?g|png)$/i.test(filePath)) {
      applyNewCover(await window.api.openImagePath(filePath));
      return;
    }
    if (state && isDirty() && !confirm(T.confirmSwitch)) return;
    openResultToState(await window.api.openAudioPath(filePath));
  });

  /* ---- cover ---- */
  function applyNewCover(result) {
    if (!result || !state) return;
    if (!result.ok) { showToast(result.error || T.imageFailed, true); return; }
    const data = Uint8Array.from(result.data);
    state.cover = { action: "replace", mime: result.mime, data: data };
    state.coverPreviewData = data;
    state.coverPreviewMime = result.mime;
    setCoverPreview(data, result.mime);
    showCoverSize(result.note || null);
    if (result.note) {
      showToast(T.coverShrunk(humanSize(result.note.from), humanSize(result.note.to), result.note.px));
    }
    updateStatus();
  }

  coverDrop.addEventListener("dragover", function () { if (state) coverDrop.classList.add("drag-over"); });
  coverDrop.addEventListener("dragleave", function () { coverDrop.classList.remove("drag-over"); });
  coverDrop.addEventListener("click", async function () {
    if (!state) return;
    applyNewCover(await window.api.openImageDialog());
  });
  coverDrop.addEventListener("keydown", async function (e) {
    if (state && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      applyNewCover(await window.api.openImageDialog());
    }
  });
  coverChangeBtn.addEventListener("click", async function () {
    if (!state) return;
    applyNewCover(await window.api.openImageDialog());
  });
  coverRemoveBtn.addEventListener("click", function () {
    if (!state) return;
    state.cover = { action: "remove" };
    state.coverPreviewData = null;
    state.coverPreviewMime = null;
    setCoverPreview(null, null);
    showCoverSize(null);
    updateStatus();
  });

  /* ---- BPM / key / name recovery ----
     Fills only the fields the user left empty. Nothing already typed or already
     tagged is ever overwritten. */
  detectBtn.addEventListener("click", function () {
    if (!state) return;
    const found = window.tagGuess.guess({
      fileName: state.name,
      title: fTitle.value,
      album: fAlbum.value,
      comment: fComment.value,
    });
    const applied = [];
    const skipped = [];
    function fill(el, value, label) {
      if (!value) return;
      if (el.value.trim()) { skipped.push(label); return; }
      el.value = value;
      applied.push({ label: label, value: value });
    }
    fill(fTitle, found.title, T.title.toLowerCase());
    fill(fArtist, found.artist, T.artist.toLowerCase());
    fill(fBpm, found.bpm, T.tempo.toLowerCase());
    fill(fKey, found.key, T.key.toLowerCase());

    // Rendered as labelled chips rather than one run-on sentence: the values come
    // from a file name and can be long, so they need to be visually separable
    // from their label. Values are escaped — they are file-name text.
    if (applied.length) {
      let html = '<span class="dn-lead">' + escapeHtml(T.filled) + "</span>";
      html += applied.map(function (a) {
        return '<span class="dn-chip"><em>' + escapeHtml(a.label) + "</em><span>" +
               escapeHtml(a.value) + "</span></span>";
      }).join("");
      if (skipped.length) {
        html += '<span class="dn-skip">' + escapeHtml(T.alreadySet(skipped.join(", "))) + "</span>";
      }
      detectNote.innerHTML = html;
    } else if (skipped.length) {
      detectNote.innerHTML = '<span class="dn-skip">' + escapeHtml(T.nothingToAdd(skipped.join(", "))) + "</span>";
    } else {
      detectNote.innerHTML = '<span class="dn-skip">' + escapeHtml(T.nothingFound) + "</span>";
    }
    detectNote.classList.toggle("found", applied.length > 0);
    updateStatus();
  });

  /* ---- reset / save ---- */
  resetBtn.addEventListener("click", function () {
    if (!state) return;
    const o = state.original;
    state.cover = { action: "keep" };
    state.coverPreviewData = o.picture ? o.picture.data : null;
    state.coverPreviewMime = o.picture ? o.picture.mime : null;
    applyStateToForm({
      title: o.fields.TIT2, artist: o.fields.TPE1, album: o.fields.TALB, albumArtist: o.fields.TPE2,
      year: o.fields.TYER, genre: o.fields.TCON,
      trackNo: (o.fields.TRCK || "").split("/")[0] || "", trackTotal: (o.fields.TRCK || "").split("/")[1] || "",
      comment: o.comment,
      bpm: o.fields.TBPM, key: o.fields.TKEY, composer: o.fields.TCOM,
      publisher: o.fields.TPUB, isrc: o.fields.TSRC,
    });
  });

  exportBtn.addEventListener("click", async function () {
    if (!state) return;
    exportBtn.disabled = true;
    const fields = currentFormFields();
    const comment = fComment.value.trim();
    const payload = {
      filePath: state.path,
      type: state.type,
      fields: fields,
      comment: comment,
      cover: state.cover.action === "replace"
        ? { action: "replace", mime: state.cover.mime, data: Array.from(state.cover.data) }
        : { action: state.cover.action },
    };
    const result = await window.api.saveFile(payload);
    if (!result.ok) {
      showToast(result.error || T.saveFailed, true);
      updateStatus();
      return;
    }
    // the saved state becomes the new baseline — same path, same file, just rewritten
    state.size = result.size;
    state.original = {
      fields: fields, comment: comment,
      picture: state.coverPreviewData ? { mime: state.coverPreviewMime, data: state.coverPreviewData } : null,
    };
    state.cover = { action: "keep" };
    showFile();
    updateStatus();
    statusText.textContent = T.saved;
    led.className = "led ok";
    showToast(T.savedToast);
  });

  showBlank();

  // Test-only seam: lets an automated test feed an IPC result (obtained the same way the
  // native dialog / drag&drop paths obtain it) into the same UI-update code real users hit.
  // Exposes no privileged capability beyond what window.api already allows.
  window.__test = { handleAudioOpen: openResultToState, handleImageOpen: applyNewCover, strings: T };
})();
