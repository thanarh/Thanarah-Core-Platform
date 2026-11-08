(function attachThanarahLocale(root) {
  'use strict';

  const html = document.documentElement;
  const dictionaries = root.ThanarahTranslations || {};
  const storageKey = 'thanarah.ui-language';
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  let locale = readSavedLocale();
  const wordingOverrides = {
    خروج: 'Sign out',
    'تسجيل الخروج': 'Sign out',
    دخول: 'Sign in',
    'تسجيل الدخول': 'Sign in',
    'الوصول محدود': 'Access restricted',
  };

  const staticTextContainers = [
    '[role="alert"]',
    '[role="status"]',
    '.toast',
    '.inline-message',
    '.success-message',
    '.auth-intro',
    '.screen-footer',
    '.page-heading p',
    '.form-note',
    '.setup-note',
    '.catalog-help',
    '.doctor-note',
    '.platform-muted',
    '.saas-note',
    '.eyebrow',
    '.breadcrumbs',
    '.nav-item',
    '.field',
    '.status-pill',
    '.setup-status',
    '.platform-status',
    '.saas-status',
    '.encounter-status',
    '.encounter-field',
    '.empty-state',
    '.error-state',
    '.loading-state',
    '.catalog-empty',
    '.catalog-error',
    '.setup-empty',
    '.setup-error',
    '.platform-empty',
    '.encounter-empty',
    '.encounter-loading',
    'h1',
    'h2',
    'h3',
    'button:not(.workspace-option):not(.team-member)',
    'label',
  ].join(',');

  function readSavedLocale() {
    try {
      return root.localStorage.getItem(storageKey) === 'en' ? 'en' : 'ar';
    } catch (_) {
      return 'ar';
    }
  }

  function routeDictionary() {
    const path = root.location.pathname.endsWith('/')
      ? root.location.pathname
      : `${root.location.pathname}/`;
    return dictionaries[path] || {};
  }

  function lookup(text) {
    if (wordingOverrides[text]) return wordingOverrides[text];
    const route = routeDictionary();
    return route[text] || (dictionaries.global && dictionaries.global[text]) || '';
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/gu, ' ').trim();
  }

  function normalizeEnglishNumerals(text) {
    const digits = '0123456789';
    return String(text)
      .replace(/[٠-٩۰-۹]/gu, (digit) => {
        const code = digit.charCodeAt(0);
        const start = code >= 0x0660 && code <= 0x0669 ? 0x0660 : 0x06f0;
        return digits[code - start];
      })
      .replace(/٬/gu, ',')
      .replace(/٫/gu, '.');
  }

  function translationEntries() {
    return Object.entries({ ...(dictionaries.global || {}), ...routeDictionary() })
      .filter(([source, target]) => source.length >= 3 && target)
      .sort(([left], [right]) => right.length - left.length);
  }

  function translate(text, allowFragments) {
    const normalized = normalizeText(text);
    const exact = lookup(normalized);
    if (exact) {
      const leading = String(text).match(/^\s*/u)?.[0] || '';
      const trailing = String(text).match(/\s*$/u)?.[0] || '';
      return `${leading}${exact}${trailing}`;
    }
    if (!allowFragments) return text;

    let result = String(text).replace(/\s+/gu, ' ');
    for (const [source, target] of translationEntries()) {
      if (result.includes(source)) result = result.split(source).join(target);
    }
    return result;
  }

  function isUserContent(element) {
    return !!element.closest(
      [
        'bdi',
        'code',
        '.mono',
        '[data-locale-toggle]',
        '[data-locale-skip]',
        '.workspace-name',
        '.user-chip',
        '.patient-name',
        '.profile-identity h1',
        '.doctor-row-main h3',
        '.team-member strong',
        '.team-member small',
        '.platform-item-select strong',
        '.platform-member code',
        '.setup-card strong',
        '.catalog-item strong',
        '.service-assignment-copy strong',
        '.doctor-chip',
        '.saas-item > strong',
      ].join(','),
    );
  }

  function canTranslateFragments(element) {
    return !!element.closest(staticTextContainers);
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || isUserContent(parent)) return;
    if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'OPTION') {
      if (parent.tagName !== 'OPTION') return;
      if (
        parent.value &&
        !/^(ACTIVE|INACTIVE|SUSPENDED|DEACTIVATED|INVITED|REMOVED|ARCHIVED|CANCELLED|CANCELED|COMPLETED|PENDING|SCHEDULED|CHECKED_IN|IN_PROGRESS|NO_SHOW|PRIMARY|SECONDARY|UNTOUCHED|UNKNOWN|NEGATIVE|DOCUMENTED|CLEAR|RESOLVED|PLANNED)$/u.test(
          parent.value,
        )
      ) {
        return;
      }
    }

    const current = node.nodeValue || '';
    let record = textState.get(node);
    const source = record && current === record.applied ? record.source : current;
    const translated =
      locale === 'en'
        ? normalizeEnglishNumerals(translate(source, canTranslateFragments(parent)))
        : source;
    if (!record || source !== record.source || translated !== record.applied) {
      record = { source, applied: translated };
      textState.set(node, record);
    }
    if (current !== translated) node.nodeValue = translated;
  }

  function translateAttribute(element, name) {
    const value = element.getAttribute(name);
    if (value == null || isUserContent(element)) return;
    let values = attributeState.get(element);
    if (!values) {
      values = new Map();
      attributeState.set(element, values);
    }
    let record = values.get(name);
    const source = record && value === record.applied ? record.source : value;
    const translated = locale === 'en' ? translate(source, canTranslateFragments(element)) : source;
    values.set(name, { source, applied: translated });
    if (value !== translated) element.setAttribute(name, translated);
  }

  function translateTree(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === Node.TEXT_NODE) {
      translateTextNode(rootNode);
      return;
    }
    if (rootNode.nodeType === Node.ELEMENT_NODE) {
      const element = rootNode;
      for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
        if (element.hasAttribute(name)) translateAttribute(element, name);
      }
      if (element.matches('meta[name="description"]') && element.hasAttribute('content')) {
        translateAttribute(element, 'content');
      }
    }

    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    if (rootNode.querySelectorAll) {
      for (const element of rootNode.querySelectorAll(
        '[placeholder],[aria-label],[title],[alt],meta[name="description"][content]',
      )) {
        for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
          if (element.hasAttribute(name)) translateAttribute(element, name);
        }
        if (element.matches('meta[name="description"]')) translateAttribute(element, 'content');
      }
    }
  }

  function updateRoot() {
    html.lang = locale;
    html.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.style.colorScheme = 'light';
  }

  function localeControlHost() {
    return (
      document.querySelector('.top-actions') ||
      document.querySelector('.topbar') ||
      document.querySelector('.auth-card') ||
      document.querySelector('.workspace-card') ||
      document.querySelector('.encounter-screen')
    );
  }

  function ensureLocaleControl() {
    const host = localeControlHost();
    if (!host) return;
    let button = document.querySelector('[data-locale-toggle]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'locale-switch';
      button.dataset.localeToggle = '';
      if (host.classList.contains('workspace-card') || host.classList.contains('auth-card')) {
        host.insertBefore(button, host.firstChild);
      } else {
        host.appendChild(button);
      }
    }
    const label = locale === 'ar' ? 'English' : 'العربية';
    const accessibleName = locale === 'ar' ? 'Switch language to English' : 'التبديل إلى العربية';
    if (button.textContent !== label) button.textContent = label;
    if (button.getAttribute('aria-label') !== accessibleName)
      button.setAttribute('aria-label', accessibleName);
    if (button.getAttribute('aria-pressed') !== String(locale === 'en'))
      button.setAttribute('aria-pressed', String(locale === 'en'));
    if (button.getAttribute('lang') !== (locale === 'ar' ? 'en' : 'ar'))
      button.setAttribute('lang', locale === 'ar' ? 'en' : 'ar');
  }

  function applyLocale() {
    updateRoot();
    translateTree(document.head);
    translateTree(document.body);
    ensureLocaleControl();
  }

  function setLocale(nextLocale) {
    locale = nextLocale === 'en' ? 'en' : 'ar';
    try {
      root.localStorage.setItem(storageKey, locale);
    } catch (_) {
      // The page still switches language when browser storage is unavailable.
    }
    applyLocale();
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-locale-toggle]')) return;
    setLocale(locale === 'ar' ? 'en' : 'ar');
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.target instanceof Element) || event.repeat) return;
    if (!['Enter', ' ', 'Spacebar'].includes(event.key)) return;
    if (!event.target.closest('[data-locale-toggle]')) return;
    event.preventDefault();
    setLocale(locale === 'ar' ? 'en' : 'ar');
  });

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        translateTextNode(record.target);
      } else if (record.type === 'attributes' && record.target instanceof Element) {
        translateAttribute(record.target, record.attributeName);
      } else {
        for (const node of record.addedNodes) translateTree(node);
      }
    }
    ensureLocaleControl();
  });

  updateRoot();
  if (document.head) observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['content', 'title'] });
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'],
    });
  }
  applyLocale();

  root.ThanarahLocale = Object.freeze({
    get language() {
      return locale;
    },
    get localeTag() {
      return locale === 'en' ? 'en-GB' : 'ar';
    },
    dateLocale(arabicLocale) {
      return locale === 'en' ? 'en-GB' : arabicLocale || 'ar';
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'ar', options).format(value);
    },
    setLocale,
  });
})(window);
