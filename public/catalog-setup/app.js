(function startCatalogSetup() {
  'use strict';
  const api = window.ThanarahApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void bootstrap();
  });
  const app = document.getElementById('app');
  const config = {
    departments: {
      label: 'الأقسام',
      singular: 'القسم',
      read: 'tenant.departments.read',
      manage: 'tenant.departments.manage',
      list: 'listDepartments',
      create: 'createDepartment',
      update: 'updateDepartment',
      status: 'changeDepartmentStatus',
      fields: [
        { key: 'name', label: 'اسم القسم', required: true },
        { key: 'description', label: 'الوصف', type: 'textarea' },
      ],
    },
    specialties: {
      label: 'التخصصات',
      singular: 'التخصص',
      read: 'tenant.specialties.read',
      manage: 'tenant.specialties.manage',
      list: 'listSpecialties',
      create: 'createSpecialty',
      update: 'updateSpecialty',
      status: 'changeSpecialtyStatus',
      fields: [
        { key: 'name', label: 'اسم التخصص', required: true },
        { key: 'description', label: 'الوصف', type: 'textarea' },
      ],
    },
    services: {
      label: 'الخدمات الطبية',
      singular: 'الخدمة',
      read: 'tenant.services.read',
      manage: 'tenant.services.manage',
      list: 'listSetupServices',
      create: 'createService',
      update: 'updateService',
      status: 'changeServiceStatus',
      fields: [
        { key: 'name', label: 'اسم الخدمة', required: true },
        { key: 'code', label: 'الرمز', direction: 'ltr' },
        { key: 'description', label: 'الوصف', type: 'textarea' },
      ],
    },
  };
  const state = {
    screen: 'boot',
    workspaces: [],
    workspace: null,
    resource: 'departments',
    items: [],
    status: '',
    editId: '',
    loading: false,
    saving: false,
    error: '',
    itemsRequestId: 0,
  };
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/gu,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const allowed = (permission) => state.workspace?.permissionCodes?.includes(permission) === true;
  const current = () => config[state.resource];

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  void bootstrap();

  async function bootstrap() {
    if (!api)
      return showScreen('تعذّر تحميل الخدمة', 'أعد تحميل الصفحة للتحقق من الاتصال بالخدمة.');
    try {
      if (!(await api.restoreSession())) return renderSignIn();
      await loadWorkspaces();
    } catch (error) {
      showScreen('تعذّر الوصول إلى مساحة العمل', safeMessage(error));
    }
  }

  async function loadWorkspaces() {
    state.screen = 'loading';
    render();
    try {
      const result = await api.listWorkspaces();
      state.workspaces = Array.isArray(result.items) ? result.items : [];
      if (state.workspaces.length === 1) return chooseWorkspace(state.workspaces[0]);
      state.screen = state.workspaces.length ? 'select' : 'none';
      render();
    } catch (error) {
      if (error.status === 401) return renderSignIn();
      showScreen('تعذّر تحميل مساحات العمل', safeMessage(error), true);
    }
  }

  async function chooseWorkspace(workspace) {
    clearWorkspaceData();
    state.workspace = workspace;
    window.ThanarahWorkspaceNavigation?.setPermissions(workspace.permissionCodes);
    state.screen = 'workspace';
    await loadItems();
  }

  function clearWorkspaceData() {
    state.itemsRequestId += 1;
    state.items = [];
    state.status = '';
    state.editId = '';
    state.loading = false;
    state.saving = false;
    state.error = '';
  }

  async function loadItems() {
    const workspace = state.workspace;
    const resource = current();
    const requestId = ++state.itemsRequestId;
    const isCurrent = () =>
      requestId === state.itemsRequestId &&
      state.workspace === workspace &&
      current() === resource;
    if (!workspace) return;
    if (!allowed(resource.read)) {
      state.items = [];
      state.loading = false;
      render();
      return;
    }
    state.loading = true;
    state.error = '';
    state.items = [];
    render();
    try {
      const result = await api[resource.list](workspace.tenantId, {
        ...(state.status ? { status: state.status } : {}),
        limit: 50,
        offset: 0,
      });
      if (!isCurrent()) return;
      state.items = Array.isArray(result.items) ? result.items : [];
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 401) {
        state.screen = 'signin';
        return renderSignIn();
      }
      state.error = safeMessage(error);
    } finally {
      if (isCurrent()) {
        state.loading = false;
        render();
      }
    }
  }

  function safeMessage(error) {
    return error?.message || 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  }

  function showScreen(title, message, retry = false) {
    state.screen = 'error';
    state.error = message;
    render();
  }

  function renderSignIn() {
    state.screen = 'signin';
    app.innerHTML = `<section class="workspace-screen"><form class="workspace-card catalog-login" data-form="login"><div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · CATALOG</span></div></div><span class="eyebrow">إدارة الكتالوج</span><h1>تسجيل الدخول</h1><label class="field"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>${state.error ? `<p class="form-error" role="alert">${esc(state.error)}</p>` : ''}<button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الدخول…' : 'دخول'}</button></form></section>`;
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'loading' || state.screen === 'boot') {
      app.innerHTML =
        '<section class="workspace-screen"><div class="workspace-card"><div class="loading-state"><div class="skeleton-row"></div><p>جارٍ تحميل مساحة العمل…</p></div></div></section>';
      return;
    }
    if (state.screen === 'select') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><span class="eyebrow">اختيار المساحة</span><h1>اختر مساحة العمل</h1><div class="workspace-list">${state.workspaces.map((workspace, index) => `<button class="workspace-option" data-action="choose" data-index="${index}" type="button"><strong>${esc(workspace.displayName || workspace.slug || 'مساحة عمل')}</strong></button>`).join('')}</div></div></section>`;
      return;
    }
    if (state.screen === 'none')
      return showScreen('لا توجد مساحة متاحة', 'لا توجد مساحة عمل مرتبطة بحسابك حاليًا.');
    if (state.screen === 'error') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><h1>تعذّر فتح الصفحة</h1><p>${esc(state.error)}</p><button class="btn btn-secondary" data-action="retry" type="button">إعادة المحاولة</button></div></section>`;
      return;
    }
    renderWorkspace();
  }

  function renderWorkspace() {
    const resource = current();
    const canRead = allowed(resource.read);
    const canManage = allowed(resource.manage);
    app.innerHTML = `<div class="app-frame"><aside class="sidebar"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">إدارة مساحة العمل</div><nav class="side-nav"><a class="nav-item" href="/appointments/">المواعيد</a><a class="nav-item" href="/patients/">المرضى</a><a class="nav-item" href="/clinic-setup/">المنشآت والفروع</a><a class="nav-item" href="/team-setup/">الأعضاء والفريق</a><div class="nav-item active" aria-current="page">التخصصات والخدمات</div></nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>مساحة نشطة<span class="workspace-name">${esc(state.workspace.displayName || state.workspace.slug || '')}</span></div><div class="side-actions"><button type="button" data-action="switch">تبديل المساحة</button><button type="button" data-action="logout">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs"><span>إدارة مساحة العمل</span><span aria-hidden="true"> / </span><strong>التخصصات والخدمات</strong></div><span class="user-chip">${esc(state.workspace.displayName || '')}</span></header><div class="page-content"><div class="page-heading"><div><span class="eyebrow">بيانات العيادة</span><h1>التخصصات والخدمات</h1><p>حدّث كتالوج المساحة. تُحفظ التغييرات على بيانات هذه المساحة فقط.</p></div></div><div class="catalog-tabs" role="tablist" aria-label="أقسام الكتالوج">${Object.entries(
      config,
    )
      .map(
        ([key, item]) =>
          `<button class="catalog-tab" type="button" role="tab" data-action="tab" data-resource="${key}" aria-selected="${state.resource === key}">${item.label}</button>`,
      )
      .join(
        '',
      )}</div>${!canRead ? '<section class="catalog-card"><div class="catalog-empty"><h2>الوصول محدود</h2><p>لا تملك صلاحية قراءة هذا القسم. لن يتم تحميل بياناته.</p></div></section>' : `<div class="catalog-layout">${canManage ? `<section class="catalog-card"><div class="catalog-card-head"><h2>${state.editId ? 'تعديل ' + resource.singular : 'إضافة ' + resource.singular}</h2><p>تحقق من البيانات قبل الحفظ.</p></div><form class="catalog-form" data-form="record">${resource.fields.map((field) => `<label class="field"><span>${field.label}${field.required ? ' *' : ''}</span>${field.type === 'textarea' ? `<textarea name="${field.key}" ${field.required ? 'required' : ''} maxlength="${field.key === 'description' ? (state.resource === 'services' ? 2000 : 512) : 191}">${esc(state.items.find((item) => item.id === state.editId)?.[field.key] || '')}</textarea>` : `<input name="${field.key}" ${field.required ? 'required' : ''} maxlength="${field.key === 'code' ? 64 : 191}" ${field.direction ? `dir="${field.direction}"` : ''} value="${esc(state.items.find((item) => item.id === state.editId)?.[field.key] || '')}">`}</label>`).join('')}${state.error ? `<p class="form-error" role="alert">${esc(state.error)}</p>` : ''}<div class="form-footer"><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>${state.editId ? '<button class="btn btn-quiet" data-action="cancel-edit" type="button">إلغاء التعديل</button>' : ''}</div></form></section>` : ''}<section class="catalog-card"><div class="catalog-card-head"><h2>${resource.label}</h2><p>${state.items.length.toLocaleString('ar')} سجل</p></div><div class="catalog-filter"><label for="catalog-status">الحالة</label><select id="catalog-status" data-action="filter"><option value="">كل الحالات</option><option value="ACTIVE" ${state.status === 'ACTIVE' ? 'selected' : ''}>نشط</option><option value="SUSPENDED" ${state.status === 'SUSPENDED' ? 'selected' : ''}>موقوف مؤقتًا</option><option value="DEACTIVATED" ${state.status === 'DEACTIVATED' ? 'selected' : ''}>موقوف نهائيًا</option></select></div>${state.loading ? '<div class="catalog-empty">جارٍ تحميل السجلات…</div>' : state.error && !canManage ? `<div class="catalog-error" role="alert">${esc(state.error)}</div>` : state.items.length ? `<div class="catalog-list">${state.items.map((item) => renderItem(item, canManage)).join('')}</div>` : `<div class="catalog-empty"><h3>لا توجد سجلات بعد</h3><p>${canManage ? `أضف ${resource.singular} لتظهر هنا.` : 'لم تتم إضافة عناصر لهذا القسم.'}</p></div>`}</section></div>`}<p class="catalog-help">تُطبق الصلاحيات وعزل مساحة العمل من الخادم. لا تُستخدم هذه الصفحة لإدارة مستخدمين أو بيانات خارج المساحة المحددة.</p></div></section></div>`;
  }

  function renderItem(item, canManage) {
    const statusText =
      { ACTIVE: 'نشط', SUSPENDED: 'موقوف مؤقتًا', DEACTIVATED: 'موقوف نهائيًا' }[item.status] ||
      'غير محدد';
    const action =
      item.status === 'ACTIVE' ? 'suspend' : item.status === 'SUSPENDED' ? 'activate' : '';
    const statusMethod = current().status;
    return `<article class="catalog-item"><div class="catalog-item-top"><h3>${esc(item.name)}</h3><span class="setup-status ${item.status === 'SUSPENDED' ? 'suspended' : item.status === 'DEACTIVATED' ? 'deactivated' : ''}">${statusText}</span></div>${item.code ? `<span class="catalog-code">${esc(item.code)}</span>` : ''}${item.description ? `<p>${esc(item.description)}</p>` : ''}${canManage && item.status !== 'DEACTIVATED' ? `<div class="catalog-actions"><button class="btn btn-secondary" type="button" data-action="edit" data-id="${esc(item.id)}">تعديل</button>${action ? `<button class="btn btn-quiet" type="button" data-action="status" data-id="${esc(item.id)}" data-status="${action}">${action === 'suspend' ? 'إيقاف مؤقت' : 'تفعيل'}</button>` : ''}<button class="btn btn-quiet" type="button" data-action="status" data-id="${esc(item.id)}" data-status="deactivate">إيقاف نهائي</button></div>` : ''}</article>`;
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.dataset.form === 'login') {
      state.saving = true;
      state.error = '';
      renderSignIn();
      try {
        const data = new FormData(form);
        await api.login(String(data.get('email') || ''), String(data.get('password') || ''));
        state.saving = false;
        await loadWorkspaces();
      } catch (error) {
        state.saving = false;
        state.error = safeMessage(error);
        renderSignIn();
      }
    }
    if (form.dataset.form === 'record') {
      if (!allowed(current().manage)) return;
      const formData = new FormData(form);
      const input = {};
      for (const field of current().fields) {
        const value = String(formData.get(field.key) || '').trim();
        if (value || field.required) input[field.key] = value;
        else if (state.editId) input[field.key] = null;
      }
      state.saving = true;
      state.error = '';
      render();
      try {
        const method = state.editId ? current().update : current().create;
        if (state.editId) await api[method](state.workspace.tenantId, state.editId, input);
        else await api[method](state.workspace.tenantId, input);
        state.editId = '';
        state.saving = false;
        await loadItems();
      } catch (error) {
        state.saving = false;
        state.error = safeMessage(error);
        render();
        for (const [key, value] of Object.entries(input)) {
          const field = app.querySelector(`[data-form="record"] [name="${key}"]`);
          if (field) field.value = value;
        }
      }
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'choose') return chooseWorkspace(state.workspaces[Number(button.dataset.index)]);
    if (action === 'retry') return state.workspace ? loadItems() : loadWorkspaces();
    if (action === 'switch') {
      clearWorkspaceData();
      state.workspace = null;
      state.screen = 'select';
      return render();
    }
    if (action === 'logout') {
      await api.logout();
      clearWorkspaceData();
      state.workspace = null;
      return renderSignIn();
    }
    if (action === 'tab') {
      state.resource = button.dataset.resource;
      state.status = '';
      state.editId = '';
      state.error = '';
      return loadItems();
    }
    if (action === 'cancel-edit') {
      state.editId = '';
      state.error = '';
      return render();
    }
    if (action === 'edit') {
      state.editId = button.dataset.id;
      state.error = '';
      return render();
    }
    if (action === 'status') {
      const item = state.items.find((entry) => entry.id === button.dataset.id);
      if (!item || !allowed(current().manage)) return;
      if (
        button.dataset.status === 'deactivate' &&
        !window.confirm(`سيتم إيقاف ${current().singular} نهائيًا. هل تريد المتابعة؟`)
      )
        return;
      try {
        await api[current().status](state.workspace.tenantId, item.id, button.dataset.status);
        state.editId = '';
        await loadItems();
      } catch (error) {
        state.error = safeMessage(error);
        render();
      }
    }
  }

  function onChange(event) {
    if (event.target.matches('[data-action="filter"]')) {
      state.status = event.target.value;
      state.editId = '';
      void loadItems();
    }
  }
})();
