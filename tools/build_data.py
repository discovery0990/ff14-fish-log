#!/usr/bin/env python3
"""Build app/data/fish.json and app/icons/ from XIVAPI and Teamcraft.

Stdlib only. Raw API responses are cached in tools/cache/ so rebuilds are
fast and repeatable; delete the cache (or pass --refresh) after bumping the
pinned versions below.

Usage: python3 tools/build_data.py [--refresh] [--skip-icons]
"""
import argparse
import collections
import concurrent.futures
import datetime
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'cache'
OUT = ROOT / 'app' / 'data' / 'fish.json'
ICONS = ROOT / 'app' / 'icons'
OVERRIDES = ROOT / 'data' / 'overrides.json'

# --- Pinned sources. Bump deliberately on patch day. ---
XIVAPI = 'https://v2.xivapi.com/api'
GAME_VERSION = '0874aee069e1e7c4'
GAME_VERSION_NAME = '7.57x1'
TEAMCRAFT_SHA = 'c022ca5385ae41ec0d747599ef16ce74e4fbfdcf'
TEAMCRAFT = ('https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/'
             f'{TEAMCRAFT_SHA}/libs/data/src/lib/json')

EXPECTED_ROD = 1517
EXPECTED_SPEAR = 289
MAX_MOOCH_DEPTH = 5
# (fish id, hole id) pairs whose mooch chain does not resolve at that hole.
# Both mooch from Captain's Pen, which Teamcraft has no bait data for yet.
KNOWN_BROKEN_CHAINS = {
    (51225, 'r335'),  # Cieldalaes Roosterfish @ Unnamed Spectral Current
    (51228, 'r335'),  # Akupara @ Unnamed Spectral Current
}

# Teamcraft codes. -1 / 0 mean "unknown" and are stored as null.
TUG = {-1: None, 0: 'medium', 1: 'heavy', 2: 'light'}
HOOKSET = {0: None, 1: 'powerful', 2: 'precision'}

USER_AGENT = 'ff14-fish-log-build/1.0'
MIN_ICON_WIDTH = 64  # _hr1 icons are 2x (fish 80px); standard ones are 40px


# --------------------------------------------------------------------------
# Fetching

class Fetcher:
    def __init__(self, refresh):
        self.refresh = refresh
        CACHE.mkdir(parents=True, exist_ok=True)

    def get(self, url, binary=False):
        key = hashlib.sha1(url.encode()).hexdigest()
        path = CACHE / key
        if path.exists() and not self.refresh:
            data = path.read_bytes()
        else:
            data = self._download(url)
            path.write_bytes(data)
        return data if binary else json.loads(data)

    @staticmethod
    def _download(url):
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return resp.read()
            except Exception as ex:  # noqa: BLE001 - retry any network error
                if attempt == 4:
                    raise RuntimeError(f'GET {url} failed: {ex}') from ex
                time.sleep(2 ** attempt)

    def sheet_all(self, sheet, fields):
        """All rows of a sheet, paginated."""
        rows, after = [], None
        while True:
            q = {'limit': 500, 'fields': fields, 'version': GAME_VERSION}
            if after is not None:
                q['after'] = after
            page = self.get(f'{XIVAPI}/sheet/{sheet}?{urllib.parse.urlencode(q)}')['rows']
            rows += page
            if len(page) < 500:
                return {r['row_id']: r['fields'] for r in rows}
            after = page[-1]['row_id']

    def sheet_rows(self, sheet, ids, fields):
        """Specific rows of a sheet, in batches."""
        ids = sorted(set(ids))
        out = {}
        for i in range(0, len(ids), 100):
            q = {'rows': ','.join(map(str, ids[i:i + 100])), 'fields': fields, 'version': GAME_VERSION}
            for r in self.get(f'{XIVAPI}/sheet/{sheet}?{urllib.parse.urlencode(q)}')['rows']:
                out[r['row_id']] = r['fields']
        return out

    def teamcraft(self, name):
        return self.get(f'{TEAMCRAFT}/{name}')


def name_of(field):
    """Name from a linked-row field like {"value":..,"fields":{"Name":..}}."""
    return ((field or {}).get('fields') or {}).get('Name')


# --------------------------------------------------------------------------
# Build

class BuildError(Exception):
    pass


def build(fetch, skip_icons):
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    # --- Fish logs ---------------------------------------------------------
    # `no` is the fish's place in its log: sheet row order (rows come back
    # sorted by row id). `text` is the log entry the game shows once caught;
    # its newlines are deliberate (verses, quotes).
    fp = fetch.sheet_all('FishParameter', 'Item@as(raw),IsInLog,FishingRecordType@as(raw),'
                         'GatheringItemLevel.GatheringItemLevel,GatheringItemLevel.Stars,Text')
    rod_log = {}
    for f in fp.values():
        if f['IsInLog'] and f['Item@as(raw)']:
            lvl = f['GatheringItemLevel']['fields']
            rod_log[f['Item@as(raw)']] = {'lvl': lvl['GatheringItemLevel'], 'stars': lvl['Stars'],
                                          'rec': f['FishingRecordType@as(raw)'],
                                          'no': len(rod_log) + 1, 'text': f['Text'].strip()}

    sfi = fetch.sheet_all('SpearfishingItem', 'Item@as(raw),IsInLog,FishingRecordType@as(raw),'
                          'GatheringItemLevel.GatheringItemLevel,GatheringItemLevel.Stars,Description')
    spear_row_item = {rid: f['Item@as(raw)'] for rid, f in sfi.items() if f.get('Item@as(raw)')}
    spear_log = {}
    for f in sfi.values():
        if f.get('IsInLog') and f.get('Item@as(raw)'):
            lvl = f['GatheringItemLevel']['fields']
            spear_log[f['Item@as(raw)']] = {'lvl': lvl['GatheringItemLevel'], 'stars': lvl['Stars'],
                                            'rec': f['FishingRecordType@as(raw)'],
                                            'no': len(spear_log) + 1, 'text': f['Description'].strip()}

    check(len(rod_log) == EXPECTED_ROD, f'rod log has {len(rod_log)} fish, expected {EXPECTED_ROD}')
    check(len(spear_log) == EXPECTED_SPEAR, f'spear log has {len(spear_log)} fish, expected {EXPECTED_SPEAR}')
    check(not (set(rod_log) & set(spear_log)), 'a fish is in both logs')
    no_text = [fid for fid, f in {**rod_log, **spear_log}.items() if not f['text']]
    check(not no_text, f'{len(no_text)} log fish have no log entry text, e.g. {no_text[:5]}')

    # --- Holes -------------------------------------------------------------
    rod_spots = fetch.sheet_all('FishingSpot', 'PlaceName@as(raw),PlaceName.Name,GatheringLevel,'
                                'TerritoryType@as(raw),Item@as(raw),X,Z,Radius,FishingSpotCategory,Rare,Order')
    notebooks = fetch.sheet_all('SpearfishingNotebook', 'PlaceName@as(raw),PlaceName.Name,GatheringLevel,'
                                'TerritoryType@as(raw),IsShadowNode,GatheringPointBase.Item@as(raw),X,Y,Radius')

    tc_rod = fetch.teamcraft('fishing-sources.json')
    tc_spear = fetch.teamcraft('spearfishing-sources.json')
    tc_spots = {s['id']: s for s in fetch.teamcraft('fishing-spots.json')}

    holes = {}
    for sid, s in rod_spots.items():
        if not s['TerritoryType@as(raw)']:
            continue
        listed = [i for i in s['Item@as(raw)'] if i in rod_log]
        holes[f'r{sid}'] = {'kind': 'rod', 'name': name_of(s['PlaceName']), 'place': s['PlaceName@as(raw)'],
                            'terr': s['TerritoryType@as(raw)'], 'lvl': s['GatheringLevel'],
                            'cat': s['FishingSpotCategory'], 'fish': listed, 'extra': [],
                            # The in-game Fishing Log's order. Elysian Fields
                            # (Island Sanctuary) has 0: put it last.
                            'ord': s['Order'] or 99999,
                            'raw': (s['X'], s['Z'])}
        # "Rare" spots are the restricted holes (sparkling icon in the log):
        # casting needs Fisher level >= the hole's level ("…but are uncertain
        # where" otherwise). Any other hole can be fished at any level; above
        # your level it just isn't marked on your map (Gulleye, patch 6.0).
        if s['Rare']:
            holes[f'r{sid}']['restricted'] = True
    for nid, n in notebooks.items():
        if not n['TerritoryType@as(raw)']:
            continue
        items = [spear_row_item.get(r) for r in n['GatheringPointBase']['fields'].get('Item@as(raw)') or []]
        listed = [i for i in items if i in spear_log]
        holes[f's{nid}'] = {'kind': 'spear', 'name': name_of(n['PlaceName']), 'place': n['PlaceName@as(raw)'],
                            'terr': n['TerritoryType@as(raw)'], 'lvl': n['GatheringLevel'],
                            'shadow': bool(n['IsShadowNode']), 'fish': listed, 'extra': [],
                            'ord': nid,  # the sheet has no Order column; row order is the log's
                            'raw': (n['X'], n['Y'])}

    # --- Catch info per fish per hole --------------------------------------
    fish = {}
    for fid, meta in rod_log.items():
        fish[fid] = {'log': 'rod', **meta, 'at': {}}
    for fid, meta in spear_log.items():
        fish[fid] = {'log': 'spear', **meta, 'at': {}}

    for hid, h in holes.items():
        for fid in h['fish']:
            fish[fid]['at'][hid] = {}

    def rod_entry(e):
        if e['tug'] not in TUG:
            failures.append(f'unknown tug code {e["tug"]}')
        if e['hookset'] not in HOOKSET:
            failures.append(f'unknown hookset code {e["hookset"]}')
        out = {'bait': e['bait'] or None, 'tug': TUG.get(e['tug']), 'hook': HOOKSET.get(e['hookset'])}
        if e.get('minGathering'):
            out['minG'] = e['minGathering']
        if e.get('spawn') is not None:
            out['spawn'], out['dur'] = e['spawn'], e['duration']
        if e.get('weathers'):
            out['w'] = e['weathers']
        if e.get('weathersFrom'):
            out['pw'] = e['weathersFrom']
        if e.get('predators'):
            out['pred'] = [[p['id'], p['amount']] for p in e['predators']]
        if e.get('snagging'):
            out['snag'] = True
        if e.get('aLure'):
            out['aLure'] = e['aLure']
        if e.get('mLure'):
            out['mLure'] = e['mLure']
        if e.get('oceanFishingTime') is not None:
            out['oft'] = [e['oceanFishingTime']]
        return out

    tc_spot_mismatch = []
    multi_entries = 0
    for fid_s, entries in tc_rod.items():
        fid = int(fid_s)
        if fid not in rod_log:
            continue
        by_spot = collections.defaultdict(list)
        for e in entries:
            by_spot[e['spot']].append(e)
        for spot, es in by_spot.items():
            hid = f'r{spot}'
            if hid not in holes:
                continue
            tcs = tc_spots.get(spot)
            # Teamcraft's naming is inverted: zoneId is the spot's own PlaceName.
            if tcs is None or tcs.get('zoneId') != holes[hid]['place']:
                tc_spot_mismatch.append(spot)
            entry = rod_entry(es[0])
            if len(es) > 1:
                # Several entries for one fish at one hole = alternative baits
                # (and, for ocean fish, other times of day).
                multi_entries += 1
                alts = []
                for e in es[1:]:
                    if e['bait'] and e['bait'] != entry['bait'] and e['bait'] not in alts:
                        alts.append(e['bait'])
                if alts:
                    entry['alts'] = alts
                ofts = sorted({e['oceanFishingTime'] for e in es if e.get('oceanFishingTime') is not None})
                if ofts:
                    entry['oft'] = ofts
            if fid not in holes[hid]['fish']:
                holes[hid]['extra'].append(fid)
                entry['x'] = True
            fish[fid]['at'][hid] = entry
    check(not tc_spot_mismatch, f'Teamcraft spots not matching XIVAPI place: {sorted(set(tc_spot_mismatch))}')

    for fid_s, entries in tc_spear.items():
        fid = int(fid_s)
        if fid not in spear_log:
            continue
        e = entries[0]
        entry = {'speed': e['speed'], 'size': e['shadowSize']}
        if e.get('spawn') is not None:
            entry['spawn'], entry['dur'] = e['spawn'], e['duration']
        if e.get('predators'):
            entry['pred'] = [[p['id'], p['amount']] for p in e['predators']]
        for hid in fish[fid]['at']:
            fish[fid]['at'][hid] = dict(entry)

    # --- Overrides -----------------------------------------------------------
    overrides = json.loads(OVERRIDES.read_text())
    for fid_s, w in overrides.get('windows', {}).items():
        fid = int(fid_s)
        check(fid in fish, f'override for unknown fish {fid}')
        for entry in fish.get(fid, {}).get('at', {}).values():
            if entry.get('spawn') is None:
                entry['spawn'], entry['dur'] = w['spawn'], w['duration']

    # Drop holes that ended up with no log fish at all.
    holes = {hid: h for hid, h in holes.items() if h['fish'] or h['extra']}

    # --- Zones, regions, weather -------------------------------------------
    terrs = fetch.sheet_rows('TerritoryType', {h['terr'] for h in holes.values()},
                             'PlaceName@as(raw),PlaceName.Name,PlaceNameRegion@as(raw),PlaceNameRegion.Name,'
                             'ExVersion@as(raw),WeatherRate@as(raw),Map.SizeFactor')
    # Ocean fishing holes: weather follows the voyage, not the zone's odds, so
    # the engine must never forecast them.
    ikd = fetch.sheet_all('IKDSpot', 'SpotMain@as(raw),SpotSub@as(raw)')
    ocean_spots = {f'r{s[k]}' for s in ikd.values() for k in ('SpotMain@as(raw)', 'SpotSub@as(raw)') if s[k]}

    zones, regions = {}, {}
    for hid, h in sorted(holes.items()):
        t = terrs[h.pop('terr')]
        zid, rid = t['PlaceName@as(raw)'], t['PlaceNameRegion@as(raw)']
        check(rid != 0, f'hole {hid} ({h["name"]}) has a zone with no region')
        h['zone'] = zid
        h['wr'] = t['WeatherRate@as(raw)']
        # Map coordinates from 2048-px map-texture positions (as shown in game).
        scale = t['Map']['fields']['SizeFactor'] / 100
        rx, ry = h.pop('raw')
        h['xy'] = [round(41 / scale * rx / 2048 + 1, 1), round(41 / scale * ry / 2048 + 1, 1)]
        if hid in ocean_spots:
            h['ocean'] = True
        z = zones.setdefault(zid, {'name': name_of(t['PlaceName']), 'region': rid,
                                   'exp': t['ExVersion@as(raw)'], 'holes': []})
        check((z['region'], z['exp']) == (rid, t['ExVersion@as(raw)']),
              f'zone {zid} ({z["name"]}) has territories in different regions/expansions')
        z['holes'].append(hid)
        r = regions.setdefault(rid, {'name': name_of(t['PlaceNameRegion']), 'zones': []})
        if zid not in r['zones']:
            r['zones'].append(zid)
        del h['place']

    # Housing districts are all tagged ARR in the game data, whatever patch added them.
    for zid_s, o in json.loads(OVERRIDES.read_text()).get('zoneExp', {}).items():
        zid = int(zid_s)
        check(zid in zones and zones[zid]['name'] == o['name'], f'zoneExp override for unknown zone {zid}')
        if zid in zones:
            zones[zid]['exp'] = o['exp']

    coord_off = []
    for hid, h in holes.items():
        tcs = tc_spots.get(int(hid[1:])) if h['kind'] == 'rod' else None
        if tcs and tcs.get('coords'):
            if max(abs(h['xy'][0] - tcs['coords']['x']), abs(h['xy'][1] - tcs['coords']['y'])) > 0.15:
                coord_off.append(f'{h["name"]} {h["xy"]} vs {tcs["coords"]}')
    check(not coord_off, f'map coordinates disagree with Teamcraft: {coord_off[:5]}')
    by_name = {h['name']: h for h in holes.values() if h['kind'] == 'rod'}
    check(by_name.get('Hidden Falls', {}).get('restricted') is True, 'Hidden Falls should be restricted')
    check('restricted' not in by_name.get('North Bloodshore', {'restricted': 1}), 'North Bloodshore should not be restricted')

    wr_rows = fetch.sheet_rows('WeatherRate', {h['wr'] for h in holes.values()}, 'Weather@as(raw),Rate')
    weather_rates = {}
    for wid, w in wr_rows.items():
        pairs = [[wt, rate] for wt, rate in zip(w['Weather@as(raw)'], w['Rate']) if rate]
        check(sum(r for _, r in pairs) == 100, f'weather rate {wid} sums to {sum(r for _, r in pairs)}')
        weather_rates[wid] = pairs
    weather_ids = {wt for pairs in weather_rates.values() for wt, _ in pairs}
    for f in fish.values():
        for e in f['at'].values():
            weather_ids.update(e.get('w', []))
            weather_ids.update(e.get('pw', []))
    weather_rows = fetch.sheet_rows('Weather', weather_ids, 'Name,Icon')
    weathers = {wid: {'name': w['Name'], 'icon': w['Icon']['id']} for wid, w in weather_rows.items()}

    exps = {eid: e['Name'] for eid, e in fetch.sheet_all('ExVersion', 'Name').items()}
    rec_types = {rid: {'name': r['Addon']['fields']['Text'], 'spear': bool(r['IsSpearfishing'])}
                 for rid, r in fetch.sheet_all('FishingRecordType', 'Addon.Text,IsSpearfishing').items()}

    # --- Names and icons ---------------------------------------------------
    bait_ids = {b for f in fish.values() for e in f['at'].values()
                for b in [e.get('bait'), *e.get('alts', [])] if b} - set(fish)
    pred_ids = {p[0] for f in fish.values() for e in f['at'].values() for p in e.get('pred', [])}
    items = fetch.sheet_rows('Item', set(fish) | bait_ids | pred_ids, 'Name,Icon')
    for fid, f in fish.items():
        f['name'] = items[fid]['Name']
        f['icon'] = items[fid]['Icon']['id']
    baits = {bid: {'name': items[bid]['Name'], 'icon': items[bid]['Icon']['id']} for bid in sorted(bait_ids)}
    extra_names = {pid: items[pid]['Name'] for pid in pred_ids - set(fish)}

    # --- Checks on the assembled data ----------------------------------------
    for fid, f in fish.items():
        check(f['at'], f'fish {fid} {f["name"]} is not at any hole')
        for hid in f['at']:
            check(hid in holes, f'fish {fid} references dropped hole {hid}')

    # A chain is broken if a bait fish has no entry, or no bait, at the same hole.
    broken = []
    for fid, f in fish.items():
        for hid, e in f['at'].items():
            b, depth = e.get('bait'), 0
            while b in fish:
                nxt = fish[b]['at'].get(hid)
                depth += 1
                if not nxt or not nxt.get('bait') or depth > MAX_MOOCH_DEPTH:
                    broken.append((fid, hid))
                    break
                b = nxt['bait']
    unexpected = set(broken) - KNOWN_BROKEN_CHAINS
    check(not (KNOWN_BROKEN_CHAINS - set(broken)),
          f'known broken chains now resolve, remove them: {sorted(KNOWN_BROKEN_CHAINS - set(broken))}')
    check(not unexpected, 'unresolved mooch chains: ' + ', '.join(
        f'{fish[f]["name"]} ({f}) at {holes[h]["name"]} ({h})' for f, h in sorted(unexpected)))

    for hid, h in holes.items():
        check(h['wr'] in weather_rates, f'hole {hid} has unknown weather rate {h["wr"]}')
    high_seas = {hid for hid, h in holes.items() if regions[zones[h['zone']]['region']]['name'] == 'The High Seas'}
    flagged = {hid for hid, h in holes.items() if h.get('ocean')}
    check(high_seas == flagged, f'ocean flag mismatch: High Seas only {sorted(high_seas - flagged)}, '
                                f'IKDSpot only {sorted(flagged - high_seas)}')

    # --- Icons ---------------------------------------------------------------
    icon_ids = {f['icon'] for f in fish.values()} | {b['icon'] for b in baits.values()} | \
               {w['icon'] for w in weathers.values()}
    if not skip_icons:
        download_icons(fetch, icon_ids)
    missing = [i for i in icon_ids if not (ICONS / f'{i}.png').exists()]
    check(not missing, f'{len(missing)} icons missing on disk')
    small = [i for i in icon_ids if i not in missing and png_width(ICONS / f'{i}.png') < MIN_ICON_WIDTH]
    check(not small, f'{len(small)} icons narrower than {MIN_ICON_WIDTH}px (not _hr1?), e.g. {small[:5]}')

    if failures:
        raise BuildError('\n'.join(f'  - {m}' for m in failures))

    stats = {
        'rod': len(rod_log), 'spear': len(spear_log), 'total': len(fish),
        'holes_rod': sum(1 for h in holes.values() if h['kind'] == 'rod'),
        'holes_spear': sum(1 for h in holes.values() if h['kind'] == 'spear'),
        'holes_restricted': sum(1 for h in holes.values() if h.get('restricted')),
        'extra_pairs': sum(len(h['extra']) for h in holes.values()),
        'zones': len(zones), 'regions': len(regions),
        'no_catch_info': sum(1 for f in fish.values() if f['log'] == 'rod'
                             and not any(e.get('tug') or e.get('bait') for e in f['at'].values())),
        'tc_multi_entries': multi_entries,
        'broken_chains': len(broken), 'icons': len(icon_ids),
    }
    data = {
        'meta': {'game': GAME_VERSION_NAME, 'xivapi': GAME_VERSION, 'teamcraft': TEAMCRAFT_SHA[:7],
                 'built': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                 'stats': stats},
        'expansions': exps, 'recordTypes': rec_types,
        'regions': regions, 'zones': zones, 'holes': holes,
        'weatherRates': weather_rates, 'weathers': weathers,
        'fish': fish, 'baits': baits, 'names': extra_names,
    }
    return data


def png_width(path):
    with open(path, 'rb') as f:
        header = f.read(24)
    return int.from_bytes(header[16:20], 'big')


def download_icons(fetch, icon_ids):
    ICONS.mkdir(parents=True, exist_ok=True)
    todo = [i for i in sorted(icon_ids) if not (ICONS / f'{i}.png').exists()]
    if not todo:
        return

    def one(icon_id):
        folder = f'{icon_id // 1000 * 1000:06d}'
        path = f'ui/icon/{folder}/{icon_id:06d}_hr1.tex'  # 2x resolution for phone screens
        url = f'{XIVAPI}/asset?{urllib.parse.urlencode({"path": path, "format": "png", "version": GAME_VERSION})}'
        (ICONS / f'{icon_id}.png').write_bytes(Fetcher._download(url))

    print(f'downloading {len(todo)} icons…', file=sys.stderr)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(one, todo))


def diff_summary(old, new):
    lines = []
    for key in ('fish', 'holes'):
        o, n = set((old or {}).get(key, {})), set(new[key])
        added, removed = n - o, o - n
        if added or removed:
            lines.append(f'{key}: +{len(added)} -{len(removed)}')
    return lines or ['no fish or holes added or removed']


def dump_lines(data):
    """Compact JSON with one entry of each top-level table per line (one fish,
    one hole, …), so a patch-day git diff shows what changed."""
    def compact(v):
        return json.dumps(v, separators=(',', ':'), ensure_ascii=False)

    def table(t):
        rows = [f'{compact(str(k))}:{compact(v)}' for k, v in t.items()]
        return '{\n' + ',\n'.join(rows) + '\n}'

    parts = [f'{compact(k)}:{table(v) if isinstance(v, dict) and v and k != "meta" else compact(v)}'
             for k, v in data.items()]
    return '{\n' + ',\n'.join(parts) + '\n}\n'


def same_except_built(old, new):
    """Whether two data files differ only in meta.built."""
    def strip(d):
        # Round-trip so int keys compare as the strings the file stores.
        d = json.loads(json.dumps(d))
        d['meta'].pop('built', None)
        return d
    return strip(old) == strip(new)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--refresh', action='store_true', help='ignore the response cache')
    ap.add_argument('--skip-icons', action='store_true', help='do not download icons')
    args = ap.parse_args()

    try:
        data = build(Fetcher(args.refresh), args.skip_icons)
    except BuildError as ex:
        print(f'BUILD FAILED:\n{ex}', file=sys.stderr)
        return 1

    old = json.loads(OUT.read_text()) if OUT.exists() else None
    # Keep the old build time when nothing else changed: fish.json then stays
    # byte-identical, so the deploy version (a hash of the app files) does too
    # and installed apps aren't asked to reload for nothing.
    if old and same_except_built(old, data):
        data['meta']['built'] = old['meta']['built']
    # JSON object keys must be strings; ints become strings here and the app
    # reads them back as such.
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dump_lines(data))
    print(json.dumps(data['meta']['stats'], indent=2))
    for line in diff_summary(old and {k: {str(i) for i in old[k]} for k in ('fish', 'holes')},
                             {k: {str(i) for i in data[k]} for k in ('fish', 'holes')}):
        print(line)
    print(f'wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
