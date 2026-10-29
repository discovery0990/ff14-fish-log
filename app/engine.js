// Eorzea time, weather forecasting and catch-window finding.
//
// Pure functions, no DOM: shared by the app and the Deno tests.
// Time is tracked in "ET hours since the Unix epoch" (H): one ET hour is 175
// real seconds, one weather period is 8 ET hours (1,400 real seconds) and
// starts at ET 00:00, 08:00 or 16:00.

export const ET_HOUR_MS = 175 * 1000;
export const PERIOD_HOURS = 8;
export const PERIOD_MS = PERIOD_HOURS * ET_HOUR_MS;

/** Real ms → ET hours since the epoch. */
export const toEtHours = (ms) => ms / ET_HOUR_MS;
/** ET hours since the epoch → real ms. */
export const toMs = (h) => Math.round(h * ET_HOUR_MS);

/** ET clock time (0 ≤ hours < 24, minutes) at a real time. */
export function eorzeaClock(ms) {
  const h = toEtHours(ms) % 24;
  return { hours: Math.floor(h), minutes: Math.floor((h % 1) * 60) };
}

/** Index of the weather period containing a real time. */
export const periodOf = (ms) => Math.floor(ms / PERIOD_MS);

/**
 * The 0–99 weather roll for the period containing `ms`.
 * Algorithm from SaintCoinach, as used by every FFXIV weather tracker.
 */
export function forecastTarget(ms) {
  const unix = Math.trunc(ms / 1000);
  const bell = Math.floor(unix / 175);
  const inc = (bell + 8 - (bell % 8)) % 24;
  const days = Math.floor(unix / 4200) >>> 0;
  const base = days * 100 + inc;
  const s1 = ((base << 11) ^ base) >>> 0;
  const s2 = ((s1 >>> 8) ^ s1) >>> 0;
  return s2 % 100;
}

/** Weather id for a roll, given a zone's [[weatherId, rate], …] table. */
export function weatherForTarget(rates, target) {
  let sum = 0;
  for (const [weather, rate] of rates) {
    sum += rate;
    if (target < sum) return weather;
  }
  return rates[rates.length - 1][0];
}

/** Returns period index → weather id for a zone, memoised. */
export function zoneWeather(rates) {
  const cache = new Map();
  return (p) => {
    let w = cache.get(p);
    if (w === undefined) {
      w = weatherForTarget(rates, forecastTarget(p * PERIOD_MS));
      cache.set(p, w);
    }
    return w;
  };
}

/** True if a catch entry has any time or weather condition. */
export const hasWindow = (cond) =>
  cond.spawn != null || (cond.w?.length > 0) || (cond.pw?.length > 0);

/** The [start, end) ET-hour pieces of period p where `cond` holds. */
function periodIntervals(cond, weatherOf, p) {
  if (cond.w?.length && !cond.w.includes(weatherOf(p))) return [];
  if (cond.pw?.length && !cond.pw.includes(weatherOf(p - 1))) return [];
  const lo = p * PERIOD_HOURS, hi = lo + PERIOD_HOURS;
  if (cond.spawn == null) return [[lo, hi]];
  // Daily time window [spawn, spawn + dur), possibly crossing midnight.
  const out = [];
  const day = Math.floor(lo / 24) * 24;
  for (const d of [day - 24, day]) {
    const s = Math.max(lo, d + cond.spawn), e = Math.min(hi, d + cond.spawn + cond.dur);
    if (s < e) out.push([s, e]);
  }
  return out;
}

/**
 * The next `count` windows when `cond` ({spawn, dur, w, pw}) holds, as
 * [{start, end}] in real ms. A window open at `fromMs` is included with its
 * real start time. Searching stops after `horizonMs` (an empty result means
 * "rare"). `weatherOf` maps period index → weather id (see zoneWeather).
 */
export function nextWindows(cond, weatherOf, fromMs, { count = 1, horizonMs = 30 * 864e5 } = {}) {
  if (!hasWindow(cond)) throw new Error('nextWindows: entry has no time or weather condition');
  const fromH = toEtHours(fromMs);
  const p0 = Math.floor(fromH / PERIOD_HOURS);
  const pEnd = Math.floor(toEtHours(fromMs + horizonMs) / PERIOD_HOURS);

  // Walk back to where a window open now really started (bounded).
  let p = p0;
  for (let back = 0; back < 90; back++) {
    const iv = periodIntervals(cond, weatherOf, p - 1);
    if (!iv.length || iv[iv.length - 1][1] !== p * PERIOD_HOURS) break;
    p--;
  }

  const found = [];
  let cur = null;
  for (; p <= pEnd + 1; p++) {
    for (const [s, e] of periodIntervals(cond, weatherOf, p)) {
      if (cur && s === cur[1]) {
        cur[1] = e;
        continue;
      }
      if (cur && cur[1] > fromH) found.push(cur);
      if (found.length === count) break;
      cur = [s, e];
    }
    if (found.length === count) break;
  }
  if (found.length < count && cur && cur[1] > fromH && cur[0] <= toEtHours(fromMs + horizonMs)) found.push(cur);
  return found.slice(0, count).map(([s, e]) => ({ start: toMs(s), end: toMs(e) }));
}

/**
 * Status of a condition fish at a real time:
 *   {state: 'open', end}  |  {state: 'upcoming', start, end}  |  {state: 'rare'}
 */
export function windowStatus(cond, weatherOf, nowMs, opts) {
  const [w] = nextWindows(cond, weatherOf, nowMs, { ...opts, count: 1 });
  if (!w) return { state: 'rare' };
  return w.start <= nowMs ? { state: 'open', start: w.start, end: w.end } : { state: 'upcoming', start: w.start, end: w.end };
}

/**
 * Windows for a fish at a hole using the built data file, or null when the
 * fish has no condition there, or the hole is an ocean-fishing hole (its
 * weather follows the voyage, so it must never be forecast).
 */
export function fishWindows(data, fishId, holeId, fromMs, opts) {
  const hole = data.holes[holeId];
  const cond = data.fish[fishId]?.at[holeId];
  if (!hole || !cond || hole.ocean || !hasWindow(cond)) return null;
  return nextWindows(cond, zoneWeather(data.weatherRates[hole.wr]), fromMs, opts);
}
