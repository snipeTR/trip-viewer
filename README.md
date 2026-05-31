**🇹🇷 Türkçe** &nbsp;·&nbsp; [🇬🇧 English](#trip-viewer)

# Trip Viewer (Türkçe)

**Senkronize video ve canlı GPS haritası sunan, ücretsiz ve açık kaynaklı bir dashcam (araç kamerası) görüntüleyici.**

Trip Viewer, bir ila dört kameralı dashcam kayıtlarını her kanalı tam senkron tutarak oynatır. Video oynarken canlı bir OpenStreetMap görünümü aracınızın GPS konumunu, hız ve yön bilgisiyle birlikte haritada takip eder — tek kameralı dashcam sahipleri kadar çok kanallı kurulumlar için de sevilen bir özellik.

Donanımsal video çözme, yüksek çözünürlükte bile akıcı oynatma sağlar. Trip Viewer; Windows, macOS ve Linux'ta hafif, yerel bir uygulama olarak çalışır (Windows'ta ~3 MB kurulum dosyası, macOS'ta imzalı DMG, Linux'ta AppImage).

## Kurulum

**Windows 10/11, macOS 11 (Big Sur) ve üzeri, ve güncel Linux dağıtımlarında (Ubuntu 22.04+ test edildi) çalışır.** Geliştirici aracı gerekmez.

### Windows
1. [Releases sayfasına](https://github.com/snipeTR/trip-viewer/releases) gidin.
2. En son sürümün altından **`_x64-setup.exe`** ile biten dosyayı indirin.
3. Kurulumu çalıştırın — uygulama yeni ve imzasız olduğu için Windows bir SmartScreen uyarısı gösterebilir. **"Ek bilgi" → "Yine de çalıştır"** deyin.
4. **Trip Viewer**'ı Başlat menüsünden açın.

**Windows'ta tek ek gereksinim:** Dashcam'iniz büyük olasılıkla HEVC (H.265) formatında kaydeder ve Windows bunun için bir çözücüye ihtiyaç duyar. Trip Viewer açılışta kontrol eder ve eksikse sizi Microsoft Store'a yönlendirir. [HEVC Video Uzantısı](https://apps.microsoft.com/detail/9n4wgh0z6vhq) tek seferlik bir kurulumdur.

### Linux
1. [Releases sayfasından](https://github.com/snipeTR/trip-viewer/releases) **`.AppImage`** ile biten dosyayı indirin.
2. Çalıştırılabilir yapın: `chmod +x trip-viewer_*_amd64.AppImage`
3. Çalıştırın: `./trip-viewer_*_amd64.AppImage`

HEVC oynatma için GStreamer'ın libav eklentisi gerekir; eksikse uygulama açılışta bir kurulum ipucu gösterir. Debian/Ubuntu'da: `sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-bad`

## Neler yapar

Uygulama üstte bir sekme çubuğu — **Player**, **Scan**, **Review**, **Timelapse**, (gerektiğinde) **Issues** ve **Places** — ve solda her zaman görünen bir trip listesi + depolama özeti şeklinde düzenlenmiştir. Sol panel, video panellerini olabildiğince büyütmek istediğinizde başlığındaki **«** simgesiyle ince bir şeride katlanır.

- **Çok kanallı senkron oynatma (1–4 kanal)** — dashcam'inizdeki her kamera tam uyumla oynar. Yan görüntüye tıklayarak ana görünüm yapın; ana görünüme çift tıklayarak tam ekrana geçin.
- **Canlı GPS haritası** — OpenStreetMap görünümü aracınızı gerçek zamanlı izler ve geçtiğiniz yolu çizer. Varsayılan olarak harita aracı takip eder ama siz sürükleyip yakınlaştırırken yerinde kalır. Haritanın köşesindeki iki tik daha ileri gider: **Lock centre** aracı haritanın merkezine kilitler (harita aracın altında kayar), **Auto-zoom** hızlandıkça uzaklaşır, yavaşladıkça yakınlaşır. Haritayı elle hareket ettirdiğinizde/yakınlaştırdığınızda ikisi de kapanır. Kısa GPS kesintileri (~2 sn'ye kadar) son yön ve hıza göre tahminle köprülenir; böylece kısa sinyal kayıplarında iz donmaz/kopmaz.
- **İki kanal düzeni** — ön+arka dashcam'lerde harita arka görüntünün altına yerleşir ve ön kamera genişliğin üçte ikisini kaplar; üç/dört kanallı düzenlerde harita kendi sütununda durur.
- **Hız ve yön göstergesi** — harita üzerinde gerçek zamanlı okumalar.
- **Hız grafikli zaman çizelgesi** — görüntü içinde görsel olarak gezinin; sert frenleme/hızlanma gibi ilginç anlar grafikte belirir.
- **Timelapse hattı** — _(sisteminizde ffmpeg gerektirir.)_ Her trip'in 8× / 16× / 60× hızlı oynatma sürümlerini önceden render eder; olaylarda yavaşlar. NVENC/NVDEC donanım hızlandırma varsa otomatik kullanılır.
- **SD kart içe aktarma** — kayıtları doğrudan dashcam SD kartından alır. Dosyalar SHA-256 bütünlük doğrulamasıyla kopyalanır; ardından bir rapor ne aktarıldığını gösterir ve **SD kartı silmek mi yoksa dosyaları kartta tutmak mı** istediğinizi sorar — "tut" derseniz karta hiç dokunulmaz (kopyalar zaten kütüphanenizde güvende). Güvenlik korumaları, kartın kendi hedefi olarak kullanılmasını engeller; silme sırasında bir dosya silinemezse uygulama durup **Retry / Skip / Cancel wipe** sorar.
- **Klasörden içe aktarma** — diskte zaten var olan dosyalar için silme yapmayan sürüm.
- **Trip algılama** — kayıtları zaman damgalarına göre otomatik olarak trip'lere gruplar.
- **Kayıt modu filtresi** — dashcam birden fazla modda kaydediyorsa (örn. 70mai'nin Normal / Event / Parking / Time-lapse'i) sol listenin üstünde bir filtre çubuğu çıkar; bir moda tıklayınca yalnızca o modun kayıtları görünür.
- **Orijinaller ve timelapse'ler** — bir trip'in orijinallerini silseniz de timelapse'leri kalır ve trip kütüphanede oynamaya devam eder.
- **Otomatik etiketleme taraması, Yerler (Places), İnceleme (Review), Sorunlar (Issues)** — kütüphaneyi tarayıp olay/durağan/sessiz segmentleri ve kayıtlı yer eşleşmelerini etiketler; toplu inceleme/silme araçları sunar.
- **Silinenler geri dönüşüm kutusuna gider** — uygulamanın sildiği her şey sistem çöp kutusuna gider.
- **Klavye kısayolları** — Boşluk oynat/duraklat, ok tuşları sarma, köşeli parantezler hız. Kısayol listesi, "Don't show this automatically on startup" kutusunu işaretleyene kadar her açılışta otomatik açılır; sol alttaki "Keyboard shortcuts" ile her zaman tekrar açılabilir.
- **Otomatik güncelleme** — uygulama açılışta yeni sürümü kontrol eder ve tek tıkla günceller.

## Desteklenen dashcam'ler

Trip Viewer, yaygın dashcam dosya adı formatlarını içe aktarma sırasında otomatik tanır — yeniden adlandırma veya ayar gerekmez.

- **Wolf Box** (3 kanal: ön / iç / arka) — `2026_03_15_173951_02_F.MP4` gibi. ShenShu metadata çözücüsüyle tam GPS desteği.
- **Thinkware** (2 kanal: ön / arka) — `REC_..._F.MP4` / `EVT_...` gibi. Test edilen model GPS kaydetmiyor; harita gizlenir.
- **Miltona MNCD60** (tek kanal) — `FILE211202-151504-000406F.MOV` gibi. NovaTek `gps0` atomundan GPS desteği.
- **70mai A810 / RC12** (2 kanal: ön A810 / arka RC12) — `NO20260522-125624-000184F.MP4` gibi; iki harfli ön ek modu (`NO` normal, `EV` olay, `PA` park, `LA` timelapse), sondaki harf kanalı (`F` ön, `B` arka) belirtir. Kart kökündeki `GPSData*.txt` günlüğünden GPS desteği.
- **Genel 4 kanal** (deneysel) — `2026_03_06_072552_A.MP4` … `_D` gibi.

> **Yeni bir kamera formatı eklemek için yapılması gerekenler:** [Yeni bir kamera eklemek](ADDING_A_CAMERA.md) rehberini izleyin — Windows, macOS veya Linux'ta SD kartınızın `dir.txt` + `tree.txt` listesini nasıl oluşturacağınızı ve bu iki dosyayı issue'ya eklemenin neden önemli olduğunu anlatır.

Geliştirme, mimari, sürüm çıkarma ve katkı bilgileri için aşağıdaki İngilizce belgeye bakın.

---

<img src="icon/icon-128.png" align="left" width="96" alt="Trip Viewer icon"/>

# Trip Viewer

**A free, open-source dashcam viewer with synchronized video and a live GPS map.**

<a href="#windows"><img src="icon/badges/windows.svg" alt="Windows" height="28"/></a> &nbsp; <a href="#macos"><img src="icon/badges/apple.svg" alt="macOS" height="28"/></a> &nbsp; <a href="#linux"><img src="icon/badges/linux.svg" alt="Linux" height="28"/></a>

<br clear="left"/>

Trip Viewer plays back footage from dashcams with one to four camera channels, keeping every channel perfectly in sync. A live OpenStreetMap view tracks your vehicle's GPS position as the video plays, with speed and heading shown on the map — a favorite feature among single-camera dashcam owners as well as multi-channel setups.

Hardware video decoding keeps playback smooth even at high resolution, and Trip Viewer runs as a lightweight native app on Windows, macOS, and Linux (~3 MB installer on Windows, signed DMG on macOS, AppImage on Linux).

![Trip Viewer screenshot showing 3-channel synchronized playback with GPS map](screenshot.png)

https://github.com/user-attachments/assets/435002ee-15ad-41d4-a7eb-979f688c5d7b

## How to install

**Trip Viewer runs on Windows 10/11, macOS 11 (Big Sur) or later, and modern Linux distributions (tested on Ubuntu 22.04+).** No developer tools required.

### Windows

1. Go to the [Releases page](https://github.com/chrisl8/trip-viewer/releases)
2. Under the latest release, download the file ending in **`_x64-setup.exe`**
3. Run the installer — Windows may show a SmartScreen warning since the app is new and unsigned. Click **"More info"** then **"Run anyway"**
4. Launch **Trip Viewer** from your Start Menu

**One extra requirement on Windows:** Your dashcam probably records in HEVC (H.265) format. Windows needs a decoder for this. Trip Viewer will check on startup and link you to the Microsoft Store if it's missing. The [HEVC Video Extension](https://apps.microsoft.com/detail/9n4wgh0z6vhq) is a one-time install.

### macOS

1. Go to the [Releases page](https://github.com/chrisl8/trip-viewer/releases)
2. Check which chip your Mac has: **Apple menu → About This Mac**
   - **Apple M1 / M2 / M3 / M4** (or later) → download the file ending in **`_aarch64.dmg`**
   - **Intel** → download the file ending in **`_x64.dmg`**
3. Double-click the DMG to mount it, then drag **Trip Viewer** into the **Applications** folder
4. Launch **Trip Viewer** from Launchpad or Applications

The macOS build is code-signed and notarized by Apple, so you won't see Gatekeeper warnings on first launch. HEVC playback works out of the box — no codec extensions to install.

### Linux

1. Go to the [Releases page](https://github.com/chrisl8/trip-viewer/releases)
2. Under the latest release, download the file ending in **`.AppImage`**
3. Make it executable: `chmod +x trip-viewer_*_amd64.AppImage`
4. Run it: `./trip-viewer_*_amd64.AppImage`

**One extra requirement on Linux:** HEVC playback needs GStreamer's libav plugin. Trip Viewer will check on startup and show an install hint if it's missing. On Debian/Ubuntu:

```bash
sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-bad
```

By default on Linux, only the primary channel is shown — press **M** to enable multi-channel view. This is opt-in because on some older integrated GPUs, multiple concurrent HEVC streams can overwhelm video memory. On typical modern hardware it works fine.

## What it does

The app is organized as a top tab bar — **Player**, **Scan**, **Review**, **Timelapse**, optional **Issues**, and **Places** — with a sidebar trip list and storage summary that's always visible. The sidebar collapses to a thin strip (click the **«** chevron in its header) when you want the video panels as large as possible.

- **Multi-channel synchronized playback (1–4 channels)** — every camera on your dashcam plays in lockstep. Click a side view to make it the main view. Double-click the main view for fullscreen.
- **Live GPS map** — an OpenStreetMap view tracks your vehicle position in real time as the video plays, with a trail showing where you've been. By default the map auto-pans to follow the vehicle but holds position during your own drag/zoom gestures so you can inspect a moment without being yanked back. Two optional toggles in the map's corner go further: **Lock centre** pins the vehicle to the middle of the map (the map slides under a fixed marker), and **Auto-zoom** widens the view as you speed up and tightens it as you slow down. Any manual pan or zoom turns both back off. Brief GPS dropouts (up to ~2 s) are bridged by dead-reckoning along the last heading and speed, so a short signal loss doesn't freeze or break the trace.
- **Two-channel layout** — for front+rear dashcams the map tucks under the rear view so the front camera fills two-thirds of the width; three- and four-channel layouts give the map its own column.
- **Speed and heading display** — real-time readouts overlaid on the map so you can see how fast you were going at any moment.
- **Timeline with speed graph** — scrub through footage visually. The speed graph shows interesting moments (hard braking, acceleration) so you can jump right to them.
- **Timelapse pipeline** — _(requires ffmpeg installed on your system; the app prompts for the binary the first time you use the feature.)_ Pre-render fast-playback versions of every trip at 8× (constant), 16× (slows to 1× during events), and 60× (slows to 8× during events). Event detection uses GPS-derived hard braking, hard acceleration, and turning thresholds, plus the dashcam's own event flag. Pick the tier and channel mix from the **Timelapse** tab; the Library view shows per-trip status and lets you rebuild any trip on demand. Once a trip has timelapses, you can delete the originals and keep playing the timelapse versions — see "Originals vs. timelapses" below. NVENC/NVDEC hardware encoding is used automatically when available.
- **SD card import** — pull footage directly off your dashcam's SD card. Files are copied with SHA-256 integrity verification — with an estimated time remaining during staging — then organized into your library. After the verified copy, a report shows what was transferred and asks whether to **erase the SD card** or **keep the files on it** — declining leaves the card completely untouched (the copies are already safe in your library). Safety guards prevent the card from ever being used as its own destination (the import is refused if the source is, contains, or sits inside the library folder), and if a file can't be deleted during a wipe the app stops and asks — **Retry**, **Skip**, or **Cancel wipe** — instead of failing silently.
- **Import from a folder** — a non-destructive variant for files already on disk (e.g., manually copied off an SD card, or from a backup). Same trip detection and library organization, but nothing is wiped.
- **Trip detection** — automatically groups your footage into trips based on recording timestamps. No manual organization needed.
- **Recording-mode filter** — when your dashcam records in more than one mode (e.g. 70mai's Normal / Event / Parking / Time-lapse), the sidebar shows a filter row above the trip list. Click a mode to show only the trips that contain it; click **All** to clear. The mode is read from the filename, so it works the moment you open the library — no extra scan.
- **Trip operations** — delete a whole trip (originals, timelapses, tags), or mark two or more trips and merge them manually if the auto-segmenter split a trip you wanted kept together.
- **Originals vs. timelapses** — timelapses are an archival format, not a cache. Deleting a trip's originals leaves its timelapses in place; the trip stays in the library and plays back from the timelapse tier. "Delete trip…" is the only action that removes everything.
- **Storage usage** — the sidebar shows total bytes used (originals + timelapses) and reclaimable bytes, with a one-click filter to surface the trips whose originals you can drop now that timelapses exist.
- **Auto-tagging scan pipeline** — a background scan analyses your library and tags segments as `event` (camera event flag from the dashcam), `stationary` (GPS shows the vehicle isn't moving), `silent` / `no_audio` (quiet or missing audio track), and any saved-place matches. Run it from the **Scan** tab; progress streams inline, and a per-trip × per-scan coverage matrix shows what each scan touched.
- **Places** — save a named location (lat/lon + radius) either manually or with one click from the player using the current segment's GPS. The next scan auto-tags any segment whose GPS track enters that place, turning "everything filmed at home" into a one-click filter. Manage them from the **Places** tab.
- **Review view** — a full-library table with tag-based filtering and bulk actions. Mark segments as **Keep** (hidden from the default filter so repeat review sessions only surface unreviewed material), or select a batch and bulk-delete the clips you don't want. Bulk actions are scoped to the intersection of your selection and the current filter, so the action button always reflects exactly what will be deleted.
- **In-player selection mode** — open selection mode from the tag bar above the timeline, then click — or shift-click for a range — to select segments directly on the timeline. A single bulk-delete action trashes every channel file for the whole selection. A one-segment delete button is right there too for quick cleanup as you watch.
- **Issues view** — a classified triage list for any file the scanner couldn't ingest. Each row is tagged by reason (invalid filename, unreadable, missing `moov`, corrupt box structure, no video track, other) with per-row reveal-in-folder, copy-path, and move-to-trash actions, plus a filter-gated bulk delete. The tab only appears when there's something to triage.
- **Deletes go to the OS recycle bin** — everything the app deletes (segments, issue files, places) goes to your system trash, so nothing is permanently gone until you empty it yourself.
- **Window state is remembered** — the app restores its last size, position, and maximized state across launches.
- **Keyboard shortcuts** — Space to play/pause, arrow keys to seek, brackets to change speed. The shortcut list opens automatically on startup until you tick "Don't show this automatically on startup"; it's always reachable again from "Keyboard shortcuts" in the sidebar footer.
- **Auto-updates** — the app checks for new versions on startup and offers a one-click update.

## Supported dashcams

Trip Viewer auto-detects common dashcam filename formats at import time. You just point it at a folder of video files — no renaming, no manual configuration.

Currently recognized formats:

- **Wolf Box** (3-channel: front / interior / rear) — filenames like `2026_03_15_173951_02_F.MP4`. Full GPS support via the ShenShu metadata parser.
- **Thinkware** (2-channel: front / rear) — filenames like `REC_2026_03_06_07_25_52_F.MP4` or `EVT_...` for event recordings. SD cards with Thinkware folder structure (`cont_rec/`, `evt_rec/`, etc.) are auto-detected at import. The tested Thinkware model does not record GPS, so the map panel is hidden and replaced with a compact caption — no wasted screen space. If a GPS-equipped Thinkware model turns up, GPS support can be added.
- **Miltona MNCD60** (single-channel) — filenames like `FILE211202-151504-000406F.MOV`. GPS support via the proprietary `gps0` atom (NovaTek-family chipset), with speed readout from the embedded km/h byte. GPS coordinates were ground-truthed against seven on-screen overlay readings from a reference clip.
- **70mai A810 / RC12** (2-channel: front A810 / rear RC12) — filenames like `NO20260522-125624-000184F.MP4`, where the two-letter prefix is the recording mode (`NO` normal, `EV` event, `PA` parking, `LA` time-lapse) and the trailing letter is the channel (`F` front, `B` rear). SD cards with the 70mai folder layout (`Normal/`, `Event/`, `Parking/`, `Lapse/`) are auto-detected at import. GPS support via the `GPSData*.txt` sidecar log written at the card root, with speed and heading derived from successive fixes.
- **Generic 4-channel** (best-effort) — filenames like `2026_03_06_072552_A.MP4` through `..._D.MP4` (or `_1` through `_4`). Labeled "Channel A" through "Channel D". GPS not yet implemented for this format.

If your dashcam uses a different naming convention, it can be added. **To add a new camera format, here's what to do:** follow **[Adding a new camera](ADDING_A_CAMERA.md)** — it walks you through capturing a `dir.txt` + `tree.txt` listing of your SD card on Windows, macOS, or Linux (and explains why attaching both to your issue is what makes the parser addition possible). The parser architecture is modular and new format support is a small, low-risk addition once we can see your card's shape.

## Built with AI

This project was built with significant help from [Claude Code](https://claude.ai/claude-code) (Anthropic's AI coding assistant). I'm a full-time software developer, and Claude Code was an excellent collaborator — it helped with architecture decisions, wrote the Rust backend and React frontend, reverse-engineered the dashcam GPS format, and built the entire SD card import pipeline. The result is a codebase I understand fully and maintain myself, with AI as a force multiplier.

If you're curious about how it was built, the [DESIGN.md](DESIGN.md) document covers the architecture decisions and tech stack in detail.

## Feature requests and bug reports

I actively maintain this project and I'm interested in making it better. If you:

- **Found a bug** — [open an issue](https://github.com/chrisl8/trip-viewer/issues) with what happened and what you expected
- **Want a feature** — [open an issue](https://github.com/chrisl8/trip-viewer/issues) describing what you'd like. Some ideas I'm already thinking about: audio source selection, clip export, GPX track export, camera view flipping, and AI-powered footage search
- **Have a different dashcam** — I'd love to add support for it. Open an issue with your dashcam model and, if possible, a sample file

### If an update breaks things

If a new release breaks something for you, uninstall it via your OS and reinstall the previous version from the [Releases page](https://github.com/chrisl8/trip-viewer/releases). Please also file a bug report. Auto-update prompts can be dismissed if you want to stay on a working version.

## Development

If you want to build Trip Viewer from source or contribute:

### Prerequisites

- Node.js 20+
- Rust 1.70+ (via [rustup](https://rustup.rs/))
- **Windows:** HEVC Video Extension (see [Windows install](#windows) above)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`). HEVC playback works natively via AVFoundation — no extra codecs needed. Local `npm run tauri build` produces a DMG for the host architecture only; CI uses a matrix build for both Intel and Apple Silicon.
- **Linux:** `webkit2gtk-4.1`, `gstreamer1.0-libav`, `gstreamer1.0-plugins-bad`, plus Tauri's standard build deps (see [Tauri prerequisites](https://tauri.app/start/prerequisites/)). For full distro-specific setup — including the distrobox path for atomic distros like Bazzite/Silverblue — see [LINUX_DEV_SETUP.md](LINUX_DEV_SETUP.md).
- **Optional — ffmpeg** for the timelapse feature. Not bundled and not required for playback or import; install from your platform's usual source (Windows: [gyan.dev builds](https://www.gyan.dev/ffmpeg/builds/) or `winget install ffmpeg`; macOS: `brew install ffmpeg`; Linux: distro package). The app prompts for the binary path the first time you open the Timelapse tab and validates it before use.

### Build and run

```bash
npm install
npm run tauri dev      # Development mode (hot-reload)
npm run tauri build    # Production build (creates installer)
```

First build compiles the Rust backend (~2 minutes). Subsequent builds use incremental compilation (~10 seconds).

### Tech stack

| Layer              | Technology                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------ |
| App framework      | Tauri v2 (Rust backend, WebView2 on Windows / WKWebView on macOS / WebKitGTK 4.1 on Linux) |
| Frontend           | React 19, TypeScript, Tailwind CSS v4, Zustand                                             |
| Maps               | Leaflet + react-leaflet + OpenStreetMap                                                    |
| Video sync         | `requestVideoFrameCallback` API                                                            |
| Container parsing  | `mp4` crate (pure Rust, no ffprobe)                                                        |
| GPS decoding       | Custom ShenShu MetaData (Wolf Box) + NovaTek gps0 atom (Miltona) + GPSData txt sidecar (70mai) parsers |
| Audio analysis     | `symphonia` (pure Rust decoder, AAC / MP3 / ISO-MP4) for silence detection                 |
| File hashing       | SHA-256 via `sha2` crate                                                                   |
| Tag + Place store  | SQLite via `rusqlite` (bundled) + `rusqlite_migration`                                     |
| File deletion      | `trash` crate — OS recycle bin (recoverable)                                               |
| Timelapse encoding | ffmpeg (user-supplied, not bundled), with NVENC + NVDEC when available                     |
| Parallelism        | `rayon` (metadata probing, scan workers, parallel timelapse rebuild)                       |
| CI/CD              | GitHub Actions + NSIS (Windows) + DMG (macOS, dual-arch) + AppImage (Linux) + auto-updater |

See [DESIGN.md](DESIGN.md) for architecture decisions and [RELEASING.md](RELEASING.md) for release instructions.

## Support

Trip Viewer is free and always will be. If it's been useful to you and you'd like to say thanks, there are two low-key ways:

- ⭐ **[Star the repo](https://github.com/chrisl8/trip-viewer)** — it's a signal that people are actually using it, which keeps me motivated to keep going.
- ☕ **[Buy me a coffee](https://buymeacoffee.com/chrisl8)** — if you'd like to chip in toward development, this is the place.

Either one is appreciated. Neither is expected.

## License

[MIT](LICENSE)
