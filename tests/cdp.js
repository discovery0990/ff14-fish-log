// Minimal Chrome DevTools Protocol driver for the e2e tests.
// BROWSER defaults to Brave's flatpak; set it to a chromium binary otherwise.
// Temp files live in /tmp so a sandboxed browser can see them.

export async function launch({ port = 9333, width = 390, height = 1200 } = {}) {
  const tmp = await Deno.makeTempDir({ dir: '/tmp', prefix: 'fishlog-e2e-' });
  const browserCmd = (Deno.env.get('BROWSER') ?? 'flatpak run com.brave.Browser').split(' ');
  const proc = new Deno.Command(browserCmd[0], {
    args: [...browserCmd.slice(1), '--headless=new', '--disable-gpu', '--hide-scrollbars',
      `--remote-debugging-port=${port}`, `--user-data-dir=${tmp}/profile`, `--window-size=${width},${height}`, 'about:blank'],
    stdout: 'null', stderr: 'null',
  }).spawn();

  let failures = 0;
  const check = (cond, msg) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
    if (!cond) failures++;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, what, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = await fn();
        if (v) return v;
      } catch { /* retry */ }
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  const target = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
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
    await sleep(250);
  };
  const shot = async (dir, name) => {
    if (!dir) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await Deno.writeFile(`${dir}/${name}.png`, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });

  async function close() {
    ws.close();
    try { proc.kill(); } catch { /* already gone */ }
    // Stop only this run's browser (matched by its temp profile dir), never
    // one the user has open. No leading "--" or pkill parses it as an option.
    const stop = (sig) => new Deno.Command('pkill', { args: [sig, '-f', `user-data-dir=${tmp}/profile`], stdout: 'null', stderr: 'null' }).output().catch(() => {});
    await stop('-TERM');
    await sleep(1000);
    await stop('-KILL');
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }

  return { tmp, send, js, go, shot, check, sleep, waitFor, close, failures: () => failures };
}
