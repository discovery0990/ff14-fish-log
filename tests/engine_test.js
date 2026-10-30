import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1.0.13';
import {
  ET_HOUR_MS, PERIOD_MS, eorzeaClock, forecastTarget, nextWindows,
  toEtHours, weatherForTarget, windowStatus, zoneWeather,
} from '../app/engine.js';
import { calculateForecastTarget } from './fixtures/upstream_weather.js';

const DATA = JSON.parse(await Deno.readTextFile(new URL('../app/data/fish.json', import.meta.url)));

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const T2026 = Date.UTC(2026, 9, 28, 12, 0, 0);
const etMs = (etHours) => etHours * ET_HOUR_MS; // ET hours since epoch → ms

// ---------------------------------------------------------------- time

Deno.test('Eorzea clock: epoch is ET 00:00, one ET hour is 175 s', () => {
  assertEquals(eorzeaClock(0), { hours: 0, minutes: 0 });
  assertEquals(eorzeaClock(175_000), { hours: 1, minutes: 0 });
  assertEquals(eorzeaClock(175_000 * 25 + 87_500), { hours: 1, minutes: 30 });
  assertEquals(PERIOD_MS, 1_400_000);
});

// ------------------------------------------------------------- forecast

Deno.test('forecastTarget matches the upstream tracker on 10,000 timestamps (2015–2035)', () => {
  const r = rng(42);
  const lo = Date.UTC(2015, 0, 1), hi = Date.UTC(2035, 0, 1);
  const mismatches = [];
  for (let i = 0; i < 10_000; i++) {
    const t = Math.floor(lo + r() * (hi - lo));
    if (forecastTarget(t) !== calculateForecastTarget(t)) mismatches.push(t);
  }
  assertEquals(mismatches.slice(0, 5), [], `${mismatches.length} mismatches`);
});

Deno.test('forecastTarget matches upstream on every period boundary for a week', () => {
  const start = Math.floor(T2026 / PERIOD_MS) * PERIOD_MS;
  for (let t = start; t < start + 7 * 864e5; t += PERIOD_MS) {
    for (const off of [0, 1000, PERIOD_MS - 1000]) {
      assertEquals(forecastTarget(t + off), calculateForecastTarget(t + off), `at ${t + off}`);
    }
  }
});

Deno.test('forecastTarget is constant within a period and in range', () => {
  const p = Math.floor(T2026 / PERIOD_MS) * PERIOD_MS;
  const v = forecastTarget(p);
  for (let off = 0; off < PERIOD_MS; off += 50_000) assertEquals(forecastTarget(p + off), v);
  assert(v >= 0 && v < 100);
});

Deno.test('weatherForTarget uses cumulative rates (Central Shroud)', () => {
  const zone = Object.values(DATA.zones).find((z) => z.name === 'Central Shroud');
  const rates = DATA.weatherRates[DATA.holes[zone.holes[0]].wr];
  // Thunder 5, Rain 15, Fog 10, Clouds 10, Fair 15, Clear 30, Fair 15
  const name = (t) => DATA.weathers[weatherForTarget(rates, t)].name;
  assertEquals([name(0), name(4), name(5), name(19), name(20), name(84), name(85), name(99)],
    ['Thunder', 'Thunder', 'Rain', 'Rain', 'Fog', 'Clear Skies', 'Fair Skies', 'Fair Skies']);
});

// ------------------------------------------------------- window finder

// A fake zone: weather id per period from a fixed list (repeating).
const seq = (...ws) => (p) => ws[((p % ws.length) + ws.length) % ws.length];
const RAIN = 7, CLEAR = 2, FOG = 4;

Deno.test('time-only window crossing midnight (ET 17:00–10:00)', () => {
  const w = seq(CLEAR);
  // From ET day 1000 at 12:00 → next window day 1000 17:00 → day 1001 10:00.
  const from = etMs(1000 * 24 + 12);
  const [win] = nextWindows({ spawn: 17, dur: 17 }, w, from);
  assertEquals(toEtHours(win.start), 1000 * 24 + 17);
  assertEquals(toEtHours(win.end), 1001 * 24 + 10);
});

Deno.test('a window open now reports its real start', () => {
  const from = etMs(1000 * 24 + 2); // ET 02:00, inside 17:00–10:00
  const [win] = nextWindows({ spawn: 17, dur: 17 }, seq(CLEAR), from);
  assertEquals(toEtHours(win.start), 999 * 24 + 17);
  assertEquals(toEtHours(win.end), 1000 * 24 + 10);
  assertEquals(windowStatus({ spawn: 17, dur: 17 }, seq(CLEAR), from).state, 'open');
});

Deno.test('fractional duration (Toramafish-style 17:00 + 2.5h)', () => {
  const [win] = nextWindows({ spawn: 17, dur: 2.5 }, seq(CLEAR), etMs(1000 * 24));
  assertEquals(toEtHours(win.end) - toEtHours(win.start), 2.5);
  assertEquals(toEtHours(win.start) % 24, 17);
});

Deno.test('weather-only windows merge across consecutive periods', () => {
  // Periods: rain, rain, clear (repeating) → 16 ET-hour rain windows.
  const wins = nextWindows({ w: [RAIN] }, seq(RAIN, RAIN, CLEAR), etMs(3 * 8 * 100 + 8 * 2), { count: 2 });
  assertEquals(wins.length, 2);
  for (const win of wins) assertEquals(toEtHours(win.end) - toEtHours(win.start), 16);
});

Deno.test('weather + time: only the overlap counts', () => {
  // Rain only in the ET 16–24 period of each day; window ET 21–03 → 21–24.
  const w = (p) => (p % 3 === 2 ? RAIN : CLEAR);
  const [win] = nextWindows({ spawn: 21, dur: 6, w: [RAIN] }, w, etMs(500 * 24));
  assertEquals(toEtHours(win.start) % 24, 21);
  assertEquals(toEtHours(win.end) - toEtHours(win.start), 3);
});

Deno.test('previous weather: clear after rain', () => {
  const w = seq(FOG, RAIN, CLEAR, CLEAR); // only the first CLEAR follows RAIN
  const [win] = nextWindows({ w: [CLEAR], pw: [RAIN] }, w, etMs(0));
  const p = Math.round(toEtHours(win.start) / 8);
  assertEquals(w(p), CLEAR);
  assertEquals(w(p - 1), RAIN);
  assertEquals(toEtHours(win.end) - toEtHours(win.start), 8);
});

Deno.test('rare: nothing within the horizon', () => {
  assertEquals(nextWindows({ w: [RAIN] }, seq(CLEAR), T2026), []);
  assertEquals(windowStatus({ w: [RAIN] }, seq(CLEAR), T2026).state, 'rare');
});

Deno.test('returns windows in order, non-overlapping, after now', () => {
  const wins = nextWindows({ spawn: 4, dur: 4 }, seq(CLEAR), T2026, { count: 5 });
  assertEquals(wins.length, 5);
  for (let i = 1; i < wins.length; i++) assert(wins[i].start >= wins[i - 1].end);
  assert(wins[0].end > T2026);
});

Deno.test('nextWindows refuses entries without conditions', () => {
  assertThrows(() => nextWindows({ bait: 1 }, seq(CLEAR), T2026));
});

// ------------------------------------- property test against brute force

Deno.test('finder agrees with brute-force sampling on real fish', () => {
  const r = rng(7);
  const cases = [];
  for (const [fid, f] of Object.entries(DATA.fish)) {
    for (const [hid, e] of Object.entries(f.at)) {
      if (!DATA.holes[hid].ocean && (e.spawn != null || e.w || e.pw)) cases.push([fid, hid, e]);
    }
  }
  assert(cases.length > 300, `only ${cases.length} condition fish`);
  for (let i = 0; i < 150; i++) {
    const [fid, hid, e] = cases[Math.floor(r() * cases.length)];
    const weatherOf = zoneWeather(DATA.weatherRates[DATA.holes[hid].wr]);
    const from = T2026 + Math.floor(r() * 30 * 864e5);
    const wins = nextWindows(e, weatherOf, from, { count: 3, horizonMs: 60 * 864e5 });
    if (!wins.length) continue;
    const span = wins[wins.length - 1].end;
    const holds = (t) => {
      const H = toEtHours(t), p = Math.floor(H / 8), h = H % 24;
      if (e.w && !e.w.includes(weatherOf(p))) return false;
      if (e.pw && !e.pw.includes(weatherOf(p - 1))) return false;
      if (e.spawn == null) return true;
      const end = e.spawn + e.dur;
      return end <= 24 ? h >= e.spawn && h < end : h >= e.spawn || h < end - 24;
    };
    const inWin = (t) => wins.some((w) => t >= w.start && t < w.end);
    // Sample every 1/20 ET hour from `from` to the end of the last window.
    for (let t = from; t < span; t += ET_HOUR_MS / 20) {
      assertEquals(inWin(t), holds(t), `${DATA.fish[fid].name} @ ${DATA.holes[hid].name}, t=${t}`);
    }
  }
});
