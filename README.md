# Fish Log

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

There's also an end-to-end smoke test in a real headless browser (Brave flatpak by default; set `BROWSER` to use another Chromium):

```sh
python3 -m http.server 8765 -d app --bind 127.0.0.1 &
deno run -A tests/e2e.js [screenshot-dir]
```

## Sources

Data comes from [XIVAPI](https://v2.xivapi.com) (game data) and [FFXIV Teamcraft](https://github.com/ffxiv-teamcraft/ffxiv-teamcraft) (MIT; catch conditions). Hand fixes go in `data/overrides.json`.
