# Fish Log — design

A mobile-first PWA for tracking FFXIV fish-log completion, hosted on GitHub Pages and used from an iPhone home screen while playing on PS5.

Status: design, 2026-10-28. Nothing is implemented yet.

## Open decisions (answer before implementation)

1. **Repo name**: sets the Pages URL `https://<user>.github.io/<repo>/` and the base path. Suggested: `ff14-fish-log`.
2. **Toolchain**: proposed: **Python 3 (stdlib only)** for the data build, **plain JS ES modules (no framework, no bundler)** for the app, **Deno** for unit tests. Both Python 3.14 and Deno are already installed; Node is not. See [Toolchain](#toolchain).
3. **"Up soon" horizon**: the mockup shows 3 hours. Options: 1h, 2h, 3h, or user-configurable in Profile. Suggested: configurable, default 2h.
4. **Ocean fishing in v1**: suggested: a static Route → Stop → fish list with bait/tug, no voyage schedule. "Next voyage" timing is an open spike (see [Ocean fishing](#ocean-fishing)).

## Goal and use case

The in-game fishing guide is slow to navigate and gives no overview of completion. The player walks the world discovering fishing holes and tries to catch everything at each. The app supports that loop:

1. Arrive at a hole → open it in the app (search, or Region → Zone → Hole).
2. See every fish catchable there: bait (or mooch chain), tug, hookset, and live time/weather status.
3. Tap to mark fish caught as they land.
4. See what's coming up soon elsewhere, and where progress is incomplete.

There's no way to import in-game progress (PS5, no plugins), so all progress is entered by hand.

## Requirements

### Content

| Section | Fish | Holes | Grouping |
|---|---|---|---|
| Rod | 1,517 log fish, of which 259 are ocean fish | 333 holes (spots with a zone and ≥1 log fish) | Region → Zone → Hole |
| Spearfishing | 289 log fish | 64 holes | Region → Zone → Hole |
| Ocean | the 259 Endeavor fish (also part of the Rod log) | IKD stops | Route → Stop |

- Spoilers are welcome: all fish are visible, including big fish.

### Counts

- **Overall total** = 1,806 = 1,517 rod log + 289 spearfishing log. Unique fish, matching the game's two logs.
- **Rod tab regions** leave out The Endeavor / The High Seas; those fish show in the Ocean tab.
- **Region and zone totals** = distinct fish catchable at any hole in that area, so a fish counts in every area it appears in. The sum of regions is larger than the overall total, which is intended.
- **Hole totals** = the game's list for that spot plus the "Also caught here" fish.
- **"Caught" belongs to the fish, not the hole**: marking a fish caught marks it everywhere.

### Screens

The mockup is at https://claude.ai/artifact/528uaT9rVpkYAw5xb5dgAz.

**Back** retraces the path you took: it goes to the previous screen and names it (e.g. a hole opened from a fish's Found at list goes back to that fish, then to the hole you started from). Each history entry keeps the screens before it, so this survives a reload. With no path behind a screen (a deep link, a fresh start), Back goes up instead: a fish to Home, Up soon or the Fish guide if opened from there, else to its hole; everything else to Home. Screens below Home also get a Home button at the top right, always, so it's found without looking.

Regions, zones, holes and fish all follow the in-game Fishing Log order: FishingSpot.Order for rod holes (zones and regions by their first hole; Elysian Fields has 0 and goes last), SpearfishingNotebook row order for spearfishing, and each hole's own item list for fish.

1. **Home**
   - Header: profile summary, ET, and overall caught count with a thin bar. Rod / Spearfishing / Ocean tabs.
   - Search box (fish, hole or zone).
   - **Up soon**: the first 5 uncaught, eligible, condition fish whose window opens within the horizon (undiscovered hole names get a dashed outline, explained by a one-line legend; the same outline is used in search results, the fish screen's Found at list and the zone header, matching the dashed hole cards and "Not discovered" toggle). "See all" opens an Up soon screen with every match, the 1/2/3/6h horizon chips, and All holes / Discovered / Undiscovered chips (saved; Home follows them and names a non-default filter next to the horizon). Tapping an Up soon fish (or a fish in search) opens the fish; Back returns to Home or Up soon, at the same scroll position.
   - Counts (header, regions, zones, holes, the hole screen, search) read caught / in reach, then the full total in muted parentheses, e.g. 7 / 8 (9), when some fish are out of reach: ones needing more Gathering than the profile has at every hole in the count, or only at holes locked for your level. Caught fish always count as in reach. Bars end in a darker strip for the fish out of reach. Only a full catch folds a row into "Completed …". A legend under Regions explains (N) when any row shows it. Teal is never used as text color; links are underlined.
   - Region list with progress. Regions hidden by filters are summarised in a "N regions hidden" line. Tapping a region expands its zones in place (one open at a time): name, caught/total, hole count, "N new" (undiscovered, dashed) and "N locked" (locked holes aren't counted as new), level range and an "N open now" tag. "Open now" means catchable now: fish needing more Gathering than the profile has, and fish at locked holes, are left out of it and of the hole rows' open tags. The hole screen still lists them with their window and the Gathering warning, without the orange open highlight. An open region keeps its progress bar; open rows are raised, and while you scroll through them the open region's row stays pinned at the top with the open zone's row under it. The accent color is kept for progress, so rails and open arrows are neutral. Tapping a zone expands its holes in place (one zone open at a time, opening in place without scrolling): Lv, name (dashed if undiscovered), caught/total, and tags only for fish open now or a lock; locked holes are greyed. There is no separate zone screen; zone links (search results, a hole's header) open Home with that zone expanded, and region links with that region expanded, unfolding a "Completed …" row if one hides it. Back from a hole opened on Home returns there with its region and zone open and the scroll restored. Completed regions, and completed zones and holes inside an open region or zone, fold into "Completed … (N)" rows that expand in place and stay open for the session.
2. **Hole** (the main screen)
   - Header: hole name; under it Region › Zone, each linking to Home with that row expanded (plain text if filters hide it there); level, coordinates, current ET and weather, with the discovered toggle beside them.
   - Each fish shows: a caught toggle (44px target), name, bait or **mooch chain**, tug and hookset, its condition with a live status pill, a Gathering-shortfall warning, and "mooch bait for X".
   - Tug is shown as ! / !! / !!! (no Light/Medium/Heavy), e.g. "Honey Worm · ! · Precision"; a mooch fish puts its chain in the bait slot on the same line, with purple arrows (no MOOCH tag).
   - Order: the game's Fishing Log order (the hole's own fish list), so the list can be checked against the log. Caught fish fold into a "Caught (N)" row at the bottom; tap to show them.
   - **Also caught here** section: community-reported fish (see Data).
   - Spearfishing holes show speed and shadow size instead of bait, tug and hookset.
   - There's no "mark all caught" action.
3. **Fish detail**: catch facts, numbered mooch-chain steps (for the hole you came from), the next N windows with local times and durations, and every hole the fish is found at. Once caught, the fish's in-game log entry and the date you marked it ("Caught before dates were kept" for older catches) show under the Mark caught button. Opened from the Fish guide it reads as a log page: the entry without the catch button or date; until then a line at the bottom says to catch it to read it.
4. **Fish guide** (`#/guide/rod`, `#/guide/spear`; an open-book button beside Profile in the Home header, always shown, opening the Spearfishing log from the Spearfishing tab and the Rod log otherwise)
   - Every fish in the log as a grid that fills in as you catch them, grouped by expansion. Each expansion is a row with its count and bar that expands in place, one open at a time (like regions on Home), all closed at first; the open one stays open for the session, so Back from a fish returns to it at the same scroll position, and its header sticks while its grid scrolls.
   - Caught fish show their icon and open the fish. Uncaught fish are anonymous tiles with a soft glow, teal, or pink for folklore fish, as the game's guide colours them (checked in game: the first pink is #409, Spring Urchin, the first folklore fish). They aren't links and don't name the fish (open it from search or a hole instead). The tiles are plain CSS, no image.
   - Expansion and order come from the game's guide key (`FishParameter.Unknown1`, `SpearfishingItem.Unknown2`: thousands = expansion + 2, ocean fish numbered one by one after their expansion's main fish), not level: ocean fish (mostly Lv 1-50) go under their route's expansion, and a few low-level fish under later ones (Castaway Chocobo Chick is Stormblood). Within an open expansion, ocean fish are set apart under "Ocean fishing". The game's own guide is a flat 5×5 paged grid; matching its layout isn't a goal.
   - Folklore fish need a folklore tome to be caught at all (`FishParameter.GatheringSubCategory` → its Item, the tome): 296 rod fish, 12 tomes, no spearfishing fish. The fish screen lists the tome under How to catch, and the hole screen notes "Needs the X folklore tome" on uncaught ones. With tomes tracked (Profile), a missing tome turns the note into a warning, and the fish is out of reach like a Gathering shortfall; owned tomes need no note.
   - Big fish: green item rarity on non-ocean holes (consolegameswiki "Big Fishing": "all green-rarity overworld fish are considered big fish"; green ocean fish are ocean fishing's own specials). 335 at 7.57; legendaries are among them. Shown as "Big fish" on the fish screen's sub-line.
   - The fish screen's sub-line starts with the fish's guide number ("No. 409"), counted per log, for checking against the game.
   - Header count and bar for the whole log, Rod / Spearfishing tabs, then "Latest catches" (the last 8 dated catches, newest first), then the expansions. Counts use the same caught / in reach (total) format; a fish is in reach if it's caught or catchable at any of its holes.
   - The live 15-second redraw skips this screen: nothing on it is live.
5. **Profile and filters**
   - Fisher level (1–100) and Gathering (0–9,999), each a number field plus ±1 steppers.
   - Expansions unlocked. (Restricted holes above your level are always listed, greyed; the Up soon horizon lives on the Up soon screen.)
   - Folklore tomes: a "Track folklore tomes" switch and a chip per tome (12, grouped by expansion, always shown). Tapping a chip turns tracking on. Off (`tomes: null`), nothing is filtered.
   - Export/import progress.

### Filtering rules

- **Locked holes:** the game's 47 "restricted" rod holes (`FishingSpot.Rare`, sparkling icon in the in-game log) can't be cast at below their level. The game says "You can sense something swimming below, but are uncertain where." (LogMessage 1125). With fisher level < hole level they stay listed but greyed, tagged "Locked until Lv X", and are left out of Up soon. This mirrors the game, which lists them as undiscovered. There's no setting for it. Only the expansion filter hides holes; a zone or region with no visible holes is hidden too.
- **All other holes** are on your map and fishable at any level. This was confirmed in game at Lv 44: the Lv 50 Privateer Forecastle is on the map and fishable, while the restricted Sterncastle is unmarked and locked. So Gulleye's "holes at or below your level" (patch 6.0) only concerns restricted holes. Above-level unrestricted holes are shown normally and included in Up soon.
- **Coordinates:** every hole shows map coordinates, computed from `FishingSpot.X/Z` (or `SpearfishingNotebook.X/Y`) and the zone map's `SizeFactor`. The build checks them against Teamcraft's coordinates for the 328 rod holes it covers.
- Spearfishing holes have no known restricted flag, so they're never locked.
- Zone expansion not unlocked → the zone is hidden. Ocean holes ignore this filter: they all sit in The Endeavor, which the game tags ARR even for the Stormblood and Endwalker routes, so the Ocean tab always lists every route.
- Zone expansions come from `TerritoryType.ExVersion`, which tags every housing district ARR. `data/overrides.json` `zoneExp` corrects Shirogane to Stormblood.
- Fish needs more Gathering than the profile → the fish is shown at the hole with a warning, and left out of Up soon.
- Tomes tracked and the fish's folklore tome not ticked → the same as a Gathering shortfall: shown at the hole with a warning ("Needs the X folklore tome — not in your Profile"), out of reach in counts, left out of Up soon, "open now" and the open highlight. Caught fish are always in reach.
- Progress totals always count all fish, whatever the filters.

### Discovery

- Each hole has a discovered or undiscovered state.
- Marking any fish caught at a hole marks that hole discovered. You can also toggle it by hand.

## Data

### Sources

| Source | Version pin |
|---|---|
| XIVAPI v2 (`https://v2.xivapi.com/api`) | Game version key `0874aee069e1e7c4` (= `7.57x1`, "latest" on 2026-10-28) |
| Teamcraft `libs/data/src/lib/json` | Commit `c022ca5385ae41ec0d747599ef16ce74e4fbfdcf` (2026-10-26) |
| `data/overrides.json` (hand-kept) | Fixes and gaps |

Nothing comes from the upstream icykoneko repo, except as a test oracle.

### Field sources

| Field | Source |
|---|---|
| Rod log membership, record type, log entry, log order | `FishParameter`: `IsInLog`, `Item`, `FishingRecordType`, `Text` (→ `text`), `Unknown1` guide key (→ `exp`, and `no` in key order), `Item.Rarity` (green off the ocean → `big`), `GatheringSubCategory.Item` (→ `folk`, names in `tomes`) |
| Fish level and stars | `FishParameter.GatheringItemLevel` → `GatheringItemLevelConvertTable` |
| Fish name and icon | `Item.Name`, `Item.Icon` |
| Spearfishing log membership, log entry, log order | `SpearfishingItem`: `IsInLog`, `Item`, `Description` (→ `text`), `Unknown2` guide key (→ `exp`, `no`) |
| Rod hole | `FishingSpot`: `PlaceName`, `GatheringLevel`, `TerritoryType`, `Item[]`, `X`, `Z`, `Radius`, `FishingSpotCategory` |
| Spearfishing hole | `SpearfishingNotebook`: `PlaceName`, `GatheringLevel`, `TerritoryType`, `IsShadowNode`, `GatheringPointBase.Item[]` (→ `SpearfishingItem` rows) |
| Zone, region, expansion | `TerritoryType`: `PlaceName`, `PlaceNameRegion`, `ExVersion` |
| Weather odds | `TerritoryType.WeatherRate` → `WeatherRate`: `Weather[]`, `Rate[]` |
| Weather names and icons | `Weather.Name`, `Weather.Icon` |
| Ocean routes and stops | `IKDRoute`, `IKDSpot` (`SpotMain`/`SpotSub` → `FishingSpot`) |
| Rod catch info, per fish per hole | Teamcraft `fishing-sources.json`: `bait`, `tug`, `hookset`, `spawn`, `duration`, `weathers`, `weathersFrom`, `predators`, `minGathering`, `snagging`, `aLure`/`mLure`, `oceanFishingTime` |
| Spearfishing catch info | Teamcraft `spearfishing-sources.json`: `speed`, `shadowSize`, `predators` (26), `spawn`/`duration` (1) |
| "Also caught here" | Teamcraft `fishing-sources` pairs whose spot's `FishingSpot.Item[]` doesn't list the fish. Kept only for log fish at holes with a zone: 10 pairs (Copperfish ×4, Merlthor Goby ×5, Galadion Goby ×1). The other 92 raw pairs are fish not in either log, or holes with no zone |
| Alternative baits | Several Teamcraft entries for one fish at one hole (122 cases). The first is `bait`; the rest go in `alts`. For ocean fish, `oft` collects every time of day listed |
| Overrides | Time windows only the upstream repo has: White Goldfish, Firelight Goldfish, Indigo Prismfish. Plus any future corrections |

### Decoded enums

These were verified against the upstream repo's 1,110 hand-curated fish.

- `tug`: `0` = Medium (!!), `1` = Heavy (!!!), `2` = Light (!), `-1` = unknown (stored as null)
- `hookset`: `1` = Powerful, `2` = Precision, `0` = unknown (stored as null)
- Spearfishing record types are fish sizes (Small / Average / Big), not water types.
- Still to decode: spearfishing `speed` and `shadowSize`. Check against in-game names and the Teamcraft UI before shipping.

### Known gaps (shown in the UI as "unknown", never guessed)

- 38 rod fish have no bait, tug or hookset: 36 ocean fish from the newer routes (Ruby Sea / Kugane, Rhotano, Thavnair), plus Iq Ebaji and Yowekwa Inkhead.
- 2 mooch chains end at a fish with no bait data: Cieldalaes Roosterfish and Akupara at Unnamed Spectral Current, both mooched from Captain's Pen. They're listed in `KNOWN_BROKEN_CHAINS`. The build fails on any other broken chain, and also when a listed one starts resolving.
- 26 ocean holes (the `IKDSpot` main and spectral spots) carry `ocean: true`. The engine must not forecast them, because their weather follows the voyage. The build checks that this set exactly equals the holes in The High Seas.
- Catch rates aren't available, so the app can't tell common from rare.

### Excluded

- FishingSpot rows with no `TerritoryType` (Diadem, cosmic-exploration-style ponds, "Undiscovered Fishing Hole" placeholders), and fish that aren't in either log.

### Build output: `app/data/fish.json`

The file is 858 KB (258 KB gzipped); the log entries (`text`, newlines kept for verses and quotes) are about half of it. Real excerpts:

```json
{
  "meta": {"game": "7.57x1", "xivapi": "0874aee069e1e7c4", "teamcraft": "c022ca5", "built": "…", "stats": {…}},
  "expansions": {"0": "A Realm Reborn", …},
  "recordTypes": {"3": {"name": "Lakes", "spear": false}, …},
  "regions": {"23": {"name": "The Black Shroud", "zones": [55, 53, 426, 56, 57, 54, 52]}},
  "zones": {"54": {"name": "Central Shroud", "region": 23, "exp": 0, "holes": ["r2", "r3", "r4", "r5", "r92"]}},
  "holes": {"r5": {"kind": "rod", "name": "Hopeseed Pond", "lvl": 35, "cat": 2, "zone": 54, "wr": 3,
                   "fish": [4950, 4958, 4964, 4942, 4939, 4979, 4976, 7934], "extra": []}},
  "weatherRates": {"3": [[3, 5], [7, 15], …]},
  "weathers": {"7": {"name": "Rain", "icon": 60207}},
  "fish": {"4964": {"name": "Black Ghost", "icon": 29213, "log": "rod", "lvl": 28, "stars": 0, "rec": 3, "no": 66, "exp": 0, "text": "Native to the rivers…",
                    "at": {"r5": {"bait": 4942, "tug": "medium", "hook": "powerful"},
                           "r15": {"bait": 4942, "tug": "medium", "hook": "powerful"}}}},
  "baits": {"2592": {"name": "Midge Basket", "icon": 27002}},
  "names": {"<predator id>": "<name>"}
}
```

- Hole IDs are namespaced (`r` = rod, `s` = spearfishing) because the two ID spaces overlap.
- Weather is per hole (`wr`), because it comes from the hole's territory.
- Catch info is stored per hole (`at`), because bait and chains differ by hole.
- **A mooch** is a `bait` that is itself a fish ID. The chain is followed through that fish's `at[sameHole]`.
- **Optional `at` fields on rod fish:**
  - `alts`: alternative baits
  - `minG`: minimum Gathering
  - `spawn` / `dur`: Eorzea-hour time window
  - `w`: weathers
  - `pw`: previous weathers
  - `pred`: predators, `[[id, count]]`
  - `snag`: needs snagging
  - `aLure` / `mLure`: ambitious / modest lure
  - `oft`: ocean time of day
  - `x`: an "also caught here" entry
- **Spearfishing `at`:** `speed`, `size`, `pred`, `spawn` / `dur`.
- Ocean routes and stops are added in milestone 5.

### Icons

- Downloaded once at build time as the 2× `_hr1` versions (`/api/asset?path=ui/icon/…_hr1.tex&format=png`) to `app/icons/<id>.png`. Fish and baits are 80px, weathers 64px. The build fails on any icon narrower than 64px.
- That's 1,348 unique icons, 17 MB. Lossless PNG compression is a possible later saving.
- They're served from Pages and cached by the service worker on first view. No runtime calls to XIVAPI.
- **Fish guide sheets:** the guide shows a whole log at once, which as separate PNGs is about 12 MB for Rod. `tools/build_sprites.py` (needs Pillow; run after the data build) packs the fish icons into one lossy WebP sheet per log and expansion (the fish's `exp`), at 80px and quality 75 (indistinguishable at tile size): 10 sheets, 1.8 MB for both logs. They're written as `app/icons/guide/<log>-<exp>.<hash>.webp`, so the worker's keep-forever icon cache never serves a stale sheet. `app/data/sprites.json` lists each sheet's icon ids in slot order, and the guide looks icons up by id, falling back to the separate PNGs if the file doesn't load. A unit test fails if any fish's icon isn't in a sheet.

### Build-time assertions (the build fails if any fail)

- Rod log has 1,517 fish and spearfishing log has 289 (update deliberately on patch day).
- Every log fish is at ≥1 hole whose zone has a region.
- Every `tug` and `hookset` value is a known code.
- Every Teamcraft spot ID exists in `FishingSpot` with a matching place name.
- Mooch chains resolve within a depth of 5. Known exceptions are listed explicitly.
- Every zone has a `WeatherRate` whose odds sum to 100.
- Every fish has an icon file on disk.

## Engine (pure JS module, shared by app and tests)

### Eorzea time

- 1 Eorzea hour = 175 real seconds.
- 1 Eorzea day = 4,200 real seconds.
- A weather period is 8 Eorzea hours = 1,400 real seconds, starting at ET 00, 08 and 16.

### Weather forecast

`forecastTarget(unixSeconds)` (from SaintCoinach, the same as upstream `js/app/weather.js:83`):

```
bell = unix / 175; inc = (bell + 8 - bell % 8) % 24; days = floor(unix / 4200)
base = days * 100 + inc; s1 = ((base << 11) ^ base) >>> 0; s2 = ((s1 >>> 8) ^ s1) >>> 0
return s2 % 100
```

- The weather is the first entry in the zone's `WeatherRate` where the target is below the running total of the odds.

### Window finder

`nextWindows(fishAtHole, zone, fromTime, n)` walks weather periods forward. In each period:

1. Is the weather in `weathers`? If the list is empty, any weather counts.
2. Was the previous period's weather in `prevWeathers`? If the list is empty, any counts.
3. Intersect the period with the time window [`spawn`, `spawn + dur`). This handles windows that cross midnight and fractional durations (e.g. 2.5).
4. Merge windows that run across consecutive periods.

- **Status values:** `open` (with time left), `upcoming` (with start time), or `rare` (nothing found within the search horizon, e.g. 30 real days; shown as "rare: none in 30 days").
- **Predators** are shown as text ("catch 3× X first"). Their timing isn't modelled.
- **Performance:** Up soon needs the next window for each eligible uncaught condition fish (a few hundred). Results are cached per weather period, and only recomputed when a period changes or a fish is marked caught.

## App

### Structure

- Static files under `app/`: `index.html`, `app.js`, `engine.js`, `store.js`, `views/*.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `data/`, `icons/`.
- **Routing** is hash-based (`#/rod`, `#/rod/soon`, `#/hole/r5`, `#/fish/4964`, `#/guide/rod`), so it works on Pages with no server rewrites.
- **Rendering**: views are template functions that build DOM. Data is small enough (~1–2 MB JSON) to load whole at startup.
- **Look**: dark theme, IBM Plex Sans/Mono, 44px touch targets, as in the mockup.

### Storage

- localStorage key `fishlog:v1`, holding:

  ```json
  {"v": 1, "caught": [ids], "caughtAt": {id: ms}, "discovered": [holeIds], "profile": {...}, "last": "r5"}
  ```

- Saved on every change.
- **Export:**
  - Builds `fishlog-YYYY-MM-DD.json` (same shape, plus `exportedAt`) and opens the iOS share sheet via `navigator.share({files})`. From there: Save to Files (iCloud Drive), AirDrop, Mail, etc.
  - Fallback: a blob download link. Verify on device that file sharing works from a home-screen app.
  - Records `lastExport` and `caughtAtLastExport` in the store.
- **Import:**
  - `<input type="file" accept=".json,application/json">` opens the iOS Files picker.
  - The file is validated (version, ID types, unknown IDs dropped with a count), then a summary is shown ("412 caught, 37 holes discovered, exported 28 Oct").
  - The user then picks **Merge** (union, the default) or **Replace**.
  - `caughtAt` (when each fish was marked caught) is optional, so older backups still import. Merge keeps the earlier date per fish; Replace takes the backup's.
- **Backup reminder:**
  - Profile always shows "Last export: N days ago" (or "never").
  - Home shows a dismissible banner when ≥14 days have passed and ≥10 new catches have been made since the last export. Thresholds are constants for now.
- No clipboard copy/paste and no automatic sync (out of scope).
- Calls `navigator.storage.persist()` on first run.
- **iOS caveats (verify on device):**
  - A home-screen web app probably has storage separate from Safari, so progress made in Safari won't show up in the installed app. Install first, then use only the installed app.
  - iOS may evict storage for sites that go unused, which export protects against.

### PWA

- `manifest.webmanifest`:
  - `start_url: "./"`, `scope: "./"` (relative, because Pages serves from `/<repo>/`).
  - `display: standalone`, dark `theme_color`.
  - A 180px `apple-touch-icon`.
- **Service worker:**
  - Precaches the app shell and `fish.json`, and caches icons as they're first viewed.
  - The data version comes from `meta` in `fish.json`.
  - A new build shows an "update available" toast.

## Ocean fishing

- **v1:** Ocean tab lists Route → Stop → fish, using `IKDRoute` and `IKDSpot`. Each fish shows bait, tug, hookset and Teamcraft's `oceanFishingTime` (day/sunset/night) where known.
- **Spike:** how `IKDRouteTable` plus a time anchor gives the real voyage schedule (departures every 2 real hours). Needs research and checking against a known timetable before any "next voyage" display ships.

## Toolchain

- **Build:** `tools/build_data.py`, Python 3 stdlib only (`urllib`, `json`). Raw API responses are cached in `tools/cache/` (gitignored) so rebuilds are fast and repeatable. Run it each patch, review the assertions and diff, then commit `app/data/` and `app/icons/`.
- **App:** no bundler or framework. Edit and reload.
- **Tests:** `deno test`. Deno runs the same ES modules the browser loads.
- **Local preview:** `python3 -m http.server -d app`. Testing on the phone needs HTTPS, so do it on a Pages branch deploy.

## Test plan

### Unit tests (Deno)

- **Forecast against an oracle:** compare `forecastTarget` with the upstream repo's `calculateForecastTarget` (copied as a test fixture) over 10,000 random timestamps from 2015–2035. Also compare with the independent Python implementation used during discovery.
- **Weather lookup:** the Central Shroud forecast for fixed timestamps matches recorded values.
- **Window finder:**
  - weather only
  - time only
  - weather and time together
  - `prevWeathers`
  - a window crossing midnight (ET 17 → 10)
  - fractional duration (2.5)
  - windows merged across periods
  - "rare" when nothing is found within the horizon
- **Filters:** level, expansion and gathering rules on a small fixture dataset.
- **Counts:** region and zone totals are distinct catchable fish, and the overall total is 1,806.
- **Store:** export/import round trip, merge vs replace, rejecting malformed files, dropping unknown IDs.
- **Reminder:** the reminder logic follows the days and new-catch thresholds.

### Build checks

- The assertions above, plus a diff summary against the previous `fish.json`: fish, holes and windows added or removed.

### Manual, on the iPhone

- Install to the home screen and launch offline.
- Mark caught, kill the app, relaunch: state is kept.
- Export to Files, delete the app, reinstall, import.
- Check one live window against the in-game weather at a hole.
- One-handed use of the hole screen.

## Milestones

1. **Data build:** script, assertions, `fish.json`, icons.
2. **Engine:** time, forecast and window finder, with tests.
3. **App v1:** Rod and Spearfishing, the six screens, profile and filters, storage, export/import.
4. **PWA:** manifest, service worker, Pages deploy, iPhone checks. Carried over from milestone 3:
   - Self-host the IBM Plex fonts (they load from Google Fonts now, so not offline).
   - Call `navigator.storage.persist()` on first run.
   - Decode spearfishing `speed` (currently a raw 0–5).
   - **On device, confirm:**
     - The search keyboard stays up while typing.
     - The share sheet works for export.
     - The Files picker works for import.
     - Taps aren't dropped and momentum scrolling isn't cut off by the 15-second refresh. If either happens, update only the clock and status-pill text instead of the whole page.
   - The e2e test runs in desktop Chromium, so it can't cover these.
5. **Ocean:** static lists (v1), then the schedule spike.
