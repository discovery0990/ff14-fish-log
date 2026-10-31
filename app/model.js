// Derived views of the data file: grouping, counts, filters, mooch chains
// and live window status. Pure functions over (data, progress, profile).

import { hasWindow, nextWindows, periodOf, windowStatus, zoneWeather } from './engine.js';

export const TABS = ['rod', 'spear', 'ocean'];
export const TAB_LABELS = { rod: 'Rod', spear: 'Spearfishing', ocean: 'Ocean' };

/** Which home tab a hole belongs to. */
export const holeTab = (h) => (h.kind === 'spear' ? 'spear' : h.ocean ? 'ocean' : 'rod');

export function createModel(data, sprites = null) {
  const weatherFns = new Map();
  const weatherOf = (hid) => {
    const wr = data.holes[hid].wr;
    if (!weatherFns.has(wr)) weatherFns.set(wr, zoneWeather(data.weatherRates[wr]));
    return weatherFns.get(wr);
  };

  // Holes per zone per tab, zones per region per tab, holes per fish.
  const zoneHoles = {}; // tab → zone → [hid]
  const regionZones = {}; // tab → region → [zone]
  const fishHoles = {}; // fid → [hid]
  for (const tab of TABS) {
    zoneHoles[tab] = {};
    regionZones[tab] = {};
  }
  for (const [hid, h] of Object.entries(data.holes)) {
    const tab = holeTab(h);
    const zone = String(h.zone);
    const region = String(data.zones[zone].region);
    (zoneHoles[tab][zone] ??= []).push(hid);
    const zs = (regionZones[tab][region] ??= []);
    if (!zs.includes(zone)) zs.push(zone);
    for (const fid of [...h.fish, ...h.extra]) (fishHoles[String(fid)] ??= []).push(hid);
  }
  // In-game Fishing Log order: holes by their Order, and zones and regions
  // by their first hole.
  const ordOf = (hid) => data.holes[hid].ord;
  const byOrd = (a, b) => ordOf(a) - ordOf(b) || (a < b ? -1 : 1);
  const regionOrder = {}; // tab → [region]
  for (const tab of TABS) {
    for (const hs of Object.values(zoneHoles[tab])) hs.sort(byOrd);
    const first = (z) => ordOf(zoneHoles[tab][z][0]);
    for (const zs of Object.values(regionZones[tab])) zs.sort((a, b) => first(a) - first(b));
    regionOrder[tab] = Object.keys(regionZones[tab])
      .sort((a, b) => first(regionZones[tab][a][0]) - first(regionZones[tab][b][0]));
  }

  const fishName = (id) => data.fish[id]?.name ?? data.baits[id]?.name ?? data.names?.[id] ?? `#${id}`;

  /** Fish at a hole: listed ones, then "also caught here" ones. */
  function holeFish(hid) {
    const h = data.holes[hid];
    return [
      ...h.fish.map((f) => ({ fid: String(f), extra: false })),
      ...h.extra.map((f) => ({ fid: String(f), extra: true })),
    ].map((x) => ({ ...x, entry: data.fish[x.fid].at[hid] ?? {} }));
  }

  /**
   * Distinct fish across holes: how many are caught, and how many are in
   * reach for the profile (caught already, or catchable at one of these
   * holes: not locked there and enough Gathering). Without a profile every
   * fish is in reach.
   */
  function count(hids, isCaught, profile) {
    const all = new Set();
    const reach = new Set();
    for (const hid of hids) {
      const locked = profile && isLocked(hid, profile);
      for (const { fid, entry } of holeFish(hid)) {
        all.add(fid);
        if (!profile || (!locked && !gatheringShort(entry, profile))) reach.add(fid);
      }
    }
    let caught = 0;
    for (const fid of all) {
      if (isCaught(fid)) {
        caught++;
        reach.add(fid);
      }
    }
    return { caught, total: all.size, reach: reach.size };
  }

  /**
   * Like count, over a set of fish rather than holes: a fish is in reach if
   * it's caught or catchable at any of its holes.
   */
  function countFish(fids, isCaught, profile) {
    let caught = 0, reach = 0;
    for (const fid of fids) {
      if (isCaught(fid)) {
        caught++;
        reach++;
      } else if (!profile || (fishHoles[fid] ?? []).some((hid) =>
        !isLocked(hid, profile) && !gatheringShort(data.fish[fid].at[hid] ?? {}, profile))) {
        reach++;
      }
    }
    return { caught, total: fids.length, reach };
  }

  // Each log's fish in log order, grouped by expansion from the fish's level
  // (ARR to Lv 50, then 10 levels each). Zone tags can't be used: every ocean
  // fish sits in The Endeavor, which the game tags ARR.
  const logFish = { rod: [], spear: [] };
  for (const [fid, f] of Object.entries(data.fish)) logFish[f.log].push(fid);
  for (const fids of Object.values(logFish)) fids.sort((a, b) => data.fish[a].no - data.fish[b].no);
  const fishExp = (fid) => Math.max(0, Math.ceil((data.fish[fid].lvl - 50) / 10));
  /** [[expansion id, [fid]]] for a log, in expansion order. */
  function guideGroups(log) {
    const by = new Map();
    for (const fid of logFish[log] ?? []) {
      const exp = fishExp(fid);
      if (!by.has(exp)) by.set(exp, []);
      by.get(exp).push(fid);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }

  // The guide's icon sheets (tools/build_sprites.py): icon id → where it is.
  const spriteAt = new Map();
  for (const sheet of sprites?.sheets ?? []) {
    const rows = Math.ceil(sheet.icons.length / sprites.cols);
    sheet.icons.forEach((icon, i) => {
      if (!spriteAt.has(icon)) spriteAt.set(icon, { file: sheet.file, col: i % sprites.cols, row: Math.floor(i / sprites.cols), cols: sprites.cols, rows });
    });
  }

  /**
   * 'show' | 'grey' | 'hide' for a hole under the profile filters. Only
   * restricted holes are level-locked: below their level they're not on your
   * map and casting fails. Every other hole is on the map and fishable at any
   * level (confirmed in game: Lv 44 fishes the Lv 50 Privateer Forecastle,
   * not the restricted Sterncastle).
   */
  function holeVisibility(hid, profile) {
    if (expOff(hid, profile)) return 'hide';
    // Locked holes stay listed (greyed), like "undiscovered" in the game's log.
    if (isLocked(hid, profile)) return 'grey';
    return 'show';
  }

  /**
   * The hole's expansion is filtered out. Ocean holes never are: they all sit
   * in The Endeavor, which the game tags ARR whatever route they're on.
   */
  const expOff = (hid, profile) =>
    !!profile.exp && !data.holes[hid].ocean && !profile.exp.includes(data.zones[data.holes[hid].zone].exp);

  /** Restricted hole above your level: casting there fails. */
  const isLocked = (hid, profile) =>
    profile.lvl != null && !!data.holes[hid].restricted && data.holes[hid].lvl > profile.lvl;

  const visibleHoles = (tab, zone, profile) =>
    (zoneHoles[tab][zone] ?? []).filter((hid) => holeVisibility(hid, profile) !== 'hide');

  function visibleZones(tab, region, profile) {
    return (regionZones[tab][region] ?? []).filter((z) => visibleHoles(tab, z, profile).length);
  }

  function visibleRegions(tab, profile) {
    return regionOrder[tab].filter((r) => visibleZones(tab, r, profile).length);
  }

  const zoneHolesAll = (tab, zone) => zoneHoles[tab][zone] ?? [];
  const regionHolesAll = (tab, region) => (regionZones[tab][region] ?? []).flatMap((z) => zoneHolesAll(tab, z));

  const isMooch = (entry) => entry.bait != null && data.fish[entry.bait] != null;

  /**
   * Mooch chain for a fish at a hole, from the starting bait to the fish:
   * {steps: [{id, fish, tug, hook}], complete}. Incomplete chains start with
   * {unknown: true}.
   */
  function moochChain(fid, hid) {
    const steps = [];
    let cur = String(fid);
    for (let depth = 0; depth < 8; depth++) {
      const e = data.fish[cur]?.at[hid];
      if (!e?.bait) {
        if (depth > 0) steps.unshift({ unknown: true });
        return { steps, complete: false };
      }
      steps.unshift({ id: cur, fish: true, tug: e.tug, hook: e.hook });
      const b = String(e.bait);
      if (!data.fish[b]) {
        steps.unshift({ id: b, fish: false });
        return { steps, complete: true };
      }
      cur = b;
    }
    return { steps, complete: false };
  }

  /** At a hole: bait fish id → names of fish mooched from it. */
  function moochTargets(hid) {
    const out = {};
    for (const { fid, entry } of holeFish(hid)) {
      if (isMooch(entry)) (out[String(entry.bait)] ??= []).push(data.fish[fid].name);
    }
    return out;
  }

  /**
   * The fish's catch entry at a hole if it has a window we can forecast,
   * else null. Ocean holes never do: their weather follows the voyage.
   */
  function windowedEntry(fid, hid) {
    const e = data.fish[fid]?.at[hid];
    return e && !data.holes[hid].ocean && hasWindow(e) ? e : null;
  }

  /** Live window status, or null if the fish has no window here. */
  function status(fid, hid, now) {
    const e = windowedEntry(fid, hid);
    return e && windowStatus(e, weatherOf(hid), now);
  }

  /** The next `count` windows ([{start, end}] in ms), or null if none here. */
  function windows(fid, hid, now, count) {
    const e = windowedEntry(fid, hid);
    return e && nextWindows(e, weatherOf(hid), now, { count });
  }

  /** Current weather id at a hole (null for ocean holes). */
  const weatherNow = (hid, now) => (data.holes[hid].ocean ? null : weatherOf(hid)(periodOf(now)));

  const gatheringShort = (entry, profile) =>
    profile.gath != null && entry.minG != null && entry.minG > profile.gath;

  // Fish/hole pairs that have a time or weather window (ocean excluded).
  const windowed = {}; // tab → [[fid, hid]]
  for (const tab of TABS) windowed[tab] = [];
  for (const [fid, f] of Object.entries(data.fish)) {
    for (const hid of Object.keys(f.at)) {
      if (windowedEntry(fid, hid)) windowed[holeTab(data.holes[hid])].push([fid, hid]);
    }
  }

  /**
   * Uncaught fish whose window is open or opens within the horizon, at holes
   * the profile shows (discovered or not), skipping fish needing more
   * Gathering. One entry per fish (its soonest hole); open windows first.
   */
  /** holeOk (optional) limits which holes count, e.g. only discovered ones. */
  function upSoon(tab, { now, horizonMs, isCaught, profile, holeOk = () => true }) {
    const best = new Map();
    for (const [fid, hid] of windowed[tab] ?? []) {
      if (isCaught(fid) || holeVisibility(hid, profile) !== 'show' || !holeOk(hid)) continue;
      if (gatheringShort(data.fish[fid].at[hid], profile)) continue;
      const st = status(fid, hid, now);
      if (!st || st.state === 'rare') continue;
      if (st.state === 'upcoming' && st.start - now > horizonMs) continue;
      const key = st.state === 'open' ? [0, st.end] : [1, st.start];
      const prev = best.get(fid);
      if (!prev || key[0] < prev.key[0] || (key[0] === prev.key[0] && key[1] < prev.key[1])) {
        best.set(fid, { fid, hid, st, key });
      }
    }
    return [...best.values()].sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  }

  // Search over fish, holes and zones (accent- and case-insensitive).
  const norm = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const index = [
    ...Object.entries(data.fish).map(([id, f]) => ({ type: 'fish', id, key: norm(f.name) })),
    ...Object.entries(data.holes).map(([id, h]) => ({ type: 'hole', id, key: norm(h.name) })),
    ...Object.entries(data.zones).map(([id, z]) => ({ type: 'zone', id, key: norm(z.name) })),
  ];
  const zoneTab = (zid) => TABS.find((t) => zoneHoles[t][zid]);

  function search(query, limit = 40) {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    const typeOrder = { zone: 0, hole: 1, fish: 2 };
    return index
      .filter((x) => x.key.includes(q))
      .map((x) => ({ ...x, rank: x.key.startsWith(q) ? 0 : x.key.split(/[\s'-]/).some((w) => w.startsWith(q)) ? 1 : 2 }))
      .sort((a, b) => a.rank - b.rank || typeOrder[a.type] - typeOrder[b.type] || a.key.localeCompare(b.key))
      .slice(0, limit)
      .map(({ type, id }) => (type === 'zone' ? { type, id, tab: zoneTab(id) } : { type, id }));
  }

  return {
    upSoon, search, isLocked, expOff, countFish, sprite: (icon) => spriteAt.get(icon) ?? null, guideGroups, logFish: (log) => logFish[log] ?? [],
    data, weatherOf, fishName, holeFish, count, holeVisibility, visibleHoles, visibleZones,
    visibleRegions, zoneHolesAll, regionHolesAll, fishHoles: (fid) => fishHoles[String(fid)] ?? [],
    isMooch, moochChain, moochTargets, status, windows, weatherNow, gatheringShort,
  };
}
