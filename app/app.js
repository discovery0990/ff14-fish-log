// Entry point: loads data, routes on the URL hash, renders, handles taps.

import { fishWindows } from './engine.js';
import { TABS, createModel } from './model.js';
import { createStore } from './store.js';
import {
  fishView, holeView, homeView, notFound, placeholderView, regionView, zoneView,
} from './views.js';

const LIVE_REFRESH_MS = 15_000;

const root = document.getElementById('app');
const store = createStore();
let model = null;

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function view() {
  const { parts, params } = parseRoute();
  const now = Date.now();
  const ctx = {
    m: model, store, now,
    tab: TABS.includes(parts[0]) ? parts[0] : 'rod',
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
  if (a === 'profile') return placeholderView('Profile & filters');
  return notFound();
}

function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  root.innerHTML = view();
  if (keepScroll) window.scrollTo(0, y);
}

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const { act, fid, hid } = el.dataset;
  if (act === 'caught') store.toggleCaught(fid, hid);
  else if (act === 'disc') store.toggleDiscovered(hid);
});

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
    render();
    window.scrollTo(0, 0);
  });
  // Keep timers and the ET clock live; skip while the page is hidden.
  setInterval(() => {
    if (document.visibilityState === 'visible') render({ keepScroll: true });
  }, LIVE_REFRESH_MS);
  render();
}

main();
