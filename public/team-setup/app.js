(function startTeamSetup() {
  'use strict';
  const api = window.ThanarahApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void bootstrap();
  });
  const app = document.getElementById('app');
  const PAGE_SIZE = 50;
  const P = {
    memberRead: 'tenant.members.read',
    memberRoles: 'tenant.members.roles.manage',
    rolesRead: 'tenant.roles.read',
    staffRead: 'tenant.staff.read',
    staffManage: 'tenant.staff.manage',
    staffRolesRead: 'tenant.staff.roles.read',
    staffRolesManage: 'tenant.staff.roles.manage',
    scopeRead: 'tenant.staff.scope.read',
    scopeManage: 'tenant.staff.scope.manage',
    facilityRead: 'tenant.facilities.read',
    branchRead: 'tenant.branches.read',
  };
  const state = {
    screen: 'boot',
    workspaces: [],
    workspace: null,
    members: [],
    staff: [],
    roles: [],
    facilities: [],
    branches: [],
    status: '',
    offset: 0,
    hasNext: false,
    loading: false,
    error: '',
    selectedId: '',
    memberRoles: [],
    staffRoles: [],
    facilityScopes: [],
    branchScopes: [],
    detailError: '',
    saving: false,
    editStaff: false,
    workspaceEpoch: 0,
    directoryRequestId: 0,
    detailRequestId: 0,
  };
  const esc = (v) =>
    String(v == null ? '' : v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const allowed = (p) => state.workspace?.permissionCodes?.includes(p) === true;
  const member = () => state.members.find((m) => m.id === state.selectedId) || null;
  const staffer = () => state.staff.find((s) => s.membershipId === state.selectedId) || null;
  const statusText = (s) =>
    ({ ACTIVE: 'نشطة', INVITED: 'بانتظار التفعيل', SUSPENDED: 'موقوفة', REMOVED: 'أزيلت' })[s] || s;

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  void bootstrap();

  async function bootstrap() {
    try {
      if (!api || !(await api.restoreSession())) {
        state.screen = 'signin';
        return render();
      }
      const result = await api.listWorkspaces();
      state.workspaces = Array.isArray(result.items) ? result.items : [];
      if (state.workspaces.length === 1) return choose(state.workspaces[0]);
      state.screen = state.workspaces.length ? 'select' : 'none';
    } catch (e) {
      state.screen = 'error';
      state.error = msg(e);
    }
    render();
  }

  async function choose(w) {
    if (!w || !Array.isArray(w.permissionCodes)) {
      state.screen = 'none';
      return render();
    }
    const epoch = ++state.workspaceEpoch;
    state.directoryRequestId += 1;
    state.detailRequestId += 1;
    state.workspace = w;
    state.screen = 'workspace';
    state.members = [];
    state.staff = [];
    state.roles = [];
    state.facilities = [];
    state.branches = [];
    state.status = '';
    state.offset = 0;
    state.hasNext = false;
    state.selectedId = '';
    state.memberRoles = [];
    state.staffRoles = [];
    state.facilityScopes = [];
    state.branchScopes = [];
    state.detailError = '';
    state.error = '';
    state.editStaff = false;
    render();
    await loadDirectory(epoch);
  }

  function msg(e) {
    return e?.message || 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  }

  function attachDirectoryRetry() {
    if (!state.error || typeof app.querySelector !== 'function') return;
    const alert = app.querySelector('.team-alert');
    if (!alert || alert.querySelector('[data-action="retry-directory"]')) return;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'inline-retry';
    retry.dataset.action = 'retry-directory';
    retry.textContent = 'إعادة المحاولة';
    alert.appendChild(retry);
  }

  async function loadDirectory(expectedEpoch = state.workspaceEpoch) {
    const epoch = expectedEpoch;
    const workspace = state.workspace;
    if (!workspace || epoch !== state.workspaceEpoch) return;
    const requestId = ++state.directoryRequestId;
    state.loading = true;
    state.error = '';
    render();
    const tenantId = workspace.tenantId;
    const isCurrent = () =>
      epoch === state.workspaceEpoch &&
      requestId === state.directoryRequestId &&
      state.workspace === workspace;
    try {
      const jobs = [];
      if (allowed(P.memberRead))
        jobs.push(
          api
            .listTenantMemberships(tenantId, {
              status: state.status || undefined,
              limit: PAGE_SIZE,
              offset: state.offset,
            })
            .then((r) => {
              if (!isCurrent()) return;
              state.members = r.items || [];
              state.hasNext = state.members.length === PAGE_SIZE;
            }),
        );
      else state.members = [];
      if (allowed(P.staffRead))
        jobs.push(
          api.listTenantStaff(tenantId, { limit: 100, offset: 0 }).then((r) => {
            if (!isCurrent()) return;
            state.staff = r.items || [];
          }),
        );
      else state.staff = [];
      if (allowed(P.rolesRead))
        jobs.push(
          api.listTenantRoles(tenantId).then((r) => {
            if (!isCurrent()) return;
            state.roles = Array.isArray(r) ? r : r.items || [];
          }),
        );
      else state.roles = [];
      if (allowed(P.scopeManage) && allowed(P.facilityRead)) {
        jobs.push(
          api.listFacilities(tenantId, { limit: 100, offset: 0 }).then(async (r) => {
            if (!isCurrent()) return;
            state.facilities = r.items || [];
            const activeFacilities = state.facilities.filter((facility) => facility.status === 'ACTIVE');
            const all = allowed(P.branchRead)
              ? await Promise.all(
                  activeFacilities.map((f) =>
                    api.listBranches(tenantId, f.id, { limit: 100, offset: 0 }),
                  ),
                )
              : [];
            if (isCurrent()) state.branches = all.flatMap((b) => b.items || []);
          }),
        );
      }
      await Promise.all(jobs);
      if (!isCurrent()) return;
      if (!allowed(P.memberRead) && allowed(P.staffRead)) {
        state.members = state.staff.map((s) => ({
          id: s.membershipId,
          platformUserId: '',
          memberName: s.displayName,
          status: 'ACTIVE',
          accountStatus: 'ACTIVE',
        }));
      }
      if (!state.members.some((m) => m.id === state.selectedId))
        state.selectedId = state.members[0]?.id || '';
      state.screen = 'workspace';
    } catch (e) {
      if (!isCurrent()) return;
      if (e.status === 401) {
        state.screen = 'signin';
        state.workspace = null;
      } else state.error = msg(e);
    } finally {
      if (isCurrent()) {
        state.loading = false;
        render();
        attachDirectoryRetry();
      }
    }
    if (isCurrent() && state.selectedId) await loadDetails();
  }

  async function loadDetails() {
    const workspace = state.workspace;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.detailRequestId;
    const selectedId = state.selectedId;
    const m = state.members.find((item) => item.id === selectedId) || null;
    const s = state.staff.find((item) => item.membershipId === selectedId) || null;
    const isCurrent = () =>
      epoch === state.workspaceEpoch &&
      requestId === state.detailRequestId &&
      state.workspace === workspace &&
      state.selectedId === selectedId;
    if (!m) {
      render();
      return;
    }
    state.detailError = '';
    state.memberRoles = [];
    state.staffRoles = [];
    state.facilityScopes = [];
    state.branchScopes = [];
    const id = workspace.tenantId;
    const requests = [];
    if (allowed(P.memberRead))
      requests.push(
        api.listTenantMembershipRoles(id, m.id).then((r) => {
          if (!isCurrent()) return;
          state.memberRoles = (Array.isArray(r) ? r : r.items || []).map((item) => ({
            roleId: item.role?.id,
            roleCode: item.role?.code,
            roleName: item.role?.name,
          }));
        }),
      );
    if (s && allowed(P.staffRolesRead))
      requests.push(
        api.listStaffRoles(id, s.id).then((r) => {
          if (!isCurrent()) return;
          state.staffRoles = r.items || [];
        }),
      );
    if (s && allowed(P.scopeRead)) {
      requests.push(
        api.listStaffFacilityScope(id, s.id).then((r) => {
          if (!isCurrent()) return;
          state.facilityScopes = r.items || [];
        }),
      );
      requests.push(
        api.listStaffBranchScope(id, s.id).then((r) => {
          if (!isCurrent()) return;
          state.branchScopes = r.items || [];
        }),
      );
    }
    try {
      await Promise.all(requests);
    } catch (e) {
      if (!isCurrent()) return;
      if (e.status === 401) {
        state.screen = 'signin';
        state.workspace = null;
      } else state.detailError = msg(e);
    }
    if (isCurrent()) render();
  }

  function render() {
    if (state.screen === 'signin')
      return card(
        'تسجيل الدخول',
        'سجّل الدخول من صفحة المواعيد ثم افتح إدارة الفريق.',
        '<a class="btn btn-primary" href="/appointments/">الانتقال لتسجيل الدخول</a>',
      );
    if (state.screen === 'select')
      return card(
        'اختر مساحة العمل',
        '',
        state.workspaces
          .map(
            (w, i) =>
              `<button class="workspace-option" data-action="choose" data-index="${i}">${esc(w.displayName || w.slug)}</button>`,
          )
          .join(''),
      );
    if (state.screen === 'none')
      return card('لا توجد مساحة متاحة', 'لا توجد مساحة عمل نشطة مرتبطة بحسابك.');
    if (state.screen === 'error')
      return card(
        'تعذّر تحميل مساحة العمل',
        state.error,
        '<button class="btn btn-secondary" data-action="retry">إعادة المحاولة</button>',
      );
    if (!state.workspace) return card('جارٍ تحميل مساحة العمل', 'نتحقق من الجلسة والصلاحيات…');
    if (!allowed(P.memberRead) && !allowed(P.staffRead))
      return card(
        'الوصول محدود',
        'تتطلب الصفحة صلاحية قراءة الأعضاء أو الموظفين. لم يتم تحميل بيانات الفريق.',
      );
    app.innerHTML = `<div class="app-frame"><aside class="sidebar" aria-label="التنقل الرئيسي"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">إدارة مساحة العمل</div><nav class="side-nav"><a class="nav-item" href="/clinic-setup/">المنشآت والفروع</a><div class="nav-item active">الأعضاء والفريق</div><a class="nav-item" href="/patients/">المرضى</a><a class="nav-item" href="/appointments/">المواعيد</a><a class="nav-item" href="/encounters/">اللقاءات</a></nav><div class="side-bottom"><div class="scope-note">مساحة نشطة<span class="workspace-name">${esc(state.workspace.displayName || state.workspace.slug)}</span></div><div class="side-actions"><button data-action="switch">تبديل المساحة</button><button data-action="logout">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs">إدارة مساحة العمل / <strong>الأعضاء والفريق</strong></div><div class="top-actions"><span class="user-chip">${esc(state.workspace.displayName || state.workspace.slug)}</span></div></header><div class="page-content"><div class="page-heading"><div><span class="eyebrow">إعداد العيادة</span><h1>الأعضاء والفريق</h1><p>راجع العضويات وأدر ملفات الموظفين والأدوار ونطاق المواقع ضمن صلاحياتك.</p></div><a class="btn btn-secondary" href="/clinic-setup/">المنشآت والفروع</a></div>${state.error ? `<p class="team-alert" role="alert">${esc(state.error)}</p>` : ''}<div class="team-layout"><section class="team-panel"><div class="team-head"><div><h2>الأعضاء</h2><p>الحالة تُعرض من النظام ولا تغيّر صلاحية العضوية هنا.</p></div></div><label class="field"><span>تصفية الحالة</span><select class="control" id="member-status"><option value="">كل الحالات</option>${['ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED'].map((x) => `<option value="${x}" ${state.status === x ? 'selected' : ''}>${statusText(x)}</option>`).join('')}</select></label>${state.loading ? '<div class="team-empty">جارٍ تحميل الأعضاء…</div>' : ''}${!state.loading && !state.members.length ? '<div class="team-empty">لا توجد عضويات في هذه القائمة.</div>' : ''}<div class="team-list">${state.members.map((m) => `<button class="team-member ${m.id === state.selectedId ? 'selected' : ''}" data-action="select" data-id="${esc(m.id)}"><strong>${esc(m.memberName)}</strong><small>معرّف: <bdi dir="ltr">${esc(m.platformUserId)}</bdi></small><span class="team-status ${m.status === 'ACTIVE' ? '' : 'inactive'}">${statusText(m.status)}</span>${m.accountStatus !== 'ACTIVE' ? '<span class="team-status inactive">حساب المنصة غير نشط</span>' : ''}</button>`).join('')}</div><div class="team-actions"><button class="btn btn-secondary btn-small" data-action="prev" ${state.offset === 0 ? 'disabled' : ''}>السابق</button><button class="btn btn-secondary btn-small" data-action="next" ${!state.hasNext ? 'disabled' : ''}>التالي</button></div></section><section class="team-panel">${state.selectedId ? detailMarkup() : '<div class="team-empty">اختر عضوًا لعرض تفاصيله.</div>'}</section></div></div></section></div>`;
  }

  function card(title, text, extra = '') {
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · TEAM SETUP</span></div></div><h1>${esc(title)}</h1><p class="auth-intro">${esc(text)}</p>${extra}</div></section>`;
  }

  function detailMarkup() {
    const m = member(),
      s = staffer();
    if (!m) return '';
    const manageMember =
      allowed(P.memberRoles) && m.status === 'ACTIVE' && m.accountStatus === 'ACTIVE';
    const canStaff =
      allowed(P.staffManage) && m.status === 'ACTIVE' && m.accountStatus === 'ACTIVE';
    return `<div class="team-head"><div><h2>${esc(m.memberName)}</h2><p>${statusText(m.status)} · عضوية مساحة العمل</p></div>${s ? `<span class="team-status ${s.status === 'ACTIVE' ? '' : 'inactive'}">ملف الموظف: ${statusText(s.status)}</span>` : ''}</div>${state.detailError ? `<p class="team-alert" role="alert">${esc(state.detailError)}</p>` : ''}<div class="team-grid"><div class="team-subcard"><h3>أدوار العضوية</h3>${chips(state.memberRoles, 'membership-role', manageMember)}${allowed(P.memberRead) && allowed(P.rolesRead) && manageMember ? roleSelect('membership-role') : ''}</div><div class="team-subcard"><h3>ملف الموظف</h3>${s ? staffMarkup(s) : `<p class="team-muted">${canStaff ? 'لا يوجد ملف موظف لهذه العضوية.' : 'لا يمكن إنشاء ملف إلا لعضوية وحساب نشطين مع صلاحية الإدارة.'}</p>`}${!s && canStaff ? '<button class="btn btn-primary btn-small" data-action="create-staff">إنشاء ملف موظف</button>' : ''}</div></div>${s ? staffControls(s) : ''}`;
  }

  function chips(items, kind, canRemove) {
    if (!items.length) return '<p class="team-muted">لا توجد تعيينات.</p>';
    return items
      .map(
        (a) =>
          `<span class="team-chip">${esc(a.roleName || a.name || a.facilityName || a.branchName)}${canRemove ? `<button type="button" aria-label="إزالة ${esc(a.roleName || a.name || a.facilityName || a.branchName)}" data-action="remove-${kind}" data-id="${esc(a.roleId || a.facilityId || a.branchId)}">إزالة</button>` : ''}</span>`,
      )
      .join('');
  }

  function roleSelect(kind) {
    const assigned = kind === 'membership-role' ? state.memberRoles : state.staffRoles;
    const choices = state.roles.filter((r) => !assigned.some((a) => a.roleId === r.id));
    return `<form class="team-form-row" data-form="add-${kind}"><select class="control" name="roleId" required><option value="">اختر دورًا</option>${choices.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} (${esc(r.code)})</option>`).join('')}</select><button class="btn btn-secondary btn-small" type="submit" ${!choices.length ? 'disabled' : ''}>إضافة دور</button></form>`;
  }

  function staffMarkup(s) {
    const m = member();
    const canManage =
      allowed(P.staffManage) && m?.status === 'ACTIVE' && m?.accountStatus === 'ACTIVE';
    if (state.editStaff)
      return `<form data-form="edit-staff" class="team-section"><label class="field"><span>اسم العرض</span><input class="control" name="displayName" required maxlength="191" value="${esc(s.displayName)}"></label><label class="field"><span>المسمى الوظيفي</span><input class="control" name="jobTitle" maxlength="191" value="${esc(s.jobTitle || '')}"></label><div class="team-actions"><button class="btn btn-secondary btn-small" type="button" data-action="cancel-edit">إلغاء</button><button class="btn btn-primary btn-small" type="submit">حفظ</button></div></form>`;
    return `<p><strong>${esc(s.displayName)}</strong></p><p class="team-muted">${esc(s.jobTitle || '—')} · ${statusText(s.status)}</p>${canManage && s.status !== 'DEACTIVATED' ? `<div class="team-actions"><button class="btn btn-secondary btn-small" data-action="edit-staff">تعديل البيانات</button>${s.status === 'ACTIVE' ? '<button class="btn btn-secondary btn-small" data-action="suspend-staff">إيقاف مؤقت</button>' : '<button class="btn btn-secondary btn-small" data-action="activate-staff">تفعيل</button>'}<button class="btn btn-quiet btn-small" data-action="deactivate-staff">إيقاف نهائي</button></div>` : ''}`;
  }

  function staffControls(s) {
    const m = member();
    const canRoles =
      allowed(P.staffRolesManage) &&
      s.status === 'ACTIVE' &&
      m?.status === 'ACTIVE' &&
      m?.accountStatus === 'ACTIVE';
    const canScope =
      allowed(P.scopeManage) &&
      s.status === 'ACTIVE' &&
      m?.status === 'ACTIVE' &&
      m?.accountStatus === 'ACTIVE';
    return `<section class="team-section"><h3>أدوار الموظف</h3>${chips(state.staffRoles, 'staff-role', canRoles)}${canRoles && allowed(P.staffRolesRead) ? roleSelect('staff-role') : ''}</section><div class="team-grid"><section class="team-section"><h3>نطاق المنشآت</h3>${chips(state.facilityScopes, 'facility-scope', canScope)}${
      canScope
        ? `<form class="team-inline" data-form="add-facility"><select class="control" name="facilityId" required><option value="">اختر منشأة نشطة</option>${state.facilities
            .filter((f) => f.status === 'ACTIVE' && !state.facilityScopes.some((a) => a.facilityId === f.id))
            .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`)
            .join(
              '',
            )}</select><button class="btn btn-secondary btn-small" type="submit">إضافة</button></form>`
        : ''
    }</section><section class="team-section"><h3>نطاق الفروع</h3>${chips(state.branchScopes, 'branch-scope', canScope)}${
      canScope
        ? `<form class="team-inline" data-form="add-branch"><select class="control" name="branchId" required><option value="">اختر فرعًا نشطًا</option>${state.branches
            .filter((b) => b.status === 'ACTIVE' && !state.branchScopes.some((a) => a.branchId === b.id))
            .map(
              (b) =>
                `<option value="${esc(b.id)}">${esc(b.name)} — ${esc(b.facility?.name || '')}</option>`,
            )
            .join(
              '',
            )}</select><button class="btn btn-secondary btn-small" type="submit">إضافة</button></form>`
        : ''
    }</section></div><p class="team-small">نطاق الفرع مستقل ولا يضيف تعيينًا للمنشأة تلقائيًا.</p>`;
  }

  async function onClick(event) {
    const b = event.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    try {
      if (a === 'choose') return choose(state.workspaces[Number(b.dataset.index)]);
      if (a === 'select') {
        state.selectedId = b.dataset.id;
        state.editStaff = false;
        render();
        return loadDetails();
      }
      if (a === 'retry') return bootstrap();
      if (a === 'retry-directory') return loadDirectory();
      if (a === 'switch') {
        state.workspaceEpoch += 1;
        state.directoryRequestId += 1;
        state.detailRequestId += 1;
        state.workspace = null;
        state.members = [];
        state.staff = [];
        state.roles = [];
        state.facilities = [];
        state.branches = [];
        state.selectedId = '';
        state.memberRoles = [];
        state.staffRoles = [];
        state.facilityScopes = [];
        state.branchScopes = [];
        state.error = '';
        state.detailError = '';
        state.screen = 'boot';
        render();
        return bootstrap();
      }
      if (a === 'logout') {
        await api.logout();
        state.workspaceEpoch += 1;
        state.directoryRequestId += 1;
        state.detailRequestId += 1;
        state.workspace = null;
        state.members = [];
        state.staff = [];
        state.facilities = [];
        state.branches = [];
        state.selectedId = '';
        state.screen = 'signin';
        return render();
      }
      if (a === 'prev' || a === 'next') {
        state.offset = Math.max(0, state.offset + (a === 'next' ? PAGE_SIZE : -PAGE_SIZE));
        return loadDirectory();
      }
      if (a === 'edit-staff') {
        state.editStaff = true;
        return render();
      }
      if (a === 'cancel-edit') {
        state.editStaff = false;
        return render();
      }
      if (a === 'create-staff') {
        const m = member();
        await api.createTenantStaff(state.workspace.tenantId, { membershipId: m.id });
        return loadDirectory();
      }
      const s = staffer(),
        tid = state.workspace.tenantId;
      if (a === 'suspend-staff' || a === 'activate-staff' || a === 'deactivate-staff') {
        const action = a.replace('-staff', '');
        if (action === 'deactivate' && !confirm('إيقاف ملف الموظف نهائيًا؟ لا يمكن إعادة تفعيله.'))
          return;
        await api.changeTenantStaffStatus(tid, s.id, action);
        return loadDirectory();
      }
      const id = b.dataset.id;
      if (a === 'remove-membership-role') {
        if (!confirm('إزالة هذا الدور من العضوية؟')) return;
        await api.removeTenantMembershipRole(tid, member().id, id);
        return loadDetails();
      }
      if (a === 'remove-staff-role') {
        if (!confirm('إزالة هذا الدور من ملف الموظف؟')) return;
        await api.removeStaffRole(tid, s.id, id);
        return loadDetails();
      }
      if (a === 'remove-facility-scope') {
        await api.removeStaffFacilityScope(tid, s.id, id);
        return loadDetails();
      }
      if (a === 'remove-branch-scope') {
        await api.removeStaffBranchScope(tid, s.id, id);
        return loadDetails();
      }
    } catch (e) {
      state.detailError = msg(e);
      render();
    }
  }

  async function onChange(event) {
    if (event.target.id === 'member-status') {
      state.status = event.target.value;
      state.offset = 0;
      state.selectedId = '';
      return loadDirectory();
    }
  }

  async function onSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const fd = new FormData(form);
    const tid = state.workspace.tenantId;
    const s = staffer();
    try {
      const kind = form.dataset.form;
      if (kind === 'edit-staff') {
        const displayName = String(fd.get('displayName') || '').trim();
        const jobTitle = String(fd.get('jobTitle') || '').trim();
        await api.updateTenantStaff(tid, s.id, { displayName, jobTitle: jobTitle || null });
        state.editStaff = false;
        return loadDirectory();
      }
      if (kind === 'add-membership-role') {
        await api.assignTenantMembershipRole(tid, member().id, String(fd.get('roleId')));
        return loadDetails();
      }
      if (kind === 'add-staff-role') {
        await api.assignStaffRole(tid, s.id, String(fd.get('roleId')));
        return loadDetails();
      }
      if (kind === 'add-facility') {
        await api.assignStaffFacilityScope(tid, s.id, String(fd.get('facilityId')));
        return loadDetails();
      }
      if (kind === 'add-branch') {
        await api.assignStaffBranchScope(tid, s.id, String(fd.get('branchId')));
        return loadDetails();
      }
    } catch (e) {
      state.detailError = msg(e);
      render();
    }
  }
})();
