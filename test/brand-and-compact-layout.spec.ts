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
  it.each(entries().filter((path) => path.endsWith('/index.html')))(
    'covers favicon and shared shell on %s',
    (path) => {
      const html = readFileSync(path, 'utf8');
      expect(html).toContain('rel="icon"');
      expect(html).toContain('/assets/thanarah-shell.js');
    },
  );
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
});
