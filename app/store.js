// Progress and settings, persisted to localStorage.

export const STORAGE_KEY = 'fishlog:v1';

export const defaultState = () => ({
  v: 1,
  caught: [],          // fish ids (strings)
  discovered: [],      // hole ids
  profile: {
    lvl: null,         // fisher level; null = not set (no level filtering)
    gath: null,        // Gathering; null = not set (no warnings)
    exp: null,         // unlocked expansion ids; null = all
    showAbove: false,  // show holes above my level, greyed
  },
  last: null,          // last viewed hole id
  upSoonHours: 2,      // "Up soon" horizon
  createdAt: null,     // ms, first save
  lastExport: null,    // ms
  caughtAtLastExport: 0,
  reminderDismissedAt: null, // ms
});

export const REMIND_AFTER_DAYS = 14;
export const REMIND_AFTER_CATCHES = 10;
export const REMIND_SNOOZE_DAYS = 3;
const DAY = 864e5;

/** Whether to show the backup reminder banner. */
export function shouldRemind(state, caughtCount, now) {
  const since = state.lastExport ?? state.createdAt;
  if (since == null) return false;
  if (now - since < REMIND_AFTER_DAYS * DAY) return false;
  if (caughtCount - (state.caughtAtLastExport ?? 0) < REMIND_AFTER_CATCHES) return false;
  if (state.reminderDismissedAt != null && now - state.reminderDismissedAt < REMIND_SNOOZE_DAYS * DAY) return false;
  return true;
}

export const BACKUP_APP = 'fishlog';

/** The export file contents. */
export function makeBackup(state, now) {
  return {
    app: BACKUP_APP, v: 1, exportedAt: new Date(now).toISOString(),
    caught: state.caught, discovered: state.discovered, profile: state.profile,
  };
}

/**
 * Validate a backup file's text against the current data. Unknown fish and
 * hole ids (e.g. removed in a later patch) are dropped and counted.
 */
export function parseBackup(text, data) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP) return { ok: false, error: "This isn't a Fish Log backup." };
  if (b.v !== 1) return { ok: false, error: `Unsupported backup version ${b.v}.` };
  if (!Array.isArray(b.caught) || !Array.isArray(b.discovered)) return { ok: false, error: 'The backup is missing its progress lists.' };
  const ids = (xs) => [...new Set(xs.filter((x) => typeof x === 'string' || typeof x === 'number').map(String))];
  const caughtAll = ids(b.caught), discAll = ids(b.discovered);
  const caught = caughtAll.filter((f) => data.fish[f]);
  const discovered = discAll.filter((h) => data.holes[h]);
  const p = b.profile && typeof b.profile === 'object' ? b.profile : null;
  const num = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const profile = p && {
    lvl: num(p.lvl, 1, 100), gath: num(p.gath, 0, 9999),
    exp: Array.isArray(p.exp) ? p.exp.filter((e) => Number.isInteger(e)) : null,
    showAbove: p.showAbove === true,
  };
  const t = Date.parse(b.exportedAt);
  return {
    ok: true, caught, discovered, profile, exportedAt: Number.isNaN(t) ? null : t,
    dropped: caughtAll.length - caught.length + discAll.length - discovered.length,
  };
}

function readState(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, profile: { ...d.profile, ...s.profile } };
  } catch {
    return defaultState();
  }
}

export function createStore(storage = globalThis.localStorage) {
  let state = readState(storage);
  let caught = new Set(state.caught);
  let discovered = new Set(state.discovered);
  const listeners = new Set();

  function commit() {
    state = { ...state, caught: [...caught], discovered: [...discovered], createdAt: state.createdAt ?? Date.now() };
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked (private mode): keep working in memory.
    }
    for (const fn of listeners) fn();
  }

  return {
    get state() { return state; },
    isCaught: (fid) => caught.has(String(fid)),
    isDiscovered: (hid) => discovered.has(hid),
    caughtCount: () => caught.size,

    /** Toggle a fish; marking it caught at a hole also discovers the hole. */
    toggleCaught(fid, hid) {
      fid = String(fid);
      if (caught.has(fid)) {
        caught.delete(fid);
      } else {
        caught.add(fid);
        if (hid) discovered.add(hid);
      }
      commit();
    },
    toggleDiscovered(hid) {
      if (discovered.has(hid)) discovered.delete(hid);
      else discovered.add(hid);
      commit();
    },
    setProfile(patch) {
      state = { ...state, profile: { ...state.profile, ...patch } };
      commit();
    },
    /** Top-level settings such as upSoonHours or reminderDismissedAt. */
    setPrefs(patch) {
      state = { ...state, ...patch };
      commit();
    },
    markExported(now) {
      state = { ...state, lastExport: now, caughtAtLastExport: caught.size, reminderDismissedAt: null };
      commit();
    },
    /** Apply a parsed backup: 'merge' unions progress; 'replace' overwrites it and the profile. */
    importBackup(b, mode) {
      if (mode === 'replace') {
        caught = new Set(b.caught);
        discovered = new Set(b.discovered);
        if (b.profile) state = { ...state, profile: { ...defaultState().profile, ...b.profile } };
      } else {
        for (const f of b.caught) caught.add(f);
        for (const h of b.discovered) discovered.add(h);
      }
      commit();
    },
    setLast(hid) {
      if (state.last === hid) return;
      state = { ...state, last: hid };
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch { /* ignore */ }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
