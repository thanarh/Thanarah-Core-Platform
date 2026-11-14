import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function publicFiles(directory = 'public'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? publicFiles(path) : [path];
  });
}

const files = publicFiles();
const pages = files.filter((path) => path.endsWith('/index.html'));
const styles = files.filter((path) => path.endsWith('.css'));
const shared = readFileSync('public/assets/thanarah-web-experience.css', 'utf8');

describe('Lightweight interface across public pages and internal workspaces', () => {
  it.each(pages)('loads the shared Arabic and low-motion rules: %s', (path) => {
    const html = readFileSync(path, 'utf8');
    expect(html.match(/href=["']\/assets\/thanarah-web-experience\.css["']/gu)).toHaveLength(1);
  });

  it.each(styles)('does not block rendering on remote font stylesheets: %s', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(/@import[^;]*fonts\.(googleapis|gstatic)/u);
  });

  it('has no remaining external font stylesheet or preconnect in any page', () => {
    for (const path of pages) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/fonts\.(googleapis|gstatic)\.com/u);
    }
  });

  it('ships licensed local Arabic regular and bold fonts with immediate fallback', () => {
    for (const weight of ['regular', 'bold']) {
      const path = `public/assets/tajawal-${weight}.ttf`;
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path).readUInt32BE(0)).toBe(0x00010000);
      expect(shared).toContain(`/assets/tajawal-${weight}.ttf`);
    }
    expect(readFileSync('public/assets/Tajawal-OFL.txt', 'utf8')).toContain('OPEN FONT LICENSE');
    expect(shared).toContain('font-display: swap');
  });

  it('resets tracking on Arabic descendants, not just headings', () => {
    expect(shared).toMatch(/html:lang\(ar\) body \*\s*\{[^}]*letter-spacing: normal !important/u);
    expect(shared).toMatch(/html:lang\(ar\) body \*\s*\{[^}]*word-spacing: normal !important/u);
    expect(shared).toContain('font-variant-ligatures: normal');
  });

  it('removes decorative effects while retaining explicit keyboard focus', () => {
    for (const property of [
      'box-shadow: none !important',
      'text-shadow: none !important',
      'backdrop-filter: none !important',
      'animation: none !important',
      'transition: none !important',
      'scroll-behavior: auto !important',
    ]) {
      expect(shared).toContain(property);
    }
    expect(shared).toContain(':focus-visible');
    expect(shared).toContain('outline: 2px solid');
    expect(shared).toMatch(/:focus-visible\s*\{[^}]*outline: 2px solid[^}]*!important/u);
  });

  it('does not install scroll animation or reveal observers for the public website', () => {
    const source = readFileSync('public/site/app.js', 'utf8');
    expect(source).not.toContain('requestAnimationFrame');
    expect(source).not.toContain('IntersectionObserver');
    expect(source).not.toContain('data-motion-toggle');
    expect(source).not.toContain('bindMotion');
  });

  it('keeps light page introductions readable and removes empty decorative columns', () => {
    expect(shared).toMatch(/\.page-intro h1,[^{]*\{[^}]*color: #292c25 !important/u);
    expect(shared).toMatch(/\.page-intro p,[^{]*\{[^}]*color: #555e52 !important/u);
    expect(shared).toMatch(/\.prose-grid,\s*\.statement\s*\{[^}]*grid-template-columns: minmax/u);
  });

  it('keeps clinical availability warnings and removes marketing em dashes', () => {
    for (const path of [
      'public/site/content.js',
      'public/site/app.js',
      'public/site/reference-home.js',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('\u2014');
      expect(source).not.toMatch(/unleash|sparkle|[✨🚀🎉🌟💡💫🔥]/iu);
    }
    const source = readFileSync('public/site/reference-home.js', 'utf8');
    expect(source).toContain('غير متاح حاليًا');
    expect(source).toContain('قيد التطوير');
    expect(source).toContain('Not available yet');
    expect(source).toContain('لا ترسل بيانات مرضى');
    expect(source).not.toContain('rh-facade');
  });
});
