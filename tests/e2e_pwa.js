// PWA end-to-end test against the built site: service worker install,
// offline use, and the update prompt after a new deploy. Run:
//   python3 tools/build_site.py
//   python3 -m http.server 8766 -d dist --bind 127.0.0.1 &
//   deno run -A tests/e2e_pwa.js
import { launch } from './cdp.js';

const APP = Deno.env.get('APP_URL') ?? 'http://127.0.0.1:8766/';
const DIST_SW = new URL('../dist/sw.js', import.meta.url);
const b = await launch({ port: 9334 });
const { send, js, go, check, waitFor, sleep } = b;
let failures = 0;
const originalSw = await Deno.readTextFile(DIST_SW);

try {
  await send('Network.enable');
  await send('Page.navigate', { url: APP });
  await waitFor(() => js(`!!document.querySelector('.tabs')`), 'app load');
  await js(`localStorage.setItem('fishlog:sw', '1')`); // SW is off on localhost by default
  await send('Page.reload');
  await waitFor(() => js(`!!navigator.serviceWorker.controller`), 'service worker control', 30000);
  check(true, 'service worker installs and controls the page');

  const keys = await js(`caches.keys()`);
  check(keys.some((k) => k.startsWith('shell-')), `shell cache created (${keys.join(', ')})`);
  const cached = await js(`caches.open(${JSON.stringify(keys.find((k) => k.startsWith('shell-')))}).then((c) => c.keys()).then((r) => r.map((x) => new URL(x.url).pathname))`);
  check(cached.some((p) => p.endsWith('/data/fish.json')), 'fish data is precached');
  check(cached.some((p) => p.endsWith('.woff2')), 'fonts are precached');

  const manifest = await js(`fetch('manifest.webmanifest').then((r) => r.json())`);
  check(manifest.start_url === './' && manifest.scope === './', 'manifest uses relative start_url and scope');
  for (const icon of manifest.icons) {
    check(await js(`fetch(${JSON.stringify(icon.src)}).then((r) => r.ok)`), `manifest icon ${icon.src} exists`);
  }

  // View a hole online so its fish icons get cached, then go offline.
  await go('#/hole/r5');
  await sleep(500);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.reload');
  await waitFor(() => js(`!!document.querySelector('.fish')`), 'offline reload', 15000);
  check(true, 'app reloads offline on a deep link (#/hole/r5)');
  check(await js(`document.querySelectorAll('.fish').length`) === 8, 'offline: Hopeseed Pond lists its 8 fish');
  check(await js(`[...document.images].filter((i) => i.closest('.fish')).every((i) => i.complete && i.naturalWidth > 0)`), 'offline: icons seen earlier still show');
  check(await js(`document.fonts.check('16px "IBM Plex Sans"')`), 'offline: IBM Plex Sans is available');
  await go('#/rod');
  check(await js(`document.querySelectorAll('.list .item').length > 5`), 'offline: home renders');
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // Simulate a new deploy: a new VERSION in sw.js.
  await Deno.writeTextFile(DIST_SW, originalSw.replace(/const VERSION = "[^"]+"/, 'const VERSION = "e2e-next"'));
  await js(`navigator.serviceWorker.getRegistration().then((r) => r.update())`);
  await waitFor(() => js(`!document.getElementById('toast').hidden`), 'update toast', 20000);
  check(await js(`document.getElementById('toast').textContent.includes('new version')`), 'a new deploy shows the update prompt');
  await js(`document.querySelector('#toast button').click()`);
  await waitFor(async () => (await js(`caches.keys()`)).includes('shell-e2e-next'), 'new cache', 20000);
  await sleep(1000);
  await waitFor(() => js(`!!document.querySelector('.tabs') && !!navigator.serviceWorker.controller`), 'reload after update');
  const after = await js(`caches.keys()`);
  check(after.includes('shell-e2e-next') && after.filter((k) => k.startsWith('shell-')).length === 1, 'reload switches to the new version and drops the old cache');
} catch (err) {
  failures++;
  console.log(`FAIL ${err.message}`);
} finally {
  await Deno.writeTextFile(DIST_SW, originalSw);
  await b.close();
}

failures += b.failures();
console.log(failures ? `\n${failures} FAILED` : '\nall PWA checks passed');
Deno.exit(failures ? 1 : 0);
