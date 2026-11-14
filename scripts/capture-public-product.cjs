/**
 * Capture the actual patient-registration renderer offline, with blank fields.
 * No credentials, API requests, patient records, or database are involved.
 * This is a UI preview, not evidence of a signed-in clinical journey.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

async function main() {
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'generated-artifacts', 'product-capture');
  fs.mkdirSync(out, { recursive: true });
  const fileUrl = (relative) => pathToFileURL(path.join(root, 'public', relative)).href;
  const source = fs.readFileSync(path.join(root, 'public/patients/app.js'), 'utf8')
    .replaceAll('/assets/logo-transparent.png', fileUrl('assets/logo-transparent.png'));
  const original = fs.readFileSync(path.join(root, 'public/patients/index.html'), 'utf8');
  const clean = original
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '')
    .replace(/href="\/([^"]+)"/gu, (_, relative) => `href="${fileUrl(relative)}"`);
  const shim = `
    window.fetch = function () { return Promise.reject(new Error('Offline capture: network disabled')); };
    window.ThanarahApi = {
      restoreSession: async function () { return true; },
      listWorkspaces: async function () { return { items: [{
        tenantId: 'offline-ui-preview', displayName: 'معاينة الواجهة',
        permissionCodes: ['tenant.patients.read', 'tenant.patients.manage']
      }] }; },
      listPatients: async function () { return { items: [], total: 0 }; }
    };
  `;
  const openForm = `
    var attempts = 0;
    var timer = setInterval(function () {
      var button = document.querySelector('[data-action="new-patient"]');
      if (button) { clearInterval(timer); button.click(); }
      else if (++attempts > 50) clearInterval(timer);
    }, 40);
  `;
  const html = clean.replace('</body>', `<script>${shim}</script><script>${source}</script><script>${openForm}</script></body>`);
  const entry = path.join(out, 'patient-interface.html');
  fs.writeFileSync(entry, html);
  const profile = fs.mkdtempSync(path.join(out, 'chromium-'));
  const args = [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--window-size=1440,1080',
    '--virtual-time-budget=6000',
    `--screenshot=${path.join(out, 'clinic-interface.png')}`,
    pathToFileURL(entry).href,
  ];
  const browser = spawn('chromium', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  browser.stderr.on('data', (chunk) => { stderr += chunk; });
  let timeout;
  try {
    const code = await new Promise((resolve, reject) => {
      browser.once('error', reject);
      browser.once('exit', resolve);
      timeout = setTimeout(() => reject(new Error('Offline capture timed out')), 30000);
    });
    if (code !== 0) throw new Error(`Chromium exited ${code}: ${stderr.slice(-1200)}`);
    console.log('Captured actual blank patient registration UI; no API or database accessed.');
  } finally {
    clearTimeout(timeout);
    if (browser.pid) {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        try { process.kill(-browser.pid, signal); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
