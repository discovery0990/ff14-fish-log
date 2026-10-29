// End-to-end smoke test in a real headless browser, driven over the Chrome
// DevTools Protocol. Not part of `deno task test` (needs a browser and a
// local server). Run:
//   python3 -m http.server 8765 -d app --bind 127.0.0.1 &
//   deno run -A tests/e2e.js [screenshot-dir]
import { launch } from './cdp.js';

const APP = Deno.env.get('APP_URL') ?? 'http://127.0.0.1:8765/';
const shotDir = Deno.args[0];
const b = await launch();
const { tmp, send, js, go, check, waitFor } = b;
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
  check(await js(`document.querySelectorAll('.fish.caught').length`) === 1, 'caught fish is styled as caught');
  check(await js(`[...document.querySelectorAll('.fish')].at(-1).classList.contains('caught')`), 'caught fish sorts last');

  // --- Home: Continue card and search keeps focus while typing
  await go('#/rod');
  check(await js(`document.querySelector('a.card[href="#/hole/r5"]') !== null`), 'Continue card points at the last hole');
  check(await js(`document.querySelector('.list .item .pill') !== null`), 'Up soon list renders with status pills');
  await js(`(() => { const i = document.getElementById('search'); i.__mark = 1; i.focus(); })()`);
  for (const ch of 'hopes') await send('Input.insertText', { text: ch });
  check(await js(`document.getElementById('search').__mark === 1`), 'search input is never replaced while typing (iOS keyboard stays up)');
  check(await js(`document.activeElement.id`) === 'search', 'search keeps focus');
  check(await js(`document.getElementById('search').value`) === 'hopes', 'search keeps every typed character');
  check(await js(`document.body.textContent.includes('Hopeseed Pond')`), 'search finds Hopeseed Pond');
  await shot('search');
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
  await js(`document.querySelector('[data-act=horizon][data-h="3"]').click()`);
  check((await stored()).upSoonHours === 3, 'Up soon horizon saves');
  await shot('profile');

  await go('#/rod');
  check(await js(`document.body.textContent.includes('hidden by your level and expansion filters')`), 'home reports hidden regions');
  check(await js(`!document.body.textContent.includes('Norvrandt')`), 'Lv 40 hides Norvrandt');
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
  await js(`document.querySelector('[data-act=horizon][data-h="2"]').click()`); // forces a re-render
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
} catch (err) {
  failures++;
  console.log(`FAIL ${err.message}`);
} finally {
  await b.close();
}

failures += b.failures();
console.log(failures ? `\n${failures} FAILED` : '\nall e2e checks passed');
Deno.exit(failures ? 1 : 0);
