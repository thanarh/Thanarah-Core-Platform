(function startClinicSetup() {
  'use strict';

  const api = window.ThanarahApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void bootstrap();
  });
  const app = document.getElementById('app');
  const toastRegion = document.getElementById('toast-region');
  const PAGE_SIZE = 50;
  const PERMISSIONS = {
    facilityRead: 'tenant.facilities.read',
    facilityCreate: 'tenant.facilities.create',
    facilityUpdate: 'tenant.facilities.update',
    facilitySuspend: 'tenant.facilities.suspend',
    facilityActivate: 'tenant.facilities.activate',
    facilityDeactivate: 'tenant.facilities.deactivate',
    branchRead: 'tenant.branches.read',
    branchCreate: 'tenant.branches.create',
    branchUpdate: 'tenant.branches.update',
    branchSuspend: 'tenant.branches.suspend',
    branchActivate: 'tenant.branches.activate',
    branchDeactivate: 'tenant.branches.deactivate',
  };
  const state = {
    screen: 'boot', workspaces: [], workspace: null, facilities: [], facilityOffset: 0,
    facilityHasNext: false, facilityStatus: '', facilityLoading: false, facilityError: null,
    selectedFacilityId: null, branches: [], branchOffset: 0, branchHasNext: false,
    branchStatus: '', branchLoading: false, branchError: null, facilityForm: null,
    branchForm: null, saving: false, busyId: null, screenMessage: '',
    workspaceEpoch: 0, facilityRequestId: 0, branchRequestId: 0,
  };
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const statusLabel = (status) => ({
    ACTIVE: 'نشطة', SUSPENDED: 'موقوفة مؤقتًا', DEACTIVATED: 'موقوفة نهائيًا',
  })[status] || 'غير محددة';
  const statusClass = (status) => status === 'SUSPENDED' ? 'suspended' : status === 'DEACTIVATED' ? 'deactivated' : '';
  const allowed = (permission) => !!state.workspace?.permissionCodes?.includes(permission);
  const selectedFacility = () => state.facilities.find((item) => item.id === state.selectedFacilityId) || null;

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  void bootstrap();

  async function bootstrap() {
    if (!api) return screenCard('تعذّر تحميل الخدمة', 'أعد تحميل الصفحة للتحقق من الاتصال بالخدمة.', false, 'retry');
    try {
      if (!(await api.restoreSession())) { state.screen = 'signin'; render(); return; }
      await loadWorkspaces();
    } catch (error) {
      state.screen = 'error'; state.screenMessage = message(error); render();
    }
  }

  async function loadWorkspaces() {
    state.screen = 'loading'; render();
    try {
      const result = await api.listWorkspaces();
      state.workspaces = Array.isArray(result.items) ? result.items : [];
      if (!state.workspaces.length) state.screen = 'none';
      else if (state.workspaces.length === 1) { await chooseWorkspace(state.workspaces[0]); return; }
      else state.screen = 'select';
    } catch (error) {
      if (error.status === 401) return expireSession();
      state.screen = 'error'; state.screenMessage = message(error);
    }
    render();
  }

  async function chooseWorkspace(workspace) {
    if (!workspace || typeof workspace.tenantId !== 'string' || !Array.isArray(workspace.permissionCodes)) {
      state.screen = 'none'; render(); return;
    }
    clearWorkspaceData();
    state.workspace = workspace;
    window.ThanarahWorkspaceNavigation?.setPermissions(workspace.permissionCodes);
    state.screen = 'workspace';
    render();
    if (allowed(PERMISSIONS.facilityRead)) await loadFacilities();
  }

  function clearWorkspaceData() {
    state.workspaceEpoch += 1;
    state.facilityRequestId += 1;
    state.branchRequestId += 1;
    state.facilities = [];
    state.selectedFacilityId = null;
    state.branches = [];
    state.facilityOffset = 0;
    state.branchOffset = 0;
    state.facilityHasNext = false;
    state.branchHasNext = false;
    state.facilityStatus = '';
    state.branchStatus = '';
    state.facilityLoading = false;
    state.branchLoading = false;
    state.facilityError = null;
    state.branchError = null;
    state.facilityForm = null;
    state.branchForm = null;
    state.saving = false;
    state.busyId = null;
  }

  function expireSession() {
    clearWorkspaceData();
    state.workspace = null; state.workspaces = []; state.screen = 'signin'; state.facilities = [];
    state.branches = []; render();
  }

  function message(error) {
    return error && typeof error.message === 'string' ? error.message : 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  }

  async function loadFacilities() {
    if (!state.workspace || !allowed(PERMISSIONS.facilityRead)) return;
    const workspace = state.workspace;
    const tenantId = workspace.tenantId;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.facilityRequestId;
    const isCurrent = () =>
      epoch === state.workspaceEpoch &&
      requestId === state.facilityRequestId &&
      state.workspace === workspace;
    state.facilityLoading = true; state.facilityError = null; render();
    try {
      const result = await api.listFacilities(tenantId, {
        status: state.facilityStatus || undefined, limit: PAGE_SIZE, offset: state.facilityOffset,
      });
      if (!isCurrent()) return;
      state.facilities = Array.isArray(result.items) ? result.items : [];
      state.facilityHasNext = state.facilities.length === PAGE_SIZE;
      if (!state.facilities.some((item) => item.id === state.selectedFacilityId)) {
        state.selectedFacilityId = null; state.branches = [];
        state.branchRequestId += 1;
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 401) return expireSession();
      state.facilityError = error;
    } finally {
      if (isCurrent()) {
        state.facilityLoading = false;
        render();
      }
    }
  }

  async function loadBranches() {
    const facility = selectedFacility();
    const workspace = state.workspace;
    const tenantId = workspace?.tenantId;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.branchRequestId;
    const facilityId = facility?.id;
    const isCurrent = () =>
      epoch === state.workspaceEpoch &&
      requestId === state.branchRequestId &&
      state.workspace === workspace &&
      selectedFacility()?.id === facilityId;
    if (!state.workspace || !allowed(PERMISSIONS.branchRead) || !facility || facility.status !== 'ACTIVE') {
      if (isCurrent()) {
        state.branches = [];
        state.branchLoading = false;
        render();
      }
      return;
    }
    state.branchLoading = true; state.branchError = null; render();
    try {
      const result = await api.listSetupBranches(tenantId, facility.id, {
        status: state.branchStatus || undefined, limit: PAGE_SIZE, offset: state.branchOffset,
      });
      if (!isCurrent()) return;
      state.branches = Array.isArray(result.items) ? result.items : [];
      state.branchHasNext = state.branches.length === PAGE_SIZE;
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 401) return expireSession();
      state.branchError = error;
    } finally {
      if (isCurrent()) {
        state.branchLoading = false;
        render();
      }
    }
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'loading' || state.screen === 'boot') {
      app.innerHTML = screenCard('جارٍ تحميل مساحة العمل', 'نتحقق من جلسة الدخول وصلاحيات الوصول.', true); return;
    }
    if (state.screen === 'select') return renderWorkspaceSelect();
    if (state.screen === 'none') return screenCard('لا توجد مساحة متاحة', 'لا توجد مساحة عمل مرتبطة بحسابك حاليًا.', false, 'logout');
    if (state.screen === 'error') return screenCard('تعذّر الوصول إلى مساحة العمل', state.screenMessage, false, 'retry');
    if (!state.workspace) return screenCard('تعذّر فتح مساحة العمل', 'سجّل الدخول مجددًا للمتابعة.', false, 'retry');
    if (!allowed(PERMISSIONS.facilityRead)) {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brand()}<span class="eyebrow">إعداد المنشآت</span><h1>الوصول محدود</h1><p class="auth-intro">تتطلب هذه الصفحة صلاحية <bdi dir="ltr">${PERMISSIONS.facilityRead}</bdi>. لم يتم تحميل بيانات المنشآت.</p><button class="btn btn-secondary" data-action="switch-workspace">اختيار مساحة أخرى</button><button class="btn btn-quiet" data-action="logout">تسجيل الخروج</button></div></section>`;
      return;
    }
    app.innerHTML = shell();
  }

  function brand() {
    return '<div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · CLINIC SETUP</span></div></div>';
  }

  function screenCard(title, text, loading, action) {
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brand()}<span class="eyebrow">إعداد المنشآت</span><h1>${esc(title)}</h1><p class="auth-intro">${esc(text)}</p>${loading ? '<div class="loading-state"><div class="skeleton-row"></div><p class="form-note">لحظات من فضلك…</p></div>' : `<button class="btn btn-secondary" data-action="${action}">${action === 'logout' ? 'تسجيل الخروج' : 'إعادة المحاولة'}</button>`}<p class="screen-footer">تُحدد العضوية والصلاحيات ونطاق المنشأة من الخادم.</p></div></section>`;
  }

  function renderSignIn() {
    app.innerHTML = `<section class="auth-screen"><div class="auth-card">${brand()}<span class="eyebrow">إعداد المنشآت والفروع</span><h1>مرحبًا بعودتك</h1><p class="auth-intro">سجّل الدخول لإدارة مواقع مساحة العمل ضمن صلاحياتك.</p>${state.screenMessage ? `<p class="inline-message" role="alert">${esc(state.screenMessage)}</p>` : ''}<form class="auth-form" data-form="signin"><div class="field"><label for="signin-email">البريد الإلكتروني</label><input class="control" id="signin-email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="signin-password">كلمة المرور</label><input class="control" id="signin-password" name="password" type="password" autocomplete="current-password" required></div><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ تسجيل الدخول…' : 'دخول إلى مساحة العمل'}</button></form><p class="screen-footer">لا تحفظ الصفحة بيانات الدخول في التخزين المحلي.</p></div></section>`;
  }

  function renderWorkspaceSelect() {
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brand()}<span class="eyebrow">اختيار المساحة</span><h1>اختر مساحة العمل</h1><p class="auth-intro">تظهر هنا المساحات المرتبطة بعضويتك النشطة فقط.</p><div class="workspace-list">${state.workspaces.map((workspace, index) => `<button class="workspace-option" type="button" data-action="choose-workspace" data-index="${index}"><span><strong>${esc(workspace.displayName || 'مساحة عمل')}</strong><small>${esc(workspace.slug || '')}</small></span><span aria-hidden="true">←</span></button>`).join('')}</div><button class="btn btn-quiet" data-action="logout">تسجيل الخروج</button></div></section>`;
  }

  function shell() {
    const name = esc(state.workspace.displayName || state.workspace.slug || 'مساحة العمل');
    return `<div class="app-frame"><aside class="sidebar" aria-label="التنقل الرئيسي"><a class="brand" href="/appointments/" aria-label="ثناره — مساحة العمل"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">إدارة مساحة العمل</div><nav class="side-nav"><div class="nav-item active" aria-current="page"><span>المنشآت والفروع</span></div><a class="nav-item" href="/patients/">المرضى</a><a class="nav-item" href="/appointments/">المواعيد</a><a class="nav-item" href="/encounters/">اللقاءات</a></nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>مساحة نشطة<span class="workspace-name">${name}</span></div><div class="side-actions"><button type="button" data-action="switch-workspace">تبديل المساحة</button><button type="button" data-action="logout">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs"><span>إدارة مساحة العمل</span><span aria-hidden="true"> / </span><strong>المنشآت والفروع</strong></div><div class="top-actions"><span class="user-chip">${name}</span></div></header><div class="page-content"><div class="page-heading"><div><span class="eyebrow">إعداد العيادة</span><h1>المنشآت والفروع</h1><p>نظّم مواقع العمل قبل إسناد الموظفين وتشغيل الخدمات.</p></div></div>${!allowed(PERMISSIONS.facilityRead) ? '' : `<div class="setup-grid"><section class="setup-panel" aria-label="المنشآت">${facilityPanel()}</section><section class="setup-panel" aria-label="الفروع">${branchPanel()}</section></div>`}</div></section></div>`;
  }

  function facilityPanel() {
    const canCreate = allowed(PERMISSIONS.facilityCreate);
    return `<div class="setup-panel-head"><div><h2>المنشآت</h2><p>أضف موقعًا رئيسيًا لإدارة فروعه.</p></div>${canCreate ? '<button class="btn btn-primary btn-small" data-action="new-facility">إضافة منشأة</button>' : ''}</div><div class="setup-filter"><label class="field"><span>حالة المنشأة</span><select class="control" id="facility-status"><option value="">كل الحالات</option>${statusOptions(state.facilityStatus)}</select></label></div>${state.facilityForm ? facilityForm() : state.facilityLoading && !state.facilities.length ? loadingMarkup() : state.facilityError ? errorMarkup('facility') : !state.facilities.length ? `<div class="setup-empty"><h3>لا توجد منشآت بعد</h3><p>${canCreate ? 'أضف المنشأة الأولى لبدء إعداد مواقع العمل.' : 'لا توجد منشآت ضمن صلاحياتك.'}</p>${canCreate ? '<button class="btn btn-primary" data-action="new-facility">إضافة منشأة</button>' : ''}</div>` : `<div class="setup-list">${state.facilities.map(facilityCard).join('')}</div>${paging('facility',state.facilityOffset,state.facilities.length,state.facilityHasNext)}`}${state.facilityLoading && state.facilities.length ? '<p class="setup-note">جارٍ تحديث القائمة…</p>' : ''}`;
  }

  function facilityCard(facility) {
    const selected = facility.id === state.selectedFacilityId;
    const actions = [];
    if (facility.status === 'ACTIVE' && allowed(PERMISSIONS.facilitySuspend)) actions.push(actionButton('suspend-facility',facility.id,'إيقاف مؤقت','btn-secondary'));
    if (facility.status === 'SUSPENDED' && allowed(PERMISSIONS.facilityActivate)) actions.push(actionButton('activate-facility',facility.id,'تفعيل','btn-secondary'));
    if (facility.status !== 'DEACTIVATED' && allowed(PERMISSIONS.facilityDeactivate)) actions.push(actionButton('deactivate-facility',facility.id,'إيقاف نهائي','btn-quiet'));
    return `<article class="setup-card${selected ? ' selected' : ''}"><button class="setup-card-select" type="button" data-action="select-facility" data-id="${esc(facility.id)}"><span class="setup-card-top"><span class="setup-card-name">${esc(facility.name)}</span><span class="setup-status ${statusClass(facility.status)}">${statusLabel(facility.status)}</span></span><span class="setup-card-meta"><span>أُنشئت ${dateLabel(facility.createdAt)}</span><span>عرض الفروع ←</span></span></button><div class="setup-row-actions">${allowed(PERMISSIONS.facilityUpdate) && facility.status !== 'DEACTIVATED' ? actionButton('edit-facility',facility.id,'تعديل','btn-secondary') : ''}${actions.join('')}</div></article>`;
  }

  function branchPanel() {
    const facility = selectedFacility();
    if (!facility) return `<div class="setup-panel-head"><div><h2>الفروع</h2><p>اختر منشأة لعرض فروعها وإدارتها.</p></div></div><div class="branch-unavailable">تظهر الفروع تحت المنشأة المحددة.</div>`;
    const canCreate = allowed(PERMISSIONS.branchCreate);
    const isActive = facility.status === 'ACTIVE';
    const header = `<div class="setup-panel-head"><div><h2>الفروع</h2><p>الفروع التابعة لمنشأة محددة.</p></div>${isActive && canCreate ? '<button class="btn btn-primary btn-small" data-action="new-branch">إضافة فرع</button>' : ''}</div><div class="facility-summary"><h3>${esc(facility.name)}</h3><p>حالة المنشأة: ${statusLabel(facility.status)}</p></div>`;
    if (!isActive) return `${header}<div class="branch-unavailable">${facility.status === 'SUSPENDED' ? 'فعّل المنشأة لعرض فروعها وإدارتها.' : 'المنشأة متوقفة نهائيًا.'}</div>`;
    if (!allowed(PERMISSIONS.branchRead)) return `${header}<div class="branch-unavailable">لا تملك صلاحية قراءة الفروع. تتطلب العملية <bdi dir="ltr">${PERMISSIONS.branchRead}</bdi>.</div>`;
    return `${header}<div class="setup-filter"><label class="field"><span>حالة الفرع</span><select class="control" id="branch-status"><option value="">كل الحالات</option>${statusOptions(state.branchStatus)}</select></label></div>${state.branchForm ? branchForm() : state.branchLoading && !state.branches.length ? loadingMarkup() : state.branchError ? errorMarkup('branch') : !state.branches.length ? `<div class="setup-empty"><h3>لا توجد فروع بعد</h3><p>${canCreate ? 'أضف أول فرع لهذه المنشأة.' : 'لا توجد فروع ضمن صلاحياتك.'}</p>${canCreate ? '<button class="btn btn-primary" data-action="new-branch">إضافة فرع</button>' : ''}</div>` : `<div class="branch-list">${state.branches.map(branchCard).join('')}</div>${paging('branch',state.branchOffset,state.branches.length,state.branchHasNext)}`}${state.branchLoading && state.branches.length ? '<p class="setup-note">جارٍ تحديث القائمة…</p>' : ''}`;
  }

  function branchCard(branch) {
    const actions = [];
    if (branch.status === 'ACTIVE' && allowed(PERMISSIONS.branchSuspend)) actions.push(actionButton('suspend-branch',branch.id,'إيقاف مؤقت','btn-secondary'));
    if (branch.status === 'SUSPENDED' && allowed(PERMISSIONS.branchActivate)) actions.push(actionButton('activate-branch',branch.id,'تفعيل','btn-secondary'));
    if (branch.status !== 'DEACTIVATED' && allowed(PERMISSIONS.branchDeactivate)) actions.push(actionButton('deactivate-branch',branch.id,'إيقاف نهائي','btn-quiet'));
    return `<article class="branch-card"><div class="branch-card-main"><strong>${esc(branch.name)}</strong><span class="setup-status ${statusClass(branch.status)}">${statusLabel(branch.status)}</span></div><div class="setup-row-actions branch-actions">${allowed(PERMISSIONS.branchUpdate) && branch.status !== 'DEACTIVATED' ? actionButton('edit-branch',branch.id,'تعديل','btn-secondary') : ''}${actions.join('')}</div></article>`;
  }

  function statusOptions(selected) {
    return ['ACTIVE','SUSPENDED','DEACTIVATED'].map((status) => `<option value="${status}" ${selected === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('');
  }

  function facilityForm() {
    const form = state.facilityForm;
    return `<div class="setup-form-wrap"><h3>${form.id ? 'تعديل اسم المنشأة' : 'منشأة جديدة'}</h3>${form.error ? `<p class="inline-message" role="alert">${esc(message(form.error))}</p>` : ''}<form data-form="facility"><label class="field"><span>اسم المنشأة *</span><input class="control" name="name" maxlength="191" required value="${esc(form.name)}" autocomplete="off"></label><div class="form-footer"><span class="form-note">تُراجع البيانات وتُحفظ عبر الخدمة.</span><div class="heading-actions"><button class="btn btn-secondary" type="button" data-action="cancel-facility-form">إلغاء</button><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ'}</button></div></div></form></div>`;
  }

  function branchForm() {
    const form = state.branchForm;
    return `<div class="setup-form-wrap"><h3>${form.id ? 'تعديل اسم الفرع' : 'فرع جديد'}</h3>${form.error ? `<p class="inline-message" role="alert">${esc(message(form.error))}</p>` : ''}<form data-form="branch"><label class="field"><span>اسم الفرع *</span><input class="control" name="name" maxlength="191" required value="${esc(form.name)}" autocomplete="off"></label><div class="form-footer"><span class="form-note">يرتبط الفرع بالمنشأة المحددة.</span><div class="heading-actions"><button class="btn btn-secondary" type="button" data-action="cancel-branch-form">إلغاء</button><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ'}</button></div></div></form></div>`;
  }

  function actionButton(action,id,label,klass) {
    return `<button class="btn ${klass}" type="button" data-action="${action}" data-id="${esc(id)}" ${state.busyId === id ? 'disabled' : ''}>${state.busyId === id ? 'جارٍ التحديث…' : label}</button>`;
  }

  function loadingMarkup() {
    return '<div class="loading-state setup-list" aria-label="جارٍ التحميل"><div class="skeleton-row"></div><div class="skeleton-row"></div></div>';
  }

  function errorMarkup(kind) {
    const isFacility = kind === 'facility';
    return `<div class="setup-error" role="alert"><h3>تعذّر تحميل ${isFacility ? 'المنشآت' : 'الفروع'}</h3><p>${esc(message(isFacility ? state.facilityError : state.branchError))}</p><button class="btn btn-secondary" data-action="retry-${kind}">إعادة المحاولة</button></div>`;
  }

  function paging(kind,offset,count,hasNext) {
    return `<div class="setup-paging"><span>النتائج ${offset + 1}–${offset + count}</span><div class="heading-actions"><button class="btn btn-secondary btn-small" data-action="previous-${kind}" ${offset === 0 || state.facilityLoading || state.branchLoading ? 'disabled' : ''}>السابق</button><button class="btn btn-secondary btn-small" data-action="next-${kind}" ${!hasNext || state.facilityLoading || state.branchLoading ? 'disabled' : ''}>التالي</button></div></div>`;
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(
          window.ThanarahLocale ? window.ThanarahLocale.dateLocale('ar') : 'ar',
          { year: 'numeric', month: 'short', day: 'numeric' },
        ).format(date);
  }

  function onChange(event) {
    if (event.target.id === 'facility-status') {
      state.facilityStatus = event.target.value; state.facilityOffset = 0; void loadFacilities();
    }
    if (event.target.id === 'branch-status') {
      state.branchStatus = event.target.value; state.branchOffset = 0; void loadBranches();
    }
  }

  async function onSubmit(event) {
    const form = event.target;
    const type = form?.dataset?.form;
    if (!type) return;
    event.preventDefault();
    if (type === 'signin') {
      const data = new FormData(form);
      state.saving = true; state.screenMessage = ''; render();
      try {
        await api.login(String(data.get('email') || '').trim(), String(data.get('password') || ''));
        state.saving = false; await loadWorkspaces();
      } catch (error) {
        state.saving = false; state.screenMessage = message(error); render();
      }
      return;
    }
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name || !state.workspace) return;
    const workspace = state.workspace;
    const epoch = state.workspaceEpoch;
    state.saving = true;
    if (type === 'facility') state.facilityForm.error = null;
    else state.branchForm.error = null;
    render();
    try {
      if (type === 'facility') {
        if (state.facilityForm.id) await api.updateFacility(workspace.tenantId, state.facilityForm.id, { name });
        else await api.createFacility(workspace.tenantId, { name });
        if (epoch !== state.workspaceEpoch || state.workspace !== workspace) return;
        state.facilityForm = null; state.facilityOffset = 0;
        toast('تم حفظ بيانات المنشأة.'); await loadFacilities();
      } else {
        const facility = selectedFacility();
        if (!facility) throw new Error('اختر منشأة نشطة قبل إضافة الفرع.');
        if (state.branchForm.id) await api.updateBranch(workspace.tenantId, facility.id, state.branchForm.id, { name });
        else await api.createBranch(workspace.tenantId, facility.id, { name });
        if (epoch !== state.workspaceEpoch || state.workspace !== workspace) return;
        state.branchForm = null; state.branchOffset = 0;
        toast('تم حفظ بيانات الفرع.'); await loadBranches();
      }
    } catch (error) {
      if (epoch !== state.workspaceEpoch || state.workspace !== workspace) return;
      if (error.status === 401) { expireSession(); return; }
      if (!state.workspace) return;
      if (type === 'facility' && state.facilityForm) state.facilityForm.error = error;
      if (type === 'branch' && state.branchForm) state.branchForm.error = error;
    } finally {
      if (epoch === state.workspaceEpoch && state.workspace === workspace) {
        state.saving = false;
        render();
      }
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'choose-workspace') { await chooseWorkspace(state.workspaces[Number(button.dataset.index)]); return; }
    if (action === 'logout') { await logout(); return; }
    if (action === 'retry') { await bootstrap(); return; }
    if (action === 'switch-workspace') {
      clearWorkspaceData();
      state.workspace = null;
      if (state.workspaces.length > 1) { state.screen = 'select'; render(); }
      else await loadWorkspaces();
      return;
    }
    if (action === 'new-facility' && allowed(PERMISSIONS.facilityCreate)) {
      state.facilityForm = { name: '', id: null, error: null }; state.branchForm = null; render(); return;
    }
    if (action === 'edit-facility' && allowed(PERMISSIONS.facilityUpdate)) {
      const item = state.facilities.find((facility) => facility.id === id);
      if (item) { state.facilityForm = { id, name: item.name, error: null }; state.branchForm = null; render(); }
      return;
    }
    if (action === 'cancel-facility-form') { state.facilityForm = null; state.saving = false; render(); return; }
    if (action === 'new-branch' && allowed(PERMISSIONS.branchCreate) && selectedFacility()?.status === 'ACTIVE') {
      state.branchForm = { name: '', id: null, error: null }; state.facilityForm = null; render(); return;
    }
    if (action === 'edit-branch' && allowed(PERMISSIONS.branchUpdate)) {
      const item = state.branches.find((branch) => branch.id === id);
      if (item) { state.branchForm = { id, name: item.name, error: null }; state.facilityForm = null; render(); }
      return;
    }
    if (action === 'cancel-branch-form') { state.branchForm = null; state.saving = false; render(); return; }
    if (action === 'select-facility') {
      state.selectedFacilityId = id; state.branches = []; state.branchOffset = 0; state.branchForm = null; render(); await loadBranches(); return;
    }
    if (action === 'retry-facility') { await loadFacilities(); return; }
    if (action === 'retry-branch') { await loadBranches(); return; }
    if (action === 'previous-facility' || action === 'next-facility') {
      state.facilityOffset = Math.max(0, state.facilityOffset + (action === 'next-facility' ? PAGE_SIZE : -PAGE_SIZE));
      await loadFacilities(); return;
    }
    if (action === 'previous-branch' || action === 'next-branch') {
      state.branchOffset = Math.max(0, state.branchOffset + (action === 'next-branch' ? PAGE_SIZE : -PAGE_SIZE));
      await loadBranches(); return;
    }
    if (action.endsWith('-facility') || action.endsWith('-branch')) {
      await changeStatus(action, id); return;
    }
  }

  async function changeStatus(action,id) {
    const facility = selectedFacility();
    const branch = state.branches.find((item) => item.id === id);
    const facilityAction = action.endsWith('-facility');
    const item = facilityAction ? state.facilities.find((entry) => entry.id === id) : branch;
    if (!item || !state.workspace) return;
    const workspace = state.workspace;
    const tenantId = workspace.tenantId;
    const epoch = state.workspaceEpoch;
    const [, entity] = action.split('-');
    const verb = action.startsWith('activate-') ? 'activate' : action.startsWith('suspend-') ? 'suspend' : 'deactivate';
    const permission = PERMISSIONS[`${entity}${verb[0].toUpperCase()}${verb.slice(1)}`];
    if (!permission || !allowed(permission)) return;
    const label = entity === 'facility' ? 'المنشأة' : 'الفرع';
    const irreversible = verb === 'deactivate';
    if (!window.confirm(irreversible
      ? `إيقاف ${label} نهائيًا؟ لا يمكن إعادة تفعيل الحالة النهائية.`
      : verb === 'suspend' ? `إيقاف ${label} مؤقتًا؟` : `إعادة تفعيل ${label}؟`)) return;
    state.busyId = id; render();
    try {
      if (entity === 'facility') await api.changeFacilityStatus(tenantId, id, verb);
      else {
        if (!facility || facility.status !== 'ACTIVE') throw new Error('فعّل المنشأة قبل تعديل حالة الفرع.');
        await api.changeBranchStatus(tenantId, facility.id, id, verb);
      }
      if (epoch !== state.workspaceEpoch || state.workspace !== workspace) return;
      toast(verb === 'activate' ? `تم تفعيل ${label}.` : verb === 'suspend' ? `تم إيقاف ${label} مؤقتًا.` : `تم إيقاف ${label} نهائيًا.`);
      if (entity === 'facility') await loadFacilities();
      else await loadBranches();
    } catch (error) {
      if (epoch !== state.workspaceEpoch || state.workspace !== workspace) return;
      if (error.status === 401) return expireSession();
      toast(message(error), true);
    } finally {
      if (epoch === state.workspaceEpoch && state.workspace === workspace) {
        state.busyId = null;
        render();
      }
    }
  }

  function toast(text,isError) {
    const node = document.createElement('div');
    node.className = `toast${isError ? ' error' : ''}`;
    node.setAttribute('role',isError ? 'alert' : 'status');
    node.textContent = text; toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  async function logout() {
    clearWorkspaceData();
    state.workspace = null; state.workspaces = []; state.screen = 'signin';
    render();
    try { await api.logout(); } catch (_) { /* The API client clears the access token. */ }
  }
})();
