(function () {
  'use strict';
  document.documentElement.classList.add('js-enabled');
  var localeKey = 'thanarah.public-locale';
  var locale = 'ar';
  try {
    locale = window.localStorage.getItem(localeKey) === 'en' ? 'en' : 'ar';
  } catch (_) {
    locale = 'ar';
  }
  var lang = window.ThanarahSiteContent;
  var t = lang[locale];
  var contactState = {
    draft: null,
    payload: null,
    uncertain: false,
    busy: false,
    reference: '',
    status: '',
  };
  var path = location.pathname.replace(/\/+$/, '') || '/';
  var route =
    path === '/' || path === '/welcome' || path === '/site'
      ? 'home'
      : path.split('/').filter(Boolean).pop();
  var isReferenceHomePath = path === '/' || path === '/welcome';
  var app = document.getElementById('app');
  var catalogCache = null;
  var queryPackage = new URLSearchParams(location.search).get('package');
  var serviceKey = new URLSearchParams(location.search).get('service');
  var originalTitle = document.title;
  function routeTitle() {
    var names = {
      home: locale === 'ar' ? 'بنية رقمية للرعاية الصحية' : 'Digital infrastructure for care',
      about: t.navAbout,
      packages: t.navPackages,
      services: t.navServices,
      'why-thanarah': t.navWhy,
      contact: t.navContact,
    };
    return names[route]
      ? route === 'home'
        ? t.brand + ' | ' + names[route]
        : names[route] + ' | ' + t.brand
      : originalTitle;
  }
  function updateMetadata(title, description, canonicalPath) {
    document.title = title;
    var desc = document.querySelector('meta[name="description"]');
    var ogTitle = document.querySelector('meta[property="og:title"]');
    var ogDescription = document.querySelector('meta[property="og:description"]');
    var canonical = document.querySelector('link[rel="canonical"]');
    if (desc) desc.content = description;
    if (ogTitle) ogTitle.content = title;
    if (ogDescription) ogDescription.content = description;
    if (canonical) canonical.href = canonicalPath;
  }
  function captureContactDraft() {
    var form = document.getElementById('inquiry-form');
    if (!form) return;
    var values = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name || field.name === 'submit') return;
      values[field.name] = field.type === 'checkbox' ? field.checked : field.value;
    });
    contactState.draft = values;
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iconArrow() {
    return '<span class="arrow" aria-hidden="true">←</span>';
  }
  function packageContact(code) {
    return '/contact/?package=' + encodeURIComponent(code);
  }
  function header() {
    var links = [
      ['/', t.navHome, 'home'],
      ['/about/', t.navAbout, 'about'],
      ['/packages/', t.navPackages, 'packages'],
      ['/services/', t.navServices, 'services'],
      ['/why-thanarah/', t.navWhy, 'why-thanarah'],
      ['/contact/', t.navContact, 'contact'],
    ];
    return (
      '<a class="skip-link" href="#main">' +
      t.skip +
      '</a><header class="topbar"><div class="wrap header-inner"><a class="brand" href="/" aria-label="' +
      esc(t.brand) +
      ' | ' +
      esc(t.navHome) +
      '"><img src="/assets/logo-mark.svg" alt=""><span class="brand-name">' +
      t.brand +
      '<small class="brand-note">' +
      t.brandNote +
      '</small></span></a><nav class="main-nav" id="main-navigation" aria-label="' +
      esc(locale === 'ar' ? 'التنقل الرئيسي' : 'Main navigation') +
      '">' +
      links
        .map(function (l) {
          return (
            '<a href="' +
            l[0] +
            '"' +
            (route === l[2] ? ' aria-current="page"' : '') +
            '>' +
            l[1] +
            '</a>'
          );
        })
        .join('') +
      '</nav><div class="nav-actions"><button class="language-button" type="button" data-language aria-label="' +
      esc(locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية') +
      '">' +
      t.language +
      '</button><a class="button small nav-cta" href="/contact/">' +
      t.navCta +
      '</a><button class="menu-button" type="button" aria-expanded="false" aria-controls="main-navigation" aria-label="' +
      esc(locale === 'ar' ? 'فتح القائمة' : 'Open menu') +
       '"><span class="menu-glyph" aria-hidden="true"><i></i><i></i></span></button></div></div></header>'
    );
  }
  function footer() {
    return (
      '<footer class="footer"><div class="wrap"><div class="footer-top"><div class="footer-brand"><a class="brand" href="/"><img src="/assets/logo-mark.svg" alt=""><span class="brand-name">' +
      t.brand +
      '<small class="brand-note">' +
      t.brandNote +
      '</small></span></a><p>' +
      t.footerSummary +
      '</p></div><div class="footer-col"><h3>' +
      t.footerExplore +
      '</h3><a href="/about/">' +
      t.navAbout +
      '</a><a href="/services/">' +
      t.navServices +
      '</a><a href="/packages/">' +
      t.navPackages +
      '</a><a href="/why-thanarah/">' +
      t.navWhy +
      '</a></div><div class="footer-col"><h3>' +
      t.footerContact +
      '</h3><a href="/contact/">' +
      t.navContact +
      '</a><a href="/contact/?topic=technical">' +
      t.topicTechnical +
      '</a><a href="/customer/">' +
      (locale === 'ar' ? 'دخول العملاء' : 'Customer sign-in') +
      '</a><a href="/platform/">' +
      (locale === 'ar' ? 'مساحات عمل الفريق' : 'Team workspaces') +
      '</a></div></div><div class="footer-bottom"><span>© ' +
      new Date().getFullYear() +
      ' THANARAH</span><span>' +
      t.rights +
      '</span></div></div></footer>'
    );
  }
  function pageIntro(eyebrow, title, desc, variant) {
    return (
      '<section class="page-intro' +
      (variant ? ' ' + variant : '') +
      '"><div class="wrap page-intro-inner"><span class="eyebrow">' +
      eyebrow +
      '</span><h1>' +
      title +
      '</h1><p>' +
      desc +
      '</p></div></section>'
    );
  }
  function workflowScene() {
    var labels =
      locale === 'ar'
        ? ['المريض', 'الموعد', 'الزيارة السريرية']
        : ['Patient', 'Appointment', 'Clinical encounter'];
    var conceptual =
      locale === 'ar'
        ? 'مخطط مفاهيمي · يشرح العلاقة ولا يعرض بيانات حقيقية'
        : 'Conceptual diagram · relationships only, no real data';
    var planned = locale === 'ar' ? 'مسارات مستقبلية · غير متاحة' : 'Future branches · unavailable';
    return (
      '<figure class="workflow-scene"><div class="workflow-topline"><span>' +
      conceptual +
      '</span></div><svg class="workflow-svg' +
      (locale === 'ar' ? ' is-rtl' : '') +
      '" viewBox="0 0 920 300" role="img" aria-labelledby="workflow-title workflow-desc" focusable="false" dir="ltr"><title id="workflow-title">' +
      (locale === 'ar' ? 'العلاقة المفاهيمية بين خطوات العمل السريري' : 'Conceptual relationships in a clinical workflow') +
      '</title><desc id="workflow-desc">' +
      (locale === 'ar'
        ? 'يرتبط المريض بالموعد ثم بالزيارة السريرية ضمن الأساس القائم. يتفرع الذكاء الاصطناعي والاتصال كمسارات مستقبلية متقطعة وغير متاحة.'
        : 'A patient connects to an appointment and then a clinical encounter within the existing foundation. AI and calling appear only as dashed, unavailable future branches.') +
      '</desc><path class="workflow-line" d="M156 152H764"/><path class="workflow-future-line" d="M460 152V67H726"/><path class="workflow-future-line" d="M460 152V238H726"/><g class="workflow-node"><circle cx="156" cy="152" r="42"/><path d="M140 155h32m-16-16v32"/></g><g class="workflow-node"><circle cx="460" cy="152" r="42"/><rect x="443" y="135" width="34" height="34" rx="3"/><path d="M450 129v12m20-12v12m-20 19h20"/></g><g class="workflow-node"><circle cx="764" cy="152" r="42"/><path d="M747 151h34m-29-9h24m-24 18h20"/></g><circle class="workflow-traveler" cx="156" cy="152" r="8"/><g class="workflow-future"><circle cx="806" cy="67" r="10"/><circle cx="806" cy="238" r="10"/></g></svg><div class="workflow-labels" dir="' +
      (locale === 'ar' ? 'rtl' : 'ltr') +
      '"><div><span>01</span><strong>' +
      labels[0] +
      '</strong></div><div><span>02</span><strong>' +
      labels[1] +
      '</strong></div><div><span>03</span><strong>' +
      labels[2] +
      '</strong></div></div><div class="workflow-branches"><span class="branch-label">' +
      planned +
      '</span><div class="planned-node"><strong>Thanarah AI</strong><span>' +
      (locale === 'ar' ? 'مخطط · غير مفعّل' : 'Planned · not activated') +
      '</span></div><div class="planned-node"><strong>Thanarah Calling</strong><span>' +
      (locale === 'ar' ? 'مخطط · غير مفعّل' : 'Planned · not activated') +
      '</span></div></div><figcaption>' +
      (locale === 'ar'
        ? 'المريض ← الموعد ← الزيارة السريرية: أساس تشغيلي قائم. الفروع المتقطعة ليست خدمات أو اتصالات حية.'
        : 'Patient → appointment → encounter: an existing operational foundation. Dashed branches are not live services or connections.') +
      '</figcaption></figure>'
    );
  }
  function home() {
    return (
      '<main id="main"><section class="hero"><div class="wrap hero-grid"><div class="hero-copy load-in"><span class="eyebrow">' +
      (locale === 'ar'
        ? 'ثنارة · شركة تقنية للرعاية الصحية'
        : 'THANARAH · HEALTHCARE TECHNOLOGY COMPANY') +
      '</span><h1>' +
      (locale === 'ar'
        ? 'منظومة واحدة،<br><em>لعمل الرعاية.</em>'
        : 'Healthcare work,<br><em>held together.</em>') +
      '</h1><p>' +
      t.homeIntro +
      '</p><p class="hero-position">' +
      (locale === 'ar'
        ? 'نبني منظومة تشغيل للعيادات: تبدأ اليوم بـ Smart Clinic، وتتسع مستقبلًا فقط عندما تصبح القدرات جاهزة.'
        : 'We build an operating ecosystem for clinics: grounded today in Smart Clinic, with future capabilities named only as future work.') +
      '</p><div class="hero-actions"><a class="button" href="/services/">' +
      t.homePrimary +
      iconArrow() +
      '</a><a class="button ghost" href="/contact/">' +
      t.homeSecondary +
      '</a></div><div class="hero-proof"><span class="proof-mark" aria-hidden="true">T/</span><span>' +
      (locale === 'ar' ? 'مرتكز على عمل العيادة، لا على وعود الأتمتة.' : 'Built around clinic work, not automation promises.') +
      '</span><span class="hero-index-label">' +
      t.heroIndex +
      '</span></div></div><div class="hero-aside" data-parallax><figure class="hero-product"><div class="product-photo"><img src="/assets/clinic-interface.webp" alt="' +
      (locale === 'ar'
        ? 'لقطة من واجهة تسجيل المرضى الحالية، حقول فارغة، دون بيانات مرضى'
        : 'Current patient-registration interface, blank fields, no patient data') +
      '" width="1280" height="960" fetchpriority="high" decoding="async"><span class="photo-index">SMART CLINIC / 01</span></div><figcaption>' +
      (locale === 'ar'
        ? 'لقطة من واجهة تسجيل المرضى الحالية، حقول فارغة، دون بيانات مرضى'
        : 'Current patient-registration interface, blank fields, no patient data') +
      '</figcaption></figure><div class="ecosystem-index" aria-label="' +
      (locale === 'ar' ? 'حالة منتجات ثنارة' : 'Thanarah product status') +
      '" role="group"><div class="ecosystem-current"><span class="system-number">01</span><div><strong>Smart Clinic</strong><span>' +
      (locale === 'ar' ? 'أساس تشغيلي قائم' : 'Existing clinic foundation') +
      '</span></div><b>' +
      (locale === 'ar' ? 'قائم' : 'EXISTS') +
      '</b></div><div class="ecosystem-planned"><span class="system-number">02</span><div><strong>Thanarah AI</strong><span>' +
      (locale === 'ar' ? 'طموح مستقبلي' : 'Future ambition') +
      '</span></div><b>' +
      (locale === 'ar' ? 'مخطط · غير مفعّل' : 'PLANNED · NOT ACTIVE') +
      '</b></div><div class="ecosystem-planned"><span class="system-number">03</span><div><strong>Thanarah Calling</strong><span>' +
      (locale === 'ar' ? 'طموح مستقبلي' : 'Future ambition') +
      '</span></div><b>' +
      (locale === 'ar' ? 'مخطط · غير مفعّل' : 'PLANNED · NOT ACTIVE') +
      '</b></div><p>' +
      (locale === 'ar' ? 'لقطة واجهة فقط؛ ليست لوحة حيّة أو إثباتًا لمسار مكتمل.' : 'Interface view only; not a live dashboard or proof of an end-to-end journey.') +
      '</p></div></div></div></section><section class="section compact"><div class="wrap"><div class="statement"><div class="statement-num">' +
      t.positionLabel +
      ' / 01</div><div><h2>' +
      t.homeTitle +
      '</h2><p>' +
      t.homeIntro +
      '</p><p class="statement-seal">' +
      t.seal +
      '</p><h3 class="statement-secondary">' +
      t.positionTitle +
      '</h3><p>' +
      t.positionBody +
      '</p></div></div></div></section><section class="section workflow-section"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      (locale === 'ar' ? 'منظومة العيادة الذكية' : 'SMART CLINIC · THE OPERATING SYSTEM') +
      '</span><h2>' +
      (locale === 'ar' ? 'من سجلّ المريض إلى الزيارة.' : 'From patient record to encounter.') +
      '</h2><p>' +
      (locale === 'ar'
        ? 'شرح بصري للعلاقات بين وظائف موجودة اليوم، وليس عرضًا لبيانات أو نشاط حي.'
        : 'A visual explanation of capabilities that exist today, not a display of real data or live activity.') +
      '</p></div></div>' +
      workflowScene() +
      '</div></section><section class="section"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      (locale === 'ar' ? 'ما هو قائم اليوم' : 'WHAT EXISTS TODAY') +
      '</span><h2>' +
      t.capabilityTitle +
      '</h2><p>' +
      t.capabilityBody +
      '</p></div><a class="text-link" href="/services/">' +
      t.navServices +
      ' <span aria-hidden="true">←</span></a></div><div class="capability-grid"><article class="capability-feature"><span class="eyebrow">' +
      (locale === 'ar' ? 'أساس سريري' : 'CLINICAL FOUNDATION') +
      '</span><div><h3>' +
      t.capabilityTitle +
      '</h3><p>' +
      t.capabilityBody +
      '</p></div></article><div class="capability-side"><article class="capability-card"><span class="num">01</span><div><h3>' +
      t.capOne +
      '</h3><p>' +
      t.capOneBody +
      '</p></div></article><article class="capability-card"><span class="num">02</span><div><h3>' +
      t.capTwo +
      '</h3><p>' +
      t.capTwoBody +
      '</p></div></article><article class="capability-card"><span class="num">03</span><div><h3>' +
      t.capThree +
      '</h3><p>' +
      t.capThreeBody +
      '</p></div></article><article class="capability-card"><span class="num">04</span><div><h3>' +
      t.capFour +
      '</h3><p>' +
      t.capFourBody +
      '</p></div></article></div></div><p class="availability-note">' +
      t.clinicalNote +
      '</p></div></section><section class="section dark"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      t.howEyebrow +
      '</span><h2>' +
      t.howTitle +
      '</h2><p>' +
      t.howDesc +
      '</p></div></div><div class="steps">' +
      [
        [t.step1, t.step1Body],
        [t.step2, t.step2Body],
        [t.step3, t.step3Body],
        [t.step4, t.step4Body],
      ]
        .map(function (s, i) {
          return (
            '<article class="step"><span class="step-number">0' +
            (i + 1) +
            '</span><h3>' +
            s[0] +
            '</h3><p>' +
            s[1] +
            '</p></article>'
          );
        })
        .join('') +
      '</div></div></section><section class="section tint"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      t.benefitsEyebrow +
      '</span><h2>' +
      t.benefitsTitle +
      '</h2></div></div><div class="benefits">' +
      [
        [t.benefit1, t.benefit1Body],
        [t.benefit2, t.benefit2Body],
        [t.benefit3, t.benefit3Body],
        [t.benefit4, t.benefit4Body],
      ]
        .map(function (b, i) {
          return (
            '<article class="benefit"><span class="num">0' +
            (i + 1) +
            '</span><h3>' +
            b[0] +
            '</h3><p>' +
            b[1] +
            '</p></article>'
          );
        })
        .join('') +
      '</div></div></section><section class="section dark"><div class="wrap security-layout"><div><span class="eyebrow">' +
      t.securityEyebrow +
      '</span><h2>' +
      t.securityTitle +
      '</h2></div><div class="security-copy"><p>' +
      t.securityBody +
      '</p><p class="small-note">' +
      t.securityNote +
      '</p></div></div></section><section class="section"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      t.packagesEyebrow +
      '</span><h2>' +
      t.packagesTitle +
      '</h2><p>' +
      t.packagesBody +
      '</p></div><a class="text-link" href="/packages/">' +
      t.packagesLink +
      ' <span aria-hidden="true">←</span></a></div><div id="home-packages" class="package-preview" aria-live="polite"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div></div></section><section class="section compact tint"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      t.faqEyebrow +
      '</span><h2>' +
      t.faqTitle +
      '</h2></div></div><div class="faq-list">' +
      [
        [t.faq1, t.faq1Body],
        [t.faq2, t.faq2Body],
        [t.faq3, t.faq3Body],
        [t.faq4, t.faq4Body],
        [t.faq5, t.faq5Body],
      ]
        .map(function (f) {
          return '<details><summary>' + f[0] + '</summary><p>' + f[1] + '</p></details>';
        })
        .join('') +
      '</div></div></section><section class="section compact"><div class="wrap statement"><div class="statement-num">' +
      (locale === 'ar' ? 'الخطوة التالية' : 'NEXT STEP') +
      '</div><div><h2>' +
      t.homeCta +
      '</h2><p>' +
      t.homeCtaBody +
      '</p><div class="hero-actions"><a class="button" href="/contact/">' +
      t.navContact +
      iconArrow() +
      '</a></div></div></div></section></main>'
    );
  }
  function about() {
    return (
      '<main id="main">' +
      pageIntro(t.navAbout, t.aboutTitle, t.aboutIntro, 'intro-about') +
      '<section class="page-body about-page"><div class="wrap"><article class="prose-grid"><div class="prose-label">' +
      t.aboutMission +
      ' / 01</div><div><h2>' +
      t.aboutMissionTitle +
      '</h2><p>' +
      t.aboutMissionBody +
      '</p></div></article><article class="prose-grid"><div class="prose-label">' +
      t.aboutVision +
      ' / 02</div><div><h2>' +
      t.aboutVisionTitle +
      '</h2><p>' +
      t.aboutVisionBody +
      '</p></div></article><article class="prose-grid"><div class="prose-label">' +
      t.aboutApproach +
      ' / 03</div><div><h2>' +
      t.aboutApproachTitle +
      '</h2><p>' +
      t.aboutApproachBody +
      '</p><div class="principles">' +
      [
        [t.principle1, t.principle1Body],
        [t.principle2, t.principle2Body],
        [t.principle3, t.principle3Body],
      ]
        .map(function (p) {
          return (
            '<div class="principle"><strong>' + p[0] + '</strong><span>' + p[1] + '</span></div>'
          );
        })
        .join('') +
      '</div></div></article><section class="founder-profile" id="founder" aria-labelledby="founder-name"><div class="founder-photo-wrap"><img class="founder-photo" src="/assets/faisal-alenizi.jpg" alt="' +
      t.founderImageAlt +
      '" width="900" height="908" loading="lazy" decoding="async"></div><div class="founder-copy"><div class="prose-label">' +
      t.founderLabel +
      '</div><h2 id="founder-name" dir="ltr">Faisal alenizi</h2><p class="founder-role">' +
      t.founderRole +
      '</p></div></section><section class="founder-profile" id="partner" aria-labelledby="partner-name"><div class="founder-photo-wrap"><img class="founder-photo" src="/assets/ziad-alkhathlan.jpg" alt="' +
      t.partnerImageAlt +
      '" width="900" height="918" style="aspect-ratio:900/918" loading="lazy" decoding="async"></div><div class="founder-copy"><div class="prose-label">' +
      t.partnerLabel +
      '</div><h2 id="partner-name" dir="ltr">Ziad alkhathlan</h2><p class="founder-role">' +
      t.partnerRole +
      '</p></div></section><section class="founder-profile" id="cto" aria-labelledby="cto-name"><div class="founder-photo-wrap"><img class="founder-photo" src="/assets/youssef-darwish.jpg" alt="' +
      t.ctoImageAlt +
      '" width="871" height="1000" style="aspect-ratio:871/1000" loading="lazy" decoding="async"></div><div class="founder-copy"><div class="prose-label">' +
      t.ctoLabel +
      '</div><h2 id="cto-name" dir="ltr">Youssef Darwish</h2><p class="founder-role">' +
      t.ctoRole +
      '</p></div></section></div></section></main>'
    );
  }
  function packagesPage() {
    return (
      '<main id="main">' +
      pageIntro(t.navPackages, t.packagesTitlePage, t.packagesIntro, 'intro-packages') +
      '<section class="page-body packages-page"><div class="wrap"><div class="package-index" aria-hidden="true"><span>01 / LITE</span><span>02 / PRO</span><span>03 / CUSTOMIZE</span></div><div id="package-list" class="package-grid" aria-live="polite"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div><p class="quote-note">' +
      t.packageContext +
      ' ' +
      t.packagePrivacy +
      '</p></div></section></main>'
    );
  }
  function services() {
    return (
      '<main id="main">' +
      pageIntro(t.navServices, t.servicesTitle, t.servicesIntro, 'intro-services') +
      '<section class="page-body"><div class="wrap"><div class="section-header"><div><span class="eyebrow">' +
      (locale === 'ar' ? 'قدرات حالية' : 'CURRENT CAPABILITIES') +
      '</span><h2>' +
      t.verifiedTitle +
      '</h2><p>' +
      t.verifiedIntro +
      '</p></div></div><div class="service-list"><article class="service-card"><h3>' +
      t.capabilityPatients +
      '</h3><p>' +
      t.capOneBody +
      '</p></article><article class="service-card"><h3>' +
      t.capabilityAppointments +
      '</h3><p>' +
      t.capTwoBody +
      '</p></article><article class="service-card"><h3>' +
      t.capabilityEncounters +
      '</h3><p>' +
      t.serviceSmartDescription +
      '</p></article><article class="service-card"><h3>' +
      t.capabilityRoles +
      '</h3><p>' +
      t.capThreeBody +
      '</p></article><article class="service-card"><h3>' +
      t.invoicing +
      '</h3><p>' +
      t.invoicingNote +
      '</p></article></div><div class="section-header" style="margin-top:68px"><div><span class="eyebrow">' +
      (locale === 'ar' ? 'مجالات الخدمة' : 'SERVICE AREAS') +
      '</span><h2>' +
      t.serviceTypesTitle +
      '</h2><p>' +
      t.serviceTypesIntro +
      '</p></div></div><div class="service-list">' +
      [
        [t.serviceSmart, t.serviceSmartDescription, t.statusAvailable],
        [t.serviceWebsite, t.serviceWebsiteDescription, t.statusUpcoming],
        [t.serviceIntegrations, t.serviceIntegrationsDescription, t.statusAssessment],
        [t.serviceAutomation, t.serviceAutomationDescription, t.statusAssessment],
        [t.serviceCommunications, t.serviceCommunicationsDescription, t.statusAssessment],
        [t.serviceTechnical, t.serviceTechnicalDescription, t.statusAssessment],
      ]
        .map(function (service) {
          return (
            '<article class="service-card"><h3>' +
            service[0] +
            '</h3><p>' +
            service[1] +
            '</p><span class="tag">' +
            service[2] +
            '</span></article>'
          );
        })
        .join('') +
      '</div><section class="service-workflow"><div class="section-header"><div><span class="eyebrow">' +
      (locale === 'ar' ? 'كيف تتصل الوظائف' : 'HOW THE PIECES CONNECT') +
      '</span><h2>' +
      (locale === 'ar' ? 'سياق عمل واحد، وخطوات مفهومة.' : 'One operating context. Understandable steps.') +
      '</h2><p>' +
      (locale === 'ar'
        ? 'المخطط مفاهيمي ولا يعرض بيانات فعلية. ميزات الذكاء الاصطناعي والاتصال المباشر مستقبلية وغير مفعّلة.'
        : 'Conceptual only; no real data is shown. AI and direct communications are future branches and are not activated.') +
      '</p></div></div>' +
      workflowScene() +
      '</section><section class="future-panel"><div class="future-intro"><span class="eyebrow">' +
      t.futureTitle +
      '</span><h2>' +
      t.futureTitle +
      '</h2><p>' +
      t.futureIntro +
      '</p></div><div class="future-lines"><div><strong>' +
      t.futureWebsite +
      '</strong><span>' +
      t.futureWebsiteState +
      '</span></div><div><strong>' +
      t.futureDelivery +
      '</strong><span>' +
      t.futureDeliveryState +
      '</span></div><div><strong>' +
      t.futureAI +
      '</strong><span>' +
      t.futureAIState +
      '</span></div></div></section><div class="section-header future-heading"><div><span class="eyebrow">' +
      t.registeredOnly +
      '</span><h2>' +
      t.catalogTitle +
      '</h2><p>' +
      t.catalogIntro +
      '</p></div></div><div id="services-list" class="service-list" aria-live="polite"><div class="catalog-status">' +
      t.catalogLoading +
      '</div></div></section></main>'
    );
  }
  function why() {
    return (
      '<main id="main">' +
      pageIntro(t.navWhy, t.whyTitle, t.whyIntro, 'intro-why') +
      '<section class="page-body"><div class="wrap"><div class="why-opening"><span class="eyebrow">' +
      (locale === 'ar' ? 'مبدأ العمل' : 'THE OPERATING PRINCIPLE') +
      '</span><h2>' +
      t.whyClarity +
      '</h2><p>' +
      t.whyClarityBody +
      '</p></div><div class="benefits">' +
      [
        [t.whyUnified, t.whyUnifiedBody],
        [t.whyJourney, t.whyJourneyBody],
        [t.whyTenant, t.whyTenantBody],
        [t.whyRoles, t.whyRolesBody],
        [t.whyScope, t.whyScopeBody],
        [t.whySupport, t.whySupportBody],
      ]
        .map(function (b, i) {
          return (
            '<article class="benefit"><span class="num">0' +
            (i + 1) +
            '</span><h3>' +
            b[0] +
            '</h3><p>' +
            b[1] +
            '</p></article>'
          );
        })
        .join('') +
      '</div><div class="why-notes"><article><span>01 / ' +
      t.whyFit +
      '</span><h3>' +
      t.whyFit +
      '</h3><p>' +
      t.whyFitBody +
      '</p></article><article><span>02 / ' +
      t.whyPace +
      '</span><h3>' +
      t.whyPace +
      '</h3><p>' +
      t.whyPaceBody +
      '</p></article><article><span>03 / ' +
      t.whyTrust +
      '</span><h3>' +
      t.whyTrust +
      '</h3><p>' +
      t.whyTrustBody +
      '</p></article></div><article class="prose-grid reality-block"><div class="prose-label">' +
      (locale === 'ar' ? 'المتاح اليوم' : 'AVAILABLE TODAY') +
      ' / 01</div><div><h2>' +
      t.whyReality +
      '</h2><p>' +
      t.whyRealityBody +
      '</p><h3>' +
      t.whyFuture +
      '</h3><p>' +
      t.whyFutureBody +
      '</p><div class="hero-actions"><a class="button" href="/contact/">' +
      t.navContact +
      iconArrow() +
      '</a></div></div></article><aside class="trust-boundary"><span class="eyebrow">' +
      t.securityEyebrow +
      '</span><h2>' +
      t.securityTitle +
      '</h2><p>' +
      t.securityBody +
      '</p><p class="small-note">' +
      t.securityNote +
      '</p></aside></div></section></main>'
    );
  }
  function contact() {
    return (
      '<main id="main">' +
      pageIntro(t.navContact, t.contactTitle, t.contactIntro, 'intro-contact') +
      '<section class="page-body"><div class="wrap contact-grid"><aside class="contact-aside"><h2>' +
      t.contactAsideTitle +
      '</h2><p>' +
      t.contactAsideBody +
      '</p><div class="contact-note">' +
      t.securityNote +
      '</div></aside><form id="inquiry-form" class="contact-form" novalidate><div class="form-grid"><div class="field"><label for="fullName">' +
      t.fullName +
      ' <span aria-hidden="true">*</span></label><input id="fullName" name="fullName" autocomplete="name" required minlength="2" maxlength="120"></div><div class="field"><label for="email">' +
      t.email +
      ' <span aria-hidden="true">*</span></label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="organization">' +
      t.organization +
      ' <span aria-hidden="true">*</span></label><input id="organization" name="organization" autocomplete="organization" required minlength="2" maxlength="191"></div><div class="field"><label for="phone">' +
      t.phone +
      ' <span class="optional">(' +
      t.optional +
      ')</span></label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+966…" aria-describedby="phone-hint"><span class="hint" id="phone-hint">' +
      (locale === 'ar' ? 'بصيغة دولية عند إدخاله' : 'Use international format if provided') +
      '</span></div><div class="field"><label for="topic">' +
      t.topic +
      ' <span aria-hidden="true">*</span></label><select id="topic" name="topic" required><option value="">' +
      t.selectTopic +
      '</option><option value="general">' +
      t.topicGeneral +
      '</option><option value="clinic">' +
      t.topicClinic +
      '</option><option value="website">' +
      t.topicWebsite +
      '</option><option value="integrations">' +
      t.topicIntegrations +
      '</option><option value="ai">' +
      t.topicAI +
      '</option><option value="communications">' +
      t.topicCommunications +
      '</option><option value="technical">' +
      t.topicTechnical +
      '</option></select></div><div class="field"><label for="packageCode">' +
      t.package +
      '</label><select id="packageCode" name="packageCode"><option value="">' +
      t.noPackage +
      '</option><option>Lite</option><option>Pro</option><option>Customize</option></select></div><div class="field span-2"><label for="message">' +
      t.message +
      ' <span aria-hidden="true">*</span></label><textarea id="message" name="message" required minlength="10" maxlength="3000" aria-describedby="message-hint"></textarea><span id="message-hint" class="hint">' +
      t.messageHint +
      '</span></div></div><label class="consent"><input type="checkbox" name="consent" required><span>' +
      t.consent +
      '<br><span class="hint">' +
      t.consentNote +
      '</span></span></label><div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div><div class="form-submit"><button class="button" id="submit-inquiry" type="submit">' +
      t.submit +
      iconArrow() +
      '</button><span class="hint">' +
      (locale === 'ar' ? 'الحقول المعلّمة مطلوبة' : 'Fields marked required') +
      '</span></div><div id="form-message" class="form-message" role="status" aria-live="polite" hidden></div><div id="form-recovery"></div></form></div></section></main>'
    );
  }
  function serviceDetail() {
    var name = document.title;
    return (
      '<main id="main"><section class="page-intro"><div class="wrap page-intro-inner"><a class="text-link" href="/services/">' +
      t.detailBack +
      '</a><h1>' +
      t.detailService +
      '</h1><p>' +
      t.catalogLoading +
      '</p></div></section><section class="page-body"><div class="wrap"><div id="service-detail" class="catalog-status" role="status">' +
      esc(name) +
      '</div></div></section></main>'
    );
  }
  function render() {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    t = lang[locale];
    if (serviceKey) {
      updateMetadata(t.detailService + ' | ' + t.brand, t.catalogIntro, '/services/');
      app.innerHTML = header() + serviceDetail() + footer();
      bindCommon();
      loadCatalog().then(renderServiceResult).catch(showServiceError);
      return;
    }
    var pages = {
      home: home,
      about: about,
      packages: packagesPage,
      services: services,
      'why-thanarah': why,
      contact: contact,
    };
    var referenceHome = isReferenceHomePath && route === 'home' && window.ThanarahReferenceHome
      ? window.ThanarahReferenceHome(locale, t, { escape: esc })
      : null;
    app.innerHTML =
      (referenceHome ? referenceHome.header() : header()) +
      (pages[route]
        ? referenceHome
          ? referenceHome.home()
          : pages[route]()
        : pageIntro(t.navHome, t.notFound, '') + '<main id="main"></main>') +
      (referenceHome ? referenceHome.footer() : footer());
    var description =
      route === 'home'
        ? t.positionBody
        : route === 'about'
          ? t.aboutIntro
          : route === 'services'
            ? t.servicesIntro
            : route === 'packages'
              ? t.packagesIntro
              : route === 'contact'
                ? t.contactIntro
                : t.whyIntro;
    updateMetadata(routeTitle(), description, route === 'home' ? '/' : '/' + route + '/');
    bindCommon();
    if (route === 'home' || route === 'packages' || route === 'services')
      loadCatalog()
        .then(function (data) {
          catalogCache = data;
          if (route === 'home') renderHomePackages(data);
          if (route === 'packages') renderPackages(data);
          if (route === 'services') renderServices(data);
        })
        .catch(function () {
          showCatalogError(route);
        });
    if (route === 'contact') initForm();
  }
  function bindCommon() {
    var main = document.getElementById('main');
    var skip = document.querySelector('.skip-link');
    if (main) main.setAttribute('tabindex', '-1');
    if (skip && main)
      skip.addEventListener('click', function () {
        main.focus({ preventScroll: true });
      });
    var langBtn = document.querySelector('[data-language]');
    if (langBtn)
      langBtn.addEventListener('click', function () {
        if (contactState.busy) return;
        captureContactDraft();
        locale = locale === 'ar' ? 'en' : 'ar';
        try {
          window.localStorage.setItem(localeKey, locale);
        } catch (_) {
          // The active tab still uses the selected language.
        }
        render();
        var nextLanguageButton = document.querySelector('[data-language]');
        if (nextLanguageButton) nextLanguageButton.focus();
      });
    var menu = document.querySelector('.menu-button');
    if (menu)
      menu.addEventListener('click', function () {
        var nav = document.getElementById('main-navigation');
        var open = menu.getAttribute('aria-expanded') === 'true';
        menu.setAttribute('aria-expanded', String(!open));
        menu.setAttribute(
          'aria-label',
          !open
            ? locale === 'ar'
              ? 'إغلاق القائمة'
              : 'Close menu'
            : locale === 'ar'
              ? 'فتح القائمة'
              : 'Open menu',
        );
        nav.classList.toggle('is-open', !open);
      });
    document.onkeydown = function (event) {
      if (event.key !== 'Escape') return;
      var openMenu = document.querySelector('.menu-button[aria-expanded="true"]');
      if (!openMenu) return;
      var nav = document.getElementById('main-navigation');
      openMenu.setAttribute('aria-expanded', 'false');
      openMenu.setAttribute('aria-label', locale === 'ar' ? 'فتح القائمة' : 'Open menu');
      if (nav) nav.classList.remove('is-open');
      openMenu.focus();
    };
    document.querySelectorAll('[data-retry-catalog]').forEach(function (button) {
      button.addEventListener('click', retryCatalog);
    });
  }
  function renderServiceResult(data) {
    var found =
      data.services &&
      data.services.find(function (s) {
        return s.key === serviceKey;
      });
    var detail = document.getElementById('service-detail');
    var titleNode = document.querySelector('.page-intro h1');
    var intro = document.querySelector('.page-intro p');
    if (found && found.published === true) {
      updateMetadata(
        found.title + ' | ' + t.brand,
        found.description || t.catalogIntro,
        '/services/',
      );
      if (titleNode) titleNode.textContent = found.title;
      if (intro) intro.textContent = found.description || '';
      if (detail) detail.textContent = t.registeredOnly;
    } else {
      updateMetadata(t.missingService + ' | ' + t.brand, t.missingServiceBody, '/services/');
      if (titleNode) titleNode.textContent = t.missingService;
      if (intro) intro.textContent = t.missingServiceBody;
      if (detail) detail.textContent = t.missingServiceBody;
    }
  }
  function showServiceError() {
    var detail = document.getElementById('service-detail');
    if (detail)
      detail.innerHTML =
        '<span>' +
        esc(t.catalogError) +
        '</span> <button type="button" data-retry-catalog>' +
        esc(t.retry) +
        '</button>';
    var retry = detail && detail.querySelector('[data-retry-catalog]');
    if (retry) retry.addEventListener('click', retryCatalog);
  }
  function loadCatalog() {
    if (catalogCache) return Promise.resolve(catalogCache);
    return fetch('/api/v1/customer-public/catalog', {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
      .then(function (response) {
        if (!response.ok) throw new Error('catalog');
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.services) || !Array.isArray(data.packages))
          throw new Error('catalog');
        catalogCache = data;
        return data;
      });
  }
  function packageData(code, catalog) {
    return (catalog.packages || []).find(function (p) {
      return p.code === code && p.published === true;
    });
  }
  function packageCard(code, catalog, compact) {
    var p = packageData(code, catalog);
    var description = p && p.description ? esc(p.description) : esc(t.unconfirmed);
    var list =
      p && Array.isArray(p.features) && p.features.length
        ? '<ul>' +
          p.features
            .map(function (x) {
              return '<li>' + esc(x) + '</li>';
            })
            .join('') +
          '</ul>'
        : compact
          ? ''
          : '<p>' + esc(t.noFeatures) + '</p>';
    return (
      '<article class="' +
      (compact ? 'package-card' : 'package-detail') +
      '"><span class="package-label">' +
      esc(code) +
      '</span><h3' +
      (compact ? '' : ' class="latin"') +
      '>' +
      esc(code) +
      '</h3><p>' +
      description +
      '</p>' +
      list +
      '<span class="quote">' +
      esc(t.quoteBased) +
      '</span>' +
      (compact
        ? '<a class="text-link" href="' +
          packageContact(code) +
          '">' +
          esc(t.askQuote) +
          ' <span aria-hidden="true">←</span></a>'
        : '<a class="button small" href="' +
          packageContact(code) +
          '">' +
          esc(t.askQuote) +
          iconArrow() +
          '</a>') +
      '</article>'
    );
  }
  function renderHomePackages(data) {
    var el = document.getElementById('home-packages');
    if (el && window.ThanarahReferenceHome) {
      el.innerHTML = window.ThanarahReferenceHome(locale, t, { escape: esc }).packages(data);
    } else if (el)
      el.innerHTML = ['Lite', 'Pro', 'Customize']
        .map(function (c) {
          return packageCard(c, data, true);
        })
        .join('');
  }
  function renderPackages(data) {
    var el = document.getElementById('package-list');
    if (el)
      el.innerHTML = ['Lite', 'Pro', 'Customize']
        .map(function (c) {
          return packageCard(c, data, false);
        })
        .join('');
  }
  function renderServices(data) {
    var el = document.getElementById('services-list');
    var published = data.services.filter(function (s) {
      return s.published === true;
    });
    if (!el) return;
    if (!published.length) {
      el.innerHTML = '<div class="catalog-status">' + esc(t.catalogEmpty) + '</div>';
      return;
    }
    el.innerHTML = published
      .map(function (s) {
        return (
          '<article class="service-card"><h3>' +
          esc(s.title) +
          '</h3><p>' +
          esc(s.description || '') +
          '</p><a class="text-link" href="/welcome/?service=' +
          encodeURIComponent(s.key) +
          '">' +
          esc(locale === 'ar' ? 'عرض تفاصيل الخدمة' : 'View service details') +
          ' <span aria-hidden="true">←</span></a></article>'
        );
      })
      .join('');
  }
  function showCatalogError(which) {
    var targets =
      which === 'home'
        ? ['home-packages']
        : which === 'packages'
          ? ['package-list']
          : ['services-list'];
    targets.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var errorNotice =
        '<div class="catalog-status error" role="alert">' +
        esc(t.catalogError) +
        ' <button type="button" data-retry-catalog>' +
        esc(t.retry) +
        '</button></div>';
      if (id === 'home-packages')
        el.innerHTML = window.ThanarahReferenceHome
          ? '<div class="rh-catalog-error">' + errorNotice + '</div>' +
            window.ThanarahReferenceHome(locale, t, { escape: esc }).packageFallback()
          :
          errorNotice +
          ['Lite', 'Pro', 'Customize']
            .map(function (c) {
              return packageCard(c, { packages: [] }, true);
            })
            .join('');
      else if (id === 'package-list')
        el.innerHTML =
          errorNotice +
          ['Lite', 'Pro', 'Customize']
            .map(function (c) {
              return packageCard(c, { packages: [] }, false);
            })
            .join('');
      else el.innerHTML = errorNotice;
    });
    document.querySelectorAll('[data-retry-catalog]').forEach(function (button) {
      button.addEventListener('click', retryCatalog);
    });
  }
  function retryCatalog() {
    catalogCache = null;
    if (serviceKey) {
      var detail = document.getElementById('service-detail');
      if (detail) detail.textContent = t.catalogLoading;
      loadCatalog().then(renderServiceResult).catch(showServiceError);
      return;
    }
    var el = document.getElementById(
      route === 'home' ? 'home-packages' : route === 'packages' ? 'package-list' : 'services-list',
    );
    if (el) el.innerHTML = '<div class="catalog-status">' + esc(t.catalogLoading) + '</div>';
    loadCatalog()
      .then(function (data) {
        if (route === 'home') renderHomePackages(data);
        else if (route === 'packages') renderPackages(data);
        else if (route === 'services') renderServices(data);
      })
      .catch(function () {
        showCatalogError(route);
      });
  }
  function initForm() {
    var form = document.getElementById('inquiry-form');
    if (!form) return;
    var packageSelect = form.elements.packageCode;
    var topicSelect = form.elements.topic;
    if (contactState.draft) {
      Object.keys(contactState.draft).forEach(function (name) {
        var field = form.elements[name];
        if (!field) return;
        if (field.type === 'checkbox') field.checked = Boolean(contactState.draft[name]);
        else field.value = contactState.draft[name];
      });
    } else {
      if (['Lite', 'Pro', 'Customize'].indexOf(queryPackage) >= 0)
        packageSelect.value = queryPackage;
      var queryTopic = new URLSearchParams(location.search).get('topic');
      if (
        [
          'general',
          'clinic',
          'website',
          'integrations',
          'ai',
          'communications',
          'technical',
        ].indexOf(queryTopic) >= 0
      )
        topicSelect.value = queryTopic;
    }
    var messageBox = document.getElementById('form-message');
    var recovery = document.getElementById('form-recovery');
    var submit = document.getElementById('submit-inquiry');
    function announce(text, bad) {
      messageBox.hidden = false;
      messageBox.className = 'form-message' + (bad ? ' error' : '');
      messageBox.textContent = text;
    }
    function setLocked(locked) {
      Array.prototype.forEach.call(form.elements, function (field) {
        if (field.name !== 'website') field.disabled = locked;
      });
      var languageButton = document.querySelector('[data-language]');
      if (languageButton) languageButton.disabled = contactState.busy;
    }
    function formPayload() {
      var fd = new FormData(form);
      var p = {
        operationId: crypto.randomUUID(),
        fullName: String(fd.get('fullName') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        organization: String(fd.get('organization') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        topic: String(fd.get('topic') || ''),
        packageCode: String(fd.get('packageCode') || ''),
        message: String(fd.get('message') || '').trim(),
        consent: fd.get('consent') === 'on',
        website: String(fd.get('website') || ''),
        locale: locale,
      };
      if (!p.phone) delete p.phone;
      if (!p.packageCode) delete p.packageCode;
      return p;
    }
    function renderState() {
      var locked = contactState.busy || contactState.uncertain || contactState.status === 'success';
      setLocked(locked);
      submit.disabled = locked;
      submit.innerHTML = (contactState.busy ? t.sending : t.submit) + iconArrow();
      if (contactState.busy) {
        announce(t.sending, false);
        recovery.innerHTML = '';
        return;
      }
      if (contactState.status === 'success') {
        announce(t.formSuccess + ' ' + contactState.reference, false);
        recovery.innerHTML = '';
        return;
      }
      var messages = {
        invalid: t.invalid,
        conflict: t.conflict,
        throttled: t.throttled,
        unavailable: t.unavailable,
        uncertain: t.networkUncertain,
        generic: t.genericError,
      };
      if (contactState.status && messages[contactState.status])
        announce(messages[contactState.status], contactState.status !== 'invalid');
      else messageBox.hidden = true;
      if (contactState.uncertain) showRecovery();
      else recovery.innerHTML = '';
    }
    function showRecovery() {
      recovery.innerHTML =
        '<div class="form-submit" style="margin-top:13px"><button class="button small" type="button" data-retry-inquiry>' +
        esc(t.retrySame) +
        '</button><button class="button small ghost" type="button" data-new-inquiry>' +
        esc(t.startNew) +
        '</button></div>';
      recovery.querySelector('[data-retry-inquiry]').addEventListener('click', function () {
        send(contactState.payload);
      });
      recovery.querySelector('[data-new-inquiry]').addEventListener('click', function () {
        if (!window.confirm(t.startNew)) return;
        contactState.payload = null;
        contactState.uncertain = false;
        contactState.reference = '';
        contactState.status = '';
        recovery.innerHTML = '';
        messageBox.hidden = true;
        submit.disabled = false;
        setLocked(false);
        captureContactDraft();
        form.elements.fullName.focus();
      });
    }
    function send(payload) {
      if (contactState.busy || !payload) return;
      contactState.busy = true;
      contactState.payload = payload;
      contactState.uncertain = false;
      renderState();
      fetch('/api/v1/customer-public/inquiries', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              return { response: response, body: body };
            });
        })
        .then(function (result) {
          var response = result.response;
          var body = result.body;
          var error = body && body.error ? body.error : body;
          if (response.status === 201 && body.reference) {
            contactState.payload = null;
            contactState.uncertain = false;
            contactState.reference = body.reference;
            contactState.status = 'success';
            return;
          }
          if (response.status === 400 && error.code === 'INQUIRY_INPUT_INVALID') {
            contactState.payload = null;
            contactState.uncertain = false;
            contactState.status = 'invalid';
            return;
          }
          if (response.status === 409 && error.code === 'INQUIRY_REFERENCE_CONFLICT') {
            contactState.uncertain = true;
            contactState.status = 'conflict';
            return;
          }
          if (response.status === 429) {
            contactState.uncertain = true;
            contactState.status = 'throttled';
            return;
          }
          if (response.status === 503 || !response.ok) {
            contactState.uncertain = true;
            contactState.status = response.status === 503 ? 'unavailable' : 'uncertain';
            return;
          }
          contactState.uncertain = true;
          contactState.status = 'uncertain';
        })
        .catch(function () {
          contactState.uncertain = true;
          contactState.status = 'uncertain';
        })
        .finally(function () {
          contactState.busy = false;
          renderState();
        });
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (contactState.busy || contactState.uncertain || contactState.status === 'success') return;
      if (!form.reportValidity()) {
        contactState.status = 'invalid';
        announce(t.invalid, true);
        return;
      }
      var payload = formPayload();
      var emailOK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email);
      var phoneOK = !payload.phone || /^\+[1-9]\d{7,14}$/.test(payload.phone);
      if (
        payload.fullName.length < 2 ||
        payload.fullName.length > 120 ||
        payload.organization.length < 2 ||
        payload.organization.length > 191 ||
        !emailOK ||
        payload.email.length > 254 ||
        payload.message.length < 10 ||
        payload.message.length > 3000 ||
        !payload.consent ||
        !phoneOK
      ) {
        contactState.status = 'invalid';
        announce(t.invalid, true);
        return;
      }
      contactState.draft = null;
      captureContactDraft();
      contactState.payload = payload;
      contactState.status = '';
      send(payload);
    });
    form.addEventListener('input', captureContactDraft);
    form.addEventListener('change', captureContactDraft);
    renderState();
  }
  render();
})();
