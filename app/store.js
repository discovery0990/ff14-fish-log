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
  lastExport: null,    // ms
  caughtAtLastExport: 0,
});

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
    state = { ...state, caught: [...caught], discovered: [...discovered] };
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
