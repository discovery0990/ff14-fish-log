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

  /** 'show' | 'grey' | 'hide' for a hole under the profile filters. */
  function holeVisibility(hid, profile) {
    const h = data.holes[hid];
    const z = data.zones[h.zone];
    if (profile.exp && !profile.exp.includes(z.exp)) return 'hide';
    if (profile.lvl != null && h.lvl > profile.lvl) return profile.showAbove ? 'grey' : 'hide';
    return 'show';
  }

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

  return {
    data, weatherOf, fishName, holeFish, count, holeVisibility, visibleHoles, visibleZones,
    visibleRegions, zoneHolesAll, regionHolesAll, fishHoles: (fid) => fishHoles[String(fid)] ?? [],
    isMooch, moochChain, moochTargets, status, weatherNow, gatheringShort,
  };
}
