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
  servicePromo: Renderer;
  header: Renderer;
  footer: Renderer;
  packageCard: (code: string, catalog: unknown, compact: boolean) => string;
  referencePackages: (catalog: unknown) => string;
}
function renderers(language: 'ar' | 'en', blockedStorage = false): SiteRenderers {
  const source = readFileSync('public/site/app.js', 'utf8');
  const boot = /\s+render\(\);\s*\}\)\(\);\s*$/u;
  if (!boot.test(source))
    throw new Error('Public website bootstrap changed; update renderer harness.');
  const context = {
    window: {
      addEventListener: (): void => {},
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
  runInNewContext(readFileSync('public/site/reference-home.js', 'utf8'), context);
  runInNewContext(
    source.replace(
      boot,
      `
    var reference = window.ThanarahReferenceHome(locale,t,{escape:esc});
    globalThis.siteRenderers={
      home:reference.home,header:reference.header,footer:reference.footer,
      referencePackages:reference.packages,about,packagesPage,services,why,contact,packageCard,
      servicePromo:servicePromoMarkup
    };
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
      for (const route of routes)
        expect(route === '/why-thanarah/' ? site.footer() : site.header()).toContain(
          `href="${route}"`,
        );
      expect(site.header()).toContain('href="/#clinic"');
      expect(site.header()).toContain('href="/customer/"');
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
        expect(html).toMatch(/<main id="main"(?:\s[^>]*)?>/u);
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('mailto:');
      }
      expect(site.contact()).toContain('name="consent"');
      expect(site.contact()).toContain('name="website"');
      expect(site.footer()).toContain('/customer/');
    },
  );
  it.each(['ar', 'en'] as const)(
    'introduces published customer capabilities and account actions in %s',
    (language) => {
      const translations = {
        window: {
          ThanarahSiteContent: {} as Record<'ar' | 'en', Record<string, string>>,
        },
      };
      runInNewContext(readFileSync('public/site/content.js', 'utf8'), translations);
      const copy = translations.window.ThanarahSiteContent[language];
      const promo = renderers(language).servicePromo();
      for (const key of [
        'promoEyebrow',
        'promoTitle',
        'promoBody',
        'promoCapabilities',
        'promoAvailable',
        'promoAccountNote',
        'promoExplore',
        'promoRegister',
        'promoLogin',
      ]) {
        expect(promo, `${language}: ${key}`).toContain(copy[key]);
      }
      for (const key of ['capabilityPatients', 'capabilityAppointments', 'capabilityEncounters']) {
        expect(promo, `${language}: ${key}`).toContain(copy[key]);
      }
      expect(promo).toContain('data-thanarah-auth="register"');
      expect(promo).toContain('data-thanarah-auth="login"');
      expect(promo).toContain('href="/services/"');
      expect(promo).not.toContain('ر.س');
      expect(promo).not.toContain('SAR');
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
        language === 'ar' ? 'الرئيس التنفيذي للتقنية، CTO' : 'Chief Technology Officer, CTO',
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
        ordersOpen: true,
        termsText: 'هذه مسودة تجريبية غير نهائية.',
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
    expect(html).toContain('Demo price — not final');
    expect(html).toContain('50 SAR');
    expect(html).toContain('/customer/?package=Lite');
    expect(html).not.toContain('5000');
  });
  it('keeps a usable Arabic default when browser storage is unavailable', () => {
    expect(renderers('en', true).header()).toContain('الرئيسية');
  });
  it.each(['ar', 'en'] as const)(
    'explains the real clinical foundation without presenting future connections as live in %s',
    (language) => {
      const site = renderers(language);
      for (const html of [site.services()]) {
        expect(html).toContain('Thanarah AI');
        expect(html).toContain('Thanarah Calling');
        expect(html).not.toContain('data-motion-scene');
        expect(html).not.toContain('data-motion-toggle');
        expect(html).toContain('<figcaption>');
        expect(html).toContain(language === 'ar' ? 'غير متاحة' : 'unavailable');
        expect(html).toContain(language === 'ar' ? 'مفاهيمي' : 'Conceptual');
      }
      expect(site.home()).toContain(language === 'ar' ? 'ثنارة كلينك' : 'Thanarah Clinic');
      expect(site.home()).toContain(language === 'ar' ? 'قيد التطوير' : 'In development');
      expect(site.home()).toContain(language === 'ar' ? 'غير متاح حاليًا' : 'Not available yet');
      expect(site.home()).not.toContain('aria-live="assertive"');
    },
  );
  it.each(['ar', 'en'] as const)(
    'uses the supplied design scenes without claiming an actual office or live interface in %s',
    (language) => {
      const html = renderers(language).home();
      expect(html).toContain('/assets/thanarah-reception.webp');
      expect(html).toContain('/assets/thanarah-devices.webp');
      expect(html).toContain('fetchpriority="high"');
      expect(html).toContain('width="1400" height="946"');
      expect(html).toContain('decoding="async"');
      expect(html).toContain(
        language === 'ar' ? 'مشهد تصوري لاستقبال ثنارة' : 'Conceptual Thanarah reception scene',
      );
      expect(html).toContain(
        language === 'ar' ? 'لا يعرض واجهة تشغيل فعلية' : 'not a live product interface',
      );
      expect(existsSync('public/assets/thanarah-reception.webp')).toBe(true);
      expect(existsSync('public/assets/thanarah-devices.webp')).toBe(true);
    },
  );
  it('retains the original bilingual positioning, safeguards, workflow and FAQs after redesign', () => {
    const translations = {
      window: {
        ThanarahSiteContent: {} as Record<'ar' | 'en', Record<string, string>>,
      },
    };
    runInNewContext(readFileSync('public/site/content.js', 'utf8'), translations);
    for (const language of ['ar', 'en'] as const) {
      const site = renderers(language);
      const home = (site.home() + site.footer()).replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&');
      const copy = translations.window.ThanarahSiteContent[language];
      for (const key of [
        'homeTitle',
        'homeIntro',
        'positionTitle',
        'positionBody',
        'clinicalNote',
        'step1Body',
        'step2Body',
        'step3Body',
        'step4Body',
        'benefit1Body',
        'benefit2Body',
        'benefit3Body',
        'benefit4Body',
        'securityBody',
        'securityNote',
        'faq1Body',
        'faq2Body',
        'faq3Body',
        'faq4Body',
        'faq5Body',
      ]) {
        expect(home, `${language}: preserved ${key}`).toContain(copy[key].replace(/<[^>]*>/gu, ''));
      }
    }
  });
  it('loads the reference renderer only for the homepage and its welcome alias, in dependency order', () => {
    for (const path of ['public/index.html', 'public/welcome/index.html']) {
      const html = readFileSync(path, 'utf8');
      expect(html.indexOf('/site/content.js')).toBeLessThan(
        html.indexOf('/site/reference-home.js'),
      );
      expect(html.indexOf('/site/reference-home.js')).toBeLessThan(html.indexOf('/site/app.js'));
      expect(html).toContain('/site/reference-home.css');
      expect(html).toContain('/site/service-promo.css');
    }
    expect(readFileSync('public/site/index.html', 'utf8')).toContain('/site/service-promo.css');
    for (const route of routes.slice(1)) {
      expect(readFileSync(`public${route}index.html`, 'utf8')).not.toContain(
        '/site/reference-home.',
      );
    }
  });
  it('keeps a single package update target inside the reference grid, outside the section heading', () => {
    const html = renderers('ar').home();
    expect(html.match(/id="home-packages"/gu)).toHaveLength(1);
    expect(html).toContain('class="rh-package-grid" id="home-packages"');
    expect(html.indexOf('rh-packages-inner')).toBeLessThan(html.indexOf('id="home-packages"'));
    const sections = [
      'rh-hero',
      'rh-benefit-bar',
      'rh-clinic',
      'rh-solutions',
      'rh-packages',
      'rh-why',
      'rh-cta',
    ];
    for (let i = 1; i < sections.length; i += 1) {
      expect(html.indexOf(`class="${sections[i - 1]}`)).toBeLessThan(
        html.indexOf(`class="${sections[i]}`),
      );
    }
  });
  it('uses only published package details in the new reference cards and escapes catalog text', () => {
    const html = renderers('en').referencePackages({
      termsText: 'هذه مسودة تجريبية غير نهائية.',
      packages: [
        {
          code: 'Lite',
          published: true,
          description: '<img onerror=alert(1)>',
          features: ['<script>bad</script>'],
          priceMinor: '5000',
        },
        { code: 'Pro', published: false, description: 'UNPUBLISHED_SCOPE', priceMinor: '999900' },
      ],
    });
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('UNPUBLISHED_SCOPE');
    expect(html).toContain('Demo price — not final');
    expect(html).toContain('50 SAR');
    expect(html).not.toContain('999900');
    for (const code of ['Lite', 'Pro', 'Customize']) {
      expect(html).toContain(`/contact/?package=${code}`);
    }
  });
  it('routes published home packages to customer ordering only when order intake is open', () => {
    const html = renderers('en').referencePackages({
      ordersOpen: true,
      packages: [
        { code: 'Lite', published: true, description: 'Approved demo', features: [], priceMinor: '29900' },
      ],
    });
    expect(html).toContain('/customer/?package=Lite');
    expect(html).toContain('/customer/?package=Customize');
    expect(html).not.toContain('/contact/?package=Lite');
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
