import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function entries(directory = 'public'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? entries(path) : [path];
  });
}

const shell = readFileSync('public/assets/thanarah-shell.js', 'utf8');
const homeCss = readFileSync('public/site/reference-home.css', 'utf8');
const siteCss = readFileSync('public/site/site.css', 'utf8');
const shellCss = readFileSync('public/assets/thanarah-shell.css', 'utf8');
const i18n = readFileSync('public/assets/thanarah-i18n.js', 'utf8');

describe('Supplied Thanarah symbol and desktop-like compact layouts', () => {
  it('uses the same supplied mark for all existing image aliases', () => {
    const png = readFileSync('public/assets/logo-mark.png');
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    // Indexed PNG transparency must survive serialization, not just conversion.
    expect(png.includes(Buffer.from('tRNS'))).toBe(true);
    expect(readFileSync('public/assets/logo-transparent.png').equals(png)).toBe(true);
    expect(readFileSync('public/assets/logo-full.png').equals(png)).toBe(true);
    const svg = readFileSync('public/assets/logo-mark.svg', 'utf8');
    expect(svg).toContain(`data:image/png;base64,${png.toString('base64')}`);
    expect(svg).not.toContain('<rect');
  });
  it.each([16, 32, 180, 192, 512])('provides a correctly sized %i pixel brand icon', (size) => {
    const png = readFileSync(`public/assets/thanarah-icon-${size}.png`);
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  });
  it('provides multi-size browser and Apple fallback icons', () => {
    const ico = readFileSync('public/favicon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(4);
    expect(
      readFileSync('public/apple-touch-icon.png').equals(
        readFileSync('public/assets/thanarah-icon-180.png'),
      ),
    ).toBe(true);
    expect(shell).toContain('apple-touch-icon');
    expect(shell).toContain("link.type = 'image/png'");
    expect(shell).toContain('?v=owner-symbol');
  });
  it.each(
    entries().filter(
      (path) =>
        path.endsWith('/index.html') &&
        readFileSync(path, 'utf8').includes('/assets/thanarah-shell.js'),
    ),
  )(
    'covers favicon and shared shell on %s',
    (path) => {
      const html = readFileSync(path, 'utf8');
      expect(html).toContain('rel="icon"');
      expect(html).toContain('/assets/thanarah-shell.js');
    },
  );
  it('keeps the customer journey route on the shared authentication modal', () => {
    const html = readFileSync('public/welcome/index.html', 'utf8');
    expect(html).toContain('/assets/thanarah-auth.js');
    expect(html).toContain('/welcome/app.js');
  });
  it('removes the extra team-login entry without removing protected-route login', () => {
    expect(shell).not.toMatch(/دخول الفريق|Team access|Team sign in|thanarah-shell-nav-staff/u);
    expect(shell).toContain('data-auth-audience="staff"');
    expect(shell).toContain('data-thanarah-auth="login"');
  });
  it('preserves the supplied colors instead of inverting the brand in old sidebars', () => {
    expect(shellCss).toMatch(/img\[src\*="\/assets\/logo-"\][^{]*\{[^}]*filter: none !important/u);
    const launcher = readFileSync('public/platform/index.html', 'utf8');
    expect(launcher).not.toContain('canvas.toDataURL');
    expect(launcher).not.toContain('<rect x="37"');
    expect(launcher).toContain('src="/assets/logo-mark.svg"');
  });
  it('keeps the hero and device image alongside text, in the desktop order', () => {
    expect(homeCss).toContain('flex-direction: row;');
    expect(homeCss).toMatch(/\.rh-clinic-image\s*\{[^}]*order: 0;/u);
    expect(homeCss).toContain('grid-template-columns: minmax(0, .88fr) minmax(0, 1.12fr)');
    expect(homeCss).toContain('margin: 0;');
  });
  it('keeps service, solution, package and benefit row counts on compact screens', () => {
    expect(siteCss).toMatch(/\.service-list\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/u);
    expect(homeCss).toMatch(/\.rh-solution-grid\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/u);
    expect(homeCss).toMatch(/\.rh-package-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/u);
    expect(homeCss).toMatch(/\.rh-benefit-bar\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/u);
  });
  it('differentiates account and method controls without removing accessible fields', () => {
    const auth = readFileSync('public/assets/thanarah-auth.js', 'utf8');
    const css = readFileSync('public/assets/thanarah-auth.css', 'utf8');
    expect(auth).toContain('ta-account-tabs');
    expect(auth).toContain('ta-method-tabs');
    expect(auth).toContain('role="group"');
    expect(css).toContain('font-size: 16px');
    expect(auth).toContain("dialog.querySelector('input') ||");
  });
  it('uses a beige shared frame and navigation that reflects each workspace', () => {
    expect(shellCss).toContain('--thanarah-frame-graphite: #e7ddcf;');
    expect(shellCss).toMatch(/\.thanarah-shell-header\s*\{[^}]*background: var\(--thanarah-frame-cream\)/u);
    expect(shellCss).not.toContain('background: #2d2f27');
    expect(shellCss).not.toContain('--thanarah-frame-graphite: #121c1a');
    expect(homeCss).toContain('.reference-home-header { position: relative; z-index: 20; color: #292c25;');
    expect(homeCss).toContain('.reference-home-footer { padding: 20px max(6vw,38px) 12px; color: #292c25;');
    expect(homeCss).not.toContain('background: #2d2f27');
    expect(homeCss).not.toContain('background: #121c1a');
    expect(shell).toContain("var customerPage = path === '/customer';");
    expect(shell).toContain("if (isStaffRoute)");
    expect(shell).toContain("['/company/', ar ? 'عمليات الشركة' : 'Company operations', 'company']");
    expect(shell).toContain("'/customer-admin': ['مكتب خدمة العيادات', 'Clinic service desk']");
    expect(shell).toContain('brandContext.textContent = pageName(ar);');
    expect(shell).toContain('thanarah-shell-footer-workspace');
    expect(shell).toContain('thanarah-shell-footer-customer');
  });
  it('names the protected workspace in the shared sign-in dialog', () => {
    const auth = readFileSync('public/assets/thanarah-auth.js', 'utf8');
    const css = readFileSync('public/assets/thanarah-auth.css', 'utf8');
    expect(auth).toContain("document.querySelector('.thanarah-shell-brand small')");
    expect(auth).toContain('Sign in to ');
    expect(css).toContain('rgb(77 68 54 / 20%)');
  });
  it('keeps an accessible language menu at the top of the shared shell', () => {
    expect(shell).toContain('thanarah-shell-language-wrap');
    expect(shell).toContain('data-locale-choice="ar"');
    expect(shell).toContain('data-locale-choice="en"');
    expect(shell).toContain('aria-expanded="false"');
    expect(shellCss).toContain('.thanarah-shell-language-menu[hidden]');
    expect(shellCss).toContain('.thanarah-shell-language-wrap { grid-column: 2; grid-row: 1; }');
    expect(i18n).toContain("button.classList.contains('thanarah-shell-language')");
  });
});
