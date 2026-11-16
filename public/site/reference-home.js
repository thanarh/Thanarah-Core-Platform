(function (root) {
  'use strict';

  function create(locale, t, helpers) {
    var ar = locale === 'ar';
    var esc = helpers && helpers.escape ? helpers.escape : function (value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
      });
    };
    function packagePrice(value) {
      try {
        var minor = BigInt(String(value));
        var whole = (minor / 100n).toLocaleString(ar ? 'ar-SA' : 'en-US');
        var fraction = String(minor % 100n).padStart(2, '0');
        return whole + (fraction === '00' ? '' : '.' + fraction) + (ar ? ' ر.س' : ' SAR');
      } catch (_) {
        return null;
      }
    }
    var icon = function (name) {
      var paths = {
        shield: '<path d="M12 3 19 6v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-5"/>',
        chart: '<path d="M4 19V11m5 8V7m5 12V4m5 15v-9"/><path d="m3 8 6-4 5 2 6-4"/>',
        layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
        bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
        people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 4h2"/>',
        document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/>',
        chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18m0-18a14 14 0 0 0 0 18"/>',
        message: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2 1.5-4A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8m-8 3h5"/>',
        megaphone: '<path d="m3 11 17-6v14L3 13v-2Z"/><path d="m7 14 2 6h4l-2-5m9-8v12"/>',
        heart: '<path d="M20.8 8.8c0 5.3-8.8 11-8.8 11s-8.8-5.7-8.8-11A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z"/><path d="m8 12 2.5 2.5L16 9"/>',
        compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>'
      };
      return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        (paths[name] || paths.layers) + '</svg>';
    };
    var nav = [
      ['/', t.navHome, 'home'],
      ['/about/', t.navAbout, 'about'],
      ['/#clinic', ar ? 'المنتجات' : 'Products', 'products'],
      ['/services/', t.navServices, 'services'],
      ['/packages/', t.navPackages, 'packages'],
      ['/customer/', ar ? 'العملاء' : 'Customers', 'customers'],
      ['/contact/', t.navContact, 'contact']
    ];
    function header() {
      return '<a class="skip-link" href="#main">' + esc(t.skip) +
        '</a><header class="reference-home-header"><div class="rh-header-inner">' +
        '<a class="rh-brand" href="/" aria-label="' + esc(t.brand) + ' | ' + esc(t.navHome) +
        '"><img src="/assets/logo-mark.svg" width="40" height="40" alt=""><span>' +
        (ar ? 'ثنارة' : 'Thanarah') + '<small>Thanarah · ثنارة</small></span></a>' +
        '<nav class="main-nav rh-nav" id="main-navigation" aria-label="' +
        (ar ? 'التنقل الرئيسي' : 'Main navigation') + '">' +
        nav.map(function (item) {
          return '<a href="' + item[0] + '"' + (item[2] === 'home' ? ' aria-current="page"' : '') +
            '>' + esc(item[1]) + '</a>';
        }).join('') + '</nav><div class="rh-nav-actions">' +
        '<button class="language-button rh-language" type="button" data-language aria-label="' +
        (ar ? 'Switch to English' : 'التبديل إلى العربية') + '">' + esc(t.language) + '</button>' +
        '<a class="rh-signin" href="/customer/">' + (ar ? 'تسجيل الدخول' : 'Sign in') + '</a>' +
        '<a class="rh-start" href="/contact/">' + (ar ? 'ابدأ الآن' : 'Get started') + '</a>' +
        '<button class="menu-button rh-menu" type="button" aria-expanded="false" aria-controls="main-navigation" aria-label="' +
        (ar ? 'فتح القائمة' : 'Open menu') + '"><span class="menu-glyph" aria-hidden="true"><i></i><i></i></span></button>' +
        '</div></div></header>';
    }
    function footer() {
      return '<footer class="reference-home-footer"><div class="rh-footer-main">' +
        '<div class="rh-footer-brand"><a class="rh-brand" href="/"><img src="/assets/logo-mark.svg" width="40" height="40" alt=""><span>' +
        (ar ? 'ثنارة' : 'Thanarah') + '<small>Thanarah · ثنارة</small></span></a><p>' +
        esc(t.footerSummary) + '</p></div><div class="rh-footer-col"><h2>' +
        (ar ? 'روابط سريعة' : 'Explore') + '</h2><a href="/about/">' + esc(t.navAbout) +
        '</a><a href="/services/">' + esc(t.navServices) + '</a><a href="/packages/">' +
        esc(t.navPackages) + '</a><a href="/why-thanarah/">' + esc(t.navWhy) + '</a></div>' +
        '<div class="rh-footer-col"><h2>' + (ar ? 'الخدمات' : 'Services') +
        '</h2><a href="/services/">' + esc(t.serviceSmart) + '</a><a href="/contact/?topic=website">' +
        esc(t.serviceWebsite) + '</a><a href="/contact/?topic=communications">' +
        esc(t.serviceCommunications) + '</a><a href="/contact/">' + esc(t.navContact) + '</a></div>' +
        '<div class="rh-footer-col"><h2>' + (ar ? 'الشركة' : 'Company') +
        '</h2><a href="/about/">' + esc(t.navAbout) + '</a><a href="/contact/">' +
        esc(t.navContact) + '</a><a href="/customer/">' + (ar ? 'دخول العملاء' : 'Customer sign-in') +
        '</a><a href="/platform/">' + (ar ? 'مساحات عمل الفريق' : 'Team workspaces') + '</a></div>' +
        '<div class="rh-faq"><details id="home-faq"><summary>' +
        (ar ? 'الأسئلة الشائعة' : 'Frequently asked questions') + '</summary><div class="rh-faq-content">' +
        [[t.faq1, t.faq1Body], [t.faq2, t.faq2Body], [t.faq3, t.faq3Body], [t.faq4, t.faq4Body], [t.faq5, t.faq5Body]]
          .map(function (faq) { return '<details><summary>' + esc(faq[0]) + '</summary><p>' + esc(faq[1]) + '</p></details>'; }).join('') +
        '<details><summary>' + esc(t.securityTitle) + '</summary><p>' + esc(t.securityBody) +
        '</p><p>' + esc(t.securityNote) + '</p></details><details><summary>' +
        (ar ? 'ما الذي يشمله الأساس السريري؟' : 'What is included in the clinical foundation?') +
        '</summary><p>' + esc(t.capabilityBody) + '</p><p>' + esc(t.capOne + ': ' + t.capOneBody) +
        '</p><p>' + esc(t.capTwo + ': ' + t.capTwoBody) + '</p><p>' +
        esc(t.capThree + ': ' + t.capThreeBody) + '</p><p>' + esc(t.capFour + ': ' + t.capFourBody) +
        '</p><p>' + esc(t.clinicalNote) + '</p></details><details><summary>' +
        (ar ? 'عن ثنارة ونهجنا' : 'About Thanarah and our approach') + '</summary><p>' +
        esc(t.homeTitle.replace(/<[^>]+>/g, '')) + '</p><p>' +
        esc(t.homeIntro) + '</p><p><strong>' + esc(t.positionTitle) + '</strong></p><p>' +
        esc(t.positionBody) + '</p></details><details><summary>' +
        (ar ? 'طريقة العمل والقيمة' : 'How we work and the value') + '</summary><p>' +
        esc(t.howDesc) + '</p><p>' + esc([t.step1, t.step1Body, t.step2, t.step2Body, t.step3, t.step3Body,
          t.step4, t.step4Body].join(' · ')) + '</p><p>' +
        esc([t.benefit1, t.benefit1Body, t.benefit2, t.benefit2Body, t.benefit3, t.benefit3Body,
          t.benefit4, t.benefit4Body].join(' · ')) + '</p></details>' +
        '<p class="rh-clinical-note">' + (ar ? 'ملاحظة: لا ترسل بيانات مرضى أو معلومات صحية حساسة عبر نموذج التواصل.' :
          'Please do not submit patient details or sensitive health information through the contact form.') +
        '</p></div></details></div></div><div class="rh-footer-bottom"><span>© ' +
        new Date().getFullYear() + ' THANARAH</span><span>' + esc(t.rights) +
        '</span><span class="rh-footer-marks" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div></footer>';
    }
    function home() {
      var solutions = ar ? [
        ['chip', 'المساعد الذكي', 'مساعد ذكي لدعم العيادات', 'قيد التطوير', 'ai'],
        ['globe', 'الموقع الإلكتروني', 'حضور رقمي احترافي للعيادة', 'غير متاح حاليًا', 'website'],
        ['message', 'التواصل الذكي', 'قنوات التواصل والواتساب', 'غير متاح حاليًا', 'communications'],
        ['megaphone', 'التسويق والحملات', 'تواصل أوضح مع جمهورك', 'قيد التقييم', 'general']
      ] : [
        ['chip', 'AI assistant', 'A smarter assistant for clinics', 'In development', 'ai'],
        ['globe', 'Clinic website', 'A considered digital presence', 'Not available yet', 'website'],
        ['message', 'Smart communication', 'Communication and WhatsApp channels', 'Not available yet', 'communications'],
        ['megaphone', 'Marketing & campaigns', 'Clearer outreach to your audience', 'Under assessment', 'general']
      ];
      var principles = ar ? ['سهل في التشغيل والتنفيذ', 'أمان وخصوصية', 'منظومة موحدة', 'دعم مستمر', 'قابلية التوسع'] :
        ['Simple to operate', 'Privacy & security', 'One connected system', 'Ongoing support', 'Room to grow'];
      return '<main id="main" class="reference-home-root' + (ar ? ' is-ar' : ' is-en') + '">' +
        '<section class="rh-hero"><div class="rh-hero-photo"><img src="/assets/thanarah-reception.webp" width="1400" height="946" fetchpriority="high" decoding="async" alt="' +
        (ar ? 'مشهد تصوري لاستقبال ثنارة بتصميم خشبي ونباتات ومكتب استقبال' : 'Conceptual Thanarah reception scene with warm timber, plants and a reception desk') +
        '"></div><div class="rh-hero-copy"><span class="rh-eyebrow">' +
        (ar ? 'منظومة تقنية متكاملة للرعاية الصحية' : 'An integrated technology ecosystem for healthcare') +
        '</span><h1>' + (ar ? 'ثنارة' : 'Thanarah') + '</h1><h2>' +
        (ar ? 'تشغّل، تنظّم، وتنمّي<br>أعمالك الصحية.' : 'Operate, organise and grow<br>your healthcare practice.') +
        '</h2><p>' + (ar ? 'منصة موحدة لإدارة العيادات والمراكز الطبية، تبدأ من التشغيل السريري وتوضح ما هو قائم وما يحتاج إلى تقييم.' :
          'A unified platform for clinics and medical centres, starting with clinical operations and clarifying what exists today and what needs assessment.') +
        '</p><div class="rh-hero-actions"><a class="rh-pill rh-pill-primary" href="/contact/">' +
        (ar ? 'ابدأ رحلتك مع ثنارة' : 'Start your Thanarah journey') + '<span aria-hidden="true">←</span></a>' +
        '<a class="rh-pill rh-pill-outline" href="#clinic">' + (ar ? 'شاهد كيف نعمل' : 'See how we work') +
        '<span aria-hidden="true">◉</span></a></div></div></section>' +
        '<section class="rh-benefit-bar" aria-label="' + (ar ? 'مميزات ثنارة' : 'Thanarah benefits') + '">' +
        [[icon('bolt'), ar ? 'تشغيل يومي سلس' : 'Smooth daily operations'], [icon('layers'), ar ? 'حلول متكاملة' : 'Connected solutions'],
          [icon('chart'), ar ? 'دعم النمو والتوسع' : 'Support growth'], [icon('shield'), ar ? 'أمان وخصوصية' : 'Privacy and security']]
          .map(function (x) { return '<div class="rh-benefit-item"><span>' + x[0] + '</span><strong>' + x[1] + '</strong></div>'; }).join('') +
        '</section><section class="rh-clinic" id="clinic"><div class="rh-clinic-image"><img src="/assets/thanarah-devices.webp" width="1400" height="933" loading="lazy" decoding="async" alt="' +
        (ar ? 'مشهد تصوري لحاسوب وهاتف يعرضان واجهة عيادة مفاهيمية، وليست لقطة من نظام فعلي' :
          'Conceptual laptop and phone clinic interface scene, not a screenshot of a live system') + '"></div><div class="rh-clinic-copy">' +
        '<span class="rh-eyebrow">' + (ar ? 'المنظومة الأساسية' : 'THE CLINICAL FOUNDATION') + '</span><h2>' +
        (ar ? 'ثنارة كلينك' : 'Thanarah Clinic') + '</h2><p>' +
        (ar ? 'نظام متكامل لإدارة العيادات والمراكز الطبية، من المرضى والمواعيد إلى الزيارات السريرية والأدوار.' :
          'A connected system for clinics and medical centres, from patients and appointments to clinical encounters and user roles.') +
        '</p><div class="rh-clinic-features"><span>' + icon('people') + (ar ? 'إدارة المرضى' : 'Patient management') +
        '</span><span>' + icon('calendar') + (ar ? 'تنظيم المواعيد' : 'Appointments') + '</span><span>' +
        icon('document') + (ar ? 'الزيارات السريرية' : 'Clinical encounters') + '</span><span>' + icon('shield') +
        (ar ? 'الأدوار والصلاحيات' : 'Roles & permissions') + '</span></div><a class="rh-pill rh-pill-primary" href="/services/">' +
        (ar ? 'اكتشف ثنارة كلينك' : 'Explore Thanarah Clinic') + '<span aria-hidden="true">←</span></a>' +
        '<small class="rh-image-caption">' + (ar ? 'مشهد تصوري من المرجع التصميمي؛ لا يعرض واجهة تشغيل فعلية.' :
          'Conceptual reference scene; not a live product interface.') + '</small></div></section>' +
        '<section class="rh-solutions"><header class="rh-section-heading"><span class="rh-eyebrow">' +
        (ar ? 'حلول ثنارة' : 'THANARAH SOLUTIONS') + '</span><h2>' +
        (ar ? 'أكثر من إدارة عيادة، منظومة متكاملة للنمو' : 'More than clinic operations, a connected ecosystem for growth') +
        '</h2></header><div class="rh-solution-grid">' + solutions.map(function (solution) {
          return '<a class="rh-solution-card" href="/contact/?topic=' + encodeURIComponent(solution[4]) +
            '"><span class="rh-solution-icon">' + icon(solution[0]) + '</span><span class="rh-solution-title">' +
            solution[1] + '</span><span class="rh-solution-description">' + solution[2] +
            '</span><span class="rh-status">' + solution[3] + '</span><span class="rh-card-arrow" aria-hidden="true">←</span></a>';
        }).join('') + '</div><p class="rh-status-note">' +
        (ar ? 'هذه المجالات قيد التطوير أو التقييم، وليست خدمات متاحة حاليًا. تواصل معنا لمناقشة الاحتياج.' :
          'These areas are in development or assessment, not currently available services. Contact us to discuss a need.') +
        '</p></section><section class="rh-packages" id="plans"><div class="rh-package-curve"></div><div class="rh-packages-inner">' +
        '<span class="rh-eyebrow">' + (ar ? 'الباقات' : 'PACKAGES') + '</span><h2>' +
        (ar ? 'اختر الباقة المناسبة لعملك' : 'Choose a package for your practice') + '</h2><p>' +
        (ar ? 'باقات مرنة تناسب احتياجات العيادات والمراكز الطبية.' :
          'Flexible packages for the needs of clinics and medical centres.') + '</p><div class="rh-package-grid" id="home-packages" aria-live="polite"><div class="rh-package-loading"></div><div class="rh-package-loading"></div><div class="rh-package-loading"></div></div><small>' + (ar ? 'النطاق والتسعير عبر عرض سعر بعد مناقشة الاحتياج.' :
          'Scope and pricing are quote-based after discussing your needs.') + '</small></div></section>' +
        '<section class="rh-why"><div class="rh-why-content"><span class="rh-eyebrow">' +
        (ar ? 'لماذا ثنارة؟' : 'WHY THANARAH') + '</span><h2>' +
        (ar ? 'قيمة حقيقية لقطاع صحي أكثر تطورًا' : 'Meaningful value for a more connected healthcare sector') +
        '</h2><div class="rh-principles">' + principles.map(function (text, index) {
          var names = ['people', 'layers', 'shield', 'bolt', 'chart'];
          return '<div><span>' + icon(names[index]) + '</span><strong>' + text + '</strong></div>';
        }).join('') + '</div></div></section><section class="rh-cta"><div class="rh-cta-copy"><span class="rh-eyebrow">' +
        (ar ? 'خطوتك القادمة' : 'YOUR NEXT STEP') + '</span><h2>' +
        (ar ? 'ابدأ الآن، وطوّر تجربة الرعاية في عيادتك.' : 'Start today. Build a better care experience.') +
        '</h2><p>' + (ar ? 'انضم إلى ثنارة واستفد من منظومة متكاملة تدعم نمو منشأتك.' :
          'Talk with Thanarah about a connected foundation for your practice.') + '</p></div><a class="rh-pill rh-cta-button" href="/contact/">' +
        (ar ? 'ابدأ الآن' : 'Get started') + '<span aria-hidden="true">←</span></a><div class="rh-chair">' +
        '<img src="/assets/home-chair.webp" width="266" height="196" loading="lazy" decoding="async" alt="' +
        (ar ? 'مشهد تصوري لكرسي عيادة ضمن مساحة رعاية صحية' : 'Conceptual clinical chair in a healthcare space') +
        '"></div></section><section class="rh-home-faq" aria-labelledby="home-faq-heading"><h2 id="home-faq-heading">' +
        (ar ? 'الأسئلة الشائعة' : 'Frequently asked questions') + '</h2>' +
        [[t.faq1, t.faq1Body], [t.faq2, t.faq2Body], [t.faq3, t.faq3Body], [t.faq4, t.faq4Body], [t.faq5, t.faq5Body],
          [t.securityTitle, t.securityBody + ' ' + t.securityNote],
          [ar ? 'ما الذي يشمله الأساس السريري؟' : 'What is included in the clinical foundation?',
            t.capabilityBody + ' ' + t.capOne + ': ' + t.capOneBody + ' ' + t.capTwo + ': ' + t.capTwoBody +
            ' ' + t.capThree + ': ' + t.capThreeBody + ' ' + t.capFour + ': ' + t.capFourBody + ' ' + t.clinicalNote]]
          .map(function (faq) { return '<details><summary>' + esc(faq[0]) + '</summary><p>' + esc(faq[1]) + '</p></details>'; }).join('') +
        '</section></main>';
    }
    function packageCard(pack, catalog) {
      var code = pack[0];
      var item = catalog && catalog.packages && catalog.packages.find(function (entry) {
        return entry.code === code && entry.published === true;
      });
      var description = item && item.description ? esc(item.description) : esc(t.unconfirmed);
      var features = item && Array.isArray(item.features) ? item.features : [];
      var price = item && item.priceMinor !== null && item.priceMinor !== undefined
        ? packagePrice(item.priceMinor)
        : null;
      var priceLabel = String((catalog && catalog.termsText) || '').includes('تجريبي')
        ? t.demoPriceLabel
        : t.publishedPriceLabel;
      var orderOpen = catalog && catalog.ordersOpen === true;
      var actionUrl = orderOpen
        ? '/customer/?package=' + encodeURIComponent(code)
        : '/contact/?package=' + encodeURIComponent(code);
      var actionLabel = orderOpen
        ? (ar ? 'ابدأ طلب الباقة' : 'Start this package')
        : (code === 'Customize' ? (ar ? 'ناقش احتياجك' : 'Discuss your needs') :
          (ar ? 'اطلب الباقة' : 'Discuss this package'));
      return '<article class="rh-package-card' + (code === 'Pro' ? ' rh-package-pro' : '') +
        '"><span class="rh-package-icon">' + icon(code === 'Lite' ? 'bolt' : code === 'Pro' ? 'layers' : 'compass') +
        '</span><h3 dir="ltr">' + code + '</h3><strong class="rh-package-code">' + pack[1] + '</strong><p>' +
        description + '</p>' + (price ? '<strong class="rh-package-price">' + esc(priceLabel) + ' · ' +
        esc(price) + '</strong>' : '') + (features.length ? '<ul>' + features.map(function (feature) {
          return '<li>' + esc(feature) + '</li>';
        }).join('') + '</ul>' : '') + '<a href="' + esc(actionUrl) + '">' +
        esc(actionLabel) + '<span aria-hidden="true">←</span></a></article>';
    }
    function packages(data) {
      var labels = ar ? {
        Customize: ['مخصصة', 'حل مصمم حسب احتياجاتك'],
        Pro: ['احترافية', 'مزايا متقدمة لاحتياجات أكبر'],
        Lite: ['أساسية', 'كل ما تحتاجه لبدء إدارة عيادتك']
      } : {
        Customize: ['Custom', 'A scope shaped around your needs'],
        Pro: ['Professional', 'More room for growing practices'],
        Lite: ['Essential', 'A clear place to begin']
      };
      return ['Customize', 'Pro', 'Lite'].map(function (code) {
        return packageCard([code, labels[code][0], labels[code][1]], data);
      }).join('');
    }
    function packageFallback() {
      return packages({ packages: [] });
    }
    return { header: header, footer: footer, home: home, packages: packages, packageFallback: packageFallback };
  }
  root.ThanarahReferenceHome = create;
})(window);
