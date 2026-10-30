// Entry point: loads data, routes on the URL hash, renders, handles input.

import { TABS, createModel } from './model.js';
import { createStore, makeBackup, parseBackup, shouldRemind } from './store.js';
import {
  fishView, holeView, homeBody, homeView, notFound, profileView, soonView,
} from './views.js';

const LIVE_REFRESH_MS = 15_000;
// Filled in by tools/build_site.py with the deploy's content hash.
const APP_VERSION = '__APP_VERSION__';

const root = document.getElementById('app');
const store = createStore();
let model = null;

// Transient UI state (not persisted).
const ui = { query: '', openRegion: null, openZone: null, scrollToZone: null, listY: {}, folds: new Set(), showCaught: false, pendingImport: null, flash: '' };

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function makeCtx(parts) {
  const now = Date.now();
  return {
    m: model, store, now, ...ui, appVersion: APP_VERSION.startsWith('__') ? 'dev' : APP_VERSION,
    tab: TABS.includes(parts[0]) ? parts[0] : 'rod',
    remind: shouldRemind(store.state, store.caughtCount(), now),
  };
}

/**
 * Side effects of arriving at a route, run once per navigation (never on
 * redraws): zone links redirect to Home with the zone open, and a hole opens
 * its zone on Home so Back returns there.
 */
function enterRoute() {
  const [a, b, c] = parseRoute().parts;
  if (TABS.includes(a) && b === 'zone') {
    if (model.data.zones[c]) openZone(c, true);
    ui.query = '';
    history.replaceState(null, '', `#/${a}`);
  } else if (a === 'hole' && model.data.holes[b]) {
    openZone(String(model.data.holes[b].zone), false);
  }
}

/** The current screen's HTML. Reads state; changes nothing. */
function view() {
  const { parts, params } = parseRoute();
  const ctx = makeCtx(parts);
  const [a, b] = parts;
  if (!a || (TABS.includes(a) && !b)) return homeView(ctx);
  if (TABS.includes(a) && b === 'soon') return soonView(ctx, a);
  if (a === 'hole' && b) return holeView(ctx, b);
  if (a === 'fish' && b) return fishView(ctx, b, params.get('h'), params.get('from'));
  if (a === 'profile') return profileView(ctx);
  return notFound();
}

/**
 * Re-render after expanding or collapsing a row, keeping that row where it
 * was on screen: rows collapsing above it would otherwise pull it up.
 */
function renderPinned(el, selector) {
  const top = el.getBoundingClientRect().top;
  render({ keepScroll: true });
  const now = document.querySelector(selector);
  if (now) window.scrollBy(0, now.getBoundingClientRect().top - top);
}

/** Expand a zone (and its region) on Home; scroll it into view on the next render. */
function openZone(zid, scroll) {
  ui.openRegion = String(model.data.zones[zid].region);
  ui.openZone = zid;
  if (scroll) ui.scrollToZone = zid;
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

  // Keep already-loaded icons: a fresh <img> has to decode again, which
  // flashes. Swap each new one for an old element with the same src.
  const loaded = new Map();
  for (const img of root.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth) (loaded.get(img.src) ?? loaded.set(img.src, []).get(img.src)).push(img);
  }
  root.innerHTML = view();
  for (const img of root.querySelectorAll('img')) {
    const old = loaded.get(img.src)?.pop();
    if (old) {
      old.className = img.className;
      img.replaceWith(old);
    }
  }

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
  if (ui.scrollToZone) {
    document.querySelector(`[data-zid="${ui.scrollToZone}"]`)?.scrollIntoView({ block: 'start' });
    ui.scrollToZone = null;
    return true;
  }
  return false;
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

// The file input lives outside #app (index.html) so re-renders can never
// detach it while the iOS Files picker is open.
const fileInput = document.getElementById('import-file');
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = ''; // allow picking the same file again
  if (f) readImportFile(f);
});

/** Update only the results under the search box; the input stays put. */
function updateSearch(value) {
  ui.query = value;
  const clear = document.querySelector('[data-act="clear-search"]');
  if (clear) clear.hidden = !value;
  const body = document.getElementById('home-body');
  if (body) body.innerHTML = homeBody(makeCtx(parseRoute().parts));
  else render({ keepScroll: true });
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
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort((x, y) => x - y);
      store.setProfile({ exp: next.length === all.length ? null : next });
      break;
    }
    case 'fold':
      if (!ui.folds.delete(d.key)) ui.folds.add(d.key);
      renderPinned(el, `[data-act=fold][data-key="${d.key}"]`);
      break;
    case 'show-caught':
      ui.showCaught = !ui.showCaught;
      render({ keepScroll: true });
      break;
    case 'region':
      ui.openRegion = ui.openRegion === d.rid ? null : d.rid;
      ui.openZone = null;
      renderPinned(el, `[data-rid="${d.rid}"]`);
      break;
    case 'zone':
      if (ui.openZone === d.zid) ui.openZone = null;
      else openZone(d.zid, false);
      renderPinned(el, `[data-zid="${d.zid}"]`);
      break;
    case 'soon-holes': store.setPrefs({ upSoonHoles: d.f }); break;
    case 'horizon': store.setPrefs({ upSoonHours: Number(d.h) }); break;
    case 'clear-search': {
      const input = document.getElementById('search');
      input.value = '';
      updateSearch('');
      input.focus(); // ready for the next search
      break;
    }
    case 'export': exportProgress(); break;
    case 'import': fileInput.click(); break;
    case 'import-merge': applyImport('merge'); break;
    case 'import-replace': applyImport('replace'); break;
    case 'import-cancel': ui.pendingImport = null; render({ keepScroll: true }); break;
  }
});

root.addEventListener('input', (ev) => {
  if (ev.target.id === 'search') updateSearch(ev.target.value);
});

root.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.profile) setProfileNumber(t.dataset.profile, t.value);
});

root.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.dataset?.profile) ev.target.blur(); // commits via change
  if (ev.key === 'Escape' && ev.target.id === 'search') {
    ev.target.value = '';
    updateSearch('');
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
  // Returning to a list (Home or Up soon) from a screen it opened restores
  // where you were on it. Switching tabs starts at the top.
  const listKey = () => {
    const p = parseRoute().parts;
    if (!p.length) return 'rod';
    if (!TABS.includes(p[0])) return null;
    return !p[1] ? p[0] : p[1] === 'soon' ? `${p[0]}/soon` : null;
  };
  enterRoute(); // before listKey: a zone link redirects to Home
  let lastList = listKey();
  window.addEventListener('hashchange', () => {
    if (lastList) ui.listY[lastList] = window.scrollY;
    enterRoute();
    const key = listKey();
    ui.flash = '';
    ui.pendingImport = null;
    ui.showCaught = false;
    if (!render()) window.scrollTo(0, key && !lastList ? ui.listY[key] ?? 0 : 0);
    lastList = key;
  });
  // Keep timers and the ET clock live. Skip while hidden, or while any field
  // has focus: replacing a focused input closes the iOS keyboard and would
  // discard a half-typed number.
  const refresh = () => {
    const editing = document.activeElement?.tagName === 'INPUT';
    if (document.visibilityState === 'visible' && !editing) render({ keepScroll: true });
  };
  setInterval(refresh, LIVE_REFRESH_MS);
  // The timer doesn't run in the background, so coming back to the app (or
  // iOS restoring it from memory) would show hours-old times until the next
  // tick. Redraw at once instead.
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pageshow', refresh);
  render();
  // Ask the browser not to evict progress under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  registerServiceWorker();
}

// ------------------------------------------------------------ offline / updates

// Off on localhost so editing files shows up on reload; the e2e test turns it
// on with localStorage 'fishlog:sw' = '1' when serving the built dist/.
const SW_ENABLED = 'serviceWorker' in navigator &&
  (!['localhost', '127.0.0.1'].includes(location.hostname) || localStorage.getItem('fishlog:sw') === '1');

async function registerServiceWorker() {
  if (!SW_ENABLED) return;
  let reg;
  try {
    reg = await navigator.serviceWorker.register('sw.js');
  } catch {
    return; // e.g. private mode; the app still works online
  }
  const offer = (worker) => showToast('A new version is available.', 'Reload', () => worker.postMessage('skip-waiting'));
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
    });
  });
  // A new worker taking over means an update: reload onto it. But on a first
  // visit the first worker claims the page too (clients.claim), and that page
  // is already current, so don't reload for it.
  let controlled = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (!reloading) {
      reloading = true;
      location.reload();
    }
  });
  // Home-screen apps can stay open for days; look for updates on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

function showToast(text, action, onAction) {
  const t = document.getElementById('toast');
  t.innerHTML = '';
  const msg = Object.assign(document.createElement('span'), { className: 'grow', textContent: text });
  const btn = Object.assign(document.createElement('button'), { className: 'btn primary', textContent: action });
  btn.addEventListener('click', () => {
    t.hidden = true;
    onAction();
  });
  t.append(msg, btn);
  t.hidden = false;
}

main();
