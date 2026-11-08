(function startDoctorSetup() {
  'use strict';
  const api = window.ThanarahApi;
  const app = document.getElementById('app');
  const P = {
    read: 'tenant.doctors.read',
    manage: 'tenant.doctors.manage',
    staffRead: 'tenant.staff.read',
    staffScope: 'tenant.staff.scope.manage',
    departmentsRead: 'tenant.departments.read',
    specialtiesRead: 'tenant.specialties.read',
    servicesRead: 'tenant.services.read',
    servicesManage: 'tenant.services.manage',
    facilitiesRead: 'tenant.facilities.read',
    branchesRead: 'tenant.branches.read',
  };
  const state = {
    screen: 'boot',
    workspaces: [],
    workspace: null,
    doctors: [],
    staff: [],
    departments: [],
    specialties: [],
    services: [],
    facilities: [],
    branches: [],
    serviceAssignments: [],
    selectedFacilityId: '',
    assignmentLoading: false,
    assignmentRequest: 0,
    branchLoading: false,
    assignmentSaving: false,
    assignmentError: '',
    status: '',
    search: '',
    selectedId: '',
    editId: '',
    loading: false,
    saving: false,
    error: '',
    success: '',
  };
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/gu,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const allowed = (p) => state.workspace?.permissionCodes?.includes(p) === true;
  const selected = () => state.doctors.find((item) => item.id === state.selectedId);
  const statusLabel = (s) =>
    ({ ACTIVE: 'نشط', SUSPENDED: 'موقوف مؤقتًا', DEACTIVATED: 'غير نشط' })[s] || 'غير محدد';

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  void bootstrap();

  async function bootstrap() {
    try {
      if (!api || !(await api.restoreSession())) return signIn();
      const result = await api.listWorkspaces();
      state.workspaces = result.items || [];
      if (state.workspaces.length === 1) return chooseWorkspace(state.workspaces[0]);
      state.screen = state.workspaces.length ? 'select' : 'error';
      state.error = state.workspaces.length ? '' : 'لا توجد مساحة عمل مرتبطة بحسابك.';
      render();
    } catch (error) {
      state.screen = 'error';
      state.error = message(error);
      render();
    }
  }
  async function chooseWorkspace(workspace) {
    state.workspace = workspace;
    state.screen = 'workspace';
    render();
    await loadData();
  }
  function signIn(error = '') {
    state.screen = 'signin';
    state.error = error;
    app.innerHTML = `<section class="workspace-screen"><form class="workspace-card" data-form="login"><div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · DOCTORS</span></div></div><span class="eyebrow">إدارة مساحة العمل</span><h1>تسجيل الدخول</h1><label class="field"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}<button class="btn btn-primary" type="submit">دخول</button></form></section>`;
  }
  function message(error) {
    return error?.message || 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  }

  async function loadData() {
    if (!allowed(P.read)) {
      state.error = 'لا تملك صلاحية قراءة ملفات الأطباء.';
      render();
      return;
    }
    state.loading = true;
    state.error = '';
    render();
    const tenantId = state.workspace.tenantId;
    const jobs = [
      api
        .listSetupDoctors(tenantId, { status: state.status || undefined, limit: 100, offset: 0 })
        .then((r) => {
          state.doctors = r.items || [];
        }),
    ];
    if (allowed(P.staffRead))
      jobs.push(
        api.listTenantStaff(tenantId, { status: 'ACTIVE', limit: 100, offset: 0 }).then((r) => {
          state.staff = r.items || [];
        }),
      );
    if (allowed(P.departmentsRead))
      jobs.push(
        api.listDepartments(tenantId, { status: 'ACTIVE', limit: 100, offset: 0 }).then((r) => {
          state.departments = r.items || [];
        }),
      );
    if (allowed(P.specialtiesRead))
      jobs.push(
        api.listSpecialties(tenantId, { status: 'ACTIVE', limit: 100, offset: 0 }).then((r) => {
          state.specialties = r.items || [];
        }),
      );
    if (allowed(P.servicesRead))
      jobs.push(
        api.listSetupServices(tenantId, { status: 'ACTIVE', limit: 100, offset: 0 }).then((r) => {
          state.services = r.items || [];
        }),
      );
    if (allowed(P.facilitiesRead))
      jobs.push(
        api.listFacilities(tenantId, { status: 'ACTIVE', limit: 100, offset: 0 }).then((r) => {
          state.facilities = r.items || [];
        }),
      );
    try {
      await Promise.all(jobs);
      if (!state.doctors.some((item) => item.id === state.selectedId))
        state.selectedId = state.doctors[0]?.id || '';
      if (!state.facilities.some((item) => item.id === state.selectedFacilityId))
        state.selectedFacilityId = state.facilities[0]?.id || '';
    } catch (error) {
      if (error.status === 401) {
        state.screen = 'signin';
        return signIn();
      }
      state.error = message(error);
    } finally {
      state.loading = false;
      if (state.screen !== 'signin') {
        render();
        if (state.selectedId) void loadDoctorServices();
        if (state.selectedFacilityId) void loadBranches(state.selectedFacilityId);
      }
    }
  }

  async function loadDoctorServices() {
    if (
      !state.selectedId ||
      !allowed(P.read) ||
      !allowed(P.servicesRead) ||
      !allowed(P.facilitiesRead) ||
      !allowed(P.branchesRead)
    ) {
      state.serviceAssignments = [];
      return;
    }
    const doctorId = state.selectedId;
    const requestId = ++state.assignmentRequest;
    state.serviceAssignments = [];
    state.assignmentLoading = true;
    state.assignmentError = '';
    render();
    try {
      const result = await api.listDoctorServices(state.workspace.tenantId, doctorId);
      if (requestId === state.assignmentRequest && doctorId === state.selectedId)
        state.serviceAssignments = result?.items || [];
    } catch (error) {
      if (requestId !== state.assignmentRequest) return;
      if (error.status === 401) {
        state.screen = 'signin';
        return signIn();
      }
      state.assignmentError = message(error);
    } finally {
      if (requestId === state.assignmentRequest) {
        state.assignmentLoading = false;
        if (state.screen !== 'signin') render();
      }
    }
  }

  async function loadBranches(facilityId) {
    state.selectedFacilityId = facilityId;
    state.branches = [];
    if (!facilityId || !allowed(P.facilitiesRead) || !allowed(P.branchesRead)) {
      render();
      return;
    }
    state.branchLoading = true;
    render();
    try {
      const result = await api.listBranches(state.workspace.tenantId, facilityId, {
        status: 'ACTIVE',
        limit: 100,
        offset: 0,
      });
      if (state.selectedFacilityId === facilityId) state.branches = result.items || [];
    } catch (error) {
      state.assignmentError = message(error);
    } finally {
      state.branchLoading = false;
      render();
    }
  }

  function render() {
    if (state.screen === 'signin') return;
    if (state.screen === 'select') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><h1>اختر مساحة العمل</h1><div class="workspace-list">${state.workspaces.map((w, i) => `<button class="workspace-option" data-action="choose" data-index="${i}" type="button">${esc(w.displayName || w.slug)}</button>`).join('')}</div></div></section>`;
      return;
    }
    if (state.screen === 'error') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><h1>تعذّر فتح الصفحة</h1><p>${esc(state.error)}</p><button class="btn btn-secondary" data-action="retry" type="button">إعادة المحاولة</button></div></section>`;
      return;
    }
    const canManage = allowed(P.manage);
    const filtered = state.doctors.filter((d) =>
      `${d.professionalDisplayName || ''} ${d.staff?.displayName || ''} ${d.professionalCode || ''} ${d.professionalTitle || ''}`
        .toLocaleLowerCase('ar')
        .includes(state.search.toLocaleLowerCase('ar')),
    );
    app.innerHTML = `<div class="app-frame"><aside class="sidebar"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">إدارة مساحة العمل</div><nav class="side-nav"><a class="nav-item" href="/appointments/">المواعيد</a><a class="nav-item" href="/patients/">المرضى</a><a class="nav-item" href="/clinic-setup/">المنشآت والفروع</a><a class="nav-item" href="/team-setup/">الأعضاء والفريق</a><a class="nav-item" href="/catalog-setup/">التخصصات والخدمات</a><div class="nav-item active">الأطباء</div></nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>مساحة نشطة<span class="workspace-name">${esc(state.workspace.displayName || '')}</span></div><div class="side-actions"><button data-action="switch" type="button">تبديل المساحة</button><button data-action="logout" type="button">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs"><span>إدارة مساحة العمل</span><span> / </span><strong>الأطباء</strong></div><span class="user-chip">${esc(state.workspace.displayName || '')}</span></header><div class="page-content"><div class="page-heading"><div><span class="eyebrow">إدارة الأطباء</span><h1>ملفات الأطباء</h1><p>إدارة البيانات المهنية وربطها بكتالوج المساحة.</p></div></div>${state.error ? `<div class="doctor-notice" role="alert">${esc(state.error)}</div>` : ''}${state.success ? `<div class="doctor-success" role="status">${esc(state.success)}</div>` : ''}<div class="doctor-layout">${
      canManage
        ? `<section class="doctor-panel"><div class="doctor-panel-head"><h2>${state.editId ? 'تعديل الملف المهني' : 'إضافة طبيب'}</h2><p>يرتبط ملف الطبيب بعضو فريق نشط في مساحة العمل.</p></div>${
            !state.editId && !allowed(P.staffRead)
              ? '<div class="doctor-detail"><p class="doctor-notice">تحتاج إلى صلاحية قراءة الفريق لإضافة طبيب من ملف عضو نشط.</p></div>'
              : `<form class="doctor-form" data-form="doctor">${
                  !state.editId
                    ? `<label class="field"><span>عضو الفريق *</span><select name="staffId" required><option value="">اختر عضوًا نشطًا</option>${state.staff
                        .filter((s) => !state.doctors.some((d) => d.staffId === s.id))
                        .map(
                          (s) =>
                            `<option value="${esc(s.id)}">${esc(s.displayName)}${s.jobTitle ? ' · ' + esc(s.jobTitle) : ''}</option>`,
                        )
                        .join('')}</select></label>`
                    : ''
                }<label class="field"><span>الاسم المهني</span><input name="professionalDisplayName" maxlength="191" value="${esc(state.doctors.find((d) => d.id === state.editId)?.professionalDisplayName || '')}"></label><div class="doctor-grid"><label class="field"><span>المسمى المهني</span><input name="professionalTitle" maxlength="191" value="${esc(state.doctors.find((d) => d.id === state.editId)?.professionalTitle || '')}"></label><label class="field"><span>الرمز المهني</span><input name="professionalCode" maxlength="64" dir="ltr" value="${esc(state.doctors.find((d) => d.id === state.editId)?.professionalCode || '')}"></label></div><label class="field"><span>نبذة مهنية نصية</span><textarea name="bio" maxlength="2000">${esc(state.doctors.find((d) => d.id === state.editId)?.bio || '')}</textarea></label>${!state.editId ? `<label class="field"><span>القسم (اختياري)</span><select name="departmentIds" multiple>${state.departments.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span>التخصص (اختياري)</span><select name="specialtyIds" multiple>${state.specialties.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>` : ''}<div class="form-footer"><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>${state.editId ? '<button class="btn btn-quiet" type="button" data-action="cancel-edit">إلغاء</button>' : ''}</div></form>`
          }</section>`
        : ''
    }<section class="doctor-panel"><div class="doctor-panel-head"><h2>قائمة الأطباء</h2><p>${filtered.length.toLocaleString('ar')} طبيب</p></div><div class="doctor-toolbar"><input aria-label="ابحث عن طبيب" data-search value="${esc(state.search)}" placeholder="ابحث بالاسم أو الرمز"><select aria-label="تصفية حسب الحالة" data-status><option value="">كل الحالات</option><option value="ACTIVE" ${state.status === 'ACTIVE' ? 'selected' : ''}>نشط</option><option value="SUSPENDED" ${state.status === 'SUSPENDED' ? 'selected' : ''}>موقوف مؤقتًا</option><option value="DEACTIVATED" ${state.status === 'DEACTIVATED' ? 'selected' : ''}>غير نشط</option></select></div>${state.loading ? '<div class="catalog-empty">جارٍ تحميل الأطباء…</div>' : filtered.length ? `<div class="doctor-list">${filtered.map((d) => `<article class="doctor-row ${d.id === state.selectedId ? 'selected' : ''}"><div class="doctor-row-main"><button type="button" data-action="select" data-id="${esc(d.id)}"><h3>${esc(d.professionalDisplayName || d.staff?.displayName || 'طبيب')}</h3><p>${esc([d.professionalTitle, d.professionalCode].filter(Boolean).join(' · '))}</p></button><span class="setup-status ${d.status === 'SUSPENDED' ? 'suspended' : d.status === 'DEACTIVATED' ? 'deactivated' : ''}">${statusLabel(d.status)}</span></div></article>`).join('')}</div>` : `<div class="catalog-empty"><h3>لا توجد نتائج</h3><p>${state.search ? 'جرّب عبارة بحث أخرى.' : 'أضف طبيبًا إلى مساحة العمل.'}</p></div>`}</section></div>${renderDetail(canManage)}<p class="doctor-note">تُدار صلاحيات المرافق والفروع على ملف عضو الفريق من <a href="/team-setup/">إدارة الفريق</a>.</p></div></section></div>`;
  }

  function renderDetail(canManage) {
    const d = selected();
    if (!d) return '';
    const assignments = (kind, items) =>
      `<section class="doctor-assignment"><h3>${kind === 'department' ? 'الأقسام' : 'التخصصات'}</h3><div class="doctor-assignment-list">${(items || []).length ? items.map((item) => `<span class="doctor-chip">${esc(item.name)}${canManage ? `<button type="button" aria-label="إزالة ${esc(item.name)}" data-action="unassign" data-kind="${kind}" data-id="${esc(item.id)}">×</button>` : ''}</span>`).join('') : '<span class="catalog-empty">لا توجد روابط</span>'}</div>${
        canManage
          ? `<form class="doctor-assignment-form" data-form="assignment" data-kind="${kind}"><select name="targetId" required><option value="">اختر ${kind === 'department' ? 'قسمًا' : 'تخصصًا'}</option>${(kind ===
            'department'
              ? state.departments
              : state.specialties
            )
              .filter((x) => !items.some((i) => i.id === x.id))
              .map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`)
              .join(
                '',
              )}</select><button class="btn btn-secondary" type="submit">ربط</button></form>`
          : ''
      }</section>`;
    return `<section class="doctor-panel"><div class="doctor-panel-head"><h2>تفاصيل الطبيب</h2><p>${esc(d.staff?.displayName || '')} · ${statusLabel(d.status)}</p></div><div class="doctor-detail"><div class="doctor-meta"><div><small>الاسم المهني</small><strong>${esc(d.professionalDisplayName || d.staff?.displayName || '—')}</strong></div><div><small>المسمى والرمز</small><strong>${esc([d.professionalTitle, d.professionalCode].filter(Boolean).join(' · ') || '—')}</strong></div></div>${d.bio ? `<p>${esc(d.bio)}</p>` : ''}<div class="doctor-actions">${canManage && d.status !== 'DEACTIVATED' ? `<button class="btn btn-secondary" type="button" data-action="edit" data-id="${esc(d.id)}">تعديل</button><button class="btn btn-quiet" type="button" data-action="status" data-status="${d.status === 'ACTIVE' ? 'suspend' : 'activate'}" data-id="${esc(d.id)}">${d.status === 'ACTIVE' ? 'إيقاف مؤقت' : 'تفعيل'}</button><button class="btn btn-quiet" type="button" data-action="status" data-status="deactivate" data-id="${esc(d.id)}">تعطيل نهائي</button>` : ''}</div>${assignments('department', d.departments)}${assignments('specialty', d.specialties)}${renderServiceAssignments(d, canManage)}</div></section>`;
  }

  function renderServiceAssignments(doctor, canManage) {
    const canReadAssignments =
      allowed(P.read) &&
      allowed(P.servicesRead) &&
      allowed(P.facilitiesRead) &&
      allowed(P.branchesRead);
    const canManageAssignments =
      canManage &&
      allowed(P.servicesManage) &&
      allowed(P.servicesRead) &&
      allowed(P.facilitiesRead) &&
      allowed(P.branchesRead);
    const services = state.services.filter((item) => item.status === 'ACTIVE');
    const assignments = state.serviceAssignments;
    const timestamp = (value) => {
      if (!value) return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? esc(value) : esc(date.toLocaleString('ar'));
    };
    return `<section class="doctor-assignment service-assignment"><div class="service-heading"><div><h3>ارتباطات الخدمات</h3><p>تعيين مستقل حسب المنشأة، مع فرع اختياري.</p></div><span class="service-count">${assignments.length.toLocaleString('ar')} ارتباط</span></div>${
      !canReadAssignments
        ? '<div class="doctor-notice">تحتاج إلى صلاحيات قراءة الأطباء والخدمات والمنشآت والفروع لعرض ارتباطاتها.</div>'
        : !canManageAssignments && canReadAssignments
          ? '<div class="doctor-notice">تحتاج إلى صلاحيات إدارة الأطباء والخدمات لتعديل الارتباطات.</div>'
          : ''
    }${state.assignmentError ? `<div class="doctor-notice" role="alert">${esc(state.assignmentError)} <button type="button" class="inline-retry" data-action="retry-services">إعادة المحاولة</button></div>` : ''}${
      state.assignmentLoading
        ? '<div class="catalog-empty service-state">جارٍ تحميل ارتباطات الخدمات…</div>'
        : assignments.length
          ? `<div class="service-assignment-list">${assignments.map((item) => `<article class="service-assignment-row"><div class="service-assignment-copy"><strong>${esc(item.serviceName || 'خدمة')}</strong><span>${esc(item.facilityName || 'منشأة غير محددة')}${item.branchName ? ` · ${esc(item.branchName)}` : ' · جميع فروع المنشأة'}</span><small>أُضيف في ${timestamp(item.assignedAt)}</small></div><span class="setup-status ${item.serviceStatus === 'ACTIVE' ? '' : 'deactivated'}">${statusLabel(item.serviceStatus)}</span>${canManageAssignments ? `<button class="btn btn-quiet service-remove" type="button" data-action="remove-service" data-service-id="${esc(item.serviceId)}" data-facility-id="${esc(item.facilityId)}" data-branch-id="${esc(item.branchId || '')}" aria-label="إزالة ${esc(item.serviceName)} من ${esc(item.facilityName)}${item.branchName ? `، ${esc(item.branchName)}` : ''}">إزالة</button>` : ''}</article>`).join('')}</div>`
          : '<div class="catalog-empty service-state"><h3>لا توجد ارتباطات بعد</h3><p>أضف خدمة لهذا الطبيب ضمن منشأة محددة.</p></div>'
    }${canManageAssignments ? `<form class="doctor-assignment-form service-assignment-form" data-form="service-assignment"><label class="field"><span>الخدمة</span><select name="serviceId" required ${services.length ? '' : 'disabled'}><option value="">اختر خدمة نشطة</option>${services.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><label class="field"><span>المنشأة</span><select name="facilityId" data-facility required ${state.facilities.length ? '' : 'disabled'}><option value="">اختر المنشأة</option>${state.facilities.map((item) => `<option value="${esc(item.id)}" ${item.id === state.selectedFacilityId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><label class="field"><span>الفرع (اختياري)</span><select name="branchId" ${!state.selectedFacilityId || state.branchLoading ? 'disabled' : ''}><option value="">كل فروع المنشأة</option>${state.branches.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><button class="btn btn-primary service-submit" type="submit" ${state.assignmentSaving || !services.length || !state.facilities.length ? 'disabled' : ''}>${state.assignmentSaving ? 'جارٍ الربط…' : 'إضافة ارتباط'}</button></form>${!services.length ? '<p class="service-hint">لا توجد خدمات نشطة متاحة في الكتالوج.</p>' : ''}${!state.facilities.length ? '<p class="service-hint">لا توجد منشآت نشطة متاحة.</p>' : ''}${state.branchLoading ? '<p class="service-hint">جارٍ تحميل فروع المنشأة…</p>' : ''}` : ''}</section>`;
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.dataset.form === 'login') {
      try {
        const data = new FormData(form);
        await api.login(String(data.get('email')), String(data.get('password')));
        await bootstrap();
      } catch (error) {
        signIn(message(error));
      }
      return;
    }
    if (form.dataset.form === 'doctor') {
      if (!allowed(P.manage)) return;
      const data = new FormData(form);
      const input = {};
      for (const key of [
        'professionalDisplayName',
        'professionalTitle',
        'professionalCode',
        'bio',
      ]) {
        const value = String(data.get(key) || '').trim();
        input[key] = state.editId ? value || null : value || undefined;
      }
      if (!state.editId) {
        input.staffId = String(data.get('staffId') || '');
        input.departmentIds = data.getAll('departmentIds').map(String);
        input.specialtyIds = data.getAll('specialtyIds').map(String);
      }
      state.saving = true;
      state.error = '';
      render();
      try {
        if (state.editId) await api.updateDoctor(state.workspace.tenantId, state.editId, input);
        else await api.createDoctor(state.workspace.tenantId, input);
        state.success = state.editId ? 'تم تحديث بيانات الطبيب.' : 'تم إنشاء ملف الطبيب.';
        state.editId = '';
        state.saving = false;
        await loadData();
      } catch (error) {
        state.saving = false;
        state.error = message(error);
        render();
      }
    }
    if (form.dataset.form === 'assignment') {
      if (!allowed(P.manage)) return;
      const target = String(new FormData(form).get('targetId') || '');
      const method =
        form.dataset.kind === 'department' ? 'assignDoctorDepartment' : 'assignDoctorSpecialty';
      try {
        await api[method](state.workspace.tenantId, state.selectedId, target);
        state.success = 'تم تحديث ارتباط الطبيب.';
        await loadData();
      } catch (error) {
        state.error = message(error);
        render();
      }
    }
    if (form.dataset.form === 'service-assignment') {
      if (
        !allowed(P.manage) ||
        !allowed(P.servicesManage) ||
        !allowed(P.servicesRead) ||
        !allowed(P.facilitiesRead) ||
        !allowed(P.branchesRead)
      ) return;
      const data = new FormData(form);
      const serviceId = String(data.get('serviceId') || '');
      const facilityId = String(data.get('facilityId') || '');
      const branchId = String(data.get('branchId') || '');
      if (!serviceId || !facilityId || !state.services.some((item) => item.id === serviceId && item.status === 'ACTIVE')) {
        state.assignmentError = 'اختر خدمة نشطة ومنشأة صالحة.';
        render();
        return;
      }
      state.assignmentSaving = true;
      state.assignmentError = '';
      render();
      try {
        await api.assignDoctorService(state.workspace.tenantId, state.selectedId, {
          serviceId,
          facilityId,
          ...(branchId ? { branchId } : {}),
        });
        state.success = 'تم ربط الخدمة بالطبيب ضمن النطاق المحدد.';
        state.assignmentSaving = false;
        await loadDoctorServices();
      } catch (error) {
        state.assignmentSaving = false;
        state.assignmentError = message(error);
        render();
      }
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'choose')
      return chooseWorkspace(state.workspaces[Number(button.dataset.index)]);
    if (button.dataset.action === 'retry') return state.workspace ? loadData() : bootstrap();
    if (button.dataset.action === 'switch') {
      state.workspace = null;
      state.screen = 'select';
      return render();
    }
    if (button.dataset.action === 'logout') {
      await api.logout();
      return signIn();
    }
    if (button.dataset.action === 'select') {
      state.selectedId = button.dataset.id;
      state.serviceAssignments = [];
      state.editId = '';
      render();
      return loadDoctorServices();
    }
    if (button.dataset.action === 'retry-services') return loadDoctorServices();
    if (button.dataset.action === 'edit') {
      state.editId = button.dataset.id;
      return render();
    }
    if (button.dataset.action === 'cancel-edit') {
      state.editId = '';
      state.error = '';
      return render();
    }
    if (button.dataset.action === 'status') {
      const doctor = state.doctors.find((item) => item.id === button.dataset.id);
      if (!doctor || !allowed(P.manage)) return;
      if (
        button.dataset.status === 'deactivate' &&
        !window.confirm('سيتم تعطيل ملف الطبيب نهائيًا. هل تريد المتابعة؟')
      )
        return;
      try {
        await api.changeDoctorStatus(state.workspace.tenantId, doctor.id, button.dataset.status);
        state.success = 'تم تحديث حالة الطبيب.';
        await loadData();
      } catch (error) {
        state.error = message(error);
        render();
      }
    }
    if (button.dataset.action === 'unassign') {
      if (!allowed(P.manage)) return;
      const method =
        button.dataset.kind === 'department'
          ? 'unassignDoctorDepartment'
          : 'unassignDoctorSpecialty';
      try {
        await api[method](state.workspace.tenantId, state.selectedId, button.dataset.id);
        state.success = 'تم تحديث ارتباط الطبيب.';
        await loadData();
      } catch (error) {
        state.error = message(error);
        render();
      }
    }
    if (button.dataset.action === 'remove-service') {
      if (
        !allowed(P.manage) ||
        !allowed(P.servicesManage) ||
        !allowed(P.servicesRead) ||
        !allowed(P.facilitiesRead) ||
        !allowed(P.branchesRead)
      ) return;
      const { serviceId, facilityId, branchId } = button.dataset;
      if (!serviceId || !facilityId) return;
      const assignment = state.serviceAssignments.find(
        (item) =>
          item.serviceId === serviceId &&
          item.facilityId === facilityId &&
          String(item.branchId || '') === String(branchId || ''),
      );
      const scope = assignment
        ? `${assignment.facilityName || 'المنشأة'}${assignment.branchName ? ` · ${assignment.branchName}` : ' · جميع الفروع'}`
        : 'النطاق المحدد';
      if (!window.confirm(`سيُزال ارتباط الخدمة من ${scope} فقط. هل تريد المتابعة؟`)) return;
      try {
        await api.unassignDoctorService(
          state.workspace.tenantId,
          state.selectedId,
          serviceId,
          facilityId,
          branchId || undefined,
        );
        state.success = 'تمت إزالة ارتباط الخدمة من النطاق المحدد.';
        await loadDoctorServices();
      } catch (error) {
        state.assignmentError = message(error);
        render();
      }
    }
  }
  function onChange(event) {
    if (event.target.matches('[data-status]')) {
      state.status = event.target.value;
      void loadData();
    }
    if (event.target.matches('[data-facility]')) {
      void loadBranches(event.target.value);
    }
  }
  function onInput(event) {
    if (event.target.matches('[data-search]')) {
      state.search = event.target.value;
      const start = event.target.selectionStart;
      render();
      const input = app.querySelector('[data-search]');
      input.focus();
      input.setSelectionRange(start, start);
    }
  }
})();
