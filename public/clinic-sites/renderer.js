(function (root) {
  'use strict';
  const labels = {
    hero: 'واجهة الموقع', richText: 'نبذة', doctorList: 'الأطباء',
    serviceList: 'الخدمات', contact: 'التواصل', booking: 'الحجز'
  };
  const fonts = {
    Tajawal: "'Tajawal', sans-serif",
    'IBM Plex Sans Arabic': "'IBM Plex Sans Arabic', sans-serif",
    'Noto Sans Arabic': "'Noto Sans Arabic', sans-serif"
  };
  const text = value => String(value == null ? '' : value);
  const clean = value => text(value).trim();
  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = text(value);
    return node;
  }
  function contentOf(section) {
    return section && section.content && typeof section.content === 'object'
      ? section.content : { text: text(section && section.content) };
  }
  function appendItems(parent, ids, records, kind) {
    const found = (Array.isArray(ids) ? ids : []).map(id =>
      (records || []).find(row => String(row.id) === String(id))).filter(Boolean);
    if (!found.length) {
      parent.append(el('p', 'site-empty', 'لا توجد عناصر منشورة في هذا القسم.'));
      return;
    }
    const list = el('div', 'site-list');
    found.forEach(record => {
      const item = el('article', 'site-item');
      const name = record.displayName || record.name || '';
      item.append(el('strong', '', name));
      const detail = kind === 'doctor'
        ? [record.title, record.bio, Array.isArray(record.specialties) ? record.specialties.join('، ') : ''].filter(Boolean).join(' · ')
        : record.description || '';
      if (detail) item.append(el('small', '', detail));
      list.append(item);
    });
    parent.append(list);
  }
  function render(target, input, catalog, options) {
    target.replaceChildren();
    const draft = input || {};
    const brand = draft.brand || {};
    const pages = Array.isArray(draft.pages) ? draft.pages : [];
    const requestedSlug = options && options.pageSlug;
    const privatePreview = !!(options && options.privatePreview);
    const page = pages.find(row => row.slug === requestedSlug && (privatePreview || row.visible !== false)) ||
      pages.find(row => row.visible !== false) || null;
    const site = el('div', 'site-render');
    const primary = /^#[0-9a-f]{6}$/i.test(brand.primaryColor || '') ? brand.primaryColor : '#315d48';
    const accent = /^#[0-9a-f]{6}$/i.test(brand.accentColor || '') ? brand.accentColor : '#8b6849';
    site.style.setProperty('--site-primary', primary);
    site.style.setProperty('--site-accent', accent);
    site.style.setProperty('--site-font', fonts[brand.fontFamily] || fonts.Tajawal);
    site.dataset.template = ['clinic-calm', 'editorial', 'coastal'].includes(draft.templateId) ? draft.templateId : 'clinic-calm';
    const header = el('header', 'site-top');
    header.append(el('div', 'site-logo', brand.logoText || brand.name || ''));
    const nav = el('nav', 'site-nav');
    pages.filter(row => privatePreview || row.visible !== false).forEach(row => nav.append(el('span', '', row.title || '')));
    header.append(nav);
    site.append(header);
    if (page) {
      (page.sections || []).filter(section => labels[section.type]).forEach(section => {
        const data = contentOf(section);
        const sectionTitle = clean(data.title);
        if (section.type === 'hero') {
          const hero = el('section', 'site-hero');
          if (clean(brand.tagline)) hero.append(el('p', 'site-tagline', brand.tagline));
          hero.append(el('h1', '', data.heading || data.title || brand.name || ''));
          if (clean(data.body || data.text)) hero.append(el('p', '', data.body || data.text));
          site.append(hero);
          return;
        }
        const block = el('section', `site-section${section.type === 'contact' ? ' site-contact' : ''}`);
        if (sectionTitle) block.append(el('h2', '', sectionTitle));
        if (section.type === 'richText') {
          if (clean(data.text || data.body)) {
            const copy = el('div', 'site-copy');
            copy.append(el('p', '', data.text || data.body));
            block.append(copy);
          }
        } else if (section.type === 'doctorList') {
          appendItems(block, section.sourceIds, catalog && catalog.doctors, 'doctor');
        } else if (section.type === 'serviceList') {
          appendItems(block, section.sourceIds, catalog && catalog.services, 'service');
        } else if (section.type === 'contact' || section.type === 'booking') {
          const copy = clean(data.text || data.body || data.note);
          if (copy) block.append(el('p', 'site-copy', copy));
          if (section.type === 'booking' && !copy) block.append(el('p', 'site-empty', 'تُعرض خيارات الحجز عند تهيئة هذا القسم.'));
        }
        site.append(block);
      });
    } else {
      site.append(el('section', 'site-hero', 'لا توجد صفحة متاحة للعرض.'));
    }
    site.append(el('footer', 'site-footer', brand.name || ''));
    target.append(site);
    return site;
  }
  root.ThanarahClinicRenderer = { render, labels };
})(window);
