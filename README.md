<img src="src/icon.png" width="72" height="72" alt="">

# Balise

Edit the metadata and cover art of your **MP3** and **WAV** files, right in the file on your disk: title, artist, album, year, genre, track, tempo, key, comment, and on the credits side composer, publisher and ISRC. No copy, nothing sent anywhere: you open the file, change it, save, and it is the same file, rewritten in place.

## Download

| System | File |
|---|---|
| Windows | [`Balise-Setup-windows-x64.exe`](https://github.com/Yanis-A/balise/releases/latest/download/Balise-Setup-windows-x64.exe) |
| macOS, Apple Silicon (M1 and later) | [`Balise-macos-arm64.dmg`](https://github.com/Yanis-A/balise/releases/latest/download/Balise-macos-arm64.dmg) |
| macOS, Intel | [`Balise-macos-x64.dmg`](https://github.com/Yanis-A/balise/releases/latest/download/Balise-macos-x64.dmg) |
| Linux | [`Balise-linux-x64.AppImage`](https://github.com/Yanis-A/balise/releases/latest/download/Balise-linux-x64.AppImage) |

Balise is not signed with a paid certificate, so Windows and macOS each warn once that it comes from an unknown developer. That is all the warning means.

**Windows:** run the installer. If Windows says it protected your PC, click *More info*, then *Run anyway*. It lets you pick the install folder and adds a desktop and Start menu shortcut, with a regular uninstaller.

**macOS:** open the `.dmg` and drag Balise into Applications. The first time, macOS refuses to open it: go to *System Settings → Privacy & Security*, scroll to the line about Balise, click *Open Anyway* and confirm. On macOS 14 and older, right-click Balise → *Open* does the same. After that it opens like any other app.

**Linux:** make the file executable (`chmod +x Balise-linux-x64.AppImage`) and run it.

The interface follows the system language: French on a French system, English everywhere else. Set `BALISE_LANG=fr` or `BALISE_LANG=en` to force one.

## How it works

- **Open a file** with the button, or drop it anywhere on the window.
- **Cover art:** drop a JPG or PNG on the thumbnail, or click it. The image is stored *inside* the audio file, so its weight becomes the file's. To keep the file small enough to send by email, a large image is brought down to 600 px and re-encoded as JPEG: plenty for any player, and for Explorer thumbnails, which stop at 256 px. A 3.4 MB PNG export drops to 57 KB this way, and the file from 10.9 MB to 7.6 MB. A cover that is already reasonable (under 600 px and 150 KB) is left alone: re-encoding it would only degrade it for a few kilobytes. The kept weight is shown next to the thumbnail.
- **Save** rewrites the open file, in place, with the new metadata. Nothing else is created. The light at the bottom left turns orange as soon as a change is waiting, and green once it is saved.
- **Fill from name** reads the title, artist, tempo and key out of the file name. It understands three ways of naming a file:
  - `annette peacock - nothing outside us`: artist first, the usual convention;
  - `SpotiDownloader.com - Innerbloom - RÜFÜS DU SOL`: artist last, as some downloaders write it;
  - `knocks prod vesper 140bpm Gsharpmin`: the title, then the producer as artist, plus tempo and key.

  For tempo and key it handles `145bpm Dsharpmin`, `EbMaj`, `F#min`, `120bpmDmin`, `122Emin`, `Gsharpmin-44cents`, and the Camelot (`8A`) and Open Key (`8m`) notations. Stray suffixes (`- Part_2`, `(Official Video)`, site addresses, track numbers) are dropped on the way.

  It only fills the fields left empty and never overwrites what you typed or what the file already held. It tells you what it filled and what it left as it was.
- **WAV** files get their tags written twice, for the widest compatibility: a full ID3v2 tag (cover included, read by foobar2000, MediaMonkey, VLC, FFmpeg…) and a classic `LIST/INFO` chunk so Windows Explorer shows the title and artist.

## From the source

Needs [Node.js](https://nodejs.org) 18 or newer.

```
npm install
npm start          # run the app
npm test           # tag engine, name detection, language tables: no dependencies
npm run test:ui    # opens the app, drives it, closes it
npm run dist       # builds the installer for the system you are on, into dist/
npm run smoke -- <path to the built executable>   # checks a built app opens
npm run icons      # regenerates the PNG, ICO and 1024 px icons from src/icon.svg
```

Pushing a tag that matches the version in `package.json` (`v1.0.0`) makes the *Release* workflow test Balise, build it on Windows, macOS and Linux, check each build opens, and prepare a draft release with them.

## Icon

The icon is a beacon (*balise* in French): a mast, a light, two waves, in the amber of the app's status light. The source drawing is `src/icon.svg`. Below 32 px a variant without the waves takes over: at that size they close into a smudge and the mast becomes unreadable.

## Files

```
src/metadataEngine.js   ID3v2 (MP3) and RIFF/WAVE reading and writing, no external dependency
src/main.js             Electron main process: native dialogs, the actual reads and writes on disk
src/preload.js          the safe bridge between the interface and the main process
src/renderer/           the interface, plus tagGuess.js (name detection) and strings.js (French and English)
src/icon.svg            the icon drawing; tools/make-icons.js renders the PNG, ICO and 1024 px versions
tools/smoke.js          starts a built app and checks its interface loads
test/                   the test suites
```

## License

MIT, see [LICENSE](LICENSE): do what you like with it, including redistributing it, as long as the notice stays.
