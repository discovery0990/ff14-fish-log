# Fish Log

**Live:** https://discovery0990.github.io/ff14-fish-log/ (on iPhone, open in Safari → Share → Add to Home Screen)

A mobile-first PWA for tracking FFXIV fish-log completion (rod and spearfishing), hole by hole. See [docs/DESIGN.md](docs/DESIGN.md).

## Data build

```sh
python3 tools/build_data.py            # uses tools/cache/ when present
python3 tools/build_data.py --refresh  # re-download everything
```

The build writes `app/data/fish.json` and `app/icons/`, and fails if any of its checks fail.

On patch day:
1. Bump `GAME_VERSION`, `GAME_VERSION_NAME`, `TEAMCRAFT_SHA` and the expected log counts in `tools/build_data.py`.
2. Run the build with `--refresh`.
3. Review the stats and diff it prints.

## Tests

```sh
deno task test
```

These cover the engine in `app/engine.js` (Eorzea time, weather forecast, window finder). The forecast is checked against the upstream tracker's implementation, and the finder against brute-force sampling on real fish.

There are two end-to-end tests. The first is a smoke test in a real headless browser (Brave flatpak by default; set `BROWSER` to use another Chromium):

```sh
python3 -m http.server 8765 -d app --bind 127.0.0.1 &
deno run -A tests/e2e.js [screenshot-dir]
```

The second checks the PWA against the built site: offline use and the update prompt.

```sh
python3 tools/build_site.py
python3 -m http.server 8766 -d dist --bind 127.0.0.1 &
deno run -A tests/e2e_pwa.js
```

## Deploy

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`). `tools/build_site.py` copies `app/` to `dist/` and stamps the service worker with a hash of the app and data, so every deploy prompts installed apps to reload.

## Sources

Data comes from [XIVAPI](https://v2.xivapi.com) (game data) and [FFXIV Teamcraft](https://github.com/ffxiv-teamcraft/ffxiv-teamcraft) (MIT; catch conditions). Hand fixes go in `data/overrides.json`.

## Legal

FINAL FANTASY is a registered trademark of Square Enix Holdings Co., Ltd. FINAL FANTASY XIV © SQUARE ENIX CO., LTD. All rights reserved. Game data and icons are served via XIVAPI. Fish Log is an unofficial fan project, not affiliated with or endorsed by Square Enix.

Code licence: not chosen yet. Fonts: IBM Plex, SIL Open Font License 1.1 (`app/fonts/OFL.txt`).
