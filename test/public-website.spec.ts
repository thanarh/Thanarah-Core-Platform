import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const routes = ['/', '/about/', '/packages/', '/services/', '/why-thanarah/', '/contact/'];
type Renderer = () => string;
interface SiteRenderers {
  home: Renderer;
  about: Renderer;
  packagesPage: Renderer;
  services: Renderer;
  why: Renderer;
  contact: Renderer;
  header: Renderer;
  footer: Renderer;
  packageCard: (code: string, catalog: unknown, compact: boolean) => string;
}
function renderers(language: 'ar' | 'en', blockedStorage = false): SiteRenderers {
  const source = readFileSync('public/site/app.js', 'utf8');
  const boot = /\s+render\(\);\s*\}\)\(\);\s*$/u;
  if (!boot.test(source))
    throw new Error('Public website bootstrap changed; update renderer harness.');
  const context = {
    window: {
      localStorage: {
        getItem: (): string => {
          if (blockedStorage) throw new Error('Storage disabled');
          return language;
        },
      },
    },
    document: {
      title: 'Thanarah',
      getElementById: (): object => ({}),
      documentElement: { classList: { add: (): void => {} } },
    },
    location: { pathname: '/', search: '' },
    URLSearchParams,
    siteRenderers: undefined as unknown as SiteRenderers,
  };
  runInNewContext(readFileSync('public/site/content.js', 'utf8'), context);
  runInNewContext(
    source.replace(
      boot,
      `
    globalThis.siteRenderers={home,about,packagesPage,services,why,contact,header,footer,packageCard};
  })();`,
    ),
    context,
  );
  return context.siteRenderers;
}

describe('Public website route and reusable component regressions', () => {
  it.each(routes)(
    'serves an independent semantic entry with metadata and a no-JS fallback: %s',
    (route) => {
      const source = readFileSync(`public${route}index.html`, 'utf8');
      expect(source).toContain('lang="ar"');
      expect(source).toContain('dir="rtl"');
      expect(source).toContain('name="description"');
      expect(source).toContain('property="og:title"');
      expect(source).toContain('<noscript>');
      expect(source.indexOf('/site/content.js')).toBeLessThan(source.indexOf('/site/app.js'));
      expect(source).not.toContain('mailto:');
    },
  );
  it.each(['ar', 'en'] as const)(
    'renders complete navigation and page headings in %s',
    (language) => {
      const site = renderers(language);
      for (const route of routes) expect(site.header()).toContain(`href="${route}"`);
      for (const page of [
        site.home,
        site.about,
        site.packagesPage,
        site.services,
        site.why,
        site.contact,
      ]) {
        const html = page();
        expect(html.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
        expect(html).toContain('<main id="main">');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('mailto:');
      }
      expect(site.contact()).toContain('name="consent"');
      expect(site.contact()).toContain('name="website"');
      expect(site.footer()).toContain('/customer/');
    },
  );
  it('shows the supplied founder identity and photograph on About in both languages', () => {
    for (const language of ['ar', 'en'] as const) {
      const html = renderers(language).about();
      expect(html).toContain('Faisal alenizi');
      expect(html).toContain('/assets/faisal-alenizi.jpg');
      expect(html.replace(/&amp;/gu, '&')).toContain(
        language === 'ar' ? 'المؤسس والرئيس التنفيذي' : 'Founder & CEO',
      );
      expect(html).toContain('id="founder"');
    }
    expect(existsSync('public/assets/faisal-alenizi.jpg')).toBe(true);
  });
  it('adds the supplied partner without replacing the founder in either language', () => {
    for (const language of ['ar', 'en'] as const) {
      const html = renderers(language).about();
      expect(html).toContain('Ziad alkhathlan');
      expect(html).toContain('/assets/ziad-alkhathlan.jpg');
      expect(html).toContain(language === 'ar' ? 'شريك' : 'Partner');
      expect(html).toContain('id="partner"');
      expect(html).toContain('Faisal alenizi');
    }
    expect(existsSync('public/assets/ziad-alkhathlan.jpg')).toBe(true);
  });
  it('shows the supplied CTO and portrait while retaining the founder and partner', () => {
    for (const language of ['ar', 'en'] as const) {
      const html = renderers(language).about();
      expect(html).toContain('Youssef Darwish');
      expect(html).toContain('/assets/youssef-darwish.jpg');
      expect(html).toContain(
        language === 'ar' ? 'الرئيس التنفيذي للتقنية — CTO' : 'Chief Technology Officer — CTO',
      );
      expect(html).toContain('id="cto"');
      expect(html).toContain('Faisal alenizi');
      expect(html).toContain('Ziad alkhathlan');
    }
    expect(existsSync('public/assets/youssef-darwish.jpg')).toBe(true);
  });
  it('renders quote-based packages without inventing unpublished features or currency', () => {
    const site = renderers('ar');
    const html = site.packageCard(
      'Pro',
      {
        packages: [
          { code: 'Pro', published: false, features: ['Unapproved feature'], priceMinor: '999900' },
        ],
      },
      false,
    );
    expect(html).not.toContain('Unapproved feature');
    expect(html).not.toContain('999900');
    expect(html).not.toContain('SAR');
    expect(html).toContain('/contact/?package=Pro');
  });
  it('uses published catalog content but escapes it as text, not executable markup', () => {
    const html = renderers('en').packageCard(
      'Lite',
      {
        packages: [
          {
            code: 'Lite',
            published: true,
            description: 'Approved scope',
            features: ['<script>alert(1)</script>'],
            priceMinor: '5000',
          },
        ],
      },
      false,
    );
    expect(html).toContain('Approved scope');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('5000');
  });
  it('keeps a usable Arabic default when browser storage is unavailable', () => {
    expect(renderers('en', true).header()).toContain('الرئيسية');
  });
  it('retains the original platform workspaces alongside the new public entry', () => {
    for (const path of [
      'platform',
      'appointments',
      'clinic-setup',
      'platform-setup',
      'platform-saas',
      'customer',
      'customer-admin',
      'website-inquiries',
    ]) {
      expect(existsSync(`public/${path}/index.html`)).toBe(true);
    }
    const launcher = readFileSync('public/platform/index.html', 'utf8');
    expect(launcher).toContain('/appointments/');
    expect(launcher).toContain('/website-inquiries/');
    expect(readFileSync('public/welcome/index.html', 'utf8')).toContain('/site/app.js');
  });
  it('provides mobile layout, keyboard focus and reduced-motion overrides without a UI framework', () => {
    const css = readFileSync('public/site/site.css', 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)/u);
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
  });
});
