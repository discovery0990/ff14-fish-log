// Derived views of the data file: grouping, counts, filters, mooch chains
// and live window status. Pure functions over (data, progress, profile).

import { hasWindow, periodOf, windowStatus, zoneWeather } from './engine.js';

export const TABS = ['rod', 'spear', 'ocean'];
export const TAB_LABELS = { rod: 'Rod', spear: 'Spearfishing', ocean: 'Ocean' };

/** Which home tab a hole belongs to. */
export const holeTab = (h) => (h.kind === 'spear' ? 'spear' : h.ocean ? 'ocean' : 'rod');

export function createModel(data) {
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
  for (const tab of TABS) {
    for (const hs of Object.values(zoneHoles[tab])) hs.sort((a, b) => data.holes[a].lvl - data.holes[b].lvl);
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

  /** Distinct fish across holes, with how many are caught. */
  function count(hids, isCaught) {
    const all = new Set();
    for (const hid of hids) for (const { fid } of holeFish(hid)) all.add(fid);
    let caught = 0;
    for (const fid of all) if (isCaught(fid)) caught++;
    return { caught, total: all.size };
  }

  /**
   * 'show' | 'grey' | 'hide' for a hole under the profile filters. Only
   * restricted holes are level-locked (you can't cast below their level);
   * other holes above your level are fishable, just not marked on your map.
   */
  function holeVisibility(hid, profile) {
    const h = data.holes[hid];
    const z = data.zones[h.zone];
    if (profile.exp && !profile.exp.includes(z.exp)) return 'hide';
    if (isLocked(hid, profile)) return profile.showAbove ? 'grey' : 'hide';
    return 'show';
  }

  /** Restricted hole above your level: casting there fails. */
  const isLocked = (hid, profile) =>
    profile.lvl != null && !!data.holes[hid].restricted && data.holes[hid].lvl > profile.lvl;

  /** Fishable hole above your level, so not marked on your in-game map. */
  const isUnmarked = (hid, profile) =>
    profile.lvl != null && !data.holes[hid].restricted && data.holes[hid].lvl > profile.lvl;

  const visibleHoles = (tab, zone, profile) =>
    (zoneHoles[tab][zone] ?? []).filter((hid) => holeVisibility(hid, profile) !== 'hide');

  function visibleZones(tab, region, profile) {
    return (regionZones[tab][region] ?? []).filter((z) => visibleHoles(tab, z, profile).length);
  }

  function visibleRegions(tab, profile) {
    return Object.keys(regionZones[tab]).filter((r) => visibleZones(tab, r, profile).length);
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

  /** Live window status, or null if the fish has no window here. */
  function status(fid, hid, now) {
    const h = data.holes[hid];
    const e = data.fish[fid]?.at[hid];
    if (!e || h.ocean || !hasWindow(e)) return null;
    return windowStatus(e, weatherOf(hid), now);
  }

  /** Current weather id at a hole (null for ocean holes). */
  const weatherNow = (hid, now) => (data.holes[hid].ocean ? null : weatherOf(hid)(periodOf(now)));

  const gatheringShort = (entry, profile) =>
    profile.gath != null && entry.minG != null && entry.minG > profile.gath;

  // Fish/hole pairs that have a time or weather window (ocean excluded).
  const windowed = {}; // tab → [[fid, hid]]
  for (const tab of TABS) windowed[tab] = [];
  for (const [fid, f] of Object.entries(data.fish)) {
    for (const [hid, e] of Object.entries(f.at)) {
      const h = data.holes[hid];
      if (h && !h.ocean && hasWindow(e)) windowed[holeTab(h)].push([fid, hid]);
    }
  }

  /**
   * Uncaught fish whose window is open or opens within the horizon, at holes
   * the profile shows (discovered or not), skipping fish needing more
   * Gathering. One entry per fish (its soonest hole); open windows first.
   */
  function upSoon(tab, { now, horizonMs, isCaught, profile }) {
    const best = new Map();
    for (const [fid, hid] of windowed[tab] ?? []) {
      if (isCaught(fid) || holeVisibility(hid, profile) !== 'show') continue;
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
    upSoon, search, isLocked, isUnmarked,
    data, weatherOf, fishName, holeFish, count, holeVisibility, visibleHoles, visibleZones,
    visibleRegions, zoneHolesAll, regionHolesAll, fishHoles: (fid) => fishHoles[String(fid)] ?? [],
    isMooch, moochChain, moochTargets, status, weatherNow, gatheringShort,
  };
}
