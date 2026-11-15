(function (root, document) {
  'use strict';

  if (!document || document.querySelector('[data-thanarah-shell]')) return;

  // Browser and touch icons use the same supplied symbol as every in-page logo.
  // A versioned URL also refreshes favicons browsers may cache independently.
  var brandVersion = '?v=owner-symbol';
  document.querySelectorAll('link[rel~="icon"]').forEach(function (link) {
    link.href = '/assets/thanarah-icon-32.png' + brandVersion;
    link.type = 'image/png';
    link.sizes = '32x32';
  });
  [
    ['icon', '/assets/thanarah-icon-16.png', '16x16'],
    ['icon', '/assets/thanarah-icon-192.png', '192x192'],
    ['apple-touch-icon', '/assets/thanarah-icon-180.png', '180x180']
  ].forEach(function (item) {
    var link = document.createElement('link');
    link.rel = item[0]; link.href = item[1] + brandVersion; link.sizes = item[2];
    if (item[0] === 'icon') link.type = 'image/png';
    document.head.appendChild(link);
  });

  var publicLocaleKey = 'thanarah.public-locale';
  var workspaceLocaleKey = 'thanarah.ui-language';
  var path = (root.location.pathname.replace(/\/+$/, '') || '/');
  var customerPage = path === '/customer';
  var language = 'ar';
  var authenticatedAudience = '';
  var staffRoutes = [
    '/platform', '/platform-saas', '/platform-setup', '/clinic-setup',
    '/doctor-setup', '/team-setup', '/catalog-setup', '/customer-admin',
    '/company', '/ai-admin', '/appointments', '/patients', '/encounters',
    '/finance', '/communications', '/website-inquiries'
  ];
  var isStaffRoute = staffRoutes.indexOf(path) !== -1;
  var pageNames = {
    '/': ['الرئيسية', 'Home'],
    '/welcome': ['الرئيسية', 'Home'],
    '/site': ['الرئيسية', 'Home'],
    '/about': ['من نحن', 'About'],
    '/services': ['الخدمات', 'Services'],
    '/packages': ['الباقات', 'Packages'],
    '/why-thanarah': ['لماذا ثنارة', 'Why Thanarah'],
    '/contact': ['التواصل', 'Contact'],
    '/customer': ['مساحة العميل', 'Customer workspace'],
    '/platform': ['مساحات العمل', 'Workspaces'],
    '/platform-saas': ['اشتراكات المنصة', 'Platform subscriptions'],
    '/platform-setup': ['إعداد المنصة', 'Platform setup'],
    '/clinic-setup': ['إعداد العيادة', 'Clinic setup'],
    '/doctor-setup': ['الأطباء والخدمات', 'Doctors and services'],
    '/team-setup': ['الفريق والصلاحيات', 'Team and access'],
    '/catalog-setup': ['كتالوج الخدمات', 'Service catalog'],
    '/customer-admin': ['مكتب خدمة العيادات', 'Clinic service desk'],
    '/company': ['عمليات الشركة', 'Company operations'],
    '/website-inquiries': ['استفسارات الموقع', 'Website inquiries'],
    '/ai-admin': ['إدارة الذكاء الاصطناعي', 'AI administration'],
    '/appointments': ['المواعيد', 'Appointments'],
    '/patients': ['المرضى', 'Patients'],
    '/encounters': ['الزيارات الطبية', 'Encounters'],
    '/finance': ['المالية', 'Finance'],
    '/communications': ['التواصل', 'Communications']
  };

  function readLanguage() {
    try {
      var isPublicSite = path === '/' || path === '/welcome' || path === '/site' ||
        ['/about', '/contact', '/packages', '/services', '/why-thanarah'].indexOf(path) !== -1;
      var preferredKey = isPublicSite ? publicLocaleKey : workspaceLocaleKey;
      var fallbackKey = isPublicSite ? workspaceLocaleKey : publicLocaleKey;
      var value = root.localStorage.getItem(preferredKey) || root.localStorage.getItem(fallbackKey);
      return value === 'en' ? 'en' : 'ar';
    } catch (_) {
      return document.documentElement.lang === 'en' ? 'en' : 'ar';
    }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function navItems(ar) {
    if (isStaffRoute) {
      return [
        ['/platform/', ar ? 'مساحات العمل' : 'Workspaces', 'workspace'],
        ['/customer-admin/', ar ? 'خدمة العملاء' : 'Customer service', 'customer-admin'],
        ['/company/', ar ? 'عمليات الشركة' : 'Company operations', 'company'],
        ['/website-inquiries/', ar ? 'استفسارات الموقع' : 'Website inquiries', 'website-inquiries'],
        ['/', ar ? 'الموقع العام' : 'Public site', 'home']
      ];
    }
    if (customerPage) {
      return [
        ['/customer/', ar ? 'طلباتي' : 'My requests', 'customer'],
        ['/packages/', ar ? 'الباقات' : 'Packages', 'packages'],
        ['/contact/', ar ? 'الدعم والتواصل' : 'Support', 'contact'],
        ['/', ar ? 'الرئيسية' : 'Home', 'home']
      ];
    }
    return [
      ['/', ar ? 'الرئيسية' : 'Home', 'home'],
      ['/about/', ar ? 'من نحن' : 'About', 'about'],
      ['/#clinic', ar ? 'المنظومة' : 'Platform', 'platform'],
      ['/services/', ar ? 'الخدمات' : 'Services', 'services'],
      ['/packages/', ar ? 'الباقات' : 'Packages', 'packages'],
      ['/customer/', ar ? 'العملاء' : 'Customers', 'customer'],
      ['/contact/', ar ? 'تواصل معنا' : 'Contact', 'contact']
    ];
  }

  function activeNav(item) {
    var key = item[2];
    if (key === 'workspace') return path === '/platform';
    if (key === 'customer-admin') return path === '/customer-admin';
    if (key === 'company') return path === '/company';
    if (key === 'website-inquiries') return path === '/website-inquiries';
    if (key === 'home') return path === '/' || path === '/welcome' || path === '/site';
    if (key === 'platform') return isStaffRoute && path !== '/customer-admin';
    if (key === 'customer') return path === '/customer' || path === '/customer-admin';
    return path === '/' + key || path.indexOf('/' + key + '/') === 0;
  }

  function pageName(ar) {
    var labels = pageNames[path];
    if (!labels && isStaffRoute) return ar ? 'مساحة الفريق' : 'Team workspace';
    return labels ? labels[ar ? 0 : 1] : (ar ? 'ثنارة' : 'Thanarah');
  }

  function languageControl(ar) {
    return '<div class="thanarah-shell-language-wrap"><button class="thanarah-shell-language" type="button" ' +
      'data-locale-toggle aria-expanded="false" aria-controls="thanarah-shell-language-menu" lang="' +
      (ar ? 'ar' : 'en') + '" aria-label="' +
      (ar ? 'اختيار اللغة، الحالية العربية' : 'Choose language, currently English') + '">' +
      '<svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.25"></circle>' +
      '<path d="M2.9 10h14.2M10 2.75c1.8 1.95 2.7 4.37 2.7 7.25s-.9 5.3-2.7 7.25C8.2 15.3 7.3 12.88 7.3 10s.9-5.3 2.7-7.25Z"></path></svg>' +
      '<span class="thanarah-shell-language-label" lang="' + (ar ? 'ar' : 'en') + '">' +
      (ar ? 'العربية' : 'English') + '</span><span class="thanarah-shell-language-chevron" aria-hidden="true">⌄</span></button>' +
      '<div class="thanarah-shell-language-menu" id="thanarah-shell-language-menu" data-locale-skip role="group" aria-label="' +
      (ar ? 'اختيار اللغة' : 'Choose language') + '" hidden>' +
      '<button type="button" data-locale-choice="ar" lang="ar" dir="rtl" aria-pressed="' + String(ar) +
      '"><span>العربية</span></button><button type="button" data-locale-choice="en" lang="en" dir="ltr" aria-pressed="' +
      String(!ar) + '"><span>English</span></button></div></div>';
  }

  function header(ar) {
    var mainAudience = isStaffRoute ? 'staff' : 'customer';
    var links = navItems(ar).map(function (item) {
      return '<a href="' + item[0] + '"' + (activeNav(item) ? ' aria-current="page"' : '') +
        '>' + item[1] + '</a>';
    }).join('');
    var authControls = mainAudience === 'staff'
      ? '<button class="thanarah-shell-action thanarah-shell-action-primary" type="button" data-thanarah-auth="login" data-auth-audience="staff">' +
        (ar ? 'دخول' : 'Sign in') + '</button>'
      : '<button class="thanarah-shell-action" type="button" aria-label="' + (ar ? 'تسجيل الدخول' : 'Sign in') + '" data-thanarah-auth="login" data-auth-audience="customer">' +
        (ar ? 'دخول' : 'Sign in') + '</button>' +
        '<button class="thanarah-shell-action thanarah-shell-action-primary" type="button" data-thanarah-auth="register" data-auth-audience="customer">' +
        (ar ? 'إنشاء حساب' : 'Create account') + '</button>';
    return '<header class="thanarah-shell thanarah-shell-header" data-thanarah-shell>' +
      '<a class="thanarah-shell-skip" href="#main">' + (ar ? 'تجاوز إلى المحتوى' : 'Skip to content') + '</a>' +
      '<div class="thanarah-shell-inner"><a class="thanarah-shell-brand" href="/" aria-label="' +
      (ar ? 'ثنارة | الرئيسية' : 'Thanarah | Home') + '"><img src="/assets/logo-mark.svg" width="39" height="39" alt="">' +
      '<span>' + (ar ? 'ثنارة' : 'Thanarah') + '<small>' + pageName(ar) + '</small></span></a>' +
      '<nav class="thanarah-shell-nav" id="thanarah-main-navigation" aria-label="' +
      (ar ? 'التنقل الرئيسي' : 'Main navigation') + '">' + links + '</nav>' +
      '<div class="thanarah-shell-actions">' + languageControl(ar) +
      '<span class="thanarah-shell-auth-actions">' +
      authControls + '</span>' +
      '<button class="thanarah-shell-menu" type="button" aria-expanded="false" aria-controls="thanarah-main-navigation" ' +
      'aria-label="' + (ar ? 'فتح القائمة' : 'Open menu') + '"><span class="thanarah-shell-menu-glyph" aria-hidden="true"><i></i><i></i></span></button>' +
      '</div></div></header>';
  }

  function footer(ar) {
    var quick = ar ? 'روابط سريعة' : 'Explore';
    if (isStaffRoute) {
      return '<footer class="thanarah-shell thanarah-shell-footer thanarah-shell-footer-workspace" data-thanarah-shell>' +
        '<div class="thanarah-shell-footer-main"><div class="thanarah-shell-footer-brand">' +
        '<a class="thanarah-shell-brand" href="/platform/"><img src="/assets/logo-mark.svg" width="39" height="39" alt="">' +
        '<span>' + (ar ? 'ثنارة' : 'Thanarah') + '<small>' + pageName(ar) + '</small></span></a><p>' +
        (ar ? 'مساحة عمل موحدة؛ تتغير أدواتها بحسب صلاحيات الحساب.' :
          'A shared workspace with tools determined by account permissions.') +
        '</p></div><div class="thanarah-shell-footer-col"><h2>' + (ar ? 'مساحات العمل' : 'Workspaces') + '</h2>' +
        '<a href="/platform/">' + (ar ? 'المنصة' : 'Platform') + '</a><a href="/company/">' +
        (ar ? 'عمليات الشركة' : 'Company operations') + '</a><a href="/customer-admin/">' +
        (ar ? 'خدمة العملاء' : 'Customer service') + '</a></div><div class="thanarah-shell-footer-col">' +
        '<h2>' + (ar ? 'المساعدة' : 'Help') + '</h2><a href="/website-inquiries/">' +
        (ar ? 'استفسارات الموقع' : 'Website inquiries') + '</a><a href="/contact/?topic=technical">' +
        (ar ? 'الدعم الفني' : 'Technical support') + '</a></div></div>' +
        '<div class="thanarah-shell-footer-bottom"><span>© ' + new Date().getFullYear() +
        ' THANARAH</span><span>' + (ar ? 'مساحة عمل ثنارة' : 'Thanarah workspace') + '</span></div></footer>';
    }
    if (customerPage) {
      return '<footer class="thanarah-shell thanarah-shell-footer thanarah-shell-footer-customer" data-thanarah-shell>' +
        '<div class="thanarah-shell-footer-main"><div class="thanarah-shell-footer-brand">' +
        '<a class="thanarah-shell-brand" href="/"><img src="/assets/logo-mark.svg" width="39" height="39" alt="">' +
        '<span>' + (ar ? 'ثنارة' : 'Thanarah') + '<small>' + pageName(ar) + '</small></span></a><p>' +
        (ar ? 'تابع طلباتك ووثائقك ضمن مساحة العميل.' : 'Follow your requests and documents in your customer workspace.') +
        '</p></div><div class="thanarah-shell-footer-col"><h2>' + (ar ? 'مساحة العميل' : 'Customer workspace') + '</h2>' +
        '<a href="/customer/">' + (ar ? 'طلباتي' : 'My requests') + '</a><a href="/packages/">' +
        (ar ? 'الباقات' : 'Packages') + '</a><a href="/contact/">' +
        (ar ? 'الدعم والتواصل' : 'Support') + '</a></div></div>' +
        '<div class="thanarah-shell-footer-bottom"><span>© ' + new Date().getFullYear() +
        ' THANARAH</span><span>' + (ar ? 'مساحة العميل' : 'Customer workspace') + '</span></div></footer>';
    }
    return '<footer class="thanarah-shell thanarah-shell-footer" data-thanarah-shell>' +
      '<div class="thanarah-shell-footer-main"><div class="thanarah-shell-footer-brand">' +
      '<a class="thanarah-shell-brand" href="/"><img src="/assets/logo-mark.svg" width="39" height="39" alt="">' +
      '<span>' + (ar ? 'ثنارة' : 'Thanarah') + '<small>Thanarah · ثنارة</small></span></a><p>' +
      (ar ? 'منظومة تقنية متكاملة تدعم تشغيل العيادات والمراكز الطبية ونموها.' :
        'An integrated technology ecosystem for clinic operations and sustainable growth.') +
      '</p></div><div class="thanarah-shell-footer-col"><h2>' + quick + '</h2>' +
      '<a href="/about/">' + (ar ? 'من نحن' : 'About Thanarah') + '</a><a href="/services/">' +
      (ar ? 'الخدمات' : 'Services') + '</a><a href="/packages/">' + (ar ? 'الباقات' : 'Packages') +
      '</a><a href="/why-thanarah/">' + (ar ? 'لماذا ثنارة' : 'Why Thanarah') + '</a></div>' +
      '<div class="thanarah-shell-footer-col"><h2>' + (ar ? 'المنظومة' : 'Platform') + '</h2>' +
      '<a href="/#clinic">' + (ar ? 'ثنارة كلينك' : 'Thanarah Clinic') + '</a><a href="/customer/">' +
      (ar ? 'مساحة العملاء' : 'Customer workspace') + '</a></div><div class="thanarah-shell-footer-col">' +
      '<h2>' + (ar ? 'تواصل' : 'Connect') + '</h2><a href="/contact/">' +
      (ar ? 'تواصل معنا' : 'Contact us') + '</a><a href="/contact/?topic=technical">' +
      (ar ? 'الدعم الفني' : 'Technical support') + '</a></div></div>' +
      '<div class="thanarah-shell-footer-bottom"><span>© ' + new Date().getFullYear() +
      ' THANARAH</span><span>' + (ar ? 'جميع الحقوق محفوظة' : 'All rights reserved') + '</span></div></footer>';
  }

  function setLocaleUI(ar) {
    var button = document.querySelector('.thanarah-shell-language');
    var languageLabel = button && button.querySelector('.thanarah-shell-language-label');
    var languageMenu = document.querySelector('.thanarah-shell-language-menu');
    var brandContext = document.querySelector('.thanarah-shell-header .thanarah-shell-brand small');
    var nav = document.querySelector('.thanarah-shell-nav');
    var menu = document.querySelector('.thanarah-shell-menu');
    var actions = document.querySelector('.thanarah-shell-auth-actions');
    if (brandContext) brandContext.textContent = pageName(ar);
    if (button) {
      if (languageLabel) languageLabel.textContent = ar ? 'العربية' : 'English';
      button.setAttribute('aria-label', ar
        ? 'اختيار اللغة، الحالية العربية'
        : 'Choose language, currently English');
      button.setAttribute('lang', ar ? 'ar' : 'en');
      button.setAttribute('aria-expanded', 'false');
    }
    if (languageMenu) {
      languageMenu.setAttribute('aria-label', ar ? 'اختيار اللغة' : 'Choose language');
      languageMenu.hidden = true;
      languageMenu.querySelectorAll('[data-locale-choice]').forEach(function (choice) {
        choice.setAttribute('aria-pressed', String(choice.dataset.localeChoice === (ar ? 'ar' : 'en')));
      });
    }
    if (nav) {
      nav.setAttribute('aria-label', ar ? 'التنقل الرئيسي' : 'Main navigation');
      nav.innerHTML = navItems(ar).map(function (item) {
        return '<a href="' + item[0] + '"' + (activeNav(item) ? ' aria-current="page"' : '') +
          '>' + item[1] + '</a>';
      }).join('');
    }
    if (menu) menu.setAttribute('aria-label', ar ? 'فتح القائمة' : 'Open menu');
    if (actions) {
      if (authenticatedAudience) {
        var destination = authenticatedAudience === 'staff'
          ? (staffRoutes.indexOf(path) !== -1 ? path + '/' : '/platform/')
          : '/customer/';
        actions.innerHTML = '<a class="thanarah-shell-action thanarah-shell-action-primary" data-authenticated-workspace href="' +
          destination + '">' + (authenticatedAudience === 'staff'
            ? (ar ? 'مساحة الفريق' : 'Team workspace')
            : (ar ? 'مساحة العملاء' : 'Customer workspace')) + '</a>';
      } else if (isStaffRoute) {
        actions.innerHTML = '<button class="thanarah-shell-action thanarah-shell-action-primary" type="button" data-thanarah-auth="login" data-auth-audience="staff">' +
          (ar ? 'دخول' : 'Sign in') + '</button>';
      } else {
        actions.innerHTML = '<button class="thanarah-shell-action" type="button" aria-label="' + (ar ? 'تسجيل الدخول' : 'Sign in') + '" data-thanarah-auth="login" data-auth-audience="customer">' +
          (ar ? 'دخول' : 'Sign in') + '</button><button class="thanarah-shell-action thanarah-shell-action-primary" type="button" data-thanarah-auth="register" data-auth-audience="customer">' +
          (ar ? 'إنشاء حساب' : 'Create account') + '</button>';
      }
    }
    var oldFooter = document.querySelector('.thanarah-shell-footer');
    if (oldFooter) {
      var holder = document.createElement('div');
      holder.innerHTML = footer(ar);
      oldFooter.replaceWith(holder.firstElementChild);
    }
  }

  function updateAuthState(event) {
    if (!event || !event.detail) return;
    if (event.detail.authenticated === false) {
      authenticatedAudience = '';
      setLocaleUI(language === 'ar');
      return;
    }
    var audience = event.detail.audience === 'staff' ? 'staff' : 'customer';
    authenticatedAudience = audience;
    var ar = language === 'ar';
    var actions = document.querySelector('.thanarah-shell-auth-actions');
    if (!actions) return;
    var target = audience === 'staff' ? (staffRoutes.indexOf(path) !== -1 ? path + '/' : '/platform/') : '/customer/';
    actions.innerHTML = '<a class="thanarah-shell-action thanarah-shell-action-primary" data-authenticated-workspace href="' + esc(target) + '">' +
      (audience === 'staff' ? (ar ? 'مساحة الفريق' : 'Team workspace') :
        (ar ? 'مساحة العملاء' : 'Customer workspace')) + '</a>';
  }

  function closeMenu() {
    var menu = document.querySelector('.thanarah-shell-menu');
    var nav = document.querySelector('.thanarah-shell-nav');
    if (!menu || !nav || menu.getAttribute('aria-expanded') !== 'true') return;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', language === 'ar' ? 'فتح القائمة' : 'Open menu');
    nav.classList.remove('is-open');
  }

  function closeLanguageMenu(returnFocus) {
    var button = document.querySelector('.thanarah-shell-language');
    var menu = document.querySelector('.thanarah-shell-language-menu');
    if (!button || !menu || menu.hidden) return;
    if (returnFocus) button.focus({ preventScroll: true });
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function openLanguageMenu() {
    var button = document.querySelector('.thanarah-shell-language');
    var menu = document.querySelector('.thanarah-shell-language-menu');
    if (!button || !menu) return;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    var current = menu.querySelector('[data-locale-choice][aria-pressed="true"]');
    if (current) current.focus();
  }

  language = readLanguage();
  var existingApp = document.getElementById('app') || document.getElementById('encounter-app');
  var headerHost = document.createElement('div');
  headerHost.innerHTML = header(language === 'ar');
  var shellHeader = headerHost.firstElementChild;
  if (existingApp && existingApp.parentNode) existingApp.parentNode.insertBefore(shellHeader, existingApp);
  else document.body.insertBefore(shellHeader, document.body.firstChild);
  var skip = shellHeader.querySelector('.thanarah-shell-skip');
  var skipTarget = document.querySelector('main[id]') || existingApp || document.getElementById('inbox');
  if (skipTarget) {
    skip.href = '#' + skipTarget.id;
    if (!skipTarget.hasAttribute('tabindex')) skipTarget.setAttribute('tabindex', '-1');
  }

  var footerHost = document.createElement('div');
  footerHost.innerHTML = footer(language === 'ar');
  var shellFooter = footerHost.firstElementChild;
  if (existingApp && existingApp.parentNode) existingApp.parentNode.insertBefore(shellFooter, existingApp.nextSibling);
  else document.body.appendChild(shellFooter);

  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (!target.closest('.thanarah-shell-language-wrap')) closeLanguageMenu(false);
    var menu = target.closest('.thanarah-shell-menu');
    if (menu) {
      var nav = document.querySelector('.thanarah-shell-nav');
      var open = menu.getAttribute('aria-expanded') === 'true';
      menu.setAttribute('aria-expanded', String(!open));
      menu.setAttribute('aria-label', !open
        ? (language === 'ar' ? 'إغلاق القائمة' : 'Close menu')
        : (language === 'ar' ? 'فتح القائمة' : 'Open menu'));
      if (nav) nav.classList.toggle('is-open', !open);
      return;
    }
    if (target.closest('.thanarah-shell-nav a')) closeMenu();

    var localeChoice = target.closest('[data-locale-choice]');
    if (localeChoice) {
      var next = localeChoice.dataset.localeChoice === 'en' ? 'en' : 'ar';
      closeLanguageMenu(true);
      if (next === language) return;
      if (root.ThanarahLocale) {
        language = next;
        root.ThanarahLocale.setLocale(next);
        setLocaleUI(next === 'ar');
        return;
      }
      language = next;
      try {
        root.localStorage.setItem(publicLocaleKey, next);
        root.localStorage.setItem(workspaceLocaleKey, next);
      } catch (_) {}
      document.documentElement.lang = next;
      document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
      setLocaleUI(next === 'ar');
      root.dispatchEvent(new CustomEvent('thanarah:locale-changed', { detail: { locale: next } }));
      return;
    }
    var localeButton = target.closest('.thanarah-shell-language');
    if (localeButton) {
      if (localeButton.getAttribute('aria-expanded') === 'true') closeLanguageMenu(false);
      else openLanguageMenu();
      return;
    }
    if (!target.closest('.thanarah-shell-header')) closeMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var languageMenu = document.querySelector('.thanarah-shell-language-menu:not([hidden])');
    if (languageMenu) {
      closeLanguageMenu(true);
      return;
    }
    var menu = document.querySelector('.thanarah-shell-menu[aria-expanded="true"]');
    if (!menu) return;
    closeMenu();
    menu.focus();
  });
  root.addEventListener('thanarah:auth-changed', updateAuthState);
  root.addEventListener('thanarah:locale-changed', function (event) {
    language = event.detail && event.detail.locale === 'en' ? 'en' : 'ar';
    setLocaleUI(language === 'ar');
  });
})(window, document);
