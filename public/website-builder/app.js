(function () {
  'use strict';
  const api = window.ThanarahApi;
  const app = document.getElementById('app');
  const toastRegion = document.getElementById('toast-region');
  const renderer = window.ThanarahClinicRenderer;
  const permissionCode = 'tenant.websites.manage';
  const labels = renderer ? renderer.labels : {
    hero: 'واجهة الموقع', richText: 'نبذة', doctorList: 'الأطباء',
    serviceList: 'الخدمات', contact: 'التواصل', booking: 'الحجز'
  };
  const templates = [
    { id: 'clinic-calm', title: 'رعاية هادئة', note: 'مساحات واضحة وهوية متزنة' },
    { id: 'editorial', title: 'تحريرية', note: 'عنوان بارز ومحتوى متتابع' },
    { id: 'coastal', title: 'نسيم الساحل', note: 'درجات باردة وتكوين مفتوح' }
  ];
  const nav = [
    ['setup', 'الهوية والقالب', '01'],
    ['pages', 'الصفحات والأقسام', '02'],
    ['preview', 'معاينة المسودة', '03'],
    ['history', 'الإصدارات', '04']
  ];
  const state = {
    screen: 'boot', workspaces: [], workspace: null, data: null, catalog: null,
    versions: [], versionsLoaded: false, activeView: 'setup', activePageId: null,
    draft: null, baseDraft: null, dirty: false, busy: false, error: null,
    conflict: false, previewDevice: 'desktop', historyError: null, workspaceEpoch: 0,
    draggedSectionId: null, undoStack: [], redoStack: []
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const itemsOf = response => Array.isArray(response) ? response :
    response && Array.isArray(response.items) ? response.items : [];
  const nameOf = workspace => workspace && (workspace.name || workspace.displayName || workspace.tenantName || workspace.tenantId) || '';
  const currentPage = () => state.draft && (state.draft.pages || []).find(page => page.id === state.activePageId);
  const currentVersion = () => Number(state.data && state.data.currentVersion != null
    ? state.data.currentVersion : state.draft && state.draft.currentVersion || 0);
  const statusLabel = value => ({
    DRAFT: 'مسودة', PUBLISHED: 'منشور', UNPUBLISHED: 'غير منشور',
    ACTIVE: 'نشط', ARCHIVED: 'مؤرشف'
  }[String(value || '').toUpperCase()] || String(value || ''));
  const apiReady = names => !!api && names.every(name => typeof api[name] === 'function');

  function notify(message, isError) {
    const node = document.createElement('div');
    node.className = 'toast' + (isError ? ' error' : '');
    node.textContent = message;
    toastRegion.append(node);
    window.setTimeout(() => node.remove(), 4200);
  }
  function showState(title, message, options) {
    const config = options || {};
    app.innerHTML = `<section class="state-screen"><div class="state-card">
      <div class="state-mark" aria-hidden="true">${config.mark || 'TH'}</div>
      <h1>${esc(title)}</h1><p>${esc(message)}</p>
      <div class="state-actions">${config.login ? '<button class="btn btn-primary" type="button" data-thanarah-auth="login" data-auth-audience="staff">تسجيل الدخول</button>' : ''}
      ${config.retry ? '<button class="btn btn-primary" type="button" data-action="retry">إعادة المحاولة</button>' : ''}
      ${config.workspaces ? '<button class="btn btn-light" type="button" data-action="workspace-list">اختيار مساحة عمل أخرى</button>' : ''}</div>
    </div></section>`;
  }
  function renderLoading(message) {
    app.innerHTML = `<section class="state-screen"><div class="state-card">
      <div class="state-mark" aria-hidden="true">TH</div><div class="skeleton" style="width:58%;margin:0 auto 14px"></div>
      <div class="skeleton" style="width:84%;margin:auto"></div><p style="margin-top:18px">${esc(message || 'جارٍ تحميل بيانات مساحة العمل…')}</p>
    </div></section>`;
  }
  function workspaceView() {
    app.innerHTML = `<section class="state-screen"><div class="state-card">
      <div class="state-mark" aria-hidden="true">TH</div><span class="kicker">THANARAH · WORKSPACE</span>
      <h1>اختر مساحة العيادة</h1><p>ستُعرض سجلات الموقع والكتالوج من مساحة العمل التي تختارها.</p>
      <div class="workspace-list">${state.workspaces.map((workspace, index) =>
        `<button type="button" class="workspace-option btn-light" data-workspace="${index}">
          <span><strong>${esc(nameOf(workspace))}</strong><small>${esc(workspace.tenantId || '')}</small></span>
          <span aria-hidden="true">←</span></button>`).join('')}</div>
    </div></section>`;
  }
  function statusText() {
    if (state.busy) return 'جارٍ الحفظ…';
    return state.dirty ? 'تعديلات غير محفوظة' : 'كل التعديلات محفوظة';
  }
  function renderShell() {
    const workspace = state.workspace;
    const page = currentPage();
    app.innerHTML = `<div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/"><img src="/assets/logo-mark.svg" alt=""><span><b>ثناره</b><small>SMART CLINIC · WEBSITE</small></span></a>
        <div class="topbar-right"><span class="save-state" aria-live="polite">${statusText()}</span>
          <button class="workspace-switch" type="button" data-action="workspace-list" aria-label="تغيير مساحة العمل"><span>${esc(nameOf(workspace))}</span></button>
          <button class="top-action" type="button" data-action="history">الإصدارات</button>
        </div>
      </header>
      <div class="workspace-layout">
        <aside class="rail" aria-label="أدوات محرر الموقع">
          <div class="rail-group"><p class="rail-heading">موقع العيادة</p><nav class="rail-nav">
            ${nav.map(([id, title, number]) => `<button type="button" class="rail-tab ${state.activeView === id ? 'active' : ''}" data-view="${id}" aria-current="${state.activeView === id ? 'page' : 'false'}"><span class="rail-index">${number}</span><span>${title}</span></button>`).join('')}
          </nav></div>
          <div class="rail-note"><strong>مصدر المحتوى</strong>الأطباء والخدمات مرتبطة بسجلات Smart Clinic وتُعرض من الكتالوج الحي.</div>
        </aside>
        <section class="main">
          <div class="page-head"><div><span class="kicker">إعداد حضور العيادة</span><h1>${esc(nav.find(item => item[0] === state.activeView)[1])}</h1>
            <p class="subhead">جهّز نسخة الموقع من معلومات مساحة العمل، ثم راجعها قبل النشر.
              ${state.data.status ? `<span class="status-badge">${esc(statusLabel(state.data.status))}</span>` : ''}
              · الإصدار الحالي ${esc(currentVersion())}
            </p></div>
            <div class="head-actions">
              <button class="btn btn-subtle" type="button" data-action="undo" ${state.undoStack.length ? '' : 'disabled'} aria-label="تراجع">تراجع</button>
              <button class="btn btn-subtle" type="button" data-action="redo" ${state.redoStack.length ? '' : 'disabled'} aria-label="إعادة">إعادة</button>
              <button class="btn btn-light" type="button" data-action="save" ${state.busy || !state.dirty ? 'disabled' : ''}>حفظ المسودة</button>
              <button class="btn btn-primary" type="button" data-action="publish" ${state.busy ? 'disabled' : ''}>مراجعة النشر</button>
            </div>
          </div>
          <div class="workbench ${state.activeView === 'history' ? 'history-mode' : ''}">
            <div class="editor-column">
              ${renderSetup()}
              ${renderPages(page)}
              ${renderHistory()}
            </div>
            ${renderPreview()}
          </div>
        </section>
      </div>
    </div>`;
    bindDragHandles();
  }
  function renderSetup() {
    const draft = state.draft;
    return `<section class="panel setup-panel" ${state.activeView !== 'setup' ? 'hidden' : ''}>
      <div class="panel-head"><h2>هوية الموقع</h2><small>مسودة خاصة</small></div>
      <div class="editor-body">
        <div class="field"><label for="site-name">اسم العيادة كما سيظهر</label><input class="input" id="site-name" data-edit="brand.name" value="${esc(draft.brand.name || '')}" autocomplete="off"></div>
        <div class="field"><label for="site-tagline">عبارة تعريفية</label><input class="input" id="site-tagline" data-edit="brand.tagline" value="${esc(draft.brand.tagline || '')}" autocomplete="off"></div>
        <div class="split-fields">
          <div class="field"><label for="site-logo">نص الشعار</label><input class="input" id="site-logo" data-edit="brand.logoText" value="${esc(draft.brand.logoText || '')}" autocomplete="off"></div>
          <div class="field"><label for="site-slug">المعرّف التجريبي</label><input class="input" id="site-slug" data-edit="slug" value="${esc(draft.slug || '')}" dir="ltr" autocomplete="off"></div>
        </div>
        <div class="field"><label for="font-family">الخط العربي</label><select class="select" id="font-family" data-edit="brand.fontFamily">
          ${['Tajawal', 'IBM Plex Sans Arabic', 'Noto Sans Arabic'].map(font => `<option value="${esc(font)}" ${draft.brand.fontFamily === font ? 'selected' : ''}>${esc(font)}</option>`).join('')}
        </select></div>
        <div class="color-fields">
          <div class="field"><label for="primary-color">اللون الأساسي</label><input class="input" type="color" id="primary-color" data-edit="brand.primaryColor" value="${esc(colorValue(draft.brand.primaryColor, '#315d48'))}"></div>
          <div class="field"><label for="accent-color">لون مساعد</label><input class="input" type="color" id="accent-color" data-edit="brand.accentColor" value="${esc(colorValue(draft.brand.accentColor, '#8b6849'))}"></div>
        </div>
        <div class="notice">هذا رابط اختبار داخل بيئة ثناره فقط. لم يتم ربط نطاق مخصص أو نشر استضافة.</div>
      </div>
      <div class="panel-head"><h2>اختر التكوين</h2><small>يمكن تغييره قبل النشر</small></div>
      <div class="editor-body"><div class="template-grid" role="group" aria-label="قوالب الموقع">
        ${templates.map(template => `<button class="template-choice" type="button" data-template="${template.id}" aria-pressed="${draft.templateId === template.id}">
          <span class="template-art" aria-hidden="true"></span><strong>${template.title}</strong></button>`).join('')}
      </div></div>
    </section>`;
  }
  function colorValue(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }
  function renderPages(page) {
    if (!page) {
      return `<section class="panel page-panel" ${state.activeView !== 'pages' ? 'hidden' : ''}>
        <div class="panel-head"><h2>صفحات الموقع</h2><button class="btn btn-primary btn-sm" data-action="add-page" type="button">إضافة صفحة</button></div>
        <div class="section-empty">أنشئ صفحة أولى، ثم أضف لها أقسامًا من الأنواع المعتمدة.</div>
      </section>`;
    }
    const pages = state.draft.pages || [];
    return `<section class="panel page-panel" ${state.activeView !== 'pages' ? 'hidden' : ''}>
      <div class="panel-head"><h2>صفحات الموقع</h2><button class="btn btn-primary btn-sm" data-action="add-page" type="button">إضافة صفحة</button></div>
      <div class="page-list">${pages.map(item => `<div class="page-row ${item.id === page.id ? 'active' : ''}">
        <button class="page-select" type="button" data-page="${esc(item.id)}"><strong>${esc(item.title || 'صفحة بلا عنوان')}</strong><small>/${esc(item.slug || '')}</small></button>
        <button class="icon-btn" type="button" aria-label="حذف الصفحة" title="حذف الصفحة" data-delete-page="${esc(item.id)}">×</button>
      </div>`).join('')}</div>
      <div class="editor-body page-editor">
        <div class="page-meta">
          <div class="field"><label>عنوان الصفحة</label><input class="input" data-edit="page.title" value="${esc(page.title || '')}"></div>
          <div class="field"><label>معرّف الصفحة</label><input class="input" dir="ltr" data-edit="page.slug" value="${esc(page.slug || '')}"></div>
          <label class="toggle-line"><input type="checkbox" data-edit="page.visible" ${page.visible !== false ? 'checked' : ''}> ظاهرة للزوار</label>
        </div>
      </div>
      <div class="section-toolbar"><strong>أقسام الصفحة</strong><span class="form-note">اسحب للترتيب أو استخدم أزرار التحريك</span></div>
      <div class="section-list" id="section-list">${(page.sections || []).map((section, index) => renderSection(section, index)).join('') || '<div class="section-empty">لا توجد أقسام بعد. أضف قسمًا مدعومًا لبناء الصفحة.</div>'}</div>
      <div class="section-add"><select class="select" id="new-section-type" aria-label="نوع القسم">
        ${Object.entries(labels).map(([id, title]) => `<option value="${id}">${title}</option>`).join('')}
      </select><button class="btn btn-light btn-sm" type="button" data-action="add-section">إضافة قسم</button></div>
    </section>`;
  }
  function renderSection(section, index) {
    const data = section.content && typeof section.content === 'object' ? section.content : { text: section.content || '' };
    const type = labels[section.type] ? section.type : 'richText';
    const listType = type === 'doctorList' ? 'doctors' : type === 'serviceList' ? 'services' : '';
    let fields = '';
    if (type === 'hero') {
      fields = textField('عنوان الواجهة', 'heading', data.heading || data.title) +
        textArea('نص تمهيدي', 'body', data.body || data.text) +
        textField('نص الزر الاختياري', 'buttonText', data.buttonText);
    } else if (type === 'richText') {
      fields = textField('عنوان القسم', 'title', data.title) + textArea('النص', 'text', data.text || data.body);
    } else if (listType) {
      const records = state.catalog && Array.isArray(state.catalog[listType]) ? state.catalog[listType] : [];
      const selected = new Set((section.sourceIds || []).map(String));
      fields = textField('عنوان القسم', 'title', data.title) +
        `<fieldset class="field"><legend>${listType === 'doctors' ? 'اختر من سجل الأطباء' : 'اختر من سجل الخدمات'}</legend>
          ${records.length ? records.map(record => `<label class="toggle-line"><input type="checkbox" data-source-id="${esc(record.id)}" ${selected.has(String(record.id)) ? 'checked' : ''}>
            ${esc(record.displayName || record.name || '')}</label>`).join('') : '<span class="form-note">لا توجد سجلات متاحة في الكتالوج الحالي.</span>'}</fieldset>`;
    } else if (type === 'contact') {
      fields = textField('عنوان القسم', 'title', data.title) + textArea('معلومات التواصل المتاحة', 'text', data.text || data.body);
    } else {
      fields = textField('عنوان القسم', 'title', data.title) + textArea('ملاحظة الحجز', 'text', data.text || data.body);
    }
    return `<article class="section-card" data-section-id="${esc(section.id)}" draggable="true">
      <header class="section-head"><span class="drag-handle" role="button" tabindex="0" aria-label="اسحب أو استخدم Alt مع الأسهم لإعادة الترتيب" title="اسحب أو استخدم Alt مع الأسهم">⠿</span>
        <span class="section-type">${labels[type]}</span><div class="move-controls">
          <button class="icon-btn" type="button" data-move-section="${esc(section.id)}" data-direction="-1" aria-label="تحريك القسم لأعلى">↑</button>
          <button class="icon-btn" type="button" data-move-section="${esc(section.id)}" data-direction="1" aria-label="تحريك القسم لأسفل">↓</button>
          <button class="icon-btn danger" type="button" data-delete-section="${esc(section.id)}" aria-label="حذف القسم">×</button>
        </div>
      </header><div class="section-body">${fields}</div></article>`;
  }
  function textField(label, key, value) {
    return `<div class="field"><label>${label}</label><input class="input" data-content="${key}" value="${esc(value || '')}"></div>`;
  }
  function textArea(label, key, value) {
    return `<div class="field"><label>${label}</label><textarea class="textarea" data-content="${key}">${esc(value || '')}</textarea></div>`;
  }
  function renderHistory() {
    const error = state.historyError;
    const list = state.versions;
    return `<section class="panel history-panel" ${state.activeView !== 'history' ? 'hidden' : ''}>
      <div class="panel-head"><h2>سجل النسخ</h2><button class="btn btn-light btn-sm" type="button" data-action="history">تحديث</button></div>
      ${error ? `<div class="section-empty">${esc(error)}<br><button class="btn btn-light btn-sm" data-action="history" type="button">إعادة المحاولة</button></div>` : ''}
      ${!error && state.versionsLoaded && !list.length ? '<div class="section-empty">لا توجد إصدارات محفوظة حتى الآن. بعد النشر ستظهر النسخ هنا.</div>' : ''}
      <div class="history-list">${list.map(row => `<article class="history-item">
        <div><strong>الإصدار ${esc(row.version)} <span class="status-badge ${String(row.status).toLowerCase() === 'draft' ? 'draft' : ''}">${esc(row.status || 'منشور')}</span></strong>
          <small>${esc(row.authorId || '—')} · ${esc(formatDate(row.createdAt))}</small><div class="history-summary">${esc(row.summary || '')}</div></div>
        <button class="btn btn-subtle btn-sm" type="button" data-restore-version="${esc(row.version)}" ${state.busy ? 'disabled' : ''}>استعادة هذه النسخة</button>
      </article>`).join('')}</div>
    </section>`;
  }
  function formatDate(value) {
    if (!value) return 'وقت غير متاح';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function renderPreview() {
    const page = currentPage();
    const slug = state.draft.slug || '';
    return `<section class="panel preview-panel" ${state.activeView === 'history' ? 'hidden' : ''}>
      <div class="panel-head"><h2>معاينة خاصة للمسودة</h2><small>لا تمثل النسخة المنشورة</small></div>
      <div class="preview-toolbar"><small>المعرّف التجريبي: <span class="public-path">/clinic-sites/?slug=${esc(encodeURIComponent(slug))}</span></small>
        <div class="device-switch" role="group" aria-label="حجم المعاينة">
          <button type="button" data-device="desktop" class="${state.previewDevice === 'desktop' ? 'active' : ''}" aria-pressed="${state.previewDevice === 'desktop'}">حاسوب</button>
          <button type="button" data-device="phone" class="${state.previewDevice === 'phone' ? 'active' : ''}" aria-pressed="${state.previewDevice === 'phone'}">هاتف</button>
        </div>
      </div>
      <div class="preview-stage"><div class="preview-device ${state.previewDevice === 'phone' ? 'phone' : ''}" id="preview-device"></div></div>
      <div class="preview-note">هذه المعاينة محلية للمسودة. الموقع العام يعرض النسخة المنشورة فقط.</div>
    </section>`;
  }
  function updatePreview() {
    const target = document.getElementById('preview-device');
    if (target && renderer && state.draft) renderer.render(target, state.draft, state.catalog || {}, {
      pageSlug: currentPage() && currentPage().slug, privatePreview: true
    });
  }
  function renderEditor() {
    renderShell();
    updatePreview();
  }
  function setDirty() {
    state.dirty = JSON.stringify(state.draft) !== JSON.stringify(state.baseDraft);
    const status = document.querySelector('.save-state');
    if (status) status.textContent = statusText();
    const save = document.querySelector('[data-action="save"]');
    if (save) save.disabled = state.busy || !state.dirty;
    updatePreview();
  }
  function checkpoint() {
    if (!state.draft) return;
    state.undoStack.push(clone(state.draft));
    if (state.undoStack.length > 40) state.undoStack.shift();
    state.redoStack = [];
  }
  function travelHistory(from, to) {
    if (!from.length || !state.draft) return;
    to.push(clone(state.draft));
    state.draft = clone(from.pop());
    ensurePageActive();
    setDirty();
    renderEditor();
  }
  function ensurePageActive() {
    const pages = state.draft.pages || [];
    if (!pages.some(page => page.id === state.activePageId)) state.activePageId = pages[0] ? pages[0].id : null;
  }
  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function slugify(value) {
    return String(value || '').trim().toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'page';
  }
  function ensureDraft(input) {
    const original = input && typeof input === 'object' ? clone(input) : {};
    original.slug = typeof original.slug === 'string' ? original.slug : '';
    original.templateId = templates.some(item => item.id === original.templateId) ? original.templateId : templates[0].id;
    original.brand = Object.assign({ name: '', tagline: '', logoText: '', primaryColor: '#315d48', accentColor: '#8b6849', fontFamily: 'Tajawal' }, original.brand || {});
    original.pages = Array.isArray(original.pages) ? original.pages : [];
    original.pages = original.pages.map(page => ({
      id: String(page.id || newId('page')), slug: String(page.slug || ''),
      title: String(page.title || ''), visible: page.visible !== false,
      sections: Array.isArray(page.sections) ? page.sections.filter(section => labels[section.type]).map(section => ({
        id: String(section.id || newId('section')), type: section.type,
        content: section.content && typeof section.content === 'object' ? section.content : { text: String(section.content || '') },
        sourceIds: Array.isArray(section.sourceIds) ? section.sourceIds : []
      })) : []
    }));
    return original;
  }
  function applyWebsiteData(data) {
    state.data = data && typeof data === 'object' ? data : {};
    state.draft = ensureDraft(state.data.draft);
    state.baseDraft = clone(state.draft);
    state.dirty = false;
    state.undoStack = [];
    state.redoStack = [];
    ensurePageActive();
    state.conflict = false;
  }
  function requireApi(methods) {
    if (!apiReady(methods)) throw new Error('موصل مواقع العيادات غير متاح بعد. أعد تحميل الصفحة بعد تحديث خدمة ثناره.');
  }
  function denied() {
    return !state.workspace || !Array.isArray(state.workspace.permissionCodes) ||
      !state.workspace.permissionCodes.includes(permissionCode);
  }
  async function boot() {
    if (!api || typeof api.restoreSession !== 'function') {
      state.screen = 'error';
      showState('تعذّر تحميل خدمة الدخول', 'لم يتم العثور على موصل جلسة ثناره في هذه الصفحة.', { retry: true });
      return;
    }
    state.screen = 'boot';
    try {
      const restored = await api.restoreSession();
      if (!restored) {
        state.screen = 'signin';
        showState('سجّل الدخول للمتابعة', 'يتطلب محرر موقع العيادة جلسة عمل مخوّلة.', { login: true });
        return;
      }
      await loadWorkspaces();
    } catch (_) {
      state.screen = 'boot-error';
      showState('تعذّر استعادة الجلسة', 'تحقق من الاتصال ثم أعد المحاولة.', { retry: true });
    }
  }
  async function loadWorkspaces() {
    renderLoading('جارٍ تحميل مساحات العمل…');
    try {
      requireApi(['listWorkspaces']);
      const response = await api.listWorkspaces();
      state.workspaces = itemsOf(response);
      if (!state.workspaces.length) {
        state.screen = 'no-workspaces';
        showState('لا توجد مساحة عمل', 'لم تتوفر مساحة عمل لهذا الحساب بعد.');
      } else if (state.workspaces.length === 1) {
        await chooseWorkspace(state.workspaces[0]);
      } else {
        state.screen = 'workspace-select';
        workspaceView();
      }
    } catch (error) {
      state.screen = 'workspaces-error';
      showState('تعذّر تحميل مساحات العمل', error.message || 'حاول مرة أخرى.', { retry: true });
    }
  }
  async function chooseWorkspace(workspace) {
    state.workspaceEpoch += 1;
    const epoch = state.workspaceEpoch;
    state.workspace = workspace;
    state.data = null;
    state.draft = null;
    if (denied()) {
      state.screen = 'access-denied';
      showState('لا تتوفر صلاحية إدارة المواقع', 'تحتاج هذه المساحة إلى الصلاحية tenant.websites.manage. لم تُحمّل بيانات الموقع.', { workspaces: state.workspaces.length > 1 });
      return;
    }
    state.screen = 'loading';
    renderLoading('جارٍ تحميل إعداد الموقع وكتالوج العيادة…');
    try {
      requireApi(['getClinicWebsite', 'getClinicWebsiteCatalog']);
      const [website, catalog] = await Promise.all([
        api.getClinicWebsite(workspace.tenantId),
        api.getClinicWebsiteCatalog(workspace.tenantId)
      ]);
      if (epoch !== state.workspaceEpoch) return;
      state.catalog = catalog || { doctors: [], services: [], facilities: [] };
      applyWebsiteData(website);
      state.screen = 'editor';
      state.activeView = 'setup';
      renderEditor();
    } catch (error) {
      if (epoch !== state.workspaceEpoch) return;
      if (error.status === 401) {
        state.screen = 'signin';
        showState('انتهت جلسة الدخول', 'سجّل الدخول مجددًا للعودة إلى محرر الموقع.', { login: true });
      } else if (error.status === 403) {
        state.screen = 'access-denied';
        showState('لا تتوفر صلاحية إدارة المواقع', 'تأكد من صلاحيات مساحة العمل قبل متابعة تحرير الموقع.', { workspaces: state.workspaces.length > 1 });
      } else {
        state.screen = 'load-error';
        showState('تعذّر تحميل بيانات الموقع', error.message || 'حاول تحميل البيانات مرة أخرى.', { retry: true });
      }
    }
  }
  async function fetchWebsite() {
    return api.getClinicWebsite(state.workspace.tenantId);
  }
  async function saveDraft(options) {
    const opts = options || {};
    if (!state.dirty && !opts.force) return true;
    try {
      requireApi(['saveClinicWebsiteDraft']);
      state.busy = true;
      renderEditor();
      const result = await api.saveClinicWebsiteDraft(state.workspace.tenantId, {
        expectedVersion: opts.expectedVersion != null ? opts.expectedVersion : currentVersion(),
        draft: clone(state.draft)
      });
      state.data = result && typeof result === 'object' ? Object.assign({}, state.data, result) : state.data;
      state.baseDraft = clone(state.draft);
      if (result && result.draft) state.draft = ensureDraft(result.draft);
      state.dirty = false;
      state.conflict = false;
      state.busy = false;
      renderEditor();
      notify('حُفظت المسودة.');
      return true;
    } catch (error) {
      state.busy = false;
      if (error.status === 409 || error.code && /CONFLICT/u.test(error.code)) {
        state.conflict = true;
        renderConflict();
      } else {
        renderEditor();
        notify(error.message || 'تعذّر حفظ المسودة.', true);
      }
      return false;
    }
  }
  function renderConflict() {
    renderEditor();
    const editor = document.querySelector('.main');
    if (!editor) return;
    const banner = document.createElement('div');
    banner.className = 'notice';
    banner.style.margin = '0 auto 15px';
    banner.style.maxWidth = '1240px';
    banner.innerHTML = 'تغيّرت النسخة على الخادم منذ تحميلها. بقيت تعديلاتك الحالية محفوظة في المحرر فقط. ';
    const retry = document.createElement('button');
    retry.className = 'btn btn-light btn-sm';
    retry.type = 'button';
    retry.dataset.action = 'conflict-retry';
    retry.textContent = 'إعادة المحاولة مع أحدث إصدار';
    const reload = document.createElement('button');
    reload.className = 'btn btn-subtle btn-sm';
    reload.type = 'button';
    reload.dataset.action = 'conflict-reload';
    reload.textContent = 'تحميل نسخة الخادم';
    banner.append(retry, reload);
    editor.insertBefore(banner, editor.firstChild);
  }
  async function retryConflict() {
    const unsaved = clone(state.draft);
    try {
      state.busy = true;
      const latest = await fetchWebsite();
      state.data = latest || {};
      const newVersion = Number(state.data.currentVersion != null ? state.data.currentVersion : 0);
      state.draft = unsaved;
      state.busy = false;
      await saveDraft({ force: true, expectedVersion: newVersion });
    } catch (error) {
      state.busy = false;
      renderConflict();
      notify(error.message || 'تعذّر تحديث رقم الإصدار.', true);
    }
  }
  async function reloadFromServer() {
    try {
      state.busy = true;
      renderLoading('جارٍ تحميل أحدث نسخة…');
      const [website, catalog] = await Promise.all([
        fetchWebsite(), api.getClinicWebsiteCatalog(state.workspace.tenantId)
      ]);
      state.catalog = catalog;
      applyWebsiteData(website);
      state.busy = false;
      state.screen = 'editor';
      renderEditor();
      notify('تم تحميل أحدث نسخة من الخادم.');
    } catch (error) {
      state.busy = false;
      renderConflict();
      notify(error.message || 'تعذّر إعادة التحميل.', true);
    }
  }
  async function loadHistory() {
    state.activeView = 'history';
    state.historyError = null;
    state.versionsLoaded = false;
    renderEditor();
    try {
      requireApi(['listClinicWebsiteVersions']);
      const response = await api.listClinicWebsiteVersions(state.workspace.tenantId);
      state.versions = itemsOf(response);
      state.versionsLoaded = true;
      renderEditor();
    } catch (error) {
      state.historyError = error.message || 'تعذّر تحميل سجل الإصدارات.';
      state.versionsLoaded = true;
      renderEditor();
    }
  }
  function ask(title, message, confirmLabel) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">${esc(title)}</h2><p>${esc(message)}</p><div class="dialog-actions">
          <button class="btn btn-light" type="button" data-dialog-cancel>إلغاء</button>
          <button class="btn btn-primary" type="button" data-dialog-confirm>${esc(confirmLabel || 'تأكيد')}</button>
        </div></section>`;
      const finish = value => { overlay.remove(); resolve(value); };
      overlay.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(false));
      overlay.querySelector('[data-dialog-confirm]').addEventListener('click', () => finish(true));
      overlay.addEventListener('click', event => { if (event.target === overlay) finish(false); });
      document.body.append(overlay);
      overlay.querySelector('[data-dialog-cancel]').focus();
    });
  }
  async function publish() {
    const accepted = await ask('نشر نسخة الموقع؟', 'سيصبح محتوى المسودة الحالية هو المحتوى المعروض على الرابط العام. يمكنك مراجعة النسخة الخاصة قبل المتابعة.', 'متابعة');
    if (!accepted) return;
    if (state.dirty && !(await saveDraft())) return;
    try {
      requireApi(['publishClinicWebsite']);
      state.busy = true;
      renderEditor();
      const result = await api.publishClinicWebsite(state.workspace.tenantId, currentVersion());
      state.data = result && typeof result === 'object' ? Object.assign({}, state.data, result) : state.data;
      state.busy = false;
      renderEditor();
      notify('تم إرسال طلب النشر.');
      await loadHistory();
    } catch (error) {
      state.busy = false;
      if (error.status === 409) {
        state.conflict = true;
        renderConflict();
      } else {
        renderEditor();
        notify(error.message || 'تعذّر نشر الموقع.', true);
      }
    }
  }
  async function restoreVersion(version) {
    const accepted = await ask('استعادة إصدار؟', `سيُنشأ محتوى المسودة من الإصدار ${version}. لا تتغير النسخة العامة قبل نشرها صراحة.`, 'استعادة الإصدار');
    if (!accepted) return;
    try {
      requireApi(['restoreClinicWebsiteVersion']);
      state.busy = true;
      renderEditor();
      const result = await api.restoreClinicWebsiteVersion(state.workspace.tenantId, version, currentVersion());
      if (result && typeof result === 'object') {
        state.data = Object.assign({}, state.data, result);
        if (result.draft) state.draft = ensureDraft(result.draft);
        else if (result.pages) state.draft = ensureDraft(result);
      } else {
        const latest = await fetchWebsite();
        state.data = latest || {};
        state.draft = ensureDraft(state.data.draft);
      }
      state.baseDraft = clone(state.draft);
      state.dirty = false;
      state.busy = false;
      ensurePageActive();
      renderEditor();
      notify('تمت استعادة الإصدار إلى المسودة.');
      await loadHistory();
    } catch (error) {
      state.busy = false;
      if (error.status === 409) {
        state.conflict = true;
        renderConflict();
      } else {
        renderEditor();
        notify(error.message || 'تعذّرت استعادة الإصدار.', true);
      }
    }
  }
  function addPage() {
    const title = window.prompt('عنوان الصفحة الجديدة');
    if (!title || !title.trim()) return;
    const baseSlug = slugify(title);
    const existing = new Set((state.draft.pages || []).map(page => page.slug));
    let slug = baseSlug, suffix = 2;
    while (existing.has(slug)) slug = `${baseSlug}-${suffix++}`;
    checkpoint();
    const page = { id: newId('page'), slug, title: title.trim(), visible: true, sections: [] };
    state.draft.pages.push(page);
    state.activePageId = page.id;
    state.activeView = 'pages';
    setDirty();
    renderEditor();
  }
  function moveSection(sectionId, offset) {
    const page = currentPage();
    if (!page) return;
    const from = page.sections.findIndex(section => section.id === sectionId);
    const to = Math.max(0, Math.min(page.sections.length - 1, from + offset));
    if (from < 0 || to === from) return;
    checkpoint();
    const [section] = page.sections.splice(from, 1);
    page.sections.splice(to, 0, section);
    setDirty();
    renderEditor();
    const handle = document.querySelector(`[data-section-id="${CSS.escape(sectionId)}"] .drag-handle`);
    if (handle) handle.focus();
  }
  function reorderSection(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const page = currentPage();
    if (!page) return;
    const from = page.sections.findIndex(section => section.id === sourceId);
    const to = page.sections.findIndex(section => section.id === targetId);
    if (from < 0 || to < 0) return;
    checkpoint();
    const [section] = page.sections.splice(from, 1);
    page.sections.splice(to, 0, section);
    setDirty();
    renderEditor();
  }
  function bindDragHandles() {
    document.querySelectorAll('.drag-handle').forEach(handle => {
      handle.addEventListener('pointerdown', pointerStart);
      handle.addEventListener('keydown', event => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const card = event.target.closest('[data-section-id]');
        moveSection(card && card.dataset.sectionId, event.key === 'ArrowUp' ? -1 : 1);
      });
    });
  }
  function pointerStart(event) {
    const card = event.currentTarget.closest('[data-section-id]');
    if (!card || event.button !== 0) return;
    const id = card.dataset.sectionId;
    let moved = false;
    const startY = event.clientY;
    const move = pointerEvent => {
      if (Math.abs(pointerEvent.clientY - startY) > 5) {
        moved = true;
        const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest('[data-section-id]');
        document.querySelectorAll('.section-card').forEach(node => node.classList.toggle('drop-target', node === target && node.dataset.sectionId !== id));
      }
    };
    const end = pointerEvent => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.querySelectorAll('.drop-target').forEach(node => node.classList.remove('drop-target'));
      if (moved) {
        const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest('[data-section-id]');
        if (target) reorderSection(id, target.dataset.sectionId);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }

  app.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.workspace != null) {
      const selected = state.workspaces[Number(target.dataset.workspace)];
      if (selected) await chooseWorkspace(selected);
      return;
    }
    if (target.dataset.view) {
      state.activeView = target.dataset.view;
      if (state.activeView === 'history') await loadHistory();
      else renderEditor();
      return;
    }
    if (target.dataset.page) {
      state.activePageId = target.dataset.page;
      renderEditor();
      return;
    }
    if (target.dataset.template) {
      checkpoint();
      state.draft.templateId = target.dataset.template;
      setDirty();
      renderEditor();
      return;
    }
    if (target.dataset.device) {
      state.previewDevice = target.dataset.device;
      renderEditor();
      return;
    }
    if (target.dataset.moveSection) {
      moveSection(target.dataset.moveSection, Number(target.dataset.direction));
      return;
    }
    if (target.dataset.deleteSection) {
      if (await ask('حذف القسم؟', 'سيُحذف هذا القسم من المسودة. يمكنك حفظ التغيير بعد ذلك.', 'حذف القسم')) {
        checkpoint();
        const page = currentPage();
        page.sections = page.sections.filter(section => section.id !== target.dataset.deleteSection);
        setDirty();
        renderEditor();
      }
      return;
    }
    if (target.dataset.deletePage) {
      if (await ask('حذف الصفحة؟', 'سيُحذف محتوى الصفحة من المسودة. لا يمكن التراجع بعد حفظ التغيير.', 'حذف الصفحة')) {
        checkpoint();
        state.draft.pages = state.draft.pages.filter(page => page.id !== target.dataset.deletePage);
        ensurePageActive();
        setDirty();
        renderEditor();
      }
      return;
    }
    if (target.dataset.restoreVersion) { await restoreVersion(target.dataset.restoreVersion); return; }
    switch (target.dataset.action) {
      case 'save': await saveDraft(); break;
      case 'publish': await publish(); break;
      case 'history': await loadHistory(); break;
      case 'retry': await boot(); break;
      case 'workspace-list': state.screen = 'workspace-select'; workspaceView(); break;
      case 'undo': travelHistory(state.undoStack, state.redoStack); break;
      case 'redo': travelHistory(state.redoStack, state.undoStack); break;
      case 'add-page': addPage(); break;
      case 'add-section': {
        const page = currentPage();
        const type = document.getElementById('new-section-type').value;
        if (!page || !labels[type]) break;
        const content = type === 'hero' ? { heading: '', body: '', buttonText: '' } :
          type === 'richText' ? { title: '', text: '' } :
            ['doctorList', 'serviceList'].includes(type) ? { title: '' } : { title: '', text: '' };
        checkpoint();
        page.sections.push({ id: newId('section'), type, content, sourceIds: [] });
        setDirty();
        renderEditor();
        break;
      }
      case 'conflict-retry': await retryConflict(); break;
      case 'conflict-reload': await reloadFromServer(); break;
    }
  });
  app.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-edit]')) {
      checkpoint();
      const key = target.dataset.edit;
      if (key === 'slug') state.draft.slug = target.value;
      else if (key.startsWith('brand.')) state.draft.brand[key.slice(6)] = target.value;
      else if (key === 'page.title' || key === 'page.slug') {
        const page = currentPage();
        if (page) page[key.slice(5)] = target.value;
      }
      setDirty();
    } else if (target.matches('[data-content]')) {
      const section = target.closest('[data-section-id]');
      const page = currentPage();
      const record = page && section && page.sections.find(item => item.id === section.dataset.sectionId);
      if (record) {
        checkpoint();
        if (!record.content || typeof record.content !== 'object') record.content = {};
        record.content[target.dataset.content] = target.value;
        setDirty();
      }
    }
  });
  app.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-edit="page.visible"]')) {
      checkpoint();
      const page = currentPage();
      if (page) page.visible = target.checked;
      setDirty();
      updatePreview();
    }
    if (target.matches('[data-source-id]')) {
      const card = target.closest('[data-section-id]');
      const page = currentPage();
      const section = page && card && page.sections.find(item => item.id === card.dataset.sectionId);
      if (section) {
        checkpoint();
        const values = new Set((section.sourceIds || []).map(String));
        if (target.checked) values.add(String(target.dataset.sourceId));
        else values.delete(String(target.dataset.sourceId));
        section.sourceIds = Array.from(values);
        setDirty();
      }
    }
    if (target.matches('[data-edit]') && target.type === 'color') {
      const key = target.dataset.edit.slice(6);
      state.draft.brand[key] = target.value;
      setDirty();
    }
  });
  app.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-section-id]');
    if (!card) return;
    state.draggedSectionId = card.dataset.sectionId;
    card.classList.add('dragging');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  app.addEventListener('dragend', event => {
    event.target.closest('[data-section-id]')?.classList.remove('dragging');
    state.draggedSectionId = null;
    document.querySelectorAll('.drop-target').forEach(node => node.classList.remove('drop-target'));
  });
  app.addEventListener('dragover', event => {
    const target = event.target.closest('[data-section-id]');
    if (!target || !state.draggedSectionId) return;
    event.preventDefault();
    target.classList.add('drop-target');
  });
  app.addEventListener('dragleave', event => event.target.closest('[data-section-id]')?.classList.remove('drop-target'));
  app.addEventListener('drop', event => {
    const target = event.target.closest('[data-section-id]');
    if (!target) return;
    event.preventDefault();
    target.classList.remove('drop-target');
    reorderSection(state.draggedSectionId, target.dataset.sectionId);
  });
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail && event.detail.audience === 'staff') void boot();
  });
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      travelHistory(state.redoStack, state.undoStack);
      return;
    }
    if (event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    travelHistory(
      event.shiftKey ? state.redoStack : state.undoStack,
      event.shiftKey ? state.undoStack : state.redoStack
    );
  });
  window.addEventListener('thanarah:auth-changed', event => {
    if (event.detail && event.detail.authenticated === false) {
      state.workspace = null;
      state.screen = 'signin';
      showState('انتهت جلسة الدخول', 'سجّل الدخول مجددًا لمتابعة إدارة الموقع.', { login: true });
    }
  });
  void boot();
})();
