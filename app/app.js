// Entry point: loads data, routes on the URL hash, renders, handles input.

import { fishWindows } from './engine.js';
import { TABS, createModel } from './model.js';
import { createStore, makeBackup, parseBackup, shouldRemind } from './store.js';
import {
  fishView, holeView, homeView, notFound, profileView, regionView, zoneView,
} from './views.js';

const LIVE_REFRESH_MS = 15_000;

const root = document.getElementById('app');
const store = createStore();
let model = null;

// Transient UI state (not persisted).
const ui = { query: '', showAllSoon: false, pendingImport: null, flash: '' };

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function view() {
  const { parts, params } = parseRoute();
  const now = Date.now();
  const ctx = {
    m: model, store, now, ...ui,
    tab: TABS.includes(parts[0]) ? parts[0] : 'rod',
    remind: shouldRemind(store.state, store.caughtCount(), now),
    nextWindows: (fid, hid, count) => fishWindows(model.data, fid, hid, now, { count }),
  };
  const [a, b, c] = parts;
  if (!a || (TABS.includes(a) && !b)) return homeView(ctx);
  if (TABS.includes(a) && b === 'region') return regionView(ctx, a, c);
  if (TABS.includes(a) && b === 'zone') return zoneView(ctx, a, c, params.get('f') ?? 'all');
  if (a === 'hole' && b) {
    if (model.data.holes[b]) store.setLast(b);
    return holeView(ctx, b);
  }
  if (a === 'fish' && b) return fishView(ctx, b, params.get('h'));
  if (a === 'profile') return profileView(ctx);
  return notFound();
}

/** Re-render, keeping scroll and the focused input (and its caret). */
function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  const active = document.activeElement;
  const focusId = active?.id && root.contains(active) ? active.id : null;
  let sel = null;
  try {
    sel = focusId ? [active.selectionStart, active.selectionEnd] : null;
  } catch { /* number inputs have no selection */ }

  root.innerHTML = view();

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      try {
        if (sel && sel[0] != null) el.setSelectionRange(sel[0], sel[1]);
      } catch { /* ignore */ }
    }
  }
  if (keepScroll) window.scrollTo(0, y);
}

// ------------------------------------------------------------ actions

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const LIMITS = { lvl: [1, 100], gath: [0, 9999] };

function setProfileNumber(key, raw) {
  const [lo, hi] = LIMITS[key];
  const v = raw === '' || raw == null ? null : parseInt(raw, 10);
  store.setProfile({ [key]: v == null || Number.isNaN(v) ? null : clamp(v, lo, hi) });
}

async function exportProgress() {
  const now = Date.now();
  const json = JSON.stringify(makeBackup(store.state, now), null, 1);
  const name = `fishlog-${new Date(now).toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Fish Log backup' });
    } else {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // user closed the share sheet
    ui.flash = `Export failed: ${err?.message ?? err}`;
    render({ keepScroll: true });
    return;
  }
  ui.flash = `Exported ${store.caughtCount()} caught fish.`;
  store.markExported(now);
}

async function readImportFile(file) {
  const res = parseBackup(await file.text(), model.data);
  ui.pendingImport = res.ok ? res : null;
  ui.flash = res.ok ? '' : res.error;
  render({ keepScroll: true });
}

function applyImport(mode) {
  const p = ui.pendingImport;
  ui.pendingImport = null;
  store.importBackup(p, mode);
  ui.flash = `Imported (${mode === 'merge' ? 'merged' : 'replaced'}). ${store.caughtCount()} fish caught.`;
  render({ keepScroll: true });
}

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const d = el.dataset;
  switch (d.act) {
    case 'caught': store.toggleCaught(d.fid, d.hid); break;
    case 'disc': store.toggleDiscovered(d.hid); break;
    case 'soon-all': ui.showAllSoon = !ui.showAllSoon; render({ keepScroll: true }); break;
    case 'dismiss-reminder': store.setPrefs({ reminderDismissedAt: Date.now() }); break;
    case 'step': {
      const cur = store.state.profile[d.key];
      const fallback = d.key === 'lvl' ? 50 : 0;
      setProfileNumber(d.key, (cur ?? fallback) + Number(d.d));
      break;
    }
    case 'exp': {
      const all = Object.keys(model.data.expansions).map(Number);
      const id = Number(d.exp);
      const cur = store.state.profile.exp ?? all;
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort();
      store.setProfile({ exp: next.length === all.length ? null : next });
      break;
    }
    case 'show-above': store.setProfile({ showAbove: !store.state.profile.showAbove }); break;
    case 'horizon': store.setPrefs({ upSoonHours: Number(d.h) }); break;
    case 'export': exportProgress(); break;
    case 'import-merge': applyImport('merge'); break;
    case 'import-replace': applyImport('replace'); break;
    case 'import-cancel': ui.pendingImport = null; render({ keepScroll: true }); break;
  }
});

root.addEventListener('input', (ev) => {
  if (ev.target.id === 'search') {
    ui.query = ev.target.value;
    render({ keepScroll: true });
  }
});

root.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.profile) setProfileNumber(t.dataset.profile, t.value);
  else if (t.id === 'import-file' && t.files?.[0]) readImportFile(t.files[0]);
});

root.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.dataset?.profile) ev.target.blur(); // commits via change
  if (ev.key === 'Escape' && ev.target.id === 'search') {
    ui.query = '';
    render();
  }
});

// ------------------------------------------------------------ start

async function main() {
  try {
    const res = await fetch('data/fish.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    model = createModel(await res.json());
  } catch (err) {
    root.innerHTML = `<h1>Couldn't load fish data</h1><p class="note">${String(err)}</p>`;
    return;
  }
  store.subscribe(() => render({ keepScroll: true }));
  window.addEventListener('hashchange', () => {
    ui.flash = '';
    ui.pendingImport = null;
    render();
    window.scrollTo(0, 0);
  });
  // Keep timers and the ET clock live. Skip while hidden, or while a number
  // field is being edited (a re-render would discard the half-typed value).
  setInterval(() => {
    const a = document.activeElement;
    const editing = a?.tagName === 'INPUT' && a.type !== 'search';
    if (document.visibilityState === 'visible' && !editing) render({ keepScroll: true });
  }, LIVE_REFRESH_MS);
  render();
}

main();
