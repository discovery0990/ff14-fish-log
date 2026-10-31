import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.13';
import { createModel } from '../app/model.js';
import { createStore, makeBackup, parseBackup, shouldRemind } from '../app/store.js';
import { esc, fishView, fmtDuration, guideView, holeView, homeView, profileView, soonView } from '../app/views.js';
import { toEtHours } from '../app/engine.js';

const DATA = JSON.parse(await Deno.readTextFile(new URL('../app/data/fish.json', import.meta.url)));
const m = createModel(DATA);
const byName = (n) => Object.entries(DATA.fish).find(([, f]) => f.name === n)[0];
const zoneByName = (n) => Object.entries(DATA.zones).find(([, z]) => z.name === n)[0];
const regionByName = (n) => Object.entries(DATA.regions).find(([, r]) => r.name === n)[0];
const T = Date.UTC(2026, 9, 28, 12);

// In-memory localStorage stand-in.
const memStorage = () => {
  const s = new Map();
  return { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => s.set(k, String(v)) };
};
const profile = (p = {}) => ({ lvl: null, gath: null, exp: null, ...p });

// ------------------------------------------------------------ counts

// The build already pins the log sizes (EXPECTED_ROD/SPEAR), so this only
// checks the two logs don't overlap. The zone and region counts below are
// pinned on purpose: they test the counting on old (ARR) zones that patches
// don't touch. If one fails after a data update, check the game before
// changing the number.
Deno.test('every fish is in exactly one log', () => {
  const { rod, spear } = DATA.meta.stats;
  assertEquals(Object.keys(DATA.fish).length, rod + spear);
});

Deno.test('Central Shroud: 5 holes, 28 distinct fish (27 listed + Copperfish reported at The Vein)', () => {
  const z = zoneByName('Central Shroud');
  assertEquals(m.zoneHolesAll('rod', z).length, 5);
  assertEquals(m.count(m.zoneHolesAll('rod', z), () => false), { caught: 0, total: 28, reach: 28 });
});

Deno.test('a fish needing more Gathering is out of reach, until caught', () => {
  const matriarch = byName('The Matriarch'); // needs 349 Gathering at Exploratory Ice Hole
  assertEquals(m.count(['r32'], () => false, profile({ gath: 348 })), { caught: 0, total: 5, reach: 4 });
  assertEquals(m.count(['r32'], () => false, profile({ gath: 349 })).reach, 5);
  assertEquals(m.count(['r32'], () => false, profile()).reach, 5);
  assertEquals(m.count(['r32'], (f) => f === matriarch, profile({ gath: 0 })), { caught: 1, total: 5, reach: 5 });
});

Deno.test('fish at a locked hole are out of reach', () => {
  const total = m.count(['r21'], () => false).total; // Lake Tahtotl, restricted Lv 50
  assertEquals(m.count(['r21'], () => false, profile({ lvl: 49, gath: 9999 })).reach, 0);
  assertEquals(m.count(['r21'], () => false, profile({ lvl: 50, gath: 9999 })).reach, total);
});

Deno.test('Black Shroud counts every catchable fish once (82), more than its log share of 62', () => {
  const r = regionByName('The Black Shroud');
  assertEquals(m.count(m.regionHolesAll('rod', r), () => false).total, 82);
});

Deno.test('caught counts are distinct across holes', () => {
  const ghost = byName('Black Ghost'); // at two holes in different zones
  const r = regionByName('The Black Shroud');
  const c = m.count(m.regionHolesAll('rod', r), (f) => f === ghost);
  assertEquals(c.caught, 1);
});

Deno.test('ocean holes are only in the Ocean tab', () => {
  const oceanRegions = m.visibleRegions('ocean', profile()).map((r) => DATA.regions[r].name);
  assertEquals(oceanRegions, ['The High Seas']);
  assert(!m.visibleRegions('rod', profile()).map((r) => DATA.regions[r].name).includes('The High Seas'));
});

// ------------------------------------------------------------ filters

Deno.test('level only locks restricted holes; other above-level holes are shown', () => {
  // Hidden Falls (r54) is a restricted Lv 35 hole.
  assertEquals(m.holeVisibility('r54', profile({ lvl: 34 })), 'grey'); // always listed, greyed
  assertEquals(m.holeVisibility('r54', profile({ lvl: 35 })), 'show');
  assert(m.isLocked('r54', profile({ lvl: 34 })));
  // Hopeseed Pond (r5, Lv 35) and North Isle of Endless Summer (r156, Lv 50) are not restricted.
  assertEquals(m.holeVisibility('r5', profile({ lvl: 10 })), 'show');
  assertEquals(m.holeVisibility('r156', profile({ lvl: 40 })), 'show');
  // Confirmed in game at Lv 44: Privateer Forecastle (r? Lv 50) fishable, Sterncastle locked.
  const priv = (n) => Object.keys(DATA.holes).find((h) => DATA.holes[h].name === `Rhotano Sea (Privateer ${n})`);
  assertEquals(m.holeVisibility(priv('Forecastle'), profile({ lvl: 44 })), 'show');
  assertEquals(m.holeVisibility(priv('Sterncastle'), profile({ lvl: 44 })), 'grey');
});

Deno.test('every hole has map coordinates', () => {
  for (const [hid, h] of Object.entries(DATA.holes)) {
    assert(Array.isArray(h.xy) && h.xy.every((v) => v >= 1 && v <= 45), `${hid} ${h.name} ${h.xy}`);
  }
  assertEquals(DATA.holes.r156.xy, [36, 26.6]);
});

Deno.test('expansion filter hides zones; empty regions disappear', () => {
  const arrOnly = m.visibleRegions('rod', profile({ exp: [0] })).map((r) => DATA.regions[r].name);
  assert(arrOnly.includes('The Black Shroud'));
  assert(!arrOnly.includes('Norvrandt'));
  // Spearfishing exists in one ARR zone (Bronze Lake, added later), nowhere else.
  const spearArr = m.visibleRegions('spear', profile({ exp: [0] })).map((r) => DATA.regions[r].name);
  assertEquals(spearArr, ['La Noscea']);
  // Shirogane is a Stormblood housing district, though the game tags it ARR.
  assert(!arrOnly.includes('Hingashi'));
  // Ocean holes are tagged ARR (The Endeavor) but ignore the filter.
  const noArr = profile({ exp: [1, 2, 3, 4, 5] });
  const ocean = Object.keys(DATA.holes).filter((h) => DATA.holes[h].ocean);
  assertEquals(ocean.length, 26);
  assert(ocean.every((h) => !m.expOff(h, noArr)));
  assert(m.expOff('r2', noArr));
});

Deno.test('gathering shortfall is a warning, not a filter', () => {
  const jester = DATA.fish[byName('The Green Jester')].at.r5;
  assert(m.gatheringShort(jester, profile({ gath: 340 })));
  assert(!m.gatheringShort(jester, profile({ gath: 345 })));
  assert(!m.gatheringShort(jester, profile())); // not set → no warning
});

// ------------------------------------------------------------ mooching

Deno.test('mooch chains: Black Ghost and Junkmonger', () => {
  const names = (fid, hid) => m.moochChain(fid, hid).steps.map((s) => m.fishName(s.id));
  assertEquals(names(byName('Black Ghost'), 'r5'), ['Midge Basket', 'Ala Mhigan Fighting Fish', 'Black Ghost']);
  assertEquals(names(byName('Junkmonger'), 'r60'), ['Lugworm', 'Merlthor Goby', 'Wahoo', 'Junkmonger']);
  assertEquals(m.moochTargets('r5')[byName('Ala Mhigan Fighting Fish')], ['Black Ghost']);
});

Deno.test('broken ocean chain is marked incomplete', () => {
  const { steps, complete } = m.moochChain('51225', 'r335');
  assertEquals(complete, false);
  assert(steps[0].unknown);
});

// ------------------------------------------------------------ store

Deno.test('store: marking caught discovers the hole and persists', () => {
  const storage = memStorage();
  const s = createStore(storage);
  s.toggleCaught('4964', 'r5');
  assert(s.isCaught('4964'));
  assert(s.isDiscovered('r5'));
  const again = createStore(storage);
  assert(again.isCaught(4964));
  again.toggleCaught(4964, 'r5');
  assert(!again.isCaught('4964'));
  assert(again.isDiscovered('r5')); // un-catching keeps the hole discovered
});

Deno.test('store survives corrupt storage', () => {
  const storage = memStorage();
  storage.setItem('fishlog:v1', '{nope');
  assertEquals(createStore(storage).caughtCount(), 0);
});

Deno.test('windows: Black Eel at Hopeseed Pond is ET 17:00–10:00', () => {
  const [win] = m.windows(byName('Black Eel'), 'r5', T, 1);
  assertEquals(toEtHours(win.start) % 24, 17);
  assertEquals(toEtHours(win.end) - toEtHours(win.start), 17);
});

Deno.test('windows and status: null for unconditional fish and ocean holes', () => {
  assertEquals(m.windows(byName('Mudcrab'), 'r5', T, 1), null);
  assertEquals(m.status(byName('Mudcrab'), 'r5', T), null);
  const oceanCase = Object.entries(DATA.fish).flatMap(([fid, f]) =>
    Object.entries(f.at).filter(([hid, e]) => DATA.holes[hid].ocean && e.w).map(([hid]) => [fid, hid]))[0];
  assert(oceanCase, 'expected an ocean fish with weather');
  assertEquals(m.windows(oceanCase[0], oceanCase[1], T, 1), null);
  assertEquals(m.status(oceanCase[0], oceanCase[1], T), null);
});

// ------------------------------------------------------------ views

const ctxFor = (store, extra = {}) => ({
  m, store, now: T, tab: 'rod', query: '', showAllSoon: false, pendingImport: null, flash: '', remind: false,
  ...extra,
});

Deno.test('every view renders for every region, zone, hole and fish', () => {
  const store = createStore(memStorage());
  const ctx = ctxFor(store);
  for (const tab of ['rod', 'spear', 'ocean']) {
    homeView({ ...ctx, tab });
    for (const r of Object.keys(DATA.regions)) if (m.regionHolesAll(tab, r).length) homeView({ ...ctx, tab, openRegion: r });
    soonView({ ...ctx, tab }, tab);
    for (const z of Object.keys(DATA.zones)) if (m.zoneHolesAll(tab, z).length) homeView({ ...ctx, tab, openRegion: String(DATA.zones[z].region), openZone: z, folds: new Set([`holes:${tab}:${z}`]) });
  }
  for (const hid of Object.keys(DATA.holes)) holeView(ctx, hid);
  profileView(ctx);
  homeView({ ...ctx, query: 'goby' });
  homeView({ ...ctx, remind: true });
  for (const fid of Object.keys(DATA.fish)) fishView(ctx, fid, null);
  guideView(ctx, 'rod');
  guideView(ctx, 'spear');
});

Deno.test('hole view: Hopeseed Pond shows mooch, warning and feeds lines', () => {
  const store = createStore(memStorage());
  store.setProfile({ gath: 340 });
  const html = holeView(ctxFor(store), 'r5');
  assertStringIncludes(html, 'Midge Basket <span class="arrow" aria-label="then mooch">→</span> Ala Mhigan Fighting Fish');
  assertStringIncludes(html, 'Needs Gathering 345 — you have 340');
  assertStringIncludes(html, 'Mooch bait for Black Ghost');
  assertStringIncludes(html, '0 / 7<span class="out">(8)</span>'); // Gathering 340: one fish out of reach
});

Deno.test('hole view: also-caught-here section only where there are extras', () => {
  const store = createStore(memStorage());
  const withExtra = Object.keys(DATA.holes).find((h) => DATA.holes[h].extra.length);
  assertStringIncludes(holeView(ctxFor(store), withExtra), 'Also caught here');
  assert(!holeView(ctxFor(store), 'r5').includes('Also caught here'));
});

Deno.test('escaping and duration formatting', () => {
  assertEquals(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assertEquals(fmtDuration(14 * 60000), '14m');
  assertEquals(fmtDuration(112 * 60000), '1h 52m');
  assertEquals(fmtDuration(51 * 3600000), '2d 3h');
  assertEquals(fmtDuration(20000), '<1m');
});

// ------------------------------------------------------------ search

Deno.test('search: prefix matches first, accent-insensitive, typed results', () => {
  const r = m.search('hopeseed');
  assertEquals(r[0], { type: 'hole', id: 'r5' });
  assert(m.search('central shroud').some((x) => x.type === 'zone' && x.tab === 'rod'));
  assertEquals(m.search('g'), []); // too short
  const goby = m.search('goby').map((x) => m.fishName(x.id));
  assert(goby.includes('Merlthor Goby'));
  // accents: there is at least one fish with an accent in its name
  const accented = Object.values(DATA.fish).find((f) => /[\u00C0-\u017F]/.test(f.name));
  if (accented) {
    const plain = accented.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    assert(m.search(plain).some((x) => m.fishName(x.id) === accented.name));
  }
});

// ------------------------------------------------------------ up soon

Deno.test('up soon: within horizon, open first, uncaught, eligible, one per fish', () => {
  const p = profile();
  const opts = { now: T, horizonMs: 2 * 36e5, isCaught: () => false, profile: p };
  const list = m.upSoon('rod', opts);
  assert(list.length > 10);
  const firstUpcoming = list.findIndex((x) => x.st.state === 'upcoming');
  assert(list.slice(firstUpcoming).every((x) => x.st.state === 'upcoming'), 'open entries come first');
  for (const x of list) {
    if (x.st.state === 'upcoming') assert(x.st.start - T <= 2 * 36e5);
    assert(!DATA.holes[x.hid].ocean);
  }
  assertEquals(new Set(list.map((x) => x.fid)).size, list.length);
  // caught fish drop out
  const caught = new Set([list[0].fid]);
  assert(!m.upSoon('rod', { ...opts, isCaught: (f) => caught.has(f) }).some((x) => x.fid === list[0].fid));
  // gathering shortfall drops out
  const onlyR5 = m.upSoon('rod', { ...opts, holeOk: (h) => h === 'r5' });
  assert(onlyR5.every((x) => x.hid === 'r5'));
  assert(m.upSoon('rod', { ...opts, holeOk: (h) => h !== list[0].hid }).every((x) => x.hid !== list[0].hid), 'holeOk excludes a hole');
  const lowG = m.upSoon('rod', { ...opts, profile: profile({ gath: 0 }) });
  assert(lowG.every((x) => !(DATA.fish[x.fid].at[x.hid].minG > 0)));
  // level filter applies
  const lv20 = m.upSoon('rod', { ...opts, profile: profile({ lvl: 20 }) });
  assert(lv20.every((x) => DATA.holes[x.hid].lvl <= 20 || !DATA.holes[x.hid].restricted), 'no locked holes');
  assert(lv20.some((x) => DATA.holes[x.hid].lvl > 20), 'unmarked above-level holes are included');
});

// ------------------------------------------------------------ backup

Deno.test('backup round trip and validation', () => {
  const s = createStore(memStorage());
  s.toggleCaught('4964', 'r5');
  s.setProfile({ lvl: 40, gath: 340, exp: [0, 1] });
  const text = JSON.stringify(makeBackup(s.state, T));
  const b = parseBackup(text, DATA);
  assert(b.ok);
  assertEquals(b.caught, ['4964']);
  assertEquals(b.discovered, ['r5']);
  assertEquals(b.profile, { lvl: 40, gath: 340, exp: [0, 1] });
  assertEquals(b.exportedAt, T);

  assertEquals(parseBackup('nope', DATA).ok, false);
  assertEquals(parseBackup('{"app":"other"}', DATA).ok, false);
  assertEquals(parseBackup('{"app":"fishlog","v":2,"caught":[],"discovered":[]}', DATA).ok, false);
  const withJunk = parseBackup(JSON.stringify({ app: 'fishlog', v: 1, caught: ['4964', '999999', {}], discovered: ['r5', 'r99999'], profile: { lvl: 500 } }), DATA);
  assert(withJunk.ok);
  assertEquals(withJunk.caught, ['4964']);
  assertEquals(withJunk.dropped, 2);
  assertEquals(withJunk.profile.lvl, null);
});

Deno.test('import: merge unions, replace overwrites', () => {
  const s = createStore(memStorage());
  s.toggleCaught('4950', 'r5');
  const b = parseBackup(JSON.stringify({ app: 'fishlog', v: 1, caught: ['4964'], discovered: ['r2'], profile: { lvl: 40 } }), DATA);
  s.importBackup(b, 'merge');
  assert(s.isCaught('4950') && s.isCaught('4964'));
  assertEquals(s.state.profile.lvl, null); // merge keeps the profile
  s.importBackup(b, 'replace');
  assert(!s.isCaught('4950') && s.isCaught('4964'));
  assert(s.isDiscovered('r2') && !s.isDiscovered('r5'));
  assertEquals(s.state.profile.lvl, 40);
});

Deno.test('backup reminder: needs 14 days and 10 new catches; snooze 3 days', () => {
  const DAY = 864e5;
  const base = { lastExport: T, caughtAtLastExport: 100, createdAt: T - 30 * DAY, reminderDismissedAt: null };
  assertEquals(shouldRemind(base, 120, T + 13 * DAY), false);
  assertEquals(shouldRemind(base, 105, T + 20 * DAY), false);
  assertEquals(shouldRemind(base, 110, T + 14 * DAY), true);
  assertEquals(shouldRemind({ ...base, reminderDismissedAt: T + 14 * DAY }, 110, T + 16 * DAY), false);
  assertEquals(shouldRemind({ ...base, reminderDismissedAt: T + 14 * DAY }, 110, T + 17 * DAY), true);
  // never exported: counts from first use
  assertEquals(shouldRemind({ ...base, lastExport: null, caughtAtLastExport: 0 }, 10, T), true);
  assertEquals(shouldRemind({ ...base, lastExport: null, createdAt: null }, 50, T), false);
});

Deno.test('store: markExported resets the reminder baseline', () => {
  const s = createStore(memStorage());
  s.toggleCaught('4964', 'r5');
  s.markExported(T);
  assertEquals(s.state.lastExport, T);
  assertEquals(s.state.caughtAtLastExport, 1);
});

Deno.test('fish view without a source hole does not discover any hole when marking caught', () => {
  const store = createStore(memStorage());
  const html = fishView(ctxFor(store), byName('Black Ghost'), null);
  assertStringIncludes(html, 'data-act="caught" data-fid="4964" data-hid=""');
  const fromHole = fishView(ctxFor(store), byName('Black Ghost'), 'r5');
  assertStringIncludes(fromHole, 'data-act="caught" data-fid="4964" data-hid="r5"');
});

Deno.test('fish view: ocean fish are labelled ocean fishing, never always available', () => {
  const ctx = ctxFor(createStore(memStorage()));
  const ocean = Object.keys(DATA.fish).filter((f) => Object.keys(DATA.fish[f].at).every((h) => DATA.holes[h].ocean));
  assert(ocean.length > 0);
  for (const fid of ocean) {
    const html = fishView(ctx, fid, null);
    assertStringIncludes(html, 'Ocean fishing');
    assert(!html.includes('Always available'), DATA.fish[fid].name);
  }
  assertStringIncludes(fishView(ctx, byName('Mudcrab'), 'r5'), 'Always available');
});

Deno.test('regions, zones, holes and fish follow the in-game Fishing Log order', () => {
  const p = { lvl: null, gath: null, exp: null };
  const name = (kind) => (id) => DATA[kind][id].name;
  assertEquals(m.visibleRegions('rod', p).slice(0, 5).map(name('regions')),
    ['La Noscea', 'The Black Shroud', 'Thanalan', 'Coerthas', 'Mor Dhona']);
  assertEquals(m.visibleZones('rod', '22', p).slice(0, 3).map(name('zones')),
    ['Limsa Lominsa Upper Decks', 'Limsa Lominsa Lower Decks', 'Middle La Noscea']);
  const eln = m.visibleHoles('rod', '32', p).map(name('holes'));
  assertEquals(eln[0], 'South Bloodshore');
  assertEquals(eln.at(-1), 'North Isle of Endless Summer'); // added in 4.0: last
  assertEquals(m.holeFish('r5').map((x) => DATA.fish[x.fid].name).slice(0, 2), ['Mudcrab', 'Black Eel']);
});

// ------------------------------------------------------------ fish guide

Deno.test('guide: every log fish once, in log order, grouped by expansion from level', () => {
  for (const log of ['rod', 'spear']) {
    const groups = m.guideGroups(log);
    const flat = groups.flatMap(([, fids]) => fids);
    assertEquals(flat.length, DATA.meta.stats[log]);
    assertEquals(new Set(flat).size, flat.length);
    for (const [exp, fids] of groups) {
      for (const fid of fids) {
        const lvl = DATA.fish[fid].lvl;
        assert(exp === 0 ? lvl <= 50 : lvl > 40 + exp * 10 && lvl <= 50 + exp * 10, `${DATA.fish[fid].name} Lv ${lvl} in exp ${exp}`);
      }
      const nos = fids.map((f) => DATA.fish[f].no);
      assertEquals(nos, [...nos].sort((a, b) => a - b));
    }
  }
  // Ocean fish go by level, not by The Endeavor's ARR tag.
  const ocean = Object.keys(DATA.fish).find((f) => DATA.fish[f].lvl > 60 && Object.keys(DATA.fish[f].at).every((h) => DATA.holes[h].ocean));
  assert(ocean && m.guideGroups('rod').find(([, fids]) => fids.includes(ocean))[0] > 0);
});

Deno.test('every log fish has its log entry text', () => {
  for (const f of Object.values(DATA.fish)) assert(f.text?.trim(), f.name);
});

Deno.test('guide: tiles fill in as fish are caught; latest catches come first', () => {
  const store = createStore(memStorage());
  const black = byName('Black Ghost'), malm = byName('Malm Kelp');
  let html = guideView(ctxFor(store), 'rod');
  assert(!html.includes('Latest catches'));
  assertStringIncludes(html, `class="tile missing" href="#/fish/${black}?from=guide/rod"`);
  store.toggleCaught(black, null, T);
  store.toggleCaught(malm, null, T + 1000);
  html = guideView(ctxFor(store), 'rod');
  assertStringIncludes(html, `class="tile" href="#/fish/${black}?from=guide/rod"`);
  const latest = html.slice(html.indexOf('Latest catches'), html.indexOf('</section>', html.indexOf('Latest catches')));
  assert(latest.indexOf(malm) < latest.indexOf(black), 'newest first');
  assertStringIncludes(html, '2 / 1,517');
});

Deno.test('fish view: log entry and date only once caught', () => {
  const store = createStore(memStorage());
  const fid = byName('Black Ghost');
  let html = fishView(ctxFor(store), fid, 'r5', 'guide/rod');
  assertStringIncludes(html, 'Catch it to read its log entry.');
  assert(!html.includes(esc(DATA.fish[fid].text)));
  assertStringIncludes(html, 'href="#/guide/rod"'); // Back goes to the guide on a deep link
  store.toggleCaught(fid, 'r5', T);
  html = fishView(ctxFor(store), fid, 'r5', 'guide/rod');
  assertStringIncludes(html, esc(DATA.fish[fid].text));
  assertStringIncludes(html, `Caught ${new Date(T).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`);
});

Deno.test('store: caughtAt is set on catch, cleared on undo, and survives reload', () => {
  const storage = memStorage();
  const s = createStore(storage);
  s.toggleCaught('4964', 'r5', T);
  assertEquals(createStore(storage).caughtAt('4964'), T);
  s.toggleCaught('4964', 'r5');
  assertEquals(s.caughtAt('4964'), null);
  // State saved before dates were kept still loads.
  const old = memStorage();
  old.setItem('fishlog:v1', JSON.stringify({ v: 1, caught: ['4964'], discovered: [] }));
  const o = createStore(old);
  assert(o.isCaught('4964'));
  assertEquals(o.caughtAt('4964'), null);
});

Deno.test('backup: catch dates round trip, are optional, and merge keeps the earlier', () => {
  const s = createStore(memStorage());
  s.toggleCaught('4964', 'r5', T);
  const b = parseBackup(JSON.stringify(makeBackup(s.state, T)), DATA);
  assertEquals(b.caughtAt, { 4964: T });
  // Older backups have no dates; junk dates and dates for dropped fish are skipped.
  assertEquals(parseBackup(JSON.stringify({ app: 'fishlog', v: 1, caught: ['4964'], discovered: [] }), DATA).caughtAt, {});
  const junk = parseBackup(JSON.stringify({ app: 'fishlog', v: 1, caught: ['4964', '4950'], caughtAt: { 4964: 'x', 4950: T, 999999: T }, discovered: [] }), DATA);
  assertEquals(junk.caughtAt, { 4950: T });

  const t = createStore(memStorage());
  t.toggleCaught('4964', null, T + 5000);
  t.toggleCaught('4950', null, T + 5000);
  t.importBackup({ ...b, caughtAt: { 4964: T, 4950: T + 9000, 4942: T } , caught: ['4964', '4950', '4942'] }, 'merge');
  assertEquals([t.caughtAt('4964'), t.caughtAt('4950'), t.caughtAt('4942')], [T, T + 5000, T]);
  t.importBackup(b, 'replace');
  assertEquals([t.caughtAt('4964'), t.caughtAt('4950')], [T, null]);
});
