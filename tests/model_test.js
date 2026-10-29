import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.13';
import { createModel } from '../app/model.js';
import { createStore } from '../app/store.js';
import { esc, fishView, fmtDuration, holeView, homeView, regionView, zoneView } from '../app/views.js';
import { fishWindows } from '../app/engine.js';

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
const profile = (p = {}) => ({ lvl: null, gath: null, exp: null, showAbove: false, ...p });

// ------------------------------------------------------------ counts

Deno.test('overall total is 1,806 unique fish', () => {
  assertEquals(Object.keys(DATA.fish).length, 1806);
});

Deno.test('Central Shroud: 5 holes, 28 distinct fish (27 listed + Copperfish reported at The Vein)', () => {
  const z = zoneByName('Central Shroud');
  assertEquals(m.zoneHolesAll('rod', z).length, 5);
  assertEquals(m.count(m.zoneHolesAll('rod', z), () => false), { caught: 0, total: 28 });
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

Deno.test('level filter hides holes above level; showAbove greys them', () => {
  assertEquals(m.holeVisibility('r5', profile({ lvl: 34 })), 'hide'); // Hopeseed Pond is Lv 35
  assertEquals(m.holeVisibility('r5', profile({ lvl: 35 })), 'show');
  assertEquals(m.holeVisibility('r5', profile({ lvl: 34, showAbove: true })), 'grey');
});

Deno.test('expansion filter hides zones; empty regions disappear', () => {
  const arrOnly = m.visibleRegions('rod', profile({ exp: [0] })).map((r) => DATA.regions[r].name);
  assert(arrOnly.includes('The Black Shroud'));
  assert(!arrOnly.includes('Norvrandt'));
  // Spearfishing exists in one ARR zone (Bronze Lake, added later), nowhere else.
  const spearArr = m.visibleRegions('spear', profile({ exp: [0] })).map((r) => DATA.regions[r].name);
  assertEquals(spearArr, ['La Noscea']);
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

// ------------------------------------------------------------ views

const ctxFor = (store, extra = {}) => ({
  m, store, now: T, tab: 'rod',
  nextWindows: (fid, hid, count) => fishWindows(DATA, fid, hid, T, { count }),
  ...extra,
});

Deno.test('every view renders for every region, zone, hole and fish', () => {
  const store = createStore(memStorage());
  const ctx = ctxFor(store);
  for (const tab of ['rod', 'spear', 'ocean']) {
    homeView({ ...ctx, tab });
    for (const r of Object.keys(DATA.regions)) if (m.regionHolesAll(tab, r).length) regionView(ctx, tab, r);
    for (const z of Object.keys(DATA.zones)) if (m.zoneHolesAll(tab, z).length) zoneView(ctx, tab, z);
  }
  for (const hid of Object.keys(DATA.holes)) holeView(ctx, hid);
  for (const fid of Object.keys(DATA.fish)) fishView(ctx, fid, null);
});

Deno.test('hole view: Hopeseed Pond shows mooch, warning and feeds lines', () => {
  const store = createStore(memStorage());
  store.setProfile({ gath: 340 });
  const html = holeView(ctxFor(store), 'r5');
  assertStringIncludes(html, 'MOOCH');
  assertStringIncludes(html, 'Midge Basket → Ala Mhigan Fighting Fish');
  assertStringIncludes(html, 'Needs Gathering 345 — you have 340');
  assertStringIncludes(html, 'Mooch bait for Black Ghost');
  assertStringIncludes(html, '0 / 8');
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
});
