(function startPatientDirectory() {
  'use strict';

  const api = window.ThanarahApi;
  const app = document.getElementById('app');
  const toastRegion = document.getElementById('toast-region');
  const READ = 'tenant.patients.read';
  const MANAGE = 'tenant.patients.manage';
  const PAGE_SIZE = 20;
  const state = {
    screen: 'boot', workspaces: [], workspace: null, view: 'directory',
    items: [], total: 0, offset: 0, hasNext: false, search: '', status: '',
    loading: false, error: null, requestId: 0, patient: null, detailLoading: false,
    detailError: null, formError: null, formDraft: null, saving: false, profileId: null,
    pendingAction: false, email: '', screenMessage: '',
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const itemsOf = (response) => response && Array.isArray(response.items) ? response.items : [];
  const can = (code) => !!state.workspace && Array.isArray(state.workspace.permissionCodes) && state.workspace.permissionCodes.includes(code);
  const hasRead = () => can(READ);
  const hasManage = () => can(MANAGE);
  const safeMessage = (error) => error && typeof error.message === 'string' ? error.message : 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  const fullName = (patient) => [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ');
  const patientName = (patient) => patient.preferredName || fullName(patient) || 'مريض';
  const statusLabel = (status) => status === 'ACTIVE' ? 'نشط' : status === 'INACTIVE' ? 'غير نشط' : 'غير محدد';

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  void bootstrap();

  async function bootstrap() {
    if (!api) return renderScreenCard('تعذّر تحميل الخدمة', 'أعد تحميل الصفحة للتحقق من الاتصال بالخدمة.', false, 'retry-boot');
    try {
      if (!(await api.restoreSession())) { state.screen = 'signin'; render(); return; }
      await loadWorkspaces();
    } catch (error) {
      state.screen = 'boot-error'; state.screenMessage = safeMessage(error); render();
    }
  }

  async function loadWorkspaces() {
    state.screen = 'workspace-loading'; render();
    try {
      state.workspaces = itemsOf(await api.listWorkspaces());
      if (!state.workspaces.length) state.screen = 'no-workspaces';
      else if (state.workspaces.length === 1) { await chooseWorkspace(state.workspaces[0]); return; }
      else state.screen = 'workspace-select';
    } catch (error) {
      if (error && error.status === 401) { expireSession(); return; }
      state.screen = 'workspaces-error'; state.screenMessage = safeMessage(error);
    }
    render();
  }

  async function chooseWorkspace(workspace) {
    if (!workspace || typeof workspace.tenantId !== 'string' || !Array.isArray(workspace.permissionCodes)) {
      state.screen = 'no-workspaces'; render(); return;
    }
    clearPatientState();
    state.workspace = workspace;
    state.screen = 'workspace';
    state.view = hasRead() ? 'directory' : 'no-access';
    render();
    if (hasRead()) await loadPatients();
  }

  function clearPatientState() {
    state.requestId += 1;
    state.items = []; state.total = 0; state.offset = 0; state.hasNext = false;
    state.search = ''; state.status = ''; state.loading = false; state.error = null;
    state.patient = null; state.profileId = null; state.detailError = null;
    state.formError = null; state.formDraft = null; state.saving = false; state.pendingAction = false;
  }

  function expireSession() {
    clearPatientState();
    state.workspace = null; state.workspaces = []; state.screen = 'signin';
    state.screenMessage = 'انتهت جلسة الدخول. سجّل الدخول مجددًا.';
    render();
  }

  async function loadPatients() {
    if (!hasRead() || !state.workspace) return;
    const requestId = ++state.requestId;
    state.loading = true; state.error = null; render();
    try {
      const response = await api.listPatients(state.workspace.tenantId, {
        search: state.search.trim() || undefined,
        status: state.status || undefined,
        limit: PAGE_SIZE,
        offset: Math.min(100000, Math.max(0, state.offset)),
      });
      if (requestId !== state.requestId) return;
      state.items = itemsOf(response);
      state.total = Number.isFinite(response.total) ? response.total : state.items.length;
      state.offset = Number.isFinite(response.offset) ? Math.min(100000, Math.max(0, response.offset)) : state.offset;
      state.hasNext = !!response.hasNext;
      state.loading = false;
    } catch (error) {
      if (requestId !== state.requestId) return;
      if (error && error.status === 401) { expireSession(); return; }
      state.loading = false; state.error = error;
    }
    render();
  }

  async function openPatient(id) {
    if (!hasRead() || !state.workspace || !id) return;
    state.view = 'profile'; state.profileId = String(id);
    state.patient = null; state.detailLoading = true; state.detailError = null; render();
    const requestId = ++state.requestId;
    try {
      const patient = await api.getPatient(state.workspace.tenantId, id);
      if (requestId !== state.requestId) return;
      state.patient = patient; state.detailLoading = false;
    } catch (error) {
      if (requestId !== state.requestId) return;
      if (error && error.status === 401) { expireSession(); return; }
      state.detailLoading = false; state.detailError = error;
    }
    render();
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'workspace-loading' || state.screen === 'boot') {
      app.innerHTML = screenCard('جارٍ تحميل مساحة العمل', 'نتحقق من جلسة الدخول وصلاحيات الوصول.', true); return;
    }
    if (state.screen === 'workspace-select') return renderWorkspaceSelect();
    if (state.screen === 'no-workspaces') return renderScreenCard('لا توجد مساحة متاحة', 'لا توجد مساحة عمل مرتبطة بحسابك حاليًا. تواصل مع مسؤول المنشأة إذا كان هذا غير متوقع.', false, 'logout');
    if (state.screen === 'boot-error' || state.screen === 'workspaces-error') return renderScreenCard('تعذّر الوصول إلى مساحة العمل', state.screenMessage, false, 'retry-workspaces');
    if (!state.workspace) return renderScreenCard('تعذّر فتح مساحة العمل', 'أعد المحاولة أو سجّل الدخول من جديد.', false, 'retry-boot');
    if (!hasRead()) {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brandMarkup()}<span class="eyebrow">الوصول محدود</span><h1>لا توجد صلاحية لدليل المرضى</h1><p class="auth-intro">تتطلب هذه المساحة صلاحية <bdi dir="ltr">tenant.patients.read</bdi>. لن يتم تحميل بيانات المرضى.</p><button class="btn btn-secondary" type="button" data-action="switch-workspace">اختيار مساحة أخرى</button><button class="btn btn-quiet" type="button" data-action="logout">تسجيل الخروج</button></div></section>`;
      return;
    }
    app.innerHTML = shellMarkup();
    if (state.view === 'form') renderForm();
    else if (state.view === 'profile') renderProfile();
    else renderDirectory();
  }

  function brandMarkup() {
    return `<div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · PATIENTS</span></div></div>`;
  }

  function screenCard(title, message, loading, action) {
    const button = action ? `<button class="btn btn-secondary" type="button" data-action="${escapeHtml(action)}">${action === 'logout' ? 'تسجيل الخروج' : 'إعادة المحاولة'}</button>` : '';
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brandMarkup()}<span class="eyebrow">دليل المرضى</span><h1>${escapeHtml(title)}</h1><p class="auth-intro">${escapeHtml(message)}</p>${loading ? '<div class="loading-state"><div class="skeleton-row"></div><div class="skeleton-row"></div><p class="form-note">لحظات من فضلك…</p></div>' : button}<p class="screen-footer">تظل صلاحيات الموظفين ونطاقات الوصول بيد الخادم.</p></div></section>`;
  }

  function renderScreenCard(title, message, loading, action) { screenCard(title, message, loading, action); }

  function renderSignIn() {
    app.innerHTML = `<section class="auth-screen"><div class="auth-card">${brandMarkup()}<span class="eyebrow">مساحة العمل السريرية</span><h1>مرحبًا بعودتك</h1><p class="auth-intro">سجّل الدخول للوصول إلى دليل المرضى ضمن صلاحيات مساحة العمل.</p>${state.screenMessage ? `<p class="inline-message" role="alert">${escapeHtml(state.screenMessage)}</p>` : ''}<form class="auth-form" data-form="signin"><div class="field"><label for="signin-email">البريد الإلكتروني</label><input class="control" id="signin-email" name="email" type="email" autocomplete="username" required value="${escapeHtml(state.email)}"></div><div class="field"><label for="signin-password">كلمة المرور</label><input class="control" id="signin-password" name="password" type="password" autocomplete="current-password" required></div><div id="signin-error" class="inline-message" role="alert" hidden></div><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ تسجيل الدخول…' : 'دخول إلى مساحة العمل'}</button></form><p class="screen-footer">لا تحفظ هذه الصفحة بيانات المرضى على هذا الجهاز.</p></div></section>`;
  }

  function renderWorkspaceSelect() {
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brandMarkup()}<span class="eyebrow">اختيار المساحة</span><h1>إلى أين تتجه؟</h1><p class="auth-intro">اختر مساحة العمل التي منحك فريقها حق الوصول إليها.</p><div class="workspace-list">${state.workspaces.map((workspace, index) => `<button class="workspace-option" type="button" data-action="choose-workspace" data-index="${index}"><span><strong>${escapeHtml(workspace.displayName || 'مساحة عمل')}</strong><small>${escapeHtml(workspace.slug || workspace.tenantId || '')}</small></span><span aria-hidden="true">←</span></button>`).join('')}</div><button class="btn btn-quiet" style="margin-top:16px" type="button" data-action="logout">تسجيل الخروج</button><p class="screen-footer">لا تتم مشاركة بيانات المرضى بين مساحات العمل.</p></div></section>`;
  }

  function shellMarkup() {
    const name = escapeHtml(state.workspace.displayName || state.workspace.slug || 'مساحة العمل');
    const viewLabel = state.view === 'profile' ? 'ملف المريض' : state.view === 'form' ? (state.profileId ? 'تعديل البيانات' : 'تسجيل مريض') : 'دليل المرضى';
    return `<div class="app-frame"><aside class="sidebar" aria-label="التنقل الرئيسي"><a class="brand" href="/appointments/" aria-label="ثناره — مساحة العمل"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">العمليات السريرية</div><nav class="side-nav"><div class="nav-item active" aria-current="page"><span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20M16 5.5a3 3 0 0 1 0 5.8M18 15a4.5 4.5 0 0 1 2.5 4v1"/></svg></span><span>المرضى</span></div></nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>مساحة نشطة<span class="workspace-name">${name}</span></div><div class="side-actions"><button type="button" data-action="switch-workspace">تبديل المساحة</button><button type="button" data-action="logout">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs"><span>العمليات السريرية</span><span aria-hidden="true"> / </span><strong>${viewLabel}</strong></div><div class="top-actions"><span class="user-chip">${name}</span></div></header><div class="page-content" id="page-content"></div></section></div>`;
  }

  function renderDirectory() {
    const content = document.getElementById('page-content');
    const rows = state.items.map((patient) => `<tr><td><span class="patient-name">${escapeHtml(patientName(patient))}</span><span class="cell-sub">${escapeHtml(patient.patientNumber || '—')}</span></td><td>${escapeHtml([patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ') || '—')}</td><td><bdi dir="ltr">${escapeHtml(patient.phone || '—')}</bdi></td><td><bdi dir="ltr">${escapeHtml(patient.email || '—')}</bdi></td><td><span class="status-pill ${patient.status === 'INACTIVE' ? 'inactive' : ''}">${escapeHtml(statusLabel(patient.status))}</span></td><td><button class="row-open" type="button" data-action="open-patient" data-id="${escapeHtml(patient.id)}">فتح الملف</button></td></tr>`).join('');
    const from = state.total ? state.offset + 1 : 0;
    const to = Math.min(state.offset + state.items.length, state.total);
    content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">إدارة السجلات</span><h1>دليل المرضى</h1><p>ابحث في السجلات الأساسية وتابع حالة كل ملف.</p></div><div class="heading-actions">${hasManage() ? '<button class="btn btn-primary" type="button" data-action="new-patient"><span aria-hidden="true">＋</span> تسجيل مريض</button>' : ''}</div></div><section class="panel" aria-label="قائمة المرضى"><form class="filters-panel" data-form="filters"><div class="field search-field"><label for="patient-search">البحث في الدليل</label><input class="control" id="patient-search" name="search" type="search" maxlength="100" value="${escapeHtml(state.search)}" placeholder="الاسم أو رقم المريض أو وسيلة التواصل"></div><div class="field"><label for="patient-status">حالة الملف</label><select class="control" id="patient-status" name="status"><option value="" ${state.status === '' ? 'selected' : ''}>كل الحالات</option><option value="ACTIVE" ${state.status === 'ACTIVE' ? 'selected' : ''}>نشط</option><option value="INACTIVE" ${state.status === 'INACTIVE' ? 'selected' : ''}>غير نشط</option></select></div><div class="filter-actions"><button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>${state.loading ? 'جارٍ البحث…' : 'بحث'}</button><button class="btn btn-secondary" type="button" data-action="reset-filters">مسح</button></div></form><div class="list-status"><span>${state.loading ? 'جارٍ تحميل نتائج الدليل…' : `إجمالي النتائج: ${state.total}`}</span><span>تعرض القائمة بيانات الدليل الأساسية فقط.</span></div>${state.loading && !state.items.length ? `<div class="loading-state" aria-label="جارٍ التحميل">${[1,2,3].map(() => '<div class="skeleton-row"></div>').join('')}</div>` : ''}${state.error ? `<div class="error-state" role="alert"><div class="empty-mark" aria-hidden="true">!</div><h2>تعذّر تحميل القائمة</h2><p>${escapeHtml(safeMessage(state.error))}</p><button class="btn btn-secondary" type="button" data-action="retry-list">إعادة المحاولة</button></div>` : ''}${!state.loading && !state.error && !state.items.length ? `<div class="empty-state"><div class="empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20M17 9h4M19 7v4"/></svg></div><h2>${state.search || state.status ? 'لا توجد نتائج مطابقة' : 'لا توجد سجلات مرضى بعد'}</h2><p>${state.search || state.status ? 'جرّب تعديل عبارة البحث أو حالة الملف.' : hasManage() ? 'يمكنك تسجيل مريض جديد لبدء بناء دليل المنشأة.' : 'ستظهر السجلات هنا عند توفرها ضمن صلاحياتك.'}</p>${hasManage() && !state.search && !state.status ? '<button class="btn btn-primary" type="button" data-action="new-patient">تسجيل مريض</button>' : ''}</div>` : ''}${state.items.length ? `<div class="table-wrap"><table class="patients-table"><thead><tr><th scope="col">المريض / الرقم</th><th scope="col">الاسم المسجل</th><th scope="col">الهاتف</th><th scope="col">البريد الإلكتروني</th><th scope="col">الحالة</th><th scope="col"><span class="sr-only">إجراء</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}<div class="pagination"><span>عرض ${from}–${to} من ${state.total}</span><div class="pagination-controls"><button class="btn btn-secondary btn-small" type="button" data-action="previous-page" ${state.offset === 0 || state.loading ? 'disabled' : ''}>السابق</button><button class="btn btn-secondary btn-small" type="button" data-action="next-page" ${!state.hasNext || state.loading || state.offset >= 100000 ? 'disabled' : ''}>التالي</button></div></div></section>`;
  }

  function renderProfile() {
    const content = document.getElementById('page-content');
    if (state.detailLoading) {
      content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">دليل المرضى</span><h1>ملف المريض</h1><p>جارٍ تحميل التفاصيل المصرح بها…</p></div><button class="btn btn-secondary" type="button" data-action="back-directory">العودة إلى الدليل</button></div><section class="panel loading-state"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></section>`;
      return;
    }
    if (!state.patient) {
      content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">دليل المرضى</span><h1>ملف المريض</h1></div><button class="btn btn-secondary" type="button" data-action="back-directory">العودة إلى الدليل</button></div><section class="error-state" role="alert"><div class="empty-mark" aria-hidden="true">!</div><h2>تعذّر فتح الملف</h2><p>${escapeHtml(safeMessage(state.detailError))}</p><div class="heading-actions" style="justify-content:center"><button class="btn btn-secondary" type="button" data-action="retry-profile">إعادة المحاولة</button><button class="btn btn-quiet" type="button" data-action="back-directory">العودة إلى الدليل</button></div></section>`;
      return;
    }
    const p = state.patient;
    const active = p.status === 'ACTIVE';
    const fields = [
      ['رقم المريض', p.patientNumber, true], ['الاسم الأول', p.firstName], ['الاسم الأوسط', p.middleName],
      ['اسم العائلة', p.lastName], ['الاسم المفضل', p.preferredName], ['تاريخ الميلاد', p.dateOfBirth, true],
      ['النوع', p.gender], ['الهاتف', p.phone, true], ['البريد الإلكتروني', p.email, true],
      ['رقم الهوية', p.nationalId, true], ['العنوان', p.address], ['تاريخ إنشاء السجل', formatDate(p.createdAt), true],
    ];
    content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">دليل المرضى / الملف</span><h1>بيانات المريض</h1><p>تُعرض التفاصيل بعد التحقق من صلاحية قراءة المرضى.</p></div><button class="btn btn-secondary" type="button" data-action="back-directory">العودة إلى الدليل</button></div><section class="panel"><div class="profile-hero"><div class="profile-identity"><div class="avatar-mark" aria-hidden="true">${escapeHtml((patientName(p).trim()[0] || 'م'))}</div><div><span class="eyebrow">ملف المريض</span><h1>${escapeHtml(patientName(p))}</h1><div class="profile-meta"><bdi dir="ltr">${escapeHtml(p.patientNumber || '—')}</bdi><span class="status-pill ${active ? '' : 'inactive'}">${escapeHtml(statusLabel(p.status))}</span></div></div></div><div class="detail-actions"><button class="btn btn-secondary" type="button" data-action="back-directory">العودة إلى الدليل</button>${hasManage() ? `<button class="btn btn-primary" type="button" data-action="edit-patient">تعديل البيانات</button><button class="btn ${active ? 'btn-danger' : 'btn-secondary'}" type="button" data-action="${active ? 'deactivate-patient' : 'activate-patient'}" ${state.pendingAction ? 'disabled' : ''}>${state.pendingAction ? 'جارٍ التحديث…' : active ? 'إيقاف التفعيل' : 'إعادة التفعيل'}</button>` : ''}</div></div><div class="profile-body"><div class="detail-grid">${fields.map(([label,value,mono]) => `<div class="detail-item"><small>${escapeHtml(label)}</small><strong class="${mono ? 'mono' : ''}">${value == null || value === '' ? '—' : escapeHtml(value)}</strong></div>`).join('')}</div><p class="form-note" style="margin:16px 0 0">آخر تحديث: <bdi dir="ltr">${escapeHtml(formatDate(p.updatedAt))}</bdi></p>${!hasManage() ? '<p class="form-note">لديك صلاحية قراءة الملف فقط. إجراءات التعديل وإدارة الحالة غير متاحة.</p>' : ''}</div></section>`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function renderForm() {
    const content = document.getElementById('page-content');
    if (!hasManage()) { state.view = 'directory'; render(); return; }
    const p = state.formDraft || state.patient || {};
    const editing = !!state.profileId;
    content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">دليل المرضى</span><h1>${editing ? 'تعديل بيانات المريض' : 'تسجيل مريض'}</h1><p>${editing ? 'حدّث بيانات الملف. تُراجع المدخلات من الخدمة قبل الحفظ.' : 'أدخل البيانات الأساسية المطلوبة لفتح سجل جديد.'}</p></div><button class="btn btn-secondary" type="button" data-action="${editing ? 'cancel-edit' : 'back-directory'}">${editing ? 'العودة إلى الملف' : 'العودة إلى الدليل'}</button></div><section class="panel form-panel"><div class="form-heading"><h1>${editing ? escapeHtml(patientName(p)) : 'بيانات التسجيل'}</h1><p>الحقول ذات العلامة (*) مطلوبة. لا تُطبق هذه الصفحة قواعد إضافية على البيانات.</p></div>${state.formError ? `<div class="inline-message" role="alert">${escapeHtml(safeMessage(state.formError))}${state.formError && state.formError.rule ? ` (${escapeHtml(state.formError.rule)})` : ''}</div>` : ''}<form data-form="patient" autocomplete="off"><div class="form-grid">${inputField('patientNumber','رقم المريض',p.patientNumber,'text',!editing,true)}${inputField('firstName','الاسم الأول',p.firstName,'text',true)}${inputField('middleName','الاسم الأوسط',p.middleName)}${inputField('lastName','اسم العائلة',p.lastName,'text',true)}${inputField('preferredName','الاسم المفضل',p.preferredName)}${inputField('dateOfBirth','تاريخ الميلاد',p.dateOfBirth,'date')}${inputField('gender','النوع',p.gender)}${inputField('phone','الهاتف',p.phone,'tel')}${inputField('email','البريد الإلكتروني',p.email,'email')}${inputField('nationalId','رقم الهوية',p.nationalId,'text',false,true)}<div class="field span-all"><label for="address">العنوان</label><textarea class="control" id="address" name="address" rows="3">${escapeHtml(p.address || '')}</textarea></div></div><div class="form-footer"><span class="form-note">تُحفظ البيانات بعد استجابة الخدمة بنجاح.</span><div class="heading-actions"><button class="btn btn-secondary" type="button" data-action="${editing ? 'cancel-edit' : 'back-directory'}">إلغاء</button><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديلات' : 'تسجيل المريض'}</button></div></div></form></section>`;
  }

  function inputField(name, label, value, type, required, mono) {
    const id = `patient-${name}`;
    return `<div class="field"><label for="${id}">${escapeHtml(label)}${required ? ' *' : ''}</label><input class="control ${mono ? 'mono' : ''}" id="${id}" name="${name}" type="${type || 'text'}" value="${escapeHtml(value || '')}" ${required ? 'required' : ''} ${name === 'patientNumber' ? 'maxlength="100"' : ''}></div>`;
  }

  function renderFormAfterGet(patient) {
    state.patient = patient; state.view = 'form'; state.formError = null; render();
  }

  function onChange(event) {
    if (event.target.matches('#patient-status')) {
      state.status = event.target.value; state.offset = 0; void loadPatients();
    }
  }

  async function onSubmit(event) {
    const form = event.target;
    const formType = form && form.dataset && form.dataset.form;
    if (!formType) return;
    event.preventDefault();
    const data = new FormData(form);
    if (formType === 'signin') {
      state.email = String(data.get('email') || '').trim();
      state.saving = true; state.screenMessage = ''; render();
      try {
        await api.login(state.email, String(data.get('password') || ''));
        state.saving = false; state.screenMessage = ''; await loadWorkspaces();
      } catch (error) {
        state.saving = false; state.screenMessage = safeMessage(error); render();
      }
      return;
    }
    if (formType === 'filters') {
      state.search = String(data.get('search') || '').slice(0, 100).trim();
      state.status = String(data.get('status') || '');
      state.offset = 0; await loadPatients(); return;
    }
    if (formType === 'patient') {
      if (!hasManage() || !state.workspace) return;
      const payload = {};
      ['patientNumber','firstName','middleName','lastName','preferredName','dateOfBirth','gender','phone','email','nationalId','address'].forEach((key) => {
        const raw = data.get(key);
        if (raw !== null) payload[key] = String(raw).trim() || null;
      });
      state.formDraft = payload;
      state.saving = true; state.formError = null; render();
      try {
        if (state.profileId) {
          await api.updatePatient(state.workspace.tenantId, state.profileId, payload);
          toast('تم حفظ تعديلات الملف.', false);
          state.saving = false; state.formDraft = null;
          await openPatient(state.profileId);
        } else {
          const created = await api.createPatient(state.workspace.tenantId, payload);
          toast('تم تسجيل المريض.', false);
          state.saving = false; state.formDraft = null;
          state.offset = 0; state.view = 'directory'; state.profileId = null; state.patient = null;
          await loadPatients();
          if (created && created.id) await openPatient(created.id);
        }
      } catch (error) {
        if (error && error.status === 401) { expireSession(); return; }
        state.saving = false; state.formError = error; render();
      }
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'choose-workspace') { await chooseWorkspace(state.workspaces[Number(button.dataset.index)]); return; }
    if (action === 'logout') { await logout(); return; }
    if (action === 'switch-workspace') {
      clearPatientState(); state.workspace = null;
      if (state.workspaces.length > 1) { state.screen = 'workspace-select'; render(); }
      else await loadWorkspaces();
      return;
    }
    if (action === 'retry-boot') { await bootstrap(); return; }
    if (action === 'retry-workspaces') { await loadWorkspaces(); return; }
    if (action === 'new-patient') {
      if (!hasManage()) return;
      state.profileId = null; state.patient = null; state.formDraft = null; state.formError = null; state.view = 'form'; render(); return;
    }
    if (action === 'open-patient') { await openPatient(button.dataset.id); return; }
    if (action === 'back-directory') { state.view = 'directory'; state.patient = null; state.profileId = null; state.formError = null; state.formDraft = null; render(); return; }
    if (action === 'retry-list') { await loadPatients(); return; }
    if (action === 'reset-filters') { state.search = ''; state.status = ''; state.offset = 0; render(); await loadPatients(); return; }
    if (action === 'previous-page') { state.offset = Math.max(0, state.offset - PAGE_SIZE); await loadPatients(); return; }
    if (action === 'next-page') { if (state.hasNext && state.offset < 100000) { state.offset = Math.min(100000, state.offset + PAGE_SIZE); await loadPatients(); } return; }
    if (action === 'retry-profile') { await openPatient(state.profileId); return; }
    if (action === 'edit-patient') {
      if (!hasManage() || !state.profileId) return;
      state.view = 'form'; state.formDraft = null; state.formError = null; render(); return;
    }
    if (action === 'cancel-edit') { state.view = 'profile'; state.formError = null; state.formDraft = null; render(); return; }
    if (action === 'activate-patient' || action === 'deactivate-patient') {
      if (!hasManage() || !state.profileId || state.pendingAction) return;
      const activate = action === 'activate-patient';
      const ok = window.confirm(activate ? 'هل تريد إعادة تفعيل سجل المريض؟' : 'هل تريد إيقاف تفعيل سجل المريض؟');
      if (!ok) return;
      state.pendingAction = true; render();
      try {
        if (activate) await api.activatePatient(state.workspace.tenantId, state.profileId);
        else await api.deactivatePatient(state.workspace.tenantId, state.profileId);
        toast(activate ? 'تمت إعادة تفعيل الملف.' : 'تم إيقاف تفعيل الملف.', false);
        state.pendingAction = false; await openPatient(state.profileId); await loadPatients();
      } catch (error) {
        if (error && error.status === 401) { expireSession(); return; }
        state.pendingAction = false; state.detailError = error; toast(safeMessage(error), true); render();
      }
    }
  }

  async function logout() {
    try { await api.logout(); } catch (_) { /* Session is cleared by the API client. */ }
    clearPatientState(); state.workspace = null; state.workspaces = []; state.screen = 'signin'; state.screenMessage = ''; render();
  }

  function toast(message, isError) {
    const node = document.createElement('div');
    node.className = `toast${isError ? ' error' : ''}`;
    node.setAttribute('role', isError ? 'alert' : 'status');
    node.textContent = message;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }
})();
