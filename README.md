# Nuvio TV Lite (Samsung Tizen 3.0)

A lightweight, high-performance streaming application built with **100% pure ES5 Vanilla JavaScript** designed specifically for legacy **Samsung Tizen 3.0 Smart TVs** (Chromium 47, 2017 models) and newer.

Reverse-engineered from Nuvio TV (`NuvioTV-Tizen-1.2.9.wgt`), Nuvio TV Lite strips away heavy modern JavaScript bundles and replaces them with an optimized, low-memory UI, native hardware decoding via Tizen **AVPlay API**, and a local background proxy to handle community sources from [nuvioplugin.com](https://nuvioplugin.com/).

---

## Features

- **Strict ES5 Compliance:** Zero ES6+ features (`var`, function expressions, no arrow functions, no `let`/`const`, no classes, no template literals). Guaranteed compatibility with Samsung Tizen 3.0's Chromium 47 web runtime.
- **Legacy CSS Engine:** Built with flexbox fallback, float clears, and absolute positioning — no unsupported CSS Grid, no flex `gap`, no `backdrop-filter`, and no `aspect-ratio`.
- **Samsung TV Remote Navigation:** Full spatial D-pad navigation (Up, Down, Left, Right, Enter/OK) and hardware Return/Back key mapping (`keyCode 10009`).
- **Dual Playback Engine:**
  - **Samsung Smart TV:** Native hardware playback via `webapis.avplay` for low CPU consumption and smooth 1080p/4K streaming.
  - **PC Browser Development:** Automatic fallback to HTML5 `<video>` and `Hls.js` with audio sync, auto-play retry, and media error recovery.
- **Embedded EngineFS Media Proxy (`port 2710`):**
  - Bypasses Cloudflare / CORS restrictions.
  - Forwards required headers (`Referer`, `User-Agent`) for strict community streaming hosts (e.g., `ha.vixolity.com`, Vidmody).
  - Dynamically rewrites child HLS playlists (`.m3u8`, `.gif`) and transparently streams MPEG-TS segments.
  - Fixes disguised media segments (e.g., `thumbnail-*.jpg` MPEG-TS files and `sub_*.jpg` WebVTT subtitles) by normalizing `Content-Type: video/mp2t` and `text/vtt`.
- **Addon Ecosystem:**
  - Default integration with Stremio Cinemeta catalog (Popular Movies & TV Series).
  - Addon Manager to install and manage custom manifests (e.g., Yoru's HLS Repo, MoonCrown, Pengu, Torrentio Debrid).

---

## Project Structure

```text
rea/
├── package.json                 # Project scripts (start, verify, package)
├── start-dev.js                 # Local dev server (HTTP 8080 + Proxy 2710 + Plugin 2711)
├── nuvio-lite-tizen3.wgt        # Ready-to-install Tizen 3.0 package
│
├── scripts/
│   ├── verify_es5.js            # Automated Acorn ES5 syntax validator
│   └── package_wgt.js           # WGT zip bundler for Tizen deployment
│
└── tizen-app/                   # Root Tizen Web Application
    ├── config.xml               # Tizen app manifest, privileges, and background services
    ├── index.html               # 1920x1080 UI canvas & conditional Tizen WebAPI loader
    ├── icon.png                 # TV Home launcher icon
    │
    ├── css/
    │   └── style.css            # TV-optimized, dark-mode CSS for Chromium 47
    │
    ├── js/
    │   ├── api.js               # Cinemeta & Stremio Addon Manager (ES5)
    │   ├── app.js               # TV state machine, focus manager & D-pad navigation (ES5)
    │   ├── player.js            # Dual AVPlay / HTML5 / Hls.js player (ES5)
    │   ├── tizen-remote.js      # Samsung TV remote key handler (ES5)
    │   └── hls.min.js           # HLS playback fallback for browser testing
    │
    └── services/                # Tizen Background Web Services
        ├── custom-poster-config.cjs
        ├── plugin-http.cjs      # Plugin HTTP scraper bridge (port 2711)
        └── tizen/
            ├── enginefs-service.js
            ├── plugin-service.js
            └── runtime/
                ├── media-http.cjs             # Vendored EngineFS media proxy
                └── playback-proxy-patch.cjs   # Media segment & playlist repair patch
```

---

## Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- **Samsung Tizen Studio CLI** and a valid signing profile (required to create an installable TV package)

### 2. Local Development & Testing

Run the local development server:
```bash
npm start
```

This launches:
1. **EngineFS Media Streaming Proxy** on `http://127.0.0.1:2710`
2. **Plugin Network Service** on `http://127.0.0.1:2711`
3. **Web Application Server** on `http://127.0.0.1:8080`

Open `http://127.0.0.1:8080` in Chrome, Edge, or Firefox.
- Use **Arrow Keys** / **Enter** / **Backspace** on your keyboard (they emulate the Samsung TV remote).
- Mouse clicks are also fully supported for desktop preview.

---

## Build & Validation Tools

### Strict ES5 Validation
Before deploying to Samsung Smart TVs, ensure no ES6 syntax has accidentally leaked into client files:
```bash
npm run verify
```
*Validates `api.js`, `app.js`, `player.js`, and `tizen-remote.js` using Acorn `ecmaVersion: 5`.*

### Packaging Tizen WGT
Create a signed installation package with the Tizen CLI. Set these PowerShell variables to your Tizen Studio CLI path and certificate profile name first:
```bash
$env:TIZEN_CLI = 'C:\tizen-studio\tools\ide\bin\tizen.bat'
$env:TIZEN_PROFILE = 'YourCertificateProfile'
npm run package
```
This runs `tizen build-web` and `tizen package -t wgt -s <profile>`, then writes `nuvio-lite-tizen3.wgt` in the project root. A plain ZIP renamed to `.wgt` is not an installable Tizen package.

---

## Installing on Samsung Smart TV (Tizen 3.0)

### Recommended: TizenBrew Installer Desktop

1. Build a signed package as described above. This creates `nuvio-lite-tizen3.wgt` in the project root.
2. Connect the TV and PC to the same network. On the TV, open **Apps**, enter `12345` on the remote, enable **Developer Mode**, set **Host PC IP** to your PC's local network IP address, confirm, and restart the TV.
3. On the PC, run [TizenBrew Installer Desktop](https://github.com/reisxd/TizenBrewInstaller/releases). Choose the option to install a local `.wgt`/`.tpk` file and select `nuvio-lite-tizen3.wgt`.
4. When installation finishes, launch **Nuvio TV Lite** from the TV's Apps screen.

TizenBrew itself is the TV-side app/module manager. For a local project WGT, use its companion **TizenBrew Installer Desktop**. For **Install from GitHub**, publish a GitHub Release containing the signed `.wgt` asset; the installer installs the release package rather than building the source tree. The packaged app includes the EngineFS and Plugin background services, so you do not need to run `npm start` on the PC during playback.

### Alternative: Tizen Studio CLI

If you prefer the Samsung CLI, connect with `sdb`, then install the WGT using the Tizen CLI and an active signing profile:
```bash
sdb connect <TV_IP_ADDRESS>
sdb devices
tizen install -n nuvio-lite-tizen3.wgt -t <TV_DEVICE_ID>
```
Samsung's CLI may require the WGT to be packaged with a certificate profile accepted by the TV. See the [Samsung TV CLI guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html?device=htv) for certificate, packaging, and install details.

### Launch and Debug

- Launch **Nuvio TV Lite** from the TV's Apps screen. It starts `NuvioTV030.EngineFsService` and `NuvioTV030.PluginService` in the background and initializes `webapis.avplay` for hardware-accelerated playback.
- For live debugging, open Chrome on the PC and visit `chrome://inspect`, then configure the TV's IP address and port `26101`.

---

## TV Remote Key Controls

| Remote Button | Key Code | Action |
| :--- | :--- | :--- |
| **D-Pad Up** | `38` | Move focus up / select previous tab or row |
| **D-Pad Down** | `40` | Move focus down / navigate to media grid |
| **D-Pad Left** | `37` | Move focus left / Seek -10s in player |
| **D-Pad Right** | `39` | Move focus right / Seek +10s in player |
| **Enter / OK** | `13` | Open item / Play stream / Toggle play-pause |
| **Return / Back** | `10009` | Close modal / Exit player / Return to catalog |
| **Play** | `415` | Play stream |
| **Pause** | `19` | Pause stream |
| **Stop** | `413` | Stop playback and return to details |
| **Rewind (<<)** | `412` | Seek -10 seconds |
| **Fast Forward (>>)** | `417` | Seek +10 seconds |

---

## Technical Solutions & Architecture Notes

### 1. Bypassing CORS & Header Enforcement
Community scrapers (e.g., Vidmody on `ha.vixolity.com`) enforce strict `Referer: https://ha.vixolity.com/` validation and omit CORS headers. Nuvio TV Lite detects streams requiring headers and transforms URLs through the loopback proxy:
```text
http://127.0.0.1:2710/proxy/d=https%3A%2F%2Fha.vixolity.com&h=Referer%3Ahttps%3A%2F%2Fha.vixolity.com%2F/vs/tt22084616
```
The background proxy executes upstream requests with the exact required headers, injects `Access-Control-Allow-Origin: *`, and rewrites child playlist URLs so downstream playback remains fully authenticated.

### 2. Disguised Media Segment Protection
Certain hosts disguise binary MPEG-TS fragments as `.jpg` or `.gif` files (e.g., `thumbnail-1-v1-a1.jpg`) and upstream servers return `Content-Type: application/x-mpegURL` or `image/jpeg`. 
In [`playback-proxy-patch.cjs`](file:///d:/Projects/rea/tizen-app/services/tizen/runtime/playback-proxy-patch.cjs), the proxy explicitly checks if a URL is a media segment (`/(?:thumbnail|segment|frag|part|video|audio|-v\d+|-a\d+|\.(?:ts|mp4|m4s))/`). If so:
1. It disables text-based playlist line rewriting (`isPlaylist = false`) to prevent corrupting binary transport stream packets.
2. It normalizes the header to `Content-Type: video/mp2t` (or `text/vtt` for subtitles), ensuring Tizen AVPlay and browser demuxers process the stream without sync byte errors.

---

## License
MIT License. Created for the Samsung Tizen homebrew and streaming community.
