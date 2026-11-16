(function () {
  'use strict';
  const host = document.getElementById('public-site');
  const slug = new URLSearchParams(location.search).get('slug');
  function show(title, message, retry) {
    const card = document.createElement('section');
    card.className = 'state-card';
    const mark = document.createElement('div');
    mark.className = 'state-mark';
    mark.textContent = 'TH';
    const heading = document.createElement('h1');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;
    card.append(mark, heading, copy);
    if (retry) {
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.type = 'button';
      button.textContent = 'إعادة المحاولة';
      button.addEventListener('click', load);
      const actions = document.createElement('div');
      actions.className = 'state-actions';
      actions.append(button);
      card.append(actions);
    }
    host.className = 'state-screen';
    host.replaceChildren(card);
  }
  async function load() {
    if (!slug) {
      show('الرابط غير مكتمل', 'لم يُحدّد معرّف موقع العيادة في الرابط.');
      return;
    }
    host.className = '';
    host.innerHTML = '<section class="state-card"><div class="skeleton" style="width:55%;margin:0 auto 14px"></div><div class="skeleton" style="width:80%;margin:auto"></div><p style="margin-top:18px">جارٍ تحميل موقع العيادة…</p></section>';
    try {
      const response = await fetch('/api/v1/public/clinic-sites/' + encodeURIComponent(slug), {
        method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        show(response.status === 404 ? 'الموقع غير متاح' : 'تعذّر تحميل الموقع',
          response.status === 404 ? 'لم يُعثر على موقع منشور بهذا الرابط.' : 'حدث خطأ أثناء تحميل الموقع. حاول مرة أخرى.',
          response.status !== 404);
        return;
      }
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || Object.prototype.hasOwnProperty.call(payload, 'draft')) {
        show('الموقع غير متاح', 'تعذّر التحقق من النسخة المنشورة لهذا الرابط.');
        return;
      }
      const published = payload.publishedVersion || payload.published || payload.site || payload;
      const draft = published && published.draft ? published.draft : published;
      if (!draft || !Array.isArray(draft.pages) || !window.ThanarahClinicRenderer) {
        show('الموقع غير متاح', 'لا توجد نسخة منشورة قابلة للعرض لهذا الرابط.');
        return;
      }
      document.title = (draft.brand && draft.brand.name ? draft.brand.name : 'موقع العيادة') + ' · موقع العيادة';
      host.className = '';
      host.replaceChildren();
      window.ThanarahClinicRenderer.render(host, draft, payload.catalog || {}, {});
    } catch (_) {
      show('تعذّر الاتصال', 'تحقق من اتصالك ثم حاول تحميل الموقع مرة أخرى.', true);
    }
  }
  void load();
})();
