// Every user-facing string, in one place.
//
// The language follows the machine's own locale — French on a French Windows,
// English everywhere else — so a build can be handed to anyone without deciding
// its audience in advance. Force one with BALISE_LANG=fr / =en.
//
// Dual-mode on purpose: required by the main process, loaded as a plain
// <script> by the renderer (which reads it as window.strings), and required
// directly by the tests. No DOM, no Electron.
"use strict";

(function (root) {
  var en = {
    appName: "Balise",

    /* file bar */
    openFile: "Open a file…",
    fillFromName: "Fill from file name",
    noFile: "No file open",
    dropHint: "Drop an MP3 or WAV here, or open one",
    fileLabel: "File",

    /* fields */
    title: "Title",
    artist: "Artist",
    albumArtist: "Album artist",
    album: "Album",
    year: "Year",
    genre: "Genre",
    track: "Track",
    comment: "Comment",
    tempo: "Tempo",
    key: "Key",
    composer: "Composer",
    publisher: "Publisher",
    isrc: "ISRC",
    cover: "Cover",
    credits: "Credits",

    /* placeholders */
    phTitle: "Track title",
    phArtist: "Artist name",
    phAlbumArtist: "If different",
    phAlbum: "Album name",
    phYear: "2026",
    phGenre: "House, Jazz…",
    phTrack: "1",
    phTrackTotal: "12",
    phComment: "Free note, source, credits…",
    phTempo: "128",
    phKey: "Am, F#, Bbm…",
    phComposer: "Who wrote it",
    phPublisher: "Label name",
    phIsrc: "FRXXX2600001",

    /* cover */
    coverNone: "none",
    coverBrowse: "Browse…",
    coverRemove: "Remove",
    coverHint: "JPG or PNG",
    coverKept: function (n) { return "Cover: " + n + ", stored as-is."; },
    coverShrunk: function (from, to, px) {
      return "Cover reduced to " + px + " px, " + from + " → " + to +
             ". Plenty for any player or for Explorer thumbnails, and it keeps the file light enough to email.";
    },

    /* state */
    clean: "No changes",
    dirty: "Unsaved changes",
    saved: "Saved",
    reset: "Reset",
    save: "Save",

    /* detection */
    filled: "Filled",
    alreadySet: function (n) { return n + (n.indexOf(",") === -1 ? " was already set" : " were already set"); },
    nothingToAdd: function (n) { return "Nothing to add, these are already set: " + n + "."; },
    nothingFound: "Nothing to read from this file name.",

    /* messages */
    noSuggestion: "No match: your value is kept as typed.",
    savedToast: "Saved: same file, on your disk",
    confirmSwitch: "You have unsaved changes. Open another file anyway?",
    dropUnavailable: "Drag and drop is unavailable here. Use the Open button.",
    openFailed: "Could not open this file.",
    imageFailed: "Could not use this image.",
    saveFailed: "Could not save.",

    /* main process */
    dlgOpenAudio: "Open an audio file",
    dlgOpenImage: "Choose a cover image",
    filterAudio: "Audio files",
    filterImages: "Images",
    errUnsupported: "Unrecognised format. Please use an MP3 or WAV file.",
    errParse: "Could not read this file. It may be damaged.",
    errImageFormat: "Cover images must be JPG or PNG.",
    errImageRead: "Could not read this image.",
    errNotRiff: "This WAV file is malformed and cannot be rewritten safely.",
    errLocked: "Could not write this file. It may be open in a player or another program: close it and try again.",
    errMissing: "The file is gone. Was it moved or deleted since you opened it?",
    errSaveGeneric: function (m) { return "Could not save: " + m; },

    bytes: function (n) {
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
      return (n / (1024 * 1024)).toFixed(2) + " MB";
    },

    genres: ["Pop", "Rock", "Hip-Hop", "Rap", "Electronic", "House", "Techno", "Jazz", "Blues",
      "Classical", "R&B", "Soul", "Reggae", "Metal", "Punk", "Folk", "Country", "Ambient",
      "Lo-fi", "Soundtrack", "Podcast", "Live", "Acoustic", "Spoken word"]
  };

  var fr = {
    appName: "Balise",

    openFile: "Ouvrir un fichier…",
    fillFromName: "Remplir depuis le nom",
    noFile: "Aucun fichier ouvert",
    dropHint: "Dépose un MP3 ou un WAV ici, ou ouvre-en un",
    fileLabel: "Fichier",

    title: "Titre",
    artist: "Artiste",
    albumArtist: "Artiste de l'album",
    album: "Album",
    year: "Année",
    genre: "Genre",
    track: "Piste",
    comment: "Commentaire",
    tempo: "Tempo",
    key: "Tonalité",
    composer: "Compositeur",
    publisher: "Éditeur",
    isrc: "ISRC",
    cover: "Pochette",
    credits: "Crédits",

    phTitle: "Titre du morceau",
    phArtist: "Nom de l'artiste",
    phAlbumArtist: "Si différent",
    phAlbum: "Nom de l'album",
    phYear: "2026",
    phGenre: "Électro, Jazz…",
    phTrack: "1",
    phTrackTotal: "12",
    phComment: "Note libre, source, remerciements…",
    phTempo: "128",
    phKey: "Am, F#, Bbm…",
    phComposer: "Qui a écrit le morceau",
    phPublisher: "Nom du label",
    phIsrc: "FRXXX2600001",

    coverNone: "aucune",
    coverBrowse: "Parcourir…",
    coverRemove: "Retirer",
    coverHint: "JPG ou PNG",
    coverKept: function (n) { return "Pochette : " + n + ", conservée telle quelle."; },
    coverShrunk: function (from, to, px) {
      return "Pochette réduite à " + px + " px, " + from + " → " + to +
             ". Largement assez pour n'importe quel lecteur et pour les vignettes de l'Explorateur, " +
             "et le fichier reste assez léger pour partir par mail.";
    },

    clean: "Aucune modification",
    dirty: "Modifications non enregistrées",
    saved: "Enregistré",
    reset: "Réinitialiser",
    save: "Enregistrer",

    filled: "Rempli",
    alreadySet: function (n) { return n + (n.indexOf(",") === -1 ? " déjà rempli" : " déjà remplis"); },
    nothingToAdd: function (n) { return "Rien à ajouter, ces champs sont déjà remplis : " + n + "."; },
    nothingFound: "Rien à tirer de ce nom de fichier.",

    noSuggestion: "Aucune suggestion : ta valeur sera gardée telle quelle.",
    savedToast: "Enregistré : même fichier, sur ton disque",
    confirmSwitch: "Des modifications ne sont pas enregistrées. Ouvrir un autre fichier quand même ?",
    dropUnavailable: "Glisser-déposer indisponible ici. Utilise le bouton Ouvrir.",
    openFailed: "Impossible d'ouvrir ce fichier.",
    imageFailed: "Impossible d'utiliser cette image.",
    saveFailed: "Échec de l'enregistrement.",

    dlgOpenAudio: "Ouvrir un fichier audio",
    dlgOpenImage: "Choisir une pochette",
    filterAudio: "Fichiers audio",
    filterImages: "Images",
    errUnsupported: "Format non reconnu : utilise un fichier MP3 ou WAV.",
    errParse: "Impossible de lire ce fichier. Il est peut-être corrompu.",
    errImageFormat: "Formats acceptés pour la pochette : JPG ou PNG.",
    errImageRead: "Impossible de lire cette image.",
    errNotRiff: "Ce fichier WAV est mal formé et ne peut pas être réécrit sans risque.",
    errLocked: "Impossible d'écrire ce fichier. Il est peut-être ouvert dans un lecteur audio ou un autre logiciel : ferme-le puis réessaie.",
    errMissing: "Le fichier est introuvable. A-t-il été déplacé ou supprimé depuis son ouverture ?",
    errSaveGeneric: function (m) { return "Échec de l'enregistrement : " + m; },

    bytes: function (n) {
      if (n < 1024) return n + " o";
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " Ko";
      return (n / (1024 * 1024)).toFixed(2) + " Mo";
    },

    genres: ["Pop", "Rock", "Hip-Hop", "Rap", "Électro", "House", "Techno", "Jazz", "Blues",
      "Classique", "R&B", "Soul", "Reggae", "Metal", "Punk", "Folk", "Country", "Ambient",
      "Lo-fi", "Chanson française", "Bande originale", "Podcast", "Live", "Acoustique"]
  };

  var TABLES = { en: en, fr: fr };

  // locale: "fr", "fr-FR", "en-US"… Anything not French falls back to English,
  // which is the safer default for a build that may be handed to anyone.
  function pick(locale) {
    var forced = (typeof process !== "undefined" && process.env && process.env.BALISE_LANG) || "";
    var tag = String(forced || locale || "en").toLowerCase();
    return TABLES[tag.slice(0, 2)] || en;
  }

  var api = { pick: pick, en: en, fr: fr };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.strings = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
