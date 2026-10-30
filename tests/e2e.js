// End-to-end smoke test in a real headless browser, driven over the Chrome
// DevTools Protocol. Not part of `deno task test` (needs a browser and a
// local server). Run:
//   python3 -m http.server 8765 -d app --bind 127.0.0.1 &
//   deno run -A tests/e2e.js [screenshot-dir]
import { launch } from './cdp.js';

const APP = Deno.env.get('APP_URL') ?? 'http://127.0.0.1:8765/';
const shotDir = Deno.args[0];
const b = await launch();
const { tmp, send, js, go, check, waitFor, sleep } = b;
const shot = (name) => b.shot(shotDir, name);
let failures = 0;
const stored = () => js(`JSON.parse(localStorage.getItem('fishlog:v1') || 'null')`);

try {
  await send('Page.navigate', { url: APP });
  await waitFor(() => js(`!!document.querySelector('.tabs')`), 'app load');
  check(true, 'app loads');

  // --- Hole: mark caught, discovery follows
  await go('#/hole/r5');
  // Tap a fish with no window: which fish sorts first depends on the time.
  await js(`document.querySelector('.check[aria-label$="Mudcrab"]').click()`);
  let s = await stored();
  check(s.caught.length === 1, 'tapping the circle marks a fish caught');
  check(s.discovered.includes('r5'), 'marking caught discovers the hole');
  check(await js(`document.querySelector('.toggle').textContent.trim()`) === 'Discovered', 'discovered toggle shows Discovered');
  check(await js(`!document.querySelector('.fish.caught') && document.querySelector('[data-act=show-caught]')?.textContent.includes('Caught (1)')`), 'caught fish fold into a Caught (1) row');
  await js(`document.querySelector('[data-act=show-caught]').click()`);
  check(await js(`document.querySelectorAll('.fish.caught').length`) === 1, 'tapping Caught shows the caught fish, styled as caught');
  check(await js(`[...document.querySelectorAll('.fish')].at(-1).classList.contains('caught')`), 'caught fish sit below the rest');
  check(await js(`document.body.textContent.includes('Honey Worm · ! · Precision')`), 'tug shows as ! marks with dot separators');
  check(await js(`[...document.querySelectorAll('.fish')].some((f) => f.textContent.includes('Midge Basket → Ala Mhigan Fighting Fish · !! · Powerful') && !f.textContent.includes('MOOCH'))`), 'mooch chain (no tag), tug and hookset share one line');

  // --- Home: search keeps focus while typing
  await go('#/rod');
  check(await js(`!document.body.textContent.includes('Continue')`), 'no Continue section on Home');
  check(await js(`document.querySelector('.list .item .pill') !== null`), 'Up soon list renders with status pills');
  await js(`(() => { const i = document.getElementById('search'); i.__mark = 1; i.focus(); })()`);
  for (const ch of 'hopes') await send('Input.insertText', { text: ch });
  check(await js(`document.getElementById('search').__mark === 1`), 'search input is never replaced while typing (iOS keyboard stays up)');
  check(await js(`document.activeElement.id`) === 'search', 'search keeps focus');
  check(await js(`document.getElementById('search').value`) === 'hopes', 'search keeps every typed character');
  check(await js(`document.body.textContent.includes('Hopeseed Pond')`), 'search finds Hopeseed Pond');
  await shot('search');
  check(await js(`!document.querySelector('[data-act="clear-search"]').hidden`), 'clear button appears while there is a query');
  await js(`document.querySelector('[data-act="clear-search"]').click()`);
  check(await js(`document.getElementById('search').value === '' && document.getElementById('search').__mark === 1`), 'clear button empties search in one tap, same input');
  check(await js(`document.querySelector('[data-act="clear-search"]').hidden && !!document.querySelector('#home-body .sec')`), 'after clearing: button hides, home sections return');
  await js(`(() => { const i = document.getElementById('search'); i.value = 'hopes'; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  await new Promise((r) => setTimeout(r, 150));
  check(await js(`document.getElementById('search').value`) === '', 'Escape clears search');

  // --- Catching from a search result must not discover any hole
  const discBefore = (await stored()).discovered.length;
  await js(`(() => { const i = document.getElementById('search'); i.value = 'junkmonger'; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  await js(`document.querySelector('#home-body a[href^="#/fish/"]').click()`);
  await new Promise((r) => setTimeout(r, 250));
  await js(`document.querySelector('button.big').click()`);
  s = await stored();
  check(s.caught.includes('7684'), 'Mark caught works from a search result');
  check(s.discovered.length === discBefore, 'catching from search does not discover a hole');
  await js(`document.querySelector('button.big').click()`); // undo
  // The query is kept when coming back (handy after opening a result); clear it.
  await go('#/rod');
  check(await js(`document.getElementById('search').value`) === 'junkmonger', 'search query is kept when coming back');
  await js(`(() => { const i = document.getElementById('search'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);

  // --- Profile: level filter, stepper, gathering, expansions
  await go('#/profile');
  await js(`(() => { const i = document.getElementById('p-lvl'); i.value = '40'; i.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  check((await stored()).profile.lvl === 40, 'typing a level saves it');
  await js(`document.querySelector('[data-act=step][data-key=lvl][data-d="1"]').click()`);
  check((await stored()).profile.lvl === 41, '+ steps the level by 1');
  await js(`(() => { const i = document.getElementById('p-gath'); i.value = '340'; i.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await js(`document.querySelector('[data-act=step][data-key=gath][data-d="-1"]').click()`);
  check((await stored()).profile.gath === 339, 'Gathering saves and steps by 1');
  await js(`(() => { const i = document.getElementById('p-lvl'); i.value = '999'; i.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  check((await stored()).profile.lvl === 100, 'level is clamped to 100');
  await js(`(() => { const i = document.getElementById('p-lvl'); i.value = '40'; i.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  await js(`document.querySelector('[data-act=exp][data-exp="5"]').click()`);
  check(JSON.stringify((await stored()).profile.exp) === '[0,1,2,3,4]', 'toggling Dawntrail off saves the expansion list');
  await shot('profile');

  // --- Up soon: Home shows 5; its own screen shows all and sets the horizon
  await go('#/rod');
  check(await js(`document.querySelector('.list').querySelectorAll('.item').length`) === 5, 'Home shows 5 Up soon fish');
  check(await js(`document.querySelector('a.more')?.getAttribute('href')`) === '#/rod/soon', 'See all opens the Up soon screen');
  await go('#/rod/soon');
  check(await js(`document.querySelectorAll('.list .item').length > 5`), 'Up soon screen lists more than 5');
  check(await js(`document.querySelector('.back')?.getAttribute('href')`) === '#/rod', 'Up soon screen goes back Home in one tap');
  await js(`document.querySelector('[data-act=horizon][data-h="3"]').click()`);
  check((await stored()).upSoonHours === 3, 'Up soon horizon saves');
  check(await js(`document.querySelector('[data-act=horizon][data-h="3"]').classList.contains('on')`), 'horizon chip shows as selected');
  await js(`document.querySelector('[data-act=soon-holes][data-f=disc]').click()`);
  check((await stored()).upSoonHoles === 'disc', 'Up soon hole filter saves');
  check(await js(`!document.querySelector('.list .undisc-name')`), 'Discovered filter shows no undiscovered holes');
  await js(`document.querySelector('[data-act=soon-holes][data-f=undisc]').click()`);
  check(await js(`[...document.querySelectorAll('.list .item')].every((i) => i.querySelector('.undisc-name'))`), 'Undiscovered filter shows only undiscovered holes');
  await js(`document.querySelector('[data-act=soon-holes][data-f=all]').click()`);
  await shot('soon');

  await go('#/rod');
  check(await js(`document.body.textContent.includes('hidden by your level and expansion filters')`), 'home reports hidden regions');
  check(await js(`!document.body.textContent.includes('Yok Tural')`), 'Dawntrail off hides its regions');
  check(await js(`document.body.textContent.includes('Norvrandt')`), 'Lv 40 still shows higher regions (most holes are fishable at any level)');
  // --- Up soon rows open the fish; Back returns to where you came from
  const soonHref = await js(`document.querySelector('.list .item').getAttribute('href')`);
  check(/^#\/fish\/\d+\?h=r\d+&from=rod$/.test(soonHref), `Home Up soon row opens the fish (${soonHref})`);
  await go(soonHref);
  check(await js(`document.querySelector('.back').getAttribute('href')`) === '#/rod', 'fish from Home: Back goes Home');
  await go('#/rod/soon');
  const soonHref2 = await js(`document.querySelector('.list .item').getAttribute('href')`);
  await js(`window.scrollTo(0, 600)`);
  await go(soonHref2);
  check(await js(`document.querySelector('.back').getAttribute('href') === '#/rod/soon' && document.querySelector('.back').textContent.includes('Up soon')`), 'fish from the Up soon screen: Back goes to Up soon');
  await js(`history.back()`);
  await sleep(300);
  check(await js(`Math.abs(window.scrollY - 600) < 5`), 'Up soon restores its scroll position after Back');
  await go('#/fish/4911'); // Rock Lobster: 4 holes, none discovered
  check(await js(`document.querySelectorAll('.list .item .undisc-name').length === 4 && !!document.querySelector('.legend')`), 'Found at outlines undiscovered holes, with the legend');
  await go('#/fish/4950'); // Mudcrab, caught at Hopeseed Pond (discovered)
  check(await js(`![...document.querySelectorAll('.list .item')].find((i) => i.getAttribute('href') === '#/hole/r5').querySelector('.undisc-name')`), 'Found at leaves discovered holes plain');
  await go('#/fish/4950?h=r5&from=javascript:alert(1)');
  check(await js(`document.querySelector('.back').getAttribute('href')`) === '#/hole/r5', 'unknown from falls back to the hole');
  await go('#/rod');

  // --- Returning to the app redraws at once (no stale times until the next tick)
  await js(`document.querySelector('.top').__mark = 1`);
  await js(`document.dispatchEvent(new Event('visibilitychange'))`);
  check(await js(`!document.querySelector('.top').__mark`), 'becoming visible redraws immediately');

  // --- Undiscovered holes: dashed hole names with a legend
  check(await js(`[...document.querySelectorAll('.list .item .undisc-name')].length > 0 && !!document.querySelector('.legend .undisc-name')`), 'Up soon outlines undiscovered hole names and explains the outline');
  await js(`(() => { const i = document.getElementById('search'); i.value = 'costa del sol'; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  check(await js(`!!document.querySelector('#home-body .title .undisc-name')`), 'search outlines an undiscovered hole');
  await js(`document.querySelector('[data-act="clear-search"]').click()`);

  // --- Regions and zones expand in place; Back from a hole returns with them open
  // Earlier steps visited Hopeseed Pond (zone 54, region 23): Home shows it open.
  check(await js(`document.querySelector('[data-zid="54"]')?.getAttribute('aria-expanded') === 'true'`), 'Home opens the zone of the last hole visited');
  await js(`document.querySelector('[data-act=region][data-rid="23"]').click()`);
  check(await js(`!document.querySelector('.item.zone')`), 'tapping an open region collapses it');
  await js(`document.querySelector('[data-act=region][data-rid="22"]').click()`);
  check(await js(`!!document.querySelector('[data-act=zone][data-zid="32"]')`), 'tapping La Noscea lists its zones on Home');
  await js(`window.scrollTo(0, 300)`);
  await js(`document.querySelector('[data-act=zone][data-zid="32"]').click()`);
  check(await js(`Math.abs(window.scrollY - 300) < 5`), 'opening a zone keeps the scroll position (no jump)');
  check(await js(`[...document.querySelectorAll('a.item.hole')].some((a) => a.getAttribute('href') === '#/hole/r156')`), 'tapping Eastern La Noscea lists its holes on Home');
  // Open a zone below the open one: the tapped row stays put as the other collapses.
  const z2 = await js(`(() => { const z = document.querySelector('[data-act=zone][data-zid="32"]'); let n = z.nextElementSibling; while (n && !n.matches('[data-act=zone]')) n = n.nextElementSibling; return n.dataset.zid; })()`);
  await js(`document.querySelector('[data-zid="32"]').scrollIntoView({ block: 'start' })`);
  const before = await js(`document.querySelector('[data-zid="${z2}"]').getBoundingClientRect().top`);
  await js(`document.querySelector('[data-zid="${z2}"]').click()`);
  check(await js(`Math.abs(document.querySelector('[data-zid="${z2}"]').getBoundingClientRect().top - ${before}) < 2`), 'the tapped zone stays where it was while the one above collapses');
  await js(`document.querySelector('[data-act=zone][data-zid="32"]').click()`);
  const y = await js(`window.scrollY`);
  await go('#/hole/r156');
  check(await js(`document.querySelector('.back').getAttribute('href')`) === '#/rod', 'hole Back goes to Home');
  await js(`history.back()`);
  await sleep(300);
  check(await js(`document.querySelector('[data-zid="32"]')?.getAttribute('aria-expanded')`) === 'true', 'Home keeps the zone open after Back');
  check(await js(`Math.abs(window.scrollY - ${y}) < 5`), 'Home restores its scroll position after Back');
  await go('#/rod/zone/54');
  check(await js(`location.hash === '#/rod' && document.querySelector('[data-zid="54"]')?.getAttribute('aria-expanded') === 'true' && document.querySelector('[data-rid="23"]')?.getAttribute('aria-expanded') === 'true'`), 'zone links (search, old links) open Home with that zone expanded');
  check(await js(`Math.abs(document.querySelector('[data-zid="54"]').getBoundingClientRect().top) < 5`), 'a zone link scrolls to the zone');
  await go('#/rod/region/23');
  check(await js(`location.hash === '#/rod' && document.querySelector('[data-rid="23"]')?.getAttribute('aria-expanded') === 'true'`), 'old region links open Home with that region expanded');
  await shot('regions');
  await js(`document.querySelector('[data-act=region][data-rid="23"]').click()`);
  check(await js(`!document.querySelector('.item.zone')`), 'tapping an open region collapses it');

  // --- Redraws keep loaded icons (no flash when tapping the accordion)
  await waitFor(() => js(`[...document.querySelectorAll('.list .item img')].every((i) => i.complete)`), 'Up soon icons');
  await js(`document.querySelector('.list .item img').__mark = 1`);
  await js(`document.querySelector('[data-act=region]').click()`);
  check(await js(`document.querySelector('.list .item img').__mark === 1`), 'tapping a region keeps the Up soon icon elements');
  await js(`document.querySelector('[data-act=region]').click()`);

  // Red Mantis Falls (r58) is a restricted Lv 45 hole: locked at Lv 40.
  await js(`(() => { const i = document.getElementById('search'); i.value = 'red mantis falls'; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  check(await js(`document.getElementById('home-body').textContent.includes('Locked until Lv 45')`), 'search labels locked holes');
  await js(`document.querySelector('[data-act="clear-search"]').click()`);
  await go('#/hole/r58');
  check(await js(`document.body.textContent.includes("can't cast here until Fisher Lv 45")`), 'locked hole explains why');
  // North Isle of Endless Summer (r156) is Lv 50 but not restricted.
  await go('#/hole/r156');
  check(await js(`!document.querySelector('.banner')`), 'an above-level, unrestricted hole has no lock note');
  check(await js(`document.body.textContent.includes('X 36.0 Y 26.6')`), 'hole shows map coordinates');
  await go('#/rod/zone/32'); // Eastern La Noscea, expanded on Home
  const holeRow = (n) => `[...document.querySelectorAll('a.item.hole')].find((c) => c.textContent.includes('${n}'))`;
  check(await js(`!!${holeRow('North Isle of Endless Summer')}`), 'unmarked hole is listed in its zone');
  check(await js(`${holeRow('Privateer Sterncastle')}?.classList.contains('grey')`), 'Lv 40: restricted Sterncastle is greyed');
  check(await js(`!${holeRow('Privateer Forecastle')}?.classList.contains('grey')`), 'Lv 40: Forecastle is not greyed');
  check(await js(`document.querySelectorAll('a.item.hole.grey').length === 2 && document.body.textContent.includes('Locked until Lv 45')`), 'locked holes stay listed, greyed (Red Mantis Falls, Privateer Sterncastle)');
  await js(`document.querySelector('[data-act=region][data-rid="22"]').click()`); // collapse
  check(await js(`document.body.textContent.includes('next 3h')`), 'Up soon uses the new horizon');
  await shot('home');

  // --- Hole: gathering warning appears with Gathering 339
  await go('#/hole/r5');
  check(await js(`document.body.textContent.includes('Needs Gathering 345 — you have 339')`), 'gathering warning shows at the hole');

  // --- Export (download path in headless) and import (merge + replace)
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp, eventsEnabled: true });
  await go('#/profile');
  await js(`document.querySelector('[data-act=export]').click()`);
  const file = await waitFor(async () => {
    for await (const e of Deno.readDir(tmp)) if (e.name.startsWith('fishlog-') && e.name.endsWith('.json')) return `${tmp}/${e.name}`;
  }, 'export download');
  const backup = JSON.parse(await Deno.readTextFile(file));
  check(backup.app === 'fishlog' && backup.caught.length === 1, `export writes ${file.split('/').pop()}`);
  check((await stored()).lastExport != null, 'export records the last export time');

  await go('#/hole/r5');
  // Each tap re-renders the list, so look the next button up again.
  for (let i = 0; i < 2; i++) await js(`document.querySelector('.check[aria-pressed="false"]').click()`);
  check((await stored()).caught.length === 3, 'caught two more fish (3 total)');

  await go('#/profile');
  await js(`document.getElementById('import-file').__mark = 1`);
  for (let i = 0; i < 2; i++) await js(`document.querySelector('[data-act=exp][data-exp="5"]').click()`); // forces re-renders
  check(await js(`document.getElementById('import-file').__mark === 1`), 'file input survives re-renders (iOS Files picker)');
  check(await js(`!document.getElementById('app').contains(document.getElementById('import-file'))`), 'file input lives outside #app');
  const doc = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await waitFor(() => js(`!!document.querySelector('[data-act=import-merge]')`), 'import summary');
  check(await js(`document.body.textContent.includes('1 caught')`), 'import shows a summary before applying');
  await shot('import');
  await js(`document.querySelector('[data-act=import-merge]').click()`);
  check((await stored()).caught.length === 3, 'merge keeps newer catches (3)');

  const doc2 = await send('DOM.getDocument');
  const n2 = await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId: n2.nodeId, files: [file] });
  await waitFor(() => js(`!!document.querySelector('[data-act=import-replace]')`), 'import summary (2)');
  await js(`document.querySelector('[data-act=import-replace]').click()`);
  check((await stored()).caught.length === 1, 'replace restores the backup exactly (1)');

  await Deno.writeTextFile(`${tmp}/bad.json`, '{"hello": 1}');
  const doc3 = await send('DOM.getDocument');
  const n3 = await send('DOM.querySelector', { nodeId: doc3.root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId: n3.nodeId, files: [`${tmp}/bad.json`] });
  await waitFor(() => js(`document.body.textContent.includes("isn't a Fish Log backup")`), 'bad-file error');
  check(true, 'a non-backup file is rejected with a message');

  // --- Reload keeps progress
  await send('Page.reload');
  await waitFor(() => js(`!!document.querySelector('h1')`), 'reload');
  check((await stored()).caught.length === 1 && (await stored()).profile.lvl === 40, 'progress and profile survive a reload');

  // --- Completed regions, zones and holes fold away (Mor Dhona: region 26, zone 67)
  await js(`fetch('data/fish.json').then((r) => r.json()).then((d) => {
    const st = JSON.parse(localStorage.getItem('fishlog:v1'));
    const holes = Object.values(d.holes).filter((h) => h.zone === 67);
    st.caught = [...new Set([...st.caught, ...holes.flatMap((h) => [...h.fish, ...h.extra]).map(String)])];
    localStorage.setItem('fishlog:v1', JSON.stringify(st));
  })`);
  await go('#/rod');
  await send('Page.reload');
  await waitFor(() => js(`!!document.querySelector('.tabs')`), 'reload after catching Mor Dhona');
  check(await js(`!document.querySelector('[data-rid="26"]') && document.querySelector('[data-act=fold][data-key="regions:rod"]')?.textContent.includes('Completed regions (1)')`), 'a completed region folds into Completed regions (1)');
  await js(`document.querySelector('[data-act=fold][data-key="regions:rod"]').click()`);
  check(await js(`!!document.querySelector('[data-rid="26"]')`), 'tapping Completed regions shows them');
  await js(`document.querySelector('[data-rid="26"]').click()`);
  check(await js(`document.querySelector('[data-act=fold][data-key="zones:rod:26"]')?.textContent.includes('Completed zones (1)')`), 'completed zones fold inside an open region');
  await js(`document.querySelector('[data-act=fold][data-key="zones:rod:26"]').click()`);
  await js(`document.querySelector('[data-act=zone][data-zid="67"]').click()`);
  check(await js(`!document.querySelector('a.item.hole') && /Completed holes \\(\\d+\\)/.test(document.querySelector('[data-act=fold][data-key="holes:rod:67"]')?.textContent ?? '')`), 'completed holes fold inside an open zone');
  await shot('folds');
} catch (err) {
  failures++;
  console.log(`FAIL ${err.message}`);
} finally {
  await b.close();
}

failures += b.failures();
console.log(failures ? `\n${failures} FAILED` : '\nall e2e checks passed');
Deno.exit(failures ? 1 : 0);
