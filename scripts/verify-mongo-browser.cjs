const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Real signed-in UI smoke check, exclusively against the disposable runtime fixture. */
module.exports = async function verifyMongoBrowser({ origin, email, password, facilityId, doctorId }) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.ok(email.endsWith('@example.test'));
  const profile = await mkdtemp(join(tmpdir(), 'thanarah-mongo-browser-'));
  let browser;
  let socket;
  const pending = new Map();
  let sequence = 0;
  try {
    browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    let launchError;
    browser.on('error', error => { launchError = error; });
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
      if (port) break;
      await delay(100);
    }
    assert.ok(port, 'Disposable browser must start');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = pages.find(item => item.type === 'page');
    assert.ok(page);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Browser connection timed out')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Browser connection failed')); }, { once: true });
    });
    socket.addEventListener('message', event => {
      const response = JSON.parse(String(event.data));
      const operation = pending.get(response.id);
      if (!operation) return;
      pending.delete(response.id);
      clearTimeout(operation.timer);
      if (response.error) operation.reject(new Error(response.error.message));
      else operation.resolve(response.result);
    });
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser ${method} timed out`)); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('Browser evaluation failed in synthetic fixture');
      return result.result.value;
    }
    async function waitFor(expression, label) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return;
        await delay(150);
      }
      throw new Error(`${label}: ${await evaluate('document.body.innerText.slice(0, 700)')}`);
    }
    await send('Page.navigate', { url: `${origin}/appointments/` });
    await waitFor("!!document.querySelector('#signin-form')", 'Sign-in form did not load');
    await evaluate(`document.querySelector('#email').value=${JSON.stringify(email)};
      document.querySelector('#password').value=${JSON.stringify(password)};
      document.querySelector('#signin-form').requestSubmit(); true`);
    await waitFor(`!!document.querySelector('#filter-facility option[value="${facilityId}"]') &&
      !!document.querySelector('#filter-doctor option[value="${doctorId}"]')`, 'Signed-in appointment workspace did not load MongoDB catalogs');
    assert.equal(await evaluate("!!document.querySelector('#signin-form')"), false);
    console.log('MONGO_BROWSER_WORKSPACE_PASSED');
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    if (socket) socket.close();
    if (browser?.pid) {
      try { process.kill(-browser.pid, 'SIGTERM'); } catch {}
      await delay(500);
      try { process.kill(-browser.pid, 'SIGKILL'); } catch {}
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
