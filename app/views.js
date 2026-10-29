// Screen renderers. Each returns an HTML string; app.js wires events by
// delegation on data-act attributes. All text from data goes through esc().

import { eorzeaClock } from './engine.js';
import { TABS, TAB_LABELS, holeTab } from './model.js';

// ------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const TUG = { light: 'Light !', medium: 'Medium !!', heavy: 'Heavy !!!' };
const HOOK = { powerful: 'Powerful', precision: 'Precision' };

/** "14m", "1h 52m", "2d 3h". */
export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
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
    const size = m.data.recordTypes[m.data.fish[fid].rec]?.name;
    return `<span class="sub">${size ? `${esc(size)} · ` : ''}Speed ${esc(e.speed ?? '?')}</span>`;
  }
  const tug = e.tug ? `<span class="hi">${TUG[e.tug]}</span>` : '<span class="hi">Tug ?</span>';
  const hook = e.hook ? HOOK[e.hook] : 'Hookset ?';
  if (m.isMooch(e)) {
    const chain = m.moochChain(fid, hid).steps.map((s) => (s.unknown ? '?' : esc(m.fishName(s.id))));
    chain.pop(); // the fish itself
    return `<span class="sub"><span class="tag mooch">MOOCH</span> ${chain.join(' → ')}</span>
      <span class="sub">${tug} · ${hook}</span>`;
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

  const last = store.state.last && m.data.holes[store.state.last];
  const cont = last ? `
    <section><h2 class="sec">Continue</h2>
      <a class="card row" href="#/hole/${store.state.last}">
        <div class="grow"><div class="title">${esc(last.name)}</div>
          <div class="sub">${esc(m.data.zones[last.zone].name)} · Lv ${last.lvl} ·
            ${countText(m.count([store.state.last], store.isCaught))} caught</div></div>${chevron}
      </a></section>` : '';

  const regions = m.visibleRegions(tab, profile);
  const allRegions = Object.keys(m.data.regions).filter((r) => m.regionHolesAll(tab, r).length);
  const hidden = allRegions.length - regions.length;
  const regionRows = regions
    .map((r) => [r, m.count(m.regionHolesAll(tab, r), store.isCaught)])
    .map(([r, c]) => `
      <a class="item" href="#/${tab}/region/${r}">
        <div class="row"><span class="title grow">${esc(m.data.regions[r].name)}</span><span class="num">${countText(c)}</span></div>
        ${progress(c, 'thin')}
      </a>`).join('');

  return `
    <header class="top">
      <div class="grow"><h1>Fish Log</h1><div class="sub">${prof} · ET <span class="num">${fmtEtClock(now)}</span></div></div>
      <a class="iconbtn" href="#/profile" aria-label="Profile and filters">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
      </a>
    </header>
    <div class="stack-s">
      <div class="row sub"><span class="grow">Overall</span><span class="num hi">${store.caughtCount()} / ${total.toLocaleString()}</span></div>
      ${progress({ caught: store.caughtCount(), total })}
    </div>
    <nav class="tabs" role="tablist" aria-label="Fishing type">${tabs}</nav>
    ${cont}
    <section><h2 class="sec">Regions</h2>
      <div class="list">${regionRows || '<p class="empty">Nothing matches your filters.</p>'}</div>
      ${hidden ? `<p class="note">${hidden} region${hidden > 1 ? 's' : ''} hidden by your level and expansion filters.</p>` : ''}
    </section>`;
}

const countText = ({ caught, total }) => `${caught} / ${total}`;

export function regionView(ctx, tab, rid) {
  const { m, store, now } = ctx;
  const { profile } = store.state;
  const region = m.data.regions[rid];
  if (!region) return notFound();
  const zones = m.visibleZones(tab, rid, profile);
  const all = m.count(m.regionHolesAll(tab, rid), store.isCaught);
  const holeCount = zones.reduce((n, z) => n + m.visibleHoles(tab, z, profile).length, 0);
  const cards = zones.map((z) => {
    const hids = m.zoneHolesAll(tab, z);
    const vis = m.visibleHoles(tab, z, profile);
    const c = m.count(hids, store.isCaught);
    const lv = vis.map((h) => m.data.holes[h].lvl);
    const lvText = Math.min(...lv) === Math.max(...lv) ? `Lv ${lv[0]}` : `Lv ${Math.min(...lv)}–${Math.max(...lv)}`;
    return `
      <a class="card" href="#/${tab}/zone/${z}">
        <div class="row"><span class="title grow">${esc(m.data.zones[z].name)}</span><span class="num">${countText(c)}</span></div>
        ${progress(c, 'thin')}
        <div class="tags"><span class="sub">${vis.length} hole${vis.length > 1 ? 's' : ''} · ${lvText}</span>${areaTags(ctx, vis, c)}</div>
      </a>`;
  }).join('');
  return `
    ${back(`#/${tab}`, 'Home')}
    <header class="stack-s"><h1>${esc(region.name)}</h1>
      <div class="row sub"><span class="grow">${zones.length} zones · ${holeCount} holes</span><span class="num hi">${countText(all)} fish</span></div>
      ${progress(all)}</header>
    <section><h2 class="sec">Zones</h2><div class="cards">${cards}</div></section>`;
}

function areaTags(ctx, hids, c) {
  const { m, store, now } = ctx;
  if (c.total && c.caught === c.total) return '<span class="tag done">Complete</span>';
  let open = 0;
  for (const hid of hids) {
    for (const { fid } of m.holeFish(hid)) {
      if (!store.isCaught(fid) && m.status(fid, hid, now)?.state === 'open') open++;
    }
  }
  const undisc = hids.filter((h) => !store.isDiscovered(h)).length;
  return (open ? `<span class="tag open">${open} open now</span>` : '') +
    (undisc ? `<span class="tag undisc">${undisc} undiscovered</span>` : '');
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
    const tags = [];
    if (hc.caught === hc.total) tags.push('<span class="tag done">Complete</span>');
    let timed = 0;
    for (const { fid } of m.holeFish(hid)) {
      if (store.isCaught(fid)) continue;
      const st = m.status(fid, hid, now);
      if (st?.state === 'open') tags.push(`<span class="tag open">${esc(m.data.fish[fid].name)} open · ${fmtDuration(st.end - now)}</span>`);
      else if (st) timed++;
    }
    if (timed) tags.push(`<span class="tag">${timed} timed</span>`);
    if (!disc) tags.push('<span class="tag undisc">Not discovered</span>');
    if (grey) tags.push('<span class="tag">Above your level</span>');
    return `
      <a class="card${disc ? '' : ' dashed'}${grey ? ' grey' : ''}" href="#/hole/${hid}">
        <div class="row"><span class="num lv">Lv ${h.lvl}</span><span class="title grow">${esc(h.name)}</span><span class="num">${countText(hc)}</span></div>
        ${tags.length ? `<div class="tags indent">${tags.join('')}</div>` : ''}
      </a>`;
  }).join('');

  return `
    ${back(`#/${tab}/region/${zone.region}`, m.data.regions[zone.region].name)}
    <header class="stack-s"><h1>${esc(zone.name)}</h1>
      <div class="row sub"><span class="grow">${vis.length} holes${undisc ? ` · ${undisc} undiscovered` : ''}</span><span class="num hi">${countText(c)} fish</span></div>
      ${progress(c)}</header>
    <div class="chips" role="group" aria-label="Show">${chips}</div>
    <section><h2 class="sec">Fishing holes</h2><div class="cards">${cards || '<p class="empty">No holes match.</p>'}</div></section>`;
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
  const main = rows.filter((r) => !r.extra).map(row).join('');
  const extras = rows.filter((r) => r.extra);
  const c = m.count([hid], store.isCaught);

  return `
    ${back(`#/${tab}/zone/${h.zone}`, zone.name)}
    <header class="stack-s">
      <div class="row top-align">
        <div class="grow"><h1>${esc(h.name)}</h1>
          <div class="sub">Lv ${h.lvl} · ET <span class="num hi">${fmtEtClock(now)}</span>${w != null ? ` · <span class="hi">${esc(m.data.weathers[w]?.name)}</span>` : ''}</div></div>
        <button class="toggle${disc ? ' on' : ''}" data-act="disc" data-hid="${hid}" aria-pressed="${disc}">${disc ? 'Discovered' : 'Not discovered'}</button>
      </div>
      <div class="row sub"><span class="grow">Tap the circle to mark caught</span><span class="num hi">${countText(c)}</span></div>
      ${progress(c)}
    </header>
    <div class="fishes">${main}</div>
    ${extras.length ? `<section><h2 class="sec">Also caught here</h2><p class="note">Reported by players; not in the in-game guide for this hole.</p>
      <div class="fishes">${extras.map(row).join('')}</div></section>` : ''}
    <p class="note center">Marking a fish caught also marks the hole discovered.</p>`;
}

export function fishView(ctx, fid, fromHole) {
  const { m, store, now } = ctx;
  const f = m.data.fish[fid];
  if (!f) return notFound();
  const holes = m.fishHoles(fid);
  const hid = holes.includes(fromHole) ? fromHole : holes[0];
  const e = f.at[hid] ?? {};
  const h = m.data.holes[hid];
  const caught = store.isCaught(fid);
  const st = m.status(fid, hid, now);
  const rec = m.data.recordTypes[f.rec]?.name;
  const stars = f.stars ? ' ' + '★'.repeat(f.stars) : '';

  const facts = [];
  if (f.log === 'spear') {
    facts.push(['Size', rec ?? '?'], ['Speed', e.speed ?? '?']);
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
    return `<a class="item row" href="#/hole/${x}"><span class="grow">${esc(hh.name)} · ${esc(m.data.zones[hh.zone].name)}</span><span class="num dim">Lv ${hh.lvl}</span></a>`;
  }).join('');

  return `
    ${back(`#/hole/${hid}`, h.name)}
    <header class="row">${icon(f.icon, 'icon lg')}
      <div class="grow"><h1>${esc(f.name)}</h1><div class="sub">Lv ${f.lvl}${stars}${rec ? ` · ${esc(rec)}` : ''}${!st ? ' · Always available' : ''}</div></div>
    </header>
    <button class="big${caught ? ' done' : ''}" data-act="caught" data-fid="${fid}" data-hid="${hid}" aria-pressed="${caught}">${caught ? 'Caught — tap to undo' : 'Mark caught'}</button>
    ${banner}
    ${facts.length ? `<section><h2 class="sec">How to catch${holes.length > 1 ? ` · ${esc(h.name)}` : ''}</h2>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : ''}
    ${chain}${windows}
    <section><h2 class="sec">Found at</h2><div class="list">${found}</div></section>`;
}

export function notFound() {
  return `${back('#/rod', 'Home')}<h1>Not found</h1><p class="note">That page doesn't exist.</p>`;
}

export function placeholderView(title) {
  return `${back('#/rod', 'Home')}<h1>${esc(title)}</h1><p class="note">Coming in the next part of milestone 3.</p>`;
}
