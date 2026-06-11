# Reddit Enhancement Suite — Safari Edition

[![RES Pipeline](https://github.com/honestbleeps/Reddit-Enhancement-Suite/actions/workflows/pipeline.yml/badge.svg)](https://github.com/honestbleeps/Reddit-Enhancement-Suite/actions/workflows/pipeline.yml)
[![Chat on Discord](https://img.shields.io/discord/681993947085799490?label=Discord)](https://discord.gg/UzkFNNa)

This branch adds **Safari Web Extension** support to RES. Safari dropped RES support after v5.0.0 (Sept 2016) when its extension model diverged from Chrome/Firefox. Now that Safari supports the standard MV3 WebExtensions API (16.4+), we can target it from the same codebase.

Since Safari Web Extensions require an Apple Developer account ($99/year) for distribution, the only way to run it right now is **building from source**. It takes about 10 minutes.

> A standalone HTML version of this guide with dark mode and copy buttons is available at [`docs/safari-build-guide.html`](docs/safari-build-guide.html).

---

## Prerequisites

- **macOS 13** (Ventura) or later
- **[Xcode 15+](https://apps.apple.com/us/app/xcode/id497799835)** (free from the Mac App Store)
- **Node.js 18+** — `node -v` to check
- **Yarn** — `npm install -g yarn` if needed
- **Safari 16.4+** (ships with macOS Ventura+)
- **Git** — `git --version` to check

---

## Build steps

### 1. Clone the repo and install dependencies

```bash
git clone https://github.com/doctorgonzo/Reddit-Enhancement-Suite.git
cd Reddit-Enhancement-Suite
git checkout safari-support
yarn install
```

### 2. Build the Safari extension

```bash
npx node build.js --browsers safari
```

This compiles the source code and outputs the extension to `dist/safari/`.

### 3. Generate the Xcode project

Apple requires Safari extensions to be wrapped in a native macOS app. This command auto-generates the Xcode project from the built extension files.

```bash
xcrun safari-web-extension-converter dist/safari/ \
  --project-location ./xcode \
  --app-name "Reddit Enhancement Suite" \
  --bundle-identifier com.res.reddit-enhancement-suite \
  --no-open
```

> **Note:** You only need to run this once. After the Xcode project exists, subsequent JS rebuilds (step 2) are picked up automatically — just re-run step 4.

### 4. Build the macOS app

```bash
xcodebuild \
  -project "xcode/Reddit Enhancement Suite/Reddit Enhancement Suite.xcodeproj" \
  -scheme "Reddit Enhancement Suite (macOS)" \
  -configuration Debug \
  build \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO
```

Look for **BUILD SUCCEEDED** in the output.

### 5. Launch the app

```bash
open "$(find ~/Library/Developer/Xcode/DerivedData \
  -name 'Reddit Enhancement Suite.app' \
  -path '*/Debug/*' \
  | head -1)"
```

A small app window will appear — you can close it. The extension is now registered with Safari.

### 6. Enable the extension in Safari

**A. Enable unsigned extensions:**

Safari → menu bar → **Develop** → **Allow Unsigned Extensions**

*(If you don't see the Develop menu: Safari → Settings → Advanced → check "Show features for web developers")*

**B. Turn on the extension:**

Safari → **Settings** → **Extensions** → check the box next to **Reddit Enhancement Suite**

> ⚠️ **Important:** "Allow Unsigned Extensions" resets every time you quit Safari. You'll need to re-enable it each session.

### Done!

Navigate to [old.reddit.com](https://old.reddit.com) and you should see the RES gear icon in the toolbar.

---

## Rebuilding after code changes

If you make changes to the source code, you only need to repeat steps 2 and 4:

```bash
npx node build.js --browsers safari

xcodebuild \
  -project "xcode/Reddit Enhancement Suite/Reddit Enhancement Suite.xcodeproj" \
  -scheme "Reddit Enhancement Suite (macOS)" \
  -configuration Debug \
  build \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO
```

---

## Known limitations

- Private browsing detection is disabled (Safari doesn't expose this to extensions)
- OAuth login uses a popup window flow instead of background auth
- The locale dictionary (~150KB) is bundled in the foreground script rather than loaded via messaging
- Some media expandos may not work yet — testing is ongoing

---

## Why can't I just download the extension?

Apple requires all Safari extensions to be distributed through the Mac App Store or as notarized apps, both of which require a paid Apple Developer account ($99/year). Until we have that, building from source is the only option. The upside: you get to run the latest code and help us test.

---

## Troubleshooting

If something isn't working, open Safari's Web Inspector (**Develop → Show Web Inspector**) and check the console for errors. Please [open an issue](https://github.com/doctorgonzo/Reddit-Enhancement-Suite/issues) if you run into problems.

---

*Reddit Enhancement Suite v5.24.8 · Safari Web Extension Port · 2026*
