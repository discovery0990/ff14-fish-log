// Screen renderers. Each returns an HTML string; app.js wires events by
// delegation on data-act attributes. All text from data goes through esc().

import { eorzeaClock } from './engine.js';
import { TABS, TAB_LABELS, holeTab } from './model.js';

// ------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const TUG = { light: '!', medium: '!!', heavy: '!!!' };
const HOOK = { powerful: 'Powerful', precision: 'Precision' };
// Teamcraft enums (libs/types/src/lib/game/spearfishing-*.ts).
const SPEED = ['Very slow', 'Slow', 'Average', 'Fast', 'Faster', 'Very fast'];
const SHADOW = ['Small', 'Normal', 'Large'];

/** "14m", "1h 52m", "2d 3h". */
export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "Today 23:16", "Tomorrow 04:26", "Thu 08:02" in local time. */
export function fmtWhen(ms, now) {
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (t) => new Date(t).toDateString();
  if (day(ms) === day(now)) return `Today ${hm}`;
  if (day(ms) === day(now + 864e5)) return `Tomorrow ${hm}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hm}`;
}

const etHM = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export function fmtEtClock(now) {
  const { hours, minutes } = eorzeaClock(now);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function condText(m, e) {
  const parts = [];
  const wname = (ids) => ids.map((w) => m.data.weathers[w]?.name ?? `#${w}`).join(' / ');
  if (e.pw?.length) parts.push(`${wname(e.pw)} → ${wname(e.w ?? [])}`.replace(/ → $/, ' → any'));
  else if (e.w?.length) parts.push(wname(e.w));
  if (e.spawn != null) parts.push(`ET ${etHM(e.spawn)}–${etHM(e.spawn + e.dur)}`);
  return parts.join(' · ');
}

function statusPill(st, now) {
  if (!st) return '';
  if (st.state === 'open') return `<span class="pill open">OPEN · ${fmtDuration(st.end - now)} left</span>`;
  if (st.state === 'upcoming') return `<span class="pill">in ${fmtDuration(st.start - now)}</span>`;
  return '<span class="pill">rare</span>';
}

const icon = (id, cls = 'icon') => (id ? `<img class="${cls}" src="icons/${id}.png" alt="" loading="lazy">` : `<span class="${cls}"></span>`);

const progress = ({ caught, total }, cls = '') =>
  `<div class="bar ${cls}"><div style="width:${total ? Math.round((caught / total) * 100) : 0}%"></div></div>`;

const back = (href, label) =>
  `<a class="back" href="${href}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>${esc(label)}</a>`;

const chevron = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';

function baitLine(m, fid, hid, e) {
  if (m.data.fish[fid].log === 'spear') {
    const shadow = SHADOW[e.size] ? `${SHADOW[e.size]} shadow` : 'Shadow ?';
    const speed = SPEED[e.speed] ?? 'Speed ?';
    return `<span class="sub"><span class="hi">${shadow}</span> · ${speed}</span>`;
  }
  const tug = `<span class="hi">${e.tug ? TUG[e.tug] : 'Tug ?'}</span>`;
  const hook = e.hook ? HOOK[e.hook] : 'Hookset ?';
  if (m.isMooch(e)) {
    const chain = m.moochChain(fid, hid).steps.map((s) => (s.unknown ? '?' : esc(m.fishName(s.id))));
    chain.pop(); // the fish itself
    // Purple arrows mark a mooch chain (purple is the app's mooch colour).
    return `<span class="sub">${chain.join(' <span class="arrow" aria-label="then mooch">→</span> ')} · ${tug} · ${hook}</span>`;
  }
  const bait = e.bait ? esc(m.fishName(e.bait)) : 'Bait unknown';
  const alts = e.alts?.length ? ` <span class="dim">(or ${e.alts.map((b) => esc(m.fishName(b))).join(', ')})</span>` : '';
  return `<span class="sub">${bait}${alts} · ${tug} · ${hook}</span>`;
}

function extrasLine(m, e) {
  const bits = [];
  if (e.pred?.length) bits.push('Needs ' + e.pred.map(([id, n]) => `${n}× ${esc(m.fishName(id))}`).join(', ') + ' first');
  if (e.snag) bits.push('Snagging');
  if (e.aLure) bits.push(`Ambitious Lure ×${e.aLure}`);
  if (e.mLure) bits.push(`Modest Lure ×${e.mLure}`);
  return bits.length ? `<span class="sub">${bits.join(' · ')}</span>` : '';
}

// ------------------------------------------------------------ screens

export function homeView(ctx) {
  const { m, store, tab, now } = ctx;
  const { profile } = store.state;
  const total = Object.keys(m.data.fish).length;
  const prof = profile.lvl == null
    ? '<a href="#/profile" class="link">Set your level →</a>'
    : `FSH Lv ${profile.lvl}${profile.gath != null ? ` · Gathering ${profile.gath}` : ''}`;
  const tabs = TABS.map((t) =>
    `<a role="tab" href="#/${t}" class="tab${t === tab ? ' on' : ''}" aria-selected="${t === tab}">${TAB_LABELS[t]}</a>`).join('');

  const searchBox = `
    <label class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <span class="sr">Search</span>
      <input id="search" type="search" placeholder="Fish, hole or zone" autocomplete="off" autocorrect="off"
        spellcheck="false" enterkeyhint="search" value="${esc(ctx.query)}">
      <button type="button" class="clear" data-act="clear-search" aria-label="Clear search"${ctx.query ? '' : ' hidden'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
    </label>`;

  const header = `
    <header class="top">
      <div class="grow stack-xs"><h1>Fish Log</h1><div class="sub">${prof} · ET <span class="num">${fmtEtClock(now)}</span></div>
        <div class="row overall"><span class="num hi">${store.caughtCount().toLocaleString()} / ${total.toLocaleString()}</span><span class="sub">caught</span>
          <span class="grow">${progress({ caught: store.caughtCount(), total }, 'thin')}</span></div></div>
      <a class="iconbtn" href="#/profile" aria-label="Profile and filters">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
      </a>
    </header>`;

  const reminder = ctx.remind ? `
    <div class="banner row">
      <span class="grow">${store.state.lastExport ? `Last backup ${daysAgo(store.state.lastExport, now)}` : 'No backup yet'} ·
        ${store.caughtCount() - store.state.caughtAtLastExport} new catches. <a class="link" href="#/profile">Back up now</a></span>
      <button class="x" data-act="dismiss-reminder" aria-label="Dismiss backup reminder">×</button>
    </div>` : '';

  return `
    ${header}
    ${reminder}
    <nav class="tabs" role="tablist" aria-label="Fishing type">${tabs}</nav>
    ${searchBox}
    <div id="home-body" class="stack-l">${homeBody(ctx)}</div>`;
}

/**
 * Everything below the search box. Rendered on its own while typing, so the
 * search input is never replaced (iOS closes the keyboard if it is).
 */
export function homeBody(ctx) {
  const { m, store, tab } = ctx;
  const { profile } = store.state;
  if (ctx.query.trim()) return searchResults(ctx);
  const regions = m.visibleRegions(tab, profile);
  const allRegions = Object.keys(m.data.regions).filter((r) => m.regionHolesAll(tab, r).length);
  const hidden = allRegions.length - regions.length;
  const regionRows = regions.map((r) => {
    const c = m.count(m.regionHolesAll(tab, r), store.isCaught);
    const open = ctx.openRegion === r;
    return `
      <button class="item region${open ? ' open' : ''}" data-act="region" data-rid="${r}" aria-expanded="${open}">
        <div class="row"><span class="title grow">${esc(m.data.regions[r].name)}</span><span class="num${done(c) ? ' done' : ''}">${countText(c)}</span>${chevron}</div>
        ${progress(c, 'thin')}
      </button>${open ? zoneRows(ctx, r) : ''}`;
  }).join('');

  return `${upSoonSection(ctx)}${regionsBlock(regionRows, hidden)}`;
}

function regionsBlock(regionRows, hidden) {
  return `
    <section><h2 class="sec">Regions</h2>
      <div class="list">${regionRows || '<p class="empty">Nothing matches your filters.</p>'}</div>
      ${hidden ? `<p class="note">${hidden} region${hidden > 1 ? 's' : ''} hidden by your level and expansion filters.</p>` : ''}
    </section>`;
}

const countText = ({ caught, total }) => `${caught} / ${total}`;
const done = ({ caught, total }) => total > 0 && caught === total;

/** A region's zones, shown under it on Home when it's expanded. */
function zoneRows(ctx, rid) {
  const { m, store, tab } = ctx;
  const { profile } = store.state;
  return m.visibleZones(tab, rid, profile).map((z) => {
    const vis = m.visibleHoles(tab, z, profile);
    const c = m.count(m.zoneHolesAll(tab, z), store.isCaught);
    const lv = vis.map((h) => m.data.holes[h].lvl);
    const lvText = Math.min(...lv) === Math.max(...lv) ? `Lv ${lv[0]}` : `Lv ${Math.min(...lv)}–${Math.max(...lv)}`;
    const open = openCount(ctx, vis);
    return `
      <a class="item zone" href="#/${tab}/zone/${z}">
        <div class="row"><span class="title grow">${esc(m.data.zones[z].name)}</span><span class="num${done(c) ? ' done' : ''}">${countText(c)}</span></div>
        <div class="row"><span class="sub grow">${plural(vis.length, 'hole')} · ${lvText}</span>${open ? `<span class="tag open">${open} open now</span>` : ''}</div>
      </a>`;
  }).join('');
}

/** Uncaught fish whose window is open now across these holes. */
function openCount(ctx, hids) {
  const { m, store, now } = ctx;
  let n = 0;
  for (const hid of hids) {
    for (const { fid } of m.holeFish(hid)) {
      if (!store.isCaught(fid) && m.status(fid, hid, now)?.state === 'open') n++;
    }
  }
  return n;
}

/** Why browsing hides a hole under the current profile, or null. */
function hiddenWhy(m, hid, profile) {
  const h = m.data.holes[hid];
  const z = m.data.zones[h.zone];
  if (profile.exp && !profile.exp.includes(z.exp)) return `${m.data.expansions[z.exp]} is off`;
  if (m.isLocked(hid, profile)) return `Locked until Lv ${h.lvl}`;
  return null;
}

const xyText = (h) => (h.xy ? `X ${h.xy[0].toFixed(1)} Y ${h.xy[1].toFixed(1)}` : '');

const hiddenTag = (why) => (why ? ` <span class="tag">${esc(why)}</span>` : '');
// A dashed outline means "not discovered yet" everywhere: hole cards, the
// hole's toggle, and hole names in lists. undiscLegend explains it.
const holeName = (m, store, hid) => (store.isDiscovered(hid)
  ? esc(m.data.holes[hid].name)
  : `<span class="undisc-name" title="Not discovered yet">${esc(m.data.holes[hid].name)}</span>`);
const undiscLegend = '<p class="note legend"><span class="undisc-name">Hole</span> not discovered yet</p>';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Hole · Zone", or just the name when a hole is named after its zone. */
function holePlace(m, hid) {
  const h = m.data.holes[hid];
  const z = m.data.zones[h.zone].name;
  return h.name === z ? z : `${h.name} · ${z}`;
}

export function daysAgo(ms, now) {
  const d = Math.floor((now - ms) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

const UP_SOON_SHOWN = 5;

function upSoonList(ctx) {
  const { m, store, tab, now } = ctx;
  return m.upSoon(tab, { now, horizonMs: store.state.upSoonHours * 36e5, isCaught: store.isCaught, profile: store.state.profile });
}

/** Two lines: fish and status, then hole and condition. */
function upSoonRows(ctx, list) {
  const { m, store, now } = ctx;
  return list.map(({ fid, hid, st }) => {
    const f = m.data.fish[fid];
    return `
      <a class="item row" href="#/fish/${fid}?h=${hid}&from=${encodeURIComponent(ctx.from)}">
        ${icon(f.icon)}
        <span class="grow stack-xs">
          <span class="row"><span class="title grow">${esc(f.name)}</span>${statusPill(st, now)}</span>
          <span class="sub">${holeName(m, store, hid)} · ${esc(condText(m, f.at[hid]))}</span></span>
      </a>`;
  }).join('');
}

function upSoonSection(ctx) {
  const { store, tab } = ctx;
  if (tab === 'ocean') return '';
  const all = upSoonList(ctx);
  const shown = all.slice(0, UP_SOON_SHOWN);
  const legend = shown.some((x) => !store.isDiscovered(x.hid)) ? undiscLegend : '';
  const more = all.length > UP_SOON_SHOWN
    ? `<a class="more" href="#/${tab}/soon">See all ${all.length}</a>` : '';
  return `
    <section>
      <div class="row"><h2 class="sec grow">Up soon · uncaught</h2><a class="note" href="#/${tab}/soon">next ${store.state.upSoonHours}h</a></div>
      ${all.length ? `<div class="list">${upSoonRows({ ...ctx, from: tab }, shown)}</div>${legend}${more}` : `<p class="note">Nothing opens in that time. <a href="#/${tab}/soon">Look further ahead</a>.</p>`}
    </section>`;
}

const HORIZONS = [1, 2, 3, 6];

/** Every Up soon fish, with the look-ahead setting. */
export function soonView(ctx, tab) {
  const { store } = ctx;
  if (tab === 'ocean') return notFound();
  const all = upSoonList(ctx);
  const hours = store.state.upSoonHours;
  const chips = HORIZONS.map((h) =>
    `<button class="chip${hours === h ? ' on' : ''}" data-act="horizon" data-h="${h}" aria-pressed="${hours === h}">${h}h</button>`).join('');
  return `
    ${back(`#/${tab}`, 'Home')}
    <header class="stack-s"><h1>Up soon</h1>
      <div class="sub">Uncaught ${tab === 'spear' ? 'spearfishing ' : ''}fish with a window open now or within ${hours}h</div></header>
    <div class="chips" role="group" aria-label="Look ahead">${chips}</div>
    ${all.some((x) => !store.isDiscovered(x.hid)) ? undiscLegend : ''}
    ${all.length ? `<div class="list">${upSoonRows({ ...ctx, from: `${tab}/soon` }, all)}</div>` : '<p class="empty">Nothing opens in that time. Try looking further ahead.</p>'}`;
}

function searchResults(ctx) {
  const { m, store } = ctx;
  const { profile } = store.state;
  const results = m.search(ctx.query);
  if (ctx.query.trim().length < 2) return '<p class="note">Keep typing…</p>';
  if (!results.length) return '<p class="note">No fish, holes or zones match.</p>';
  const rows = results.map((r) => {
    if (r.type === 'fish') {
      const f = m.data.fish[r.id];
      const zones = [...new Set(m.fishHoles(r.id).map((h) => m.data.zones[m.data.holes[h].zone].name))];
      const caught = store.isCaught(r.id) ? ' · <span class="link">caught</span>' : '';
      const whys = m.fishHoles(r.id).map((h) => hiddenWhy(m, h, profile));
      const hidden = whys.every(Boolean) ? hiddenTag(whys[0]) : '';
      return `<a class="item row" href="#/fish/${r.id}?from=${ctx.tab}">${icon(f.icon)}<span class="grow"><span class="title">${esc(f.name)}</span>
        <span class="sub">Fish · ${esc(zones.slice(0, 2).join(', '))}${zones.length > 2 ? ` +${zones.length - 2}` : ''}${caught}${hidden}</span></span>${chevron}</a>`;
    }
    if (r.type === 'hole') {
      const h = m.data.holes[r.id];
      return `<a class="item row" href="#/hole/${r.id}"><span class="grow"><span class="title">${holeName(m, store, r.id)}</span>
        <span class="sub">Hole · ${esc(m.data.zones[h.zone].name)} · Lv ${h.lvl} · ${xyText(h)} · ${countText(m.count([r.id], store.isCaught))}${hiddenTag(hiddenWhy(m, r.id, profile))}</span></span>${chevron}</a>`;
    }
    const z = m.data.zones[r.id];
    return `<a class="item row" href="#/${r.tab}/zone/${r.id}"><span class="grow"><span class="title">${esc(z.name)}</span>
      <span class="sub">Zone · ${esc(m.data.regions[z.region].name)}${m.visibleHoles(r.tab, r.id, profile).length ? '' : hiddenTag(hiddenWhy(m, m.zoneHolesAll(r.tab, r.id)[0], profile))}</span></span>${chevron}</a>`;
  }).join('');
  return `<section><h2 class="sec">Results</h2><div class="list">${rows}</div></section>`;
}

export function profileView(ctx) {
  const { m, store, now } = ctx;
  const s = store.state;
  const p = s.profile;
  const stepper = (key, label, lo, hi) => `
    <div class="item row">
      <label class="grow" for="p-${key}">${label}</label>
      <button class="step" data-act="step" data-key="${key}" data-d="-1" aria-label="Lower ${label}">−</button>
      <input id="p-${key}" class="numin" type="number" inputmode="numeric" min="${lo}" max="${hi}"
        data-profile="${key}" value="${p[key] ?? ''}" placeholder="—">
      <button class="step" data-act="step" data-key="${key}" data-d="1" aria-label="Raise ${label}">+</button>
    </div>`;

  const expIds = Object.keys(m.data.expansions).map(Number);
  const exps = expIds.map((id) => {
    const on = !p.exp || p.exp.includes(id);
    return `<button class="chip${on ? ' on' : ''}" data-act="exp" data-exp="${id}" aria-pressed="${on}">${esc(m.data.expansions[id])}</button>`;
  }).join('');

  const sw = (act, label, on) => `
    <button class="item row switch-row" data-act="${act}" role="switch" aria-checked="${on}">
      <span class="grow">${label}</span><span class="switch${on ? ' on' : ''}" aria-hidden="true"><span></span></span>
    </button>`;

  const pending = ctx.pendingImport;
  const importPanel = pending ? `
    <div class="banner stack-s">
      <span class="hi">Backup from ${pending.exportedAt ? fmtWhen(pending.exportedAt, now) + ` (${daysAgo(pending.exportedAt, now)})` : 'an unknown date'}</span>
      <span class="sub">${pending.caught.length} caught · ${plural(pending.discovered.length, 'hole')} discovered${pending.dropped ? ` · ${pending.dropped} unknown ids skipped` : ''}</span>
      <div class="btns">
        <button class="btn primary" data-act="import-merge">Merge</button>
        <button class="btn" data-act="import-replace">Replace</button>
        <button class="btn" data-act="import-cancel">Cancel</button>
      </div>
      <span class="note">Merge adds the backup to what's on this phone. Replace makes this phone match the backup exactly.</span>
    </div>` : '';

  return `
    ${back('#/rod', 'Home')}
    <h1>Profile &amp; filters</h1>
    <section><h2 class="sec">My fisher</h2>
      <div class="list">${stepper('lvl', 'Fisher level', 1, 100)}${stepper('gath', 'Gathering', 0, 9999)}</div>
      <p class="note">Most holes can be fished at any level. A few (restricted holes) are locked until you reach their level: they're not on your map and you can't cast there, so the app greys them out until then. Fish needing more Gathering than you have are flagged at the hole and left out of Up soon. Leave blank to turn off.</p>
    </section>
    <section><h2 class="sec">Expansions unlocked</h2><div class="chips">${exps}</div></section>
    <section><h2 class="sec">Backup</h2>
      ${ctx.flash ? `<p class="note hi">${esc(ctx.flash)}</p>` : ''}
      ${importPanel}
      <div class="btns">
        <button class="btn" data-act="export">Export progress</button>
        <button class="btn" data-act="import">Import</button>
      </div>
      <p class="note">Progress lives on this device only. Last export: ${s.lastExport ? daysAgo(s.lastExport, now) : 'never'}.</p>
    </section>
    <p class="note">${store.caughtCount()} caught · data ${esc(m.data.meta.game)} · built ${esc(m.data.meta.built.slice(0, 10))} · app ${esc(ctx.appVersion ?? 'dev')}</p>
    <p class="legal">FINAL FANTASY is a registered trademark of Square Enix Holdings Co., Ltd.
      FINAL FANTASY XIV © SQUARE ENIX CO., LTD. All rights reserved. Game data and icons via XIVAPI;
      catch conditions from FFXIV Teamcraft. Fish Log is an unofficial fan project, not affiliated with
      or endorsed by Square Enix. Fonts: IBM Plex (SIL OFL 1.1).</p>`;
}

export function zoneView(ctx, tab, zid, filter = 'all') {
  const { m, store, now } = ctx;
  const { profile } = store.state;
  const zone = m.data.zones[zid];
  if (!zone) return notFound();
  const vis = m.visibleHoles(tab, zid, profile);
  const c = m.count(m.zoneHolesAll(tab, zid), store.isCaught);
  const undisc = vis.filter((h) => !store.isDiscovered(h)).length;
  const chips = [['all', 'All'], ['incomplete', 'Incomplete'], ['undiscovered', 'Undiscovered']].map(([k, l]) =>
    `<a class="chip${k === filter ? ' on' : ''}" href="#/${tab}/zone/${zid}${k === 'all' ? '' : `?f=${k}`}" aria-pressed="${k === filter}">${l}</a>`).join('');

  const cards = vis.map((hid) => {
    const h = m.data.holes[hid];
    const hc = m.count([hid], store.isCaught);
    const disc = store.isDiscovered(hid);
    if (filter === 'incomplete' && hc.caught === hc.total) return '';
    if (filter === 'undiscovered' && disc) return '';
    const grey = m.holeVisibility(hid, profile) === 'grey';
    // Only what's actionable: fish open now, or why the hole is locked.
    // The dashed border marks undiscovered holes; the count turns teal when complete.
    const tags = [];
    if (grey) {
      tags.push(`<span class="tag">Locked until Lv ${h.lvl}</span>`);
    } else {
      const open = m.holeFish(hid)
        .filter(({ fid }) => !store.isCaught(fid))
        .map(({ fid }) => [fid, m.status(fid, hid, now)])
        .filter(([, st]) => st?.state === 'open');
      for (const [fid, st] of open.slice(0, 2)) {
        tags.push(`<span class="tag open">${esc(m.data.fish[fid].name)} open · ${fmtDuration(st.end - now)}</span>`);
      }
      if (open.length > 2) tags.push(`<span class="tag open">+${open.length - 2} more open</span>`);
    }
    const done = hc.total && hc.caught === hc.total;
    return `
      <a class="card${disc ? '' : ' dashed'}${grey ? ' grey' : ''}" href="#/hole/${hid}">
        <div class="row"><span class="num lv">Lv ${h.lvl}</span><span class="title grow">${esc(h.name)}</span><span class="num${done ? ' done' : ''}">${countText(hc)}</span></div>
        ${tags.length ? `<div class="tags indent">${tags.join('')}</div>` : ''}
      </a>`;
  }).join('');

  return `
    ${back(`#/${tab}`, 'Home')}
    <header class="stack-s"><h1>${esc(zone.name)}</h1>
      <div class="row sub"><span class="grow">${plural(vis.length, 'hole')}${undisc ? ` · <span class="undisc-name">${undisc} not discovered</span>` : ''}</span><span class="num hi">${countText(c)} fish</span></div>
      ${progress(c)}</header>
    <div class="chips" role="group" aria-label="Show">${chips}</div>
    <section><h2 class="sec">Fishing holes</h2><div class="cards">${cards || '<p class="empty">No holes match.</p>'}</div>
    </section>`;
}

export function holeView(ctx, hid) {
  const { m, store, now } = ctx;
  const { profile } = store.state;
  const h = m.data.holes[hid];
  if (!h) return notFound();
  const tab = holeTab(h);
  const zone = m.data.zones[h.zone];
  const disc = store.isDiscovered(hid);
  const targets = m.moochTargets(hid);
  const w = m.weatherNow(hid, now);
  const why = hiddenWhy(m, hid, profile);

  const rows = m.holeFish(hid).map((x) => {
    const st = m.status(x.fid, hid, now);
    const caught = store.isCaught(x.fid);
    const rank = caught ? [3, 0] : st?.state === 'open' ? [0, st.end] : st?.state === 'upcoming' ? [1, st.start] : [2, 0];
    return { ...x, st, caught, rank };
  }).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);

  const row = (r) => {
    const f = m.data.fish[r.fid];
    const e = r.entry;
    const open = r.st?.state === 'open' && !r.caught;
    const cond = r.st && !r.caught
      ? `<span class="cond"><span class="hi">${esc(condText(m, e))}</span> ${statusPill(r.st, now)}</span>` : '';
    const warn = !r.caught && m.gatheringShort(e, profile)
      ? `<span class="warn">Needs Gathering ${e.minG} — you have ${profile.gath}</span>` : '';
    const feeds = targets[r.fid] ? `<span class="feeds">Mooch bait for ${targets[r.fid].map(esc).join(', ')}</span>` : '';
    return `
      <div class="fish${r.caught ? ' caught' : ''}${open ? ' open' : ''}">
        <button class="check" data-act="caught" data-fid="${r.fid}" data-hid="${hid}" aria-pressed="${r.caught}"
          aria-label="${r.caught ? 'Unmark' : 'Mark caught:'} ${esc(f.name)}">${r.caught ? checkSvg : ''}</button>
        <a class="body" href="#/fish/${r.fid}?h=${hid}">
          <span class="row">${icon(f.icon, 'icon sm')}<span class="title">${esc(f.name)}</span></span>
          ${baitLine(m, r.fid, hid, e)}${extrasLine(m, e)}${cond}${warn}${feeds}
        </a>
      </div>`;
  };
  const mainRows = rows.filter((r) => !r.extra);
  const main = mainRows.filter((r) => !r.caught).map(row).join('');
  // Caught fish fold away under one row; tap it to see (and unmark) them.
  const caughtRows = mainRows.filter((r) => r.caught);
  const caughtGroup = caughtRows.length ? `
    <button class="item region caught-group${ctx.showCaught ? ' open' : ''}" data-act="show-caught" aria-expanded="${!!ctx.showCaught}">
      <div class="row"><span class="title grow">Caught (${caughtRows.length})</span>${chevron}</div></button>
    ${ctx.showCaught ? `<div class="fishes">${caughtRows.map(row).join('')}</div>` : ''}` : '';
  const extras = rows.filter((r) => r.extra);
  const c = m.count([hid], store.isCaught);

  return `
    ${back(`#/${tab}/zone/${h.zone}`, zone.name)}
    <header class="stack-s">
      <div class="row top-align">
        <div class="grow"><h1>${esc(h.name)}</h1>
          <div class="sub">Lv ${h.lvl}${h.restricted ? ' · <span class="hi">Locked hole</span>' : ''} · <span class="num hi">${xyText(h)}</span></div>
          <div class="sub">ET <span class="num hi">${fmtEtClock(now)}</span>${w != null ? ` · <span class="hi">${esc(m.data.weathers[w]?.name)}</span>` : ''}</div></div>
        <button class="toggle${disc ? ' on' : ''}" data-act="disc" data-hid="${hid}" aria-pressed="${disc}">${disc ? 'Discovered' : 'Not discovered'}</button>
      </div>
      <div class="row"><span class="grow">${progress(c)}</span><span class="num hi">${countText(c)}</span></div>
    </header>
    ${why ? `<p class="banner">${m.isLocked(hid, profile)
      ? `Locked: you can't cast here until Fisher Lv ${h.lvl}.`
      : `Hidden while browsing: ${esc(why)}. Change it in <a class="link" href="#/profile">Profile</a>.`}</p>` : ''}
    ${main ? `<div class="fishes">${main}</div>` : ''}
    ${caughtGroup}
    ${extras.length ? `<section><h2 class="sec">Also caught here</h2><p class="note">Reported by players; not in the in-game guide for this hole.</p>
      <div class="fishes">${extras.map(row).join('')}</div></section>` : ''}`;
}

// Where a fish screen's Back goes when it was opened from Home or Up soon.
const FROM = /^(rod|spear|ocean)(\/soon)?$/;

export function fishView(ctx, fid, fromHole, from = null) {
  const { m, store, now } = ctx;
  const f = m.data.fish[fid];
  if (!f) return notFound();
  const holes = m.fishHoles(fid);
  const hid = holes.includes(fromHole) ? fromHole : holes[0];
  // Only a hole the user came from gets discovered when marking caught here.
  const discoverHid = holes.includes(fromHole) ? fromHole : '';
  const e = f.at[hid] ?? {};
  const h = m.data.holes[hid];
  const caught = store.isCaught(fid);
  const st = m.status(fid, hid, now);
  const rec = m.data.recordTypes[f.rec]?.name;
  const stars = f.stars ? ' ' + '★'.repeat(f.stars) : '';

  const facts = [];
  if (f.log === 'spear') {
    facts.push(['Shadow', SHADOW[e.size] ?? 'Unknown'], ['Speed', SPEED[e.speed] ?? 'Unknown']);
  } else if (!m.isMooch(e)) {
    facts.push(['Bait', e.bait ? m.fishName(e.bait) + (e.alts?.length ? ` (or ${e.alts.map(m.fishName).join(', ')})` : '') : 'Unknown'],
      ['Tug', e.tug ? TUG[e.tug] : 'Unknown'], ['Hookset', e.hook ? HOOK[e.hook] : 'Unknown']);
  }
  if (e.minG) facts.push(['Min. Gathering', e.minG]);
  if (e.w?.length) facts.push(['Weather', e.w.map((w) => m.data.weathers[w]?.name).join(' / ')]);
  if (e.pw?.length) facts.push(['Previous weather', e.pw.map((w) => m.data.weathers[w]?.name).join(' / ')]);
  if (e.spawn != null) facts.push(['Time', `ET ${etHM(e.spawn)}–${etHM(e.spawn + e.dur)}`]);
  if (e.pred?.length) facts.push(['Catch first', e.pred.map(([id, n]) => `${n}× ${m.fishName(id)}`).join(', ')]);
  if (e.snag) facts.push(['Snagging', 'Required']);

  let chain = '';
  if (f.log === 'rod' && m.isMooch(e)) {
    const { steps } = m.moochChain(fid, hid);
    chain = `
      <section><h2 class="sec">Mooch chain · ${esc(h.name)}</h2>
        <ol class="steps">${steps.map((s, i) => {
          const verb = s.unknown ? 'Start with' : !s.fish ? 'Cast with' : i === steps.length - 1 ? 'Catch' : 'Hook, then mooch it';
          const what = s.unknown ? 'Unknown — no data yet' : esc(m.fishName(s.id));
          const how = s.fish ? `<span class="sub"><span class="hi">${s.tug ? TUG[s.tug] : 'Tug ?'}</span> · ${s.hook ? HOOK[s.hook] : 'Hookset ?'}</span>` : '';
          return `<li><span class="dot${i === steps.length - 1 ? ' last' : ''}">${i + 1}</span>
            <span class="grow"><span class="sub">${verb}</span><span class="title">${what}</span>${how}</span></li>`;
        }).join('')}</ol>
        ${holes.length > 1 ? '<p class="note">Chains can differ per hole — this one is for the hole you came from.</p>' : ''}
      </section>`;
  }

  let windows = '';
  let banner = '';
  if (st) {
    const wins = ctx.nextWindows(fid, hid, 4) ?? [];
    windows = `<section><h2 class="sec">Next windows</h2><div class="list">${wins.map((w) => `
      <div class="item row"><span class="grow">${w.start <= now ? 'Now' : fmtWhen(w.start, now)}</span><span class="num dim">${fmtDuration(w.end - Math.max(w.start, now))}</span></div>`).join('')}</div></section>`;
    banner = st.state === 'open'
      ? `<div class="banner open"><span class="num">OPEN NOW · ${fmtDuration(st.end - now)} left</span></div>`
      : st.state === 'upcoming'
        ? `<div class="banner"><span class="num">Next window in ${fmtDuration(st.start - now)} · ${fmtWhen(st.start, now)}</span></div>` : '';
  }

  const found = holes.map((x) => {
    const hh = m.data.holes[x];
    return `<a class="item row" href="#/hole/${x}"><span class="grow">${esc(holePlace(m, x))}<span class="sub">${xyText(hh)}</span></span><span class="num dim">Lv ${hh.lvl}</span></a>`;
  }).join('');

  return `
    ${FROM.test(from ?? '') ? back(`#/${from}`, from.endsWith('/soon') ? 'Up soon' : 'Home') : back(`#/hole/${hid}`, h.name)}
    <header class="row">${icon(f.icon, 'icon lg')}
      <div class="grow"><h1>${esc(f.name)}</h1><div class="sub">Lv ${f.lvl}${stars}${rec ? ` · ${esc(rec)}` : ''}${!st ? ' · Always available' : ''}</div></div>
    </header>
    <button class="big${caught ? ' done' : ''}" data-act="caught" data-fid="${fid}" data-hid="${discoverHid}" aria-pressed="${caught}">${caught ? 'Caught — tap to undo' : 'Mark caught'}</button>
    ${banner}
    ${facts.length ? `<section><h2 class="sec">How to catch${holes.length > 1 ? ` · ${esc(h.name)}` : ''}</h2>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : ''}
    ${chain}${windows}
    <section><h2 class="sec">Found at</h2><div class="list">${found}</div></section>`;
}

export function notFound() {
  return `${back('#/rod', 'Home')}<h1>Not found</h1><p class="note">That page doesn't exist.</p>`;
}

