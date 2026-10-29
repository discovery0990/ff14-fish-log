// End-to-end smoke test in a real headless browser, driven over the Chrome
// DevTools Protocol. Not part of `deno task test` (needs a browser and a
// local server). Run:
//   python3 -m http.server 8765 -d app --bind 127.0.0.1 &
//   deno run -A tests/e2e.js [screenshot-dir]
//
// BROWSER defaults to Brave's flatpak; set BROWSER to a chromium binary to
// use something else. Temp files live in /tmp so a sandboxed browser can see them.

const APP = Deno.env.get('APP_URL') ?? 'http://127.0.0.1:8765/';
const PORT = 9333;
const shotDir = Deno.args[0];
const tmp = await Deno.makeTempDir({ dir: '/tmp', prefix: 'fishlog-e2e-' });
const browserCmd = (Deno.env.get('BROWSER') ?? 'flatpak run com.brave.Browser').split(' ');

const proc = new Deno.Command(browserCmd[0], {
  args: [...browserCmd.slice(1), '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${tmp}/profile`, '--window-size=390,1200', 'about:blank'],
  stdout: 'null', stderr: 'null',
}).spawn();

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const target = await waitFor(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return (await r.json()).find((t) => t.type === 'page');
}, 'browser');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
  return r.result.value;
};
const go = async (hash) => {
  await js(`location.hash = ${JSON.stringify(hash)}`);
  await new Promise((r) => setTimeout(r, 250));
};
const shot = async (name) => {
  if (!shotDir) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await Deno.writeFile(`${shotDir}/${name}.png`, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
};
const stored = () => js(`JSON.parse(localStorage.getItem('fishlog:v1') || 'null')`);

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1200, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: APP });
  await waitFor(() => js(`!!document.querySelector('.tabs')`), 'app load');
  check(true, 'app loads');

  // --- Hole: mark caught, discovery follows
  await go('#/hole/r5');
  await js(`document.querySelector('.check').click()`);
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
  await js(`document.getElementById('search').focus()`);
  for (const ch of 'hopes') await send('Input.insertText', { text: ch });
  check(await js(`document.activeElement.id`) === 'search', 'search keeps focus across re-renders');
  check(await js(`document.getElementById('search').value`) === 'hopes', 'search keeps every typed character');
  check(await js(`document.body.textContent.includes('Hopeseed Pond')`), 'search finds Hopeseed Pond');
  await shot('search');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  await new Promise((r) => setTimeout(r, 150));
  check(await js(`document.getElementById('search').value`) === '', 'Escape clears search');

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
  ws.close();
  try { proc.kill(); } catch { /* already gone */ }
  // Stop only this run's browser (matched by its temp profile dir), never a
  // browser the user has open.
  // (No leading "--" in the pattern, or pkill parses it as an option.)
  // Polite stop first; the sandbox wrapper and main process may need SIGKILL.
  const stop = (sig) => new Deno.Command('pkill', { args: [sig, '-f', `user-data-dir=${tmp}/profile`], stdout: 'null', stderr: 'null' }).output().catch(() => {});
  await stop('-TERM');
  await new Promise((r) => setTimeout(r, 1000));
  await stop('-KILL');
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
}

console.log(failures ? `\n${failures} FAILED` : '\nall e2e checks passed');
Deno.exit(failures ? 1 : 0);
