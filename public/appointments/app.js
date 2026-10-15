(function () {
  'use strict';

  const api = window.ThanarahApi;
  const timezone = window.ThanarahTimezone;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRegion = document.getElementById('toast-region');
  const PERMISSIONS = {
    appointmentsRead: 'tenant.appointments.read',
    create: 'tenant.appointments.create',
    update: 'tenant.appointments.update',
    reschedule: 'tenant.appointments.reschedule',
    cancel: 'tenant.appointments.cancel',
    patientsRead: 'tenant.patients.read',
    doctorsRead: 'tenant.doctors.read',
    facilitiesRead: 'tenant.facilities.read',
    branchesRead: 'tenant.branches.read',
    servicesRead: 'tenant.services.read',
    policyManage: 'tenant.appointments.policy.manage',
  };
  const PAGE_SIZE = 20;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const state = {
    screen: 'boot',
    workspaces: [],
    workspace: null,
    view: 'appointments',
    appointments: [],
    total: 0,
    offset: 0,
    hasNext: false,
    filters: {
      search: '',
      from: '',
      to: '',
      status: '',
      facilityId: '',
      doctorId: '',
      branchId: '',
      serviceId: '',
    },
    patients: [],
    doctors: [],
    facilities: [],
    branches: [],
    services: [],
    resourceErrors: {},
    listError: null,
    listLoading: false,
    timeZones: {},
    timeZoneError: null,
    policy: null,
    policyLoaded: false,
    policyHistory: [],
    policyHistoryError: null,
    policyError: null,
    policyLoading: false,
    policyFacilityId: '',
    workspaceEpoch: 0,
    listRequestId: 0,
    listTimeZoneRequestId: 0,
    timeZoneRequestId: 0,
    policyRequestId: 0,
    detailRequestId: 0,
    filterBranchRequestId: 0,
    createBranchRequestId: 0,
    patientSearchRequestId: 0,
    patientSearchTimer: null,
  };

  const escapeHtml = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const permission = (code) =>
    !!state.workspace &&
    Array.isArray(state.workspace.permissionCodes) &&
    state.workspace.permissionCodes.includes(code);
  const hasWorkspace = () => !!state.workspace && typeof state.workspace.tenantId === 'string';
  const itemList = (response) => (response && Array.isArray(response.items) ? response.items : []);
  const humanName = (item) => {
    if (!item) return '';
    return (
      item.displayName ||
      item.fullName ||
      item.name ||
      item.preferredName ||
      [item.firstName, item.middleName, item.lastName].filter(Boolean).join(' ') ||
      item.title ||
      item.email ||
      item.id ||
      ''
    );
  };
  const byId = (items, id) => items.find((item) => item && String(item.id) === String(id));
  const labelOf = (items, id) => {
    const found = byId(items, id);
    return found ? humanName(found) : id ? String(id) : '—';
  };
  const authorizedLabel = (items, id, permissionCode, unavailableLabel) => {
    if (!id) return '—';
    if (!permission(permissionCode)) return unavailableLabel;
    const found = byId(items, id);
    return found ? humanName(found) : 'غير متاح ضمن القائمة المحمّلة';
  };
  const patientLabel = (appointment) => {
    if (!permission(PERMISSIONS.patientsRead)) return 'بيانات المريض غير متاحة';
    const patient = byId(state.patients, appointment && appointment.patientId);
    return patient ? humanName(patient) : 'مريض';
  };
  const apiMessage = (error) => {
    const safe =
      error && typeof error.message === 'string'
        ? error.message
        : 'تعذّر إكمال الطلب. حاول مرة أخرى.';
    return error && error.rule ? `${safe} (${error.rule})` : safe;
  };
  const statusLabel = (status) =>
    ({
      SCHEDULED: 'مجدول',
      BOOKED: 'مؤكد',
      CONFIRMED: 'مؤكد',
      PENDING: 'بانتظار التأكيد',
      CHECKED_IN: 'تم الوصول',
      IN_PROGRESS: 'جارٍ',
      COMPLETED: 'مكتمل',
      CANCELLED: 'ملغي',
      CANCELED: 'ملغي',
      NO_SHOW: 'لم يحضر',
    })[status] ||
    status ||
    'غير محدد';
  const timeZoneFor = (facilityId) => {
    const policyZone = facilityId && state.timeZones[String(facilityId)];
    return (policyZone && policyZone.timeZone) || browserZone;
  };
  const timeZoneLabel = (facilityId) => {
    const zone = facilityId && state.timeZones[String(facilityId)];
    if (zone && zone.status === 'ACTIVE_POLICY') return `توقيت المنشأة · ${zone.timeZone}`;
    if (zone && zone.status === 'NO_ACTIVE_POLICY')
      return browserZone
        ? `لا توجد سياسة نشطة · توقيت الجهاز · ${browserZone}`
        : 'لا توجد سياسة نشطة، والمنطقة الزمنية غير متاحة';
    if (state.timeZoneError) return 'تعذّر تحميل المنطقة الزمنية';
    return browserZone ? `توقيت الجهاز · ${browserZone}` : 'المنطقة الزمنية غير متاحة';
  };
  const formatTime = (stamp, facilityId) => {
    if (!stamp) return '—';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return String(stamp);
    const timeZone = timeZoneFor(facilityId);
    if (!timeZone) return 'المنطقة الزمنية غير متاحة';
    try {
      return new Intl.DateTimeFormat('ar', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }).format(date);
    } catch (_) {
      return 'المنطقة الزمنية غير متاحة';
    }
  };
  const formatCompactTime = (stamp, facilityId) => {
    if (!stamp) return '—';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return String(stamp);
    const timeZone = timeZoneFor(facilityId);
    if (!timeZone) return 'المنطقة الزمنية غير متاحة';
    try {
      return new Intl.DateTimeFormat('ar', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }).format(date);
    } catch (_) {
      return 'المنطقة الزمنية غير متاحة';
    }
  };
  const localInputValue = (stamp, facilityId) =>
    stamp && timezone && timeZoneFor(facilityId)
      ? timezone.instantToLocalInput(stamp, timeZoneFor(facilityId))
      : '';
  const toIso = (localValue, facilityId) => {
    const zone = timeZoneFor(facilityId);
    if (!localValue || !timezone || !zone) return null;
    return timezone.localDateTimeToIso(localValue, zone);
  };
  const icon = (name) => {
    const icons = {
      calendar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6"/></svg>',
      policy:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
      empty:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M9 14h6M9 17h3"/></svg>',
    };
    return icons[name] || '';
  };
  const toast = (message, isError) => {
    const node = document.createElement('div');
    node.className = `toast${isError ? ' error' : ''}`;
    node.setAttribute('role', isError ? 'alert' : 'status');
    node.textContent = message;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  };
  const readOptions = async (method, ...args) => {
    const response = await api[method](...args);
    return itemList(response);
  };
  const clearTenantData = () => {
    stopPatientSearch();
    state.workspaceEpoch += 1;
    state.appointments = [];
    state.total = 0;
    state.offset = 0;
    state.hasNext = false;
    state.filters = {
      search: '',
      from: '',
      to: '',
      status: '',
      facilityId: '',
      doctorId: '',
      branchId: '',
      serviceId: '',
    };
    state.timeZones = {};
    state.timeZoneError = null;
    state.patients = [];
    state.doctors = [];
    state.facilities = [];
    state.branches = [];
    state.services = [];
    state.resourceErrors = {};
    state.listError = null;
    state.policy = null;
    state.policyLoaded = false;
    state.policyHistory = [];
    state.policyHistoryError = null;
    state.policyError = null;
    state.policyFacilityId = '';
    modalRoot.innerHTML = '';
  };

  function expireSession() {
    clearTenantData();
    state.workspace = null;
    state.screen = 'signin';
    render();
  }

  async function boot() {
    if (!api) {
      renderFatal('تعذّر تحميل موصل الخدمة. أعد تحميل الصفحة.');
      return;
    }
    try {
      const restored = await api.restoreSession();
      if (!restored) {
        state.screen = 'signin';
        render();
        return;
      }
      await loadWorkspaces();
    } catch (error) {
      state.screen = 'boot-error';
      render();
    }
  }

  async function loadWorkspaces() {
    state.screen = 'workspace-loading';
    render();
    try {
      const response = await api.listWorkspaces();
      state.workspaces = itemList(response);
      if (!state.workspaces.length) {
        state.screen = 'no-workspaces';
      } else if (state.workspaces.length === 1) {
        await chooseWorkspace(state.workspaces[0]);
        return;
      } else {
        state.screen = 'workspace-select';
      }
      render();
    } catch (error) {
      if (error.status === 401) {
        state.screen = 'signin';
      } else {
        state.screen = 'workspaces-error';
        state.listError = error;
      }
      render();
    }
  }

  async function chooseWorkspace(workspace) {
    if (
      !workspace ||
      typeof workspace.tenantId !== 'string' ||
      !Array.isArray(workspace.permissionCodes)
    ) {
      state.screen = 'no-workspaces';
      render();
      return;
    }
    clearTenantData();
    const epoch = state.workspaceEpoch;
    state.workspace = workspace;
    state.view = permission(PERMISSIONS.appointmentsRead)
      ? 'appointments'
      : permission(PERMISSIONS.policyManage)
        ? 'policy'
        : 'no-access';
    if (state.view === 'no-access') {
      state.screen = 'workspace';
      render();
      return;
    }
    state.screen = 'workspace';
    render();
    await loadReferences();
    if (epoch !== state.workspaceEpoch || !hasWorkspace()) return;
    if (state.view === 'appointments') await loadAppointments();
    else await loadPolicyFacilities();
  }

  async function loadReferences() {
    const tenantId = state.workspace.tenantId;
    const epoch = state.workspaceEpoch;
    const jobs = [];
    const load = (allowed, key, method, ...args) => {
      if (!allowed) return;
      jobs.push(
        readOptions(method, tenantId, ...args)
          .then((items) => {
            if (epoch === state.workspaceEpoch) state[key] = items;
          })
          .catch((error) => {
            if (epoch !== state.workspaceEpoch) return;
            state.resourceErrors[key] = error;
          }),
      );
    };
    load(permission(PERMISSIONS.patientsRead), 'patients', 'listPatients', {
      limit: 100,
      offset: 0,
    });
    load(permission(PERMISSIONS.doctorsRead), 'doctors', 'listDoctors', { limit: 100, offset: 0 });
    load(permission(PERMISSIONS.facilitiesRead), 'facilities', 'listFacilities', {
      limit: 100,
      offset: 0,
    });
    load(permission(PERMISSIONS.servicesRead), 'services', 'listServices', {
      limit: 100,
      offset: 0,
    });
    await Promise.all(jobs);
    if (epoch !== state.workspaceEpoch) return;
    if (Object.values(state.resourceErrors).some((error) => error && error.status === 401)) {
      expireSession();
      return;
    }
    if (!state.policyFacilityId && state.facilities.length)
      state.policyFacilityId = String(state.facilities[0].id);
    if (state.screen === 'workspace') render();
  }

  function queryOptions() {
    const filters = state.filters;
    return {
      limit: PAGE_SIZE,
      offset: state.offset,
      fromDate: filters.from || undefined,
      toDate: filters.to || undefined,
      search: filters.search || undefined,
      status: filters.status || undefined,
      facilityId: filters.facilityId || undefined,
      doctorId: filters.doctorId || undefined,
      branchId: filters.branchId || undefined,
      serviceId: filters.serviceId || undefined,
    };
  }

  async function fetchEffectiveTimeZones(facilityIds) {
    const unique = [...new Set(facilityIds.filter(Boolean).map(String))];
    const batches = [];
    for (let index = 0; index < unique.length; index += 20) {
      batches.push(unique.slice(index, index + 20));
    }
    const responses = await Promise.all(
      batches.map((batch) => api.getAppointmentTimeZones(state.workspace.tenantId, batch)),
    );
    return responses.flatMap(itemList);
  }

  async function ensureFacilityTimeZone(facilityId, forceRefresh) {
    if (!facilityId) throw new Error('اختر منشأة قبل إدخال وقت محلي.');
    const key = String(facilityId);
    const previous = state.timeZones[key];
    if (previous && !forceRefresh) return previous;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.timeZoneRequestId;
    const zones = await fetchEffectiveTimeZones([key]);
    if (epoch !== state.workspaceEpoch) throw new Error('تغيّرت مساحة العمل أثناء تحميل المنطقة الزمنية.');
    if (requestId !== state.timeZoneRequestId && state.timeZones[key])
      return state.timeZones[key];
    const result = zones.find((item) => String(item.facilityId) === key);
    if (!result) throw new Error('تعذّر التحقق من المنطقة الزمنية لهذه المنشأة.');
    state.timeZones = { ...state.timeZones, [key]: result };
    state.timeZoneError = null;
    const note = document.getElementById('appointment-timezone-note');
    if (note) note.textContent = timeZoneLabel(key);
    if (
      previous &&
      forceRefresh &&
      (previous.timeZone !== result.timeZone || previous.status !== result.status)
    ) {
      throw new Error(
        'تغيّرت المنطقة الزمنية النشطة للمنشأة. راجع الوقت المحلي الظاهر ثم أعد الإرسال.',
      );
    }
    return result;
  }

  async function loadAppointments() {
    if (!permission(PERMISSIONS.appointmentsRead) || !hasWorkspace()) return;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.listRequestId;
    state.listLoading = true;
    state.listError = null;
    render();
    try {
      const response = await api.listAppointments(state.workspace.tenantId, queryOptions());
      if (epoch !== state.workspaceEpoch || requestId !== state.listRequestId) return;
      state.appointments = itemList(response);
      state.total = Number.isFinite(response.total) ? response.total : state.appointments.length;
      state.offset = Number.isFinite(response.offset) ? response.offset : state.offset;
      state.hasNext = !!response.hasNext;
      state.timeZoneError = null;
      state.timeZones = {};
      const timeZoneRequestId = ++state.listTimeZoneRequestId;
      const facilityIds = [
        ...new Set([
          ...state.appointments.map((item) => item.facilityId).filter(Boolean),
          state.filters.facilityId,
        ]),
      ];
      if (facilityIds.length) {
        try {
          const zones = await fetchEffectiveTimeZones(facilityIds);
          if (
            epoch !== state.workspaceEpoch ||
            requestId !== state.listRequestId ||
            timeZoneRequestId !== state.listTimeZoneRequestId
          )
            return;
          state.timeZones = {
            ...state.timeZones,
            ...Object.fromEntries(zones.map((item) => [String(item.facilityId), item])),
          };
        } catch (error) {
          if (
            epoch !== state.workspaceEpoch ||
            requestId !== state.listRequestId ||
            timeZoneRequestId !== state.listTimeZoneRequestId
          )
            return;
          state.timeZoneError = error;
          if (error.status === 401) {
            expireSession();
            return;
          }
        }
      }
      state.listLoading = false;
    } catch (error) {
      if (epoch !== state.workspaceEpoch || requestId !== state.listRequestId) return;
      state.listLoading = false;
      state.listError = error;
      if (error.status === 401) {
        expireSession();
        return;
      }
    }
    render();
  }

  async function loadPolicyFacilities() {
    if (!permission(PERMISSIONS.policyManage)) return;
    if (!permission(PERMISSIONS.facilitiesRead)) {
      state.policyError = { message: 'تتطلب إدارة السياسة صلاحية قراءة المنشآت لاختيار المنشأة.' };
      state.policyLoaded = true;
      render();
      return;
    }
    const epoch = state.workspaceEpoch;
    if (!state.facilities.length && !state.resourceErrors.facilities) {
      try {
        const facilities = await readOptions('listFacilities', state.workspace.tenantId, {
          limit: 100,
          offset: 0,
        });
        if (epoch !== state.workspaceEpoch) return;
        state.facilities = facilities;
      } catch (error) {
        if (epoch !== state.workspaceEpoch) return;
        if (error.status === 401) {
          expireSession();
          return;
        }
        state.resourceErrors.facilities = error;
      }
    }
    if (epoch !== state.workspaceEpoch) return;
    if (!state.policyFacilityId && state.facilities.length)
      state.policyFacilityId = String(state.facilities[0].id);
    if (state.policyFacilityId) await loadPolicy(state.policyFacilityId);
    else {
      state.policyLoaded = true;
      render();
    }
  }

  async function loadPolicy(facilityId) {
    if (!permission(PERMISSIONS.policyManage) || !facilityId) return;
    state.policyFacilityId = String(facilityId);
    state.policyLoading = true;
    state.policyLoaded = false;
    state.policy = null;
    state.policyError = null;
    state.policyHistory = [];
    state.policyHistoryError = null;
    render();
    const tenantId = state.workspace.tenantId;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.policyRequestId;
    const [policyResult, historyResult] = await Promise.allSettled([
      api.getSchedulingPolicy(tenantId, facilityId),
      api.getSchedulingPolicyHistory(tenantId, facilityId, { limit: 20, offset: 0 }),
    ]);
    if (epoch !== state.workspaceEpoch || requestId !== state.policyRequestId) return;
    if (
      [policyResult, historyResult].some(
        (result) => result.status === 'rejected' && result.reason && result.reason.status === 401,
      )
    ) {
      expireSession();
      return;
    }
    if (policyResult.status === 'fulfilled') {
      state.policy = policyResult.value;
    } else if (policyResult.reason && policyResult.reason.status !== 404) {
      state.policyError = policyResult.reason;
    }
    if (historyResult.status === 'fulfilled') {
      state.policyHistory = itemList(historyResult.value);
    } else {
      state.policyHistoryError = historyResult.reason;
    }
    state.policyLoading = false;
    state.policyLoaded = true;
    render();
  }

  async function changeView(view) {
    if (view === 'appointments' && permission(PERMISSIONS.appointmentsRead)) {
      state.view = 'appointments';
      render();
      await loadAppointments();
    } else if (view === 'policy' && permission(PERMISSIONS.policyManage)) {
      state.view = 'policy';
      render();
      if (!state.facilities.length && !state.resourceErrors.facilities)
        await loadPolicyFacilities();
      else if (state.policyFacilityId) await loadPolicy(state.policyFacilityId);
      else await loadPolicyFacilities();
    }
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'workspace-loading')
      return renderScreenCard(
        'جارٍ تحميل مساحات العمل',
        'نتحقق من صلاحيات الوصول المرتبطة بجلسة الدخول.',
        true,
      );
    if (state.screen === 'workspace-select') return renderWorkspaceSelect();
    if (state.screen === 'no-workspaces')
      return renderScreenCard(
        'لا توجد مساحة متاحة',
        'لا توجد مساحة عمل مرتبطة بحسابك حاليًا. تواصل مع مسؤول المنشأة إذا كان هذا غير متوقع.',
        false,
        true,
      );
    if (state.screen === 'boot-error' || state.screen === 'workspaces-error')
      return renderScreenCard(
        'تعذّر الوصول إلى مساحة العمل',
        apiMessage(state.listError),
        false,
        true,
      );
    if (state.screen !== 'workspace' || !state.workspace)
      return renderScreenCard(
        'تعذّر فتح المساحة',
        'أعد المحاولة أو سجّل الدخول من جديد.',
        false,
        true,
      );
    if (state.view === 'no-access') return renderNoAccess();
    app.innerHTML = shellMarkup();
    if (state.view === 'appointments') renderAppointments();
    else renderPolicy();
  }

  function renderSignIn() {
    app.innerHTML = `
      <section class="auth-screen">
        <div class="auth-card">
          ${brandMarkup()}
          <span class="eyebrow">مساحة العمل السريرية</span>
          <h1>مرحبًا بعودتك</h1>
          <p class="auth-intro">سجّل الدخول لمتابعة المواعيد اليومية وإجراءات المنشأة ضمن نطاق وصولك.</p>
          <form id="signin-form" class="auth-form">
            <div class="field"><label for="email">البريد الإلكتروني</label><input class="control" id="email" name="email" type="email" autocomplete="username" required></div>
            <div class="field"><label for="password">كلمة المرور</label><input class="control" id="password" name="password" type="password" autocomplete="current-password" required></div>
            <div id="signin-error" class="inline-message" hidden></div>
            <button class="btn btn-primary" type="submit">دخول إلى مساحة العمل</button>
          </form>
          <p class="screen-footer">تُدار صلاحيات الوصول بواسطة المنشأة. بيانات الجلسة لا تُحفظ على هذا الجهاز.</p>
        </div>
      </section>`;
  }

  function brandMarkup() {
    return `<div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · APPOINTMENTS</span></div></div>`;
  }

  function renderScreenCard(title, message, loading, retry) {
    const action = retry
      ? `<button class="btn btn-secondary" type="button" data-action="${state.screen === 'workspaces-error' ? 'retry-workspaces' : 'retry-boot'}">إعادة المحاولة</button>`
      : state.screen === 'no-workspaces'
        ? '<button class="btn btn-quiet" type="button" data-action="logout">تسجيل الخروج</button>'
        : '';
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brandMarkup()}<span class="eyebrow">المواعيد</span><h1>${escapeHtml(title)}</h1><p class="auth-intro">${escapeHtml(message)}</p>${loading ? '<div class="loading-state"><div class="skeleton-row"></div><div class="skeleton-row"></div><p class="form-note">لحظات من فضلك…</p></div>' : action}<p class="screen-footer">تظل صلاحيات الموظفين ونطاقات الوصول بيد الخادم.</p></div></section>`;
  }

  function renderWorkspaceSelect() {
    app.innerHTML = `
      <section class="workspace-screen">
        <div class="workspace-card">${brandMarkup()}
          <span class="eyebrow">اختيار المساحة</span>
          <h1>إلى أين تتجه؟</h1>
          <p class="auth-intro">اختر مساحة العمل التي منحك فريقها حق الوصول إليها.</p>
          <div class="workspace-list">${state.workspaces
            .map(
              (workspace, index) => `
            <button class="workspace-option" type="button" data-action="choose-workspace" data-index="${index}">
              <span><strong>${escapeHtml(workspace.displayName || 'مساحة عمل')}</strong><small>${escapeHtml(workspace.slug || workspace.tenantId || '')}</small></span>
              <span class="workspace-arrow" aria-hidden="true">←</span>
            </button>`,
            )
            .join('')}
          </div>
          <button class="btn btn-quiet" style="margin-top:16px" type="button" data-action="logout">تسجيل الخروج</button>
          <p class="screen-footer">لا تتم مشاركة بيانات المواعيد بين مساحات العمل.</p>
        </div>
      </section>`;
  }

  function renderNoAccess() {
    app.innerHTML = `
      <section class="workspace-screen"><div class="workspace-card">${brandMarkup()}
        <span class="eyebrow">الوصول محدود</span><h1>لا توجد صلاحية للمواعيد</h1>
        <p class="auth-intro">لم تُمنح هذه المساحة صلاحية <bdi dir="ltr">tenant.appointments.read</bdi>. لن يتم تحميل أي بيانات مواعيد.</p>
        <button class="btn btn-secondary" type="button" data-action="switch-workspace">اختيار مساحة أخرى</button>
        <button class="btn btn-quiet" type="button" data-action="logout">تسجيل الخروج</button>
      </div></section>`;
  }

  function shellMarkup() {
    const showAppointments = permission(PERMISSIONS.appointmentsRead);
    const showPolicy = permission(PERMISSIONS.policyManage);
    return `
      <div class="app-frame">
        <aside class="sidebar" aria-label="التنقل الرئيسي">
          <a class="brand" href="/appointments/" aria-label="ثناره — مساحة المواعيد">
            <img src="/assets/logo-transparent.png" alt="">
            <span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span>
          </a>
          <div class="side-kicker">العمليات السريرية</div>
          <nav class="side-nav">
            ${showAppointments ? `<button class="nav-item ${state.view === 'appointments' ? 'active' : ''}" type="button" data-action="view-appointments" ${state.view === 'appointments' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('calendar')}</span><span>المواعيد</span></button>` : ''}
            ${showPolicy ? `<button class="nav-item ${state.view === 'policy' ? 'active' : ''}" type="button" data-action="view-policy" ${state.view === 'policy' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('policy')}</span><span>سياسة الجدولة</span></button>` : ''}
          </nav>
          <div class="side-bottom">
            <div class="scope-note"><span class="scope-dot"></span>مساحة نشطة<span class="workspace-name">${escapeHtml(state.workspace.displayName || state.workspace.slug || 'مساحة العمل')}</span></div>
            <div class="side-actions"><button type="button" data-action="switch-workspace">تبديل المساحة</button><button type="button" data-action="logout">خروج</button></div>
          </div>
        </aside>
        <section class="main-area">
          <header class="topbar">
            <div class="breadcrumbs"><span>العمليات</span><span aria-hidden="true"> / </span><strong>${state.view === 'policy' ? 'سياسة الجدولة' : 'المواعيد'}</strong></div>
            <div class="top-actions"><span class="zone-label">الأوقات حسب سياسة كل منشأة عند توفرها، وإلا توقيت الجهاز${browserZone ? ` · ${escapeHtml(browserZone)}` : ''}</span><span class="user-chip">${escapeHtml(state.workspace.displayName || state.workspace.slug || 'مساحة العمل')}</span><div class="mobile-session-actions"><button type="button" data-action="switch-workspace">تبديل</button><button type="button" data-action="logout">خروج</button></div></div>
          </header>
          <div class="page-content" id="page-content"></div>
        </section>
      </div>`;
  }

  function renderAppointments() {
    const content = document.getElementById('page-content');
    if (!content) return;
    const countLabel = state.listLoading
      ? 'جارٍ تحديث النتائج…'
      : state.filters.search
        ? `${state.total.toLocaleString('ar')} نتيجة مطابقة عبر النتائج المتاحة`
        : `${state.total.toLocaleString('ar')} موعد`;
    content.innerHTML = `
      <div class="page-heading">
        <div><span class="eyebrow">تنسيق اليوم، بوضوح</span><h1>المواعيد</h1><p>تابع حركة المواعيد ضمن صلاحيات مساحة العمل.</p></div>
        <div class="heading-actions">${permission(PERMISSIONS.create) ? '<button class="btn btn-primary" type="button" data-action="new-appointment"><span class="btn-symbol" aria-hidden="true">+</span>موعد جديد</button>' : '<button class="btn btn-secondary" type="button" disabled title="تتطلب الإضافة صلاحية tenant.appointments.create">موعد جديد · غير متاح</button>'}</div>
      </div>
      ${filterMarkup()}
      <section aria-label="قائمة المواعيد">
        <div class="list-status"><span>${countLabel}</span><span>${escapeHtml(state.filters.facilityId ? timeZoneLabel(state.filters.facilityId) : 'توقيت كل منشأة حسب سياستها')}</span></div>
        <div class="records">${recordsMarkup()}</div>
      </section>`;
  }

  function filterMarkup() {
    const f = state.filters;
    const searchPlaceholder = permission(PERMISSIONS.patientsRead)
      ? 'اسم المريض أو رقم الملف أو معرّف الموعد'
      : 'معرّف الموعد أو معرّف مرجع مرتبط';
    const localDateNote = f.facilityId
      ? timeZoneLabel(f.facilityId)
      : 'اختر منشأة لتفسير التاريخ حسب منطقتها الزمنية.';
    return `
      <form id="filter-form">
        <div class="filters-panel">
          <div class="field search-field"><label for="filter-search">بحث في المواعيد</label><input id="filter-search" name="search" class="control" type="search" maxlength="128" value="${escapeHtml(f.search)}" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off"></div>
          <div class="field"><label for="filter-status">الحالة</label><select id="filter-status" name="status" class="control"><option value="">كل الحالات</option>${['SCHEDULED', 'CANCELLED'].map((v) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${statusLabel(v)}</option>`).join('')}</select></div>
          ${permission(PERMISSIONS.facilitiesRead) ? `<div class="field"><label for="filter-facility">المنشأة</label><select id="filter-facility" name="facilityId" class="control"><option value="">كل المنشآت</option>${state.facilities.map((item) => `<option value="${escapeHtml(item.id)}" ${String(f.facilityId) === String(item.id) ? 'selected' : ''}>${escapeHtml(humanName(item))}</option>`).join('')}</select></div>` : ''}
          ${permission(PERMISSIONS.doctorsRead) ? `<div class="field"><label for="filter-doctor">الممارس</label><select id="filter-doctor" name="doctorId" class="control"><option value="">كل الممارسين</option>${state.doctors.map((item) => `<option value="${escapeHtml(item.id)}" ${String(f.doctorId) === String(item.id) ? 'selected' : ''}>${escapeHtml(humanName(item))}</option>`).join('')}</select></div>` : ''}
          ${permission(PERMISSIONS.branchesRead) && permission(PERMISSIONS.facilitiesRead) ? `<div class="field"><label for="filter-branch">الفرع</label><select id="filter-branch" name="branchId" class="control" ${!f.facilityId || !state.branches.length ? 'disabled' : ''}><option value="">${f.facilityId ? (state.branches.length ? 'كل الفروع' : 'اختر منشأة ثم حمّل الفروع') : 'اختر منشأة أولًا'}</option>${state.branches.map((item) => `<option value="${escapeHtml(item.id)}" ${String(f.branchId) === String(item.id) ? 'selected' : ''}>${escapeHtml(humanName(item))}</option>`).join('')}</select></div>` : ''}
          ${permission(PERMISSIONS.servicesRead) ? `<div class="field"><label for="filter-service">الخدمة</label><select id="filter-service" name="serviceId" class="control"><option value="">كل الخدمات</option>${state.services.map((item) => `<option value="${escapeHtml(item.id)}" ${String(f.serviceId) === String(item.id) ? 'selected' : ''}>${escapeHtml(humanName(item))}</option>`).join('')}</select></div>` : ''}
          <div class="filter-actions"><button class="btn btn-secondary btn-small" type="submit">تطبيق</button><button class="btn btn-quiet btn-small" type="button" data-action="clear-filters">مسح</button></div>
        </div>
        <div class="date-range">
          <div class="field"><label for="filter-from">من تاريخ</label><input id="filter-from" name="from" class="control" type="date" value="${escapeHtml(f.from)}"></div>
          <div class="field"><label for="filter-to">إلى تاريخ</label><input id="filter-to" name="to" class="control" type="date" value="${escapeHtml(f.to)}"></div>
        </div>
        <p class="form-note" id="filter-timezone-note">${escapeHtml(localDateNote)}</p>
      </form>`;
  }

  function recordsMarkup() {
    if (state.listLoading)
      return `<div aria-label="تحميل المواعيد" aria-busy="true">${'<div class="skeleton-row"></div>'.repeat(6)}</div>`;
    if (state.listError)
      return `<div class="error-state"><div class="empty-mark">${icon('empty')}</div><h2>تعذّر تحميل المواعيد</h2><p>${escapeHtml(apiMessage(state.listError))}</p><button class="btn btn-secondary" type="button" data-action="retry-appointments">إعادة المحاولة</button></div>`;
    const appointments = filterCurrentPageAppointments();
    if (!appointments.length) {
      const filtered = Object.values(state.filters).some(Boolean);
      return `<div class="empty-state"><div class="empty-mark">${icon('empty')}</div><h2>${filtered ? 'لا توجد نتائج مطابقة' : 'لا توجد مواعيد لعرضها'}</h2><p>${filtered ? 'عدّل المرشحات أو امسحها لعرض النتائج المتاحة ضمن نطاق وصولك.' : 'ستظهر المواعيد هنا عندما تكون متاحة ضمن نطاق وصولك.'}</p>${filtered ? '<button class="btn btn-secondary btn-small" type="button" data-action="clear-filters">مسح المرشحات</button>' : ''}</div>`;
    }
    const table = `
      <div class="table-wrap"><table class="appointments-table">
        <thead><tr><th scope="col">المريض</th><th scope="col">الموعد</th><th scope="col">الممارس</th><th scope="col">المنشأة</th><th scope="col">الحالة</th><th scope="col"><span class="sr-only">إجراء</span></th></tr></thead>
        <tbody>${appointments
          .map(
            (item) => `
          <tr>
            <td><span class="patient-name">${escapeHtml(patientLabel(item))}</span></td>
            <td><span class="time-primary">${escapeHtml(formatTime(item.startsAt, item.facilityId))}</span><span class="time-secondary">${escapeHtml(formatCompactTime(item.startsAt, item.facilityId))} – ${escapeHtml(formatCompactTime(item.endsAt, item.facilityId))}</span><small class="time-zone-note">${escapeHtml(timeZoneLabel(item.facilityId))}</small></td>
            <td>${escapeHtml(authorizedLabel(state.doctors, item.doctorId, PERMISSIONS.doctorsRead, 'بيانات الممارس غير متاحة'))}</td>
            <td>${escapeHtml(authorizedLabel(state.facilities, item.facilityId, PERMISSIONS.facilitiesRead, 'بيانات المنشأة غير متاحة'))}</td>
            <td><span class="status-pill" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
            <td><button class="row-open" type="button" data-action="open-appointment" data-id="${escapeHtml(item.id)}">التفاصيل <span aria-hidden="true">←</span></button></td>
          </tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <div class="pagination">
        <span>${state.total ? `${(state.offset + 1).toLocaleString('ar')}–${Math.min(state.offset + state.appointments.length, state.total).toLocaleString('ar')} من ${state.total.toLocaleString('ar')}` : '—'}</span>
        <div class="pagination-controls">
          <button class="btn btn-secondary btn-small" type="button" data-action="page-prev" ${state.offset <= 0 ? 'disabled' : ''}>السابق</button>
          <button class="btn btn-secondary btn-small" type="button" data-action="page-next" ${!state.hasNext ? 'disabled' : ''}>التالي</button>
        </div>
      </div>`;
    return table;
  }

  function filterCurrentPageAppointments() {
    return state.appointments;
  }

  function renderPolicy() {
    const content = document.getElementById('page-content');
    if (!content) return;
    content.innerHTML = `
      <div class="page-heading">
        <div><span class="eyebrow">قواعد المنشأة</span><h1>سياسة الجدولة</h1><p>إدارة شروط الحجز والتوفر للمنشأة المختارة.</p></div>
      </div>
      <div class="notice" style="margin-bottom:18px">تُحمّل السياسة وتاريخها وتُعدّل فقط مع صلاحية إدارة سياسة الجدولة. الخادم هو المرجع النهائي للتحقق من القواعد ونطاق الوصول.</div>
      <div class="policy-toolbar">
        <div class="field"><label for="policy-facility">المنشأة</label><select class="control" id="policy-facility" ${!state.facilities.length || state.policyLoading ? 'disabled' : ''}>
          ${state.facilities.length ? state.facilities.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(state.policyFacilityId) ? 'selected' : ''}>${escapeHtml(humanName(item))}</option>`).join('') : '<option value="">لا توجد منشآت متاحة</option>'}
        </select></div>
        <button class="btn btn-secondary" type="button" data-action="reload-policy" ${!state.policyFacilityId || state.policyLoading ? 'disabled' : ''}>تحديث</button>
      </div>
      ${policyBodyMarkup()}`;
  }

  function policyBodyMarkup() {
    if (state.policyLoading)
      return `<section class="policy-section" aria-busy="true"><div class="policy-section-head"><h2>السياسة الحالية</h2></div><div class="skeleton-row"></div><div class="skeleton-row"></div></section>`;
    if (state.policyError)
      return `<div class="error-state"><div class="empty-mark">${icon('policy')}</div><h2>تعذّر تحميل السياسة</h2><p>${escapeHtml(apiMessage(state.policyError))}</p><button class="btn btn-secondary" type="button" data-action="reload-policy">إعادة المحاولة</button></div>`;
    if (state.resourceErrors.facilities && !state.facilities.length)
      return `<div class="error-state"><h2>تعذّر تحميل المنشآت</h2><p>${escapeHtml(apiMessage(state.resourceErrors.facilities))}</p><button class="btn btn-secondary" type="button" data-action="reload-facilities">إعادة المحاولة</button></div>`;
    if (!state.policyFacilityId)
      return `<div class="empty-state"><div class="empty-mark">${icon('policy')}</div><h2>اختر منشأة</h2><p>لا توجد منشآت متاحة ضمن صلاحياتك، لذلك لم يتم طلب أو إنشاء سياسة.</p></div>`;
    if (!state.policyLoaded) return '';
    if (!state.policy) {
      const error = state.resourceErrors.facilities;
      if (error)
        return `<div class="error-state"><h2>تعذّر تحميل المنشآت</h2><p>${escapeHtml(apiMessage(error))}</p><button class="btn btn-secondary" type="button" data-action="reload-facilities">إعادة المحاولة</button></div>`;
      return `<section class="policy-section">
        <div class="policy-section-head"><h2>لا توجد سياسة مهيأة</h2><span class="policy-status inactive">غير مهيأة</span></div>
        <div class="policy-section-body">
          <div class="policy-empty">لم تُرجع الخدمة سياسة لهذه المنشأة. لا توجد قيم افتراضية معروضة؛ أدخل إعدادات المنشأة المعتمدة فقط ثم احفظها.</div>
          <div class="policy-meta" style="margin-top:14px"><span>المنشأة <strong>${escapeHtml(labelOf(state.facilities, state.policyFacilityId))}</strong></span></div>
        </div>
      </section>
      ${policyEditorMarkup(null)}
      ${historyMarkup()}`;
    }
    const policy = state.policy;
    return `
      <section class="policy-section">
        <div class="policy-section-head"><h2>السياسة الحالية</h2><span class="policy-status ${policy.status === 'ACTIVE' ? '' : 'inactive'}">${escapeHtml(policy.status === 'ACTIVE' ? 'مفعّلة' : policy.status || 'غير مفعّلة')}</span></div>
        <div class="policy-section-body">
          <div class="policy-meta"><span>المنشأة <strong>${escapeHtml(labelOf(state.facilities, policy.facilityId))}</strong></span>${policy.timeZone ? `<span>المنطقة الزمنية <strong>${escapeHtml(policy.timeZone)}</strong></span>` : ''}<span>الإصدار <strong>${escapeHtml(policy.version)}</strong></span></div>
          <div class="detail-actions">
            <button class="btn ${policy.status === 'ACTIVE' ? 'btn-secondary' : 'btn-primary'} btn-small" type="button" data-action="${policy.status === 'ACTIVE' ? 'deactivate-policy' : 'activate-policy'}">${policy.status === 'ACTIVE' ? 'إيقاف السياسة' : 'تفعيل السياسة'}</button>
            <button class="btn btn-secondary btn-small" type="button" data-action="toggle-policy-editor">تعديل الإعدادات</button>
          </div>
        </div>
      </section>
      <div id="policy-editor-wrap" hidden>${policyEditorMarkup(policy)}</div>
      <section class="policy-section">
        <div class="policy-section-head"><h2>القواعد الفعلية</h2></div>
        <div class="policy-section-body"><pre class="policy-json control">${escapeHtml(JSON.stringify(policy.rules, null, 2))}</pre></div>
      </section>
      ${historyMarkup()}`;
  }

  function policyEditorMarkup(policy) {
    const rulesValue = policy && policy.rules ? JSON.stringify(policy.rules, null, 2) : '';
    return `<section class="policy-section" id="policy-editor">
      <div class="policy-section-head"><h2>${policy ? 'تعديل السياسة' : 'إعداد سياسة'}</h2>${policy ? `<span class="policy-status inactive">الإصدار ${escapeHtml(policy.version)}</span>` : ''}</div>
      <div class="policy-section-body">
        <form id="policy-form">
          <div class="form-grid">
            <div class="field span-all"><label for="policy-timezone">المنطقة الزمنية للمنشأة (IANA)</label><input class="control" id="policy-timezone" name="timeZone" value="${escapeHtml((policy && policy.timeZone) || '')}" placeholder="أدخل المنطقة الزمنية المعتمدة" required><small class="form-note">تُعرض القيمة بعد استلامها من الخدمة؛ لا تستخدم المنطقة الزمنية للجهاز بدلًا عنها.</small></div>
            <div class="field span-all"><label for="policy-rules">القواعد (JSON)</label><textarea class="control policy-json" id="policy-rules" name="rules" spellcheck="false" placeholder="أدخل كائن القواعد المعتمد بصيغة JSON">${escapeHtml(rulesValue)}</textarea>
              <details class="schema-details"><summary>بنية القواعد المطلوبة</summary><ul>
                <li><code>operatingHours</code>: خريطة أيام الأسبوع إلى قوائم فترات <code>{ start, end }</code>.</li>
                <li><code>providerAvailability</code>: قائمة عناصر الطبيب، والتوفر الأسبوعي، والاستثناءات حسب التاريخ والفترات.</li>
                <li><code>allowedDurationsMinutes</code>: قائمة أعداد صحيحة؛ و<code>serviceDurationRules</code> يربط الخدمات بمددها المسموحة.</li>
                <li>حدود الحجز والإشعار الأربع تقبل عددًا صحيحًا أو <code>null</code>.</li>
              </ul></details>
              <small class="form-note">أدخل القيم المعتمدة فقط؛ لا تُضاف ساعات أو مراجع تلقائيًا. التحقق النهائي من التداخل والمنطقة الزمنية والمراجع يتم عبر الخدمة.</small></div>
          </div>
          <div id="policy-form-error" class="inline-message" style="margin-top:14px" hidden></div>
          <div class="dialog-footer"><span class="form-note">${policy ? `سيُرسل الإصدار المتوقع ${escapeHtml(policy.version)} للتحقق من عدم تغيّر السياسة.` : 'سيتم إرسال القيم التي أدخلتها فقط.'}</span><button class="btn btn-primary" type="submit">حفظ السياسة</button></div>
        </form>
      </div>
    </section>`;
  }

  function historyMarkup() {
    const rows = state.policyHistory
      .map(
        (entry) => `
      <div class="history-entry"><div><strong>${escapeHtml(entry.status || entry.action || 'تغيير')}</strong><span> · إصدار ${escapeHtml(entry.version || '—')}</span></div><span>${escapeHtml(formatTime(entry.createdAt || entry.updatedAt || entry.activatedAt))}</span></div>`,
      )
      .join('');
    return `<section class="policy-section"><div class="policy-section-head"><h2>سجل السياسة</h2><button class="btn btn-quiet btn-small" type="button" data-action="reload-history">تحديث السجل</button></div><div class="policy-section-body">${state.policyHistoryError ? `<div class="inline-message">${escapeHtml(apiMessage(state.policyHistoryError))}</div>` : rows ? `<div class="history-list">${rows}</div>` : '<p class="form-note">لا توجد تغييرات في السجل المتاح.</p>'}</div></section>`;
  }

  function showModal(markup, focusSelector) {
    stopPatientSearch();
    modalRoot.innerHTML = `<div class="overlay" data-overlay="true"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">${markup}</section></div>`;
    const dialog = modalRoot.querySelector('[role="dialog"]');
    if (focusSelector) dialog.querySelector(focusSelector)?.focus();
    else dialog.querySelector('button, input, select, textarea')?.focus();
    document.addEventListener('keydown', onModalKey);
  }
  function closeModal() {
    stopPatientSearch();
    modalRoot.innerHTML = '';
    document.removeEventListener('keydown', onModalKey);
  }
  function stopPatientSearch() {
    if (state.patientSearchTimer) window.clearTimeout(state.patientSearchTimer);
    state.patientSearchTimer = null;
    state.patientSearchRequestId += 1;
  }
  function onModalKey(event) {
    if (event.key === 'Escape') closeModal();
    if (event.key === 'Tab') {
      const dialog = modalRoot.querySelector('[role="dialog"]');
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]',
        ),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function resourceSelect(fieldName, label, items, required, readAllowed, error) {
    if (!readAllowed)
      return `<div class="field"><label for="${fieldName}">${label}</label><select class="control" id="${fieldName}" name="${fieldName}" disabled><option>تتطلب الخيارات صلاحية قراءة مناسبة</option></select><small class="form-note">يتطلب عرض الاختيارات صلاحية القراءة ذات الصلة.</small></div>`;
    if (error)
      return `<div class="field"><label for="${fieldName}">${label}</label><select class="control" id="${fieldName}" name="${fieldName}" disabled><option>تعذّر تحميل الاختيارات</option></select><small class="form-note">${escapeHtml(apiMessage(error))}</small><button class="btn btn-quiet btn-small" type="button" data-action="reload-create-references">إعادة تحميل الخيارات</button></div>`;
    return `<div class="field"><label for="${fieldName}">${label}</label><select class="control" id="${fieldName}" name="${fieldName}" ${required ? 'required' : ''}><option value="">${required ? 'اختر ' + label : 'بدون تحديد'}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(humanName(item))}</option>`).join('')}</select>${!items.length ? '<small class="form-note">لا توجد خيارات محمّلة ضمن نطاق الوصول.</small>' : ''}</div>`;
  }

  function patientPickerMarkup() {
    if (!permission(PERMISSIONS.patientsRead)) {
      return resourceSelect('patientId', 'المريض', [], true, false, null);
    }
    return `<div class="field span-all">
      <label for="patient-search">ابحث عن المريض بالاسم أو رقم الملف</label>
      <input class="control" id="patient-search" type="search" maxlength="64" autocomplete="off" placeholder="أدخل اسمًا أو رقم ملف للبحث">
      <label for="patientId">المريض المحدد</label>
      <select class="control" id="patientId" name="patientId" required>
        <option value="">ابدأ البحث لاختيار مريض</option>
      </select>
      <small class="form-note" id="patient-search-help" aria-live="polite">تظهر النتائج من دليل المرضى المسموح لحسابك بقراءته.</small>
    </div>`;
  }

  function rememberPatients(patients) {
    const byPatientId = new Map(state.patients.map((patient) => [String(patient.id), patient]));
    patients.forEach((patient) => byPatientId.set(String(patient.id), patient));
    state.patients = Array.from(byPatientId.values());
  }

  function searchPatients(input) {
    stopPatientSearch();
    const requestId = state.patientSearchRequestId;
    const epoch = state.workspaceEpoch;
    const term = input.value.trim();
    const form = input.closest('#appointment-form');
    const select = form && form.querySelector('#patientId');
    const help = form && form.querySelector('#patient-search-help');
    if (!select || !help) return;

    select.innerHTML = '<option value="">ابدأ البحث لاختيار مريض</option>';
    if (term.length < 2) {
      help.textContent = term
        ? 'أدخل حرفين على الأقل لبدء البحث.'
        : 'تظهر النتائج من دليل المرضى المسموح لحسابك بقراءته.';
      return;
    }

    help.textContent = 'جارٍ البحث في دليل المرضى…';
    select.innerHTML = '<option value="">جارٍ البحث…</option>';
    state.patientSearchTimer = window.setTimeout(async () => {
      state.patientSearchTimer = null;
      try {
        const response = await api.listPatients(state.workspace.tenantId, {
          search: term,
          status: 'ACTIVE',
          limit: 20,
          offset: 0,
        });
        if (
          epoch !== state.workspaceEpoch ||
          requestId !== state.patientSearchRequestId ||
          !form.isConnected ||
          input.value.trim() !== term
        ) {
          return;
        }
        const patients = itemList(response);
        rememberPatients(patients);
        select.innerHTML = `<option value="">${patients.length ? 'اختر مريضًا' : 'لا توجد نتائج'}</option>${patients
          .map((patient) => {
            const label = `${humanName(patient)}${patient.patientNumber ? ` · ${patient.patientNumber}` : ''}`;
            return `<option value="${escapeHtml(patient.id)}">${escapeHtml(label)}</option>`;
          })
          .join('')}`;
        help.textContent = patients.length
          ? `${patients.length.toLocaleString('ar')} نتيجة مطابقة. اختر المريض للمتابعة.`
          : 'لا توجد نتائج مطابقة ضمن دليل المرضى المسموح.';
      } catch (error) {
        if (epoch !== state.workspaceEpoch || requestId !== state.patientSearchRequestId) return;
        if (error.status === 401) {
          expireSession();
          return;
        }
        select.innerHTML = '<option value="">تعذّر تحميل النتائج</option>';
        help.textContent = apiMessage(error);
      }
    }, 250);
  }

  function appointmentFormMarkup(kind, appointment) {
    const editing = kind === 'edit';
    const reschedule = kind === 'reschedule';
    const title = editing ? 'تعديل تفاصيل الموعد' : reschedule ? 'إعادة جدولة الموعد' : 'موعد جديد';
    const description = editing
      ? 'يمكن تحديث سبب الموعد دون تغيير بيانات الجدولة.'
      : reschedule
        ? 'اختر وقتًا جديدًا؛ ستتحقق الخدمة من قواعد الجدولة.'
        : 'أدخل البيانات المطلوبة. ستُراجع المراجع والتوفر من قبل الخدمة.';
    const appointmentFacilityId = appointment && appointment.facilityId;
    const prefillStart = appointment
      ? localInputValue(appointment.startsAt, appointmentFacilityId)
      : '';
    const prefillEnd = appointment
      ? localInputValue(appointment.endsAt, appointmentFacilityId)
      : '';
    const missingCreatePermission =
      !permission(PERMISSIONS.patientsRead) ||
      !permission(PERMISSIONS.doctorsRead) ||
      !permission(PERMISSIONS.facilitiesRead);
    const createReferenceError = state.resourceErrors.doctors || state.resourceErrors.facilities;
    const missingCreateRecords = !state.doctors.length || !state.facilities.length;
    const createBlocked =
      kind === 'create' &&
      (missingCreatePermission || !!createReferenceError || missingCreateRecords);
    const createBlockReason = missingCreatePermission
      ? 'يتطلب إنشاء الموعد صلاحية قراءة المرضى والممارسين والمنشآت لاختيار المراجع.'
      : createReferenceError
        ? 'تعذّر تحميل مرجع مطلوب. لا يمكن إرسال موعد بمراجع غير محمّلة.'
        : missingCreateRecords
          ? 'لا توجد سجلات محمّلة لممارس أو منشأة، لذلك لا يمكن إرسال الموعد.'
          : '';
    const actionButtons = editing
      ? `<button class="btn btn-primary" type="submit">حفظ التعديل</button>`
      : reschedule
        ? `<button class="btn btn-primary" type="submit">تأكيد الوقت الجديد</button>`
        : `<button class="btn btn-primary" type="submit" ${createBlocked ? 'disabled title="' + escapeHtml(createBlockReason) + '"' : ''}>إنشاء الموعد</button>`;
    let fields = '';
    if (kind === 'create') {
      fields = `
        ${patientPickerMarkup()}
        ${resourceSelect('doctorId', 'الممارس', state.doctors, true, permission(PERMISSIONS.doctorsRead), state.resourceErrors.doctors)}
        ${resourceSelect('facilityId', 'المنشأة', state.facilities, true, permission(PERMISSIONS.facilitiesRead), state.resourceErrors.facilities)}
        ${resourceSelect('branchId', 'الفرع', [], false, permission(PERMISSIONS.branchesRead), null)}
        ${resourceSelect('serviceId', 'الخدمة', state.services, false, permission(PERMISSIONS.servicesRead), state.resourceErrors.services)}
        <div class="field"><label for="startsAt">بداية الموعد</label><input class="control" id="startsAt" name="startsAt" type="datetime-local" required></div>
        <div class="field"><label for="endsAt">نهاية الموعد</label><input class="control" id="endsAt" name="endsAt" type="datetime-local" required></div>
        <div class="notice span-all" id="appointment-timezone-note">${escapeHtml(browserZone ? `اختر المنشأة لتحميل منطقتها الزمنية. عند غياب سياسة نشطة، سيُستخدم توقيت الجهاز ${browserZone} ويظهر ذلك بوضوح.` : 'لا تتوفر منطقة زمنية من سياسة المنشأة أو الجهاز.')}</div>
        <div class="field span-all"><label for="reason">سبب الموعد (اختياري)</label><textarea class="control" id="reason" name="reason" rows="2"></textarea></div>`;
    } else if (editing) {
      fields = `<div class="field span-all"><label for="reason">سبب الموعد</label><textarea class="control" id="reason" name="reason" rows="3" placeholder="يمكن تركه فارغًا لإزالة السبب">${escapeHtml(appointment.reason || '')}</textarea><small class="form-note">تحديث غير متعلق بالجدولة؛ لن تتغير المواعيد أو المراجع.</small></div>`;
    } else {
      fields = `<div class="field"><label for="startsAt">البداية الجديدة</label><input class="control" id="startsAt" name="startsAt" type="datetime-local" value="${escapeHtml(prefillStart)}" required></div>
        <div class="field"><label for="endsAt">النهاية الجديدة</label><input class="control" id="endsAt" name="endsAt" type="datetime-local" value="${escapeHtml(prefillEnd)}" required></div>
        <div class="notice span-all" id="appointment-timezone-note">${escapeHtml(timeZoneLabel(appointmentFacilityId))}. الوقت المحلي يحوّل إلى لحظة محددة حسب هذه المنطقة.</div>`;
    }
    return `<div class="dialog-header"><div><h2 id="dialog-title">${title}</h2><p>${description}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></div>
      <div class="dialog-body"><form id="appointment-form" data-kind="${kind}" ${kind === 'create' ? 'data-idempotency=""' : ''}>
        <div id="appointment-form-error" class="inline-message" style="margin-bottom:15px" hidden></div>
        <div class="form-grid">${fields}</div>
        ${createBlocked ? `<p class="form-note" role="status" style="margin-top:16px">${escapeHtml(createBlockReason)}</p>` : ''}
        <div class="dialog-footer dialog-footer-end"><button class="btn btn-quiet" type="button" data-action="close-modal">إلغاء</button>${actionButtons}</div>
      </form></div>`;
  }

  async function openAppointment(id) {
    if (!permission(PERMISSIONS.appointmentsRead)) return;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.detailRequestId;
    showModal(
      `<div class="dialog-header"><div><h2 id="dialog-title">تفاصيل الموعد</h2><p>جارٍ تحميل أحدث بيانات الموعد…</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></div><div class="dialog-body"><div class="skeleton-row"></div><div class="skeleton-row"></div></div>`,
    );
    try {
      const appointment = await api.getAppointment(state.workspace.tenantId, id);
      if (epoch !== state.workspaceEpoch || requestId !== state.detailRequestId) return;
      if (!modalRoot.querySelector('[role="dialog"]')) return;
      renderAppointmentDetail(appointment);
    } catch (error) {
      if (epoch !== state.workspaceEpoch || requestId !== state.detailRequestId) return;
      if (error.status === 401) {
        expireSession();
        return;
      }
      if (!modalRoot.querySelector('[role="dialog"]')) return;
      showModal(
        `<div class="dialog-header"><div><h2 id="dialog-title">تعذّر تحميل الموعد</h2><p>${escapeHtml(apiMessage(error))}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></div><div class="dialog-body"><button class="btn btn-secondary" type="button" data-action="retry-detail" data-id="${escapeHtml(id)}">إعادة المحاولة</button></div>`,
      );
    }
  }

  function renderAppointmentDetail(a) {
    const terminal = ['CANCELLED', 'CANCELED', 'COMPLETED', 'NO_SHOW'].includes(a.status);
    const details = [
      ['المريض', patientLabel(a)],
      [
        'الممارس',
        authorizedLabel(
          state.doctors,
          a.doctorId,
          PERMISSIONS.doctorsRead,
          'بيانات الممارس غير متاحة',
        ),
      ],
      [
        'المنشأة',
        authorizedLabel(
          state.facilities,
          a.facilityId,
          PERMISSIONS.facilitiesRead,
          'بيانات المنشأة غير متاحة',
        ),
      ],
      [
        'الفرع',
        authorizedLabel(
          state.branches,
          a.branchId,
          PERMISSIONS.branchesRead,
          'بيانات الفرع غير متاحة',
        ),
      ],
      [
        'الخدمة',
        authorizedLabel(
          state.services,
          a.serviceId,
          PERMISSIONS.servicesRead,
          'بيانات الخدمة غير متاحة',
        ),
      ],
      ['الحالة', statusLabel(a.status)],
      ['البداية', formatTime(a.startsAt, a.facilityId)],
      ['النهاية', formatTime(a.endsAt, a.facilityId)],
      ['أُنشئ في', formatTime(a.createdAt, a.facilityId)],
      ['آخر تحديث', formatTime(a.updatedAt, a.facilityId)],
      ...(a.cancelledAt ? [['أُلغي في', formatTime(a.cancelledAt, a.facilityId)]] : []),
      ['سبب الموعد', a.reason || '—'],
      ['معرّف الموعد', a.id],
    ];
    const controls = [
      permission(PERMISSIONS.update) && !terminal
        ? `<button class="btn btn-secondary btn-small" type="button" data-action="edit-appointment">تعديل التفاصيل</button>`
        : '',
      permission(PERMISSIONS.reschedule) && !terminal
        ? `<button class="btn btn-secondary btn-small" type="button" data-action="reschedule-appointment">إعادة جدولة</button>`
        : '',
      permission(PERMISSIONS.cancel) && !terminal
        ? `<button class="btn btn-danger btn-small" type="button" data-action="confirm-cancel">إلغاء الموعد</button>`
        : '',
    ]
      .filter(Boolean)
      .join('');
    showModal(`<div class="dialog-header"><div><h2 id="dialog-title">تفاصيل الموعد</h2><p>${escapeHtml(a.id || '')} · ${escapeHtml(statusLabel(a.status))}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></div>
      <div class="dialog-body"><div class="detail-grid">${details.map(([label, value]) => `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
        <p class="form-note" style="margin:12px 0 0">${escapeHtml(timeZoneLabel(a.facilityId))}. الحالة والتغييرات تُحسم بواسطة الخدمة.</p>
        ${controls ? `<div class="detail-actions">${controls}</div>` : '<p class="form-note" style="margin-top:15px">لا توجد إجراءات متاحة على هذا الموعد ضمن صلاحياتك أو حالته الحالية.</p>'}
      </div>`);
    const dialog = modalRoot.querySelector('[role="dialog"]');
    dialog.dataset.appointment = JSON.stringify(a);
  }

  function openCancelConfirm(appointment) {
    showModal(`<div class="dialog-header"><div><h2 id="dialog-title">تأكيد إلغاء الموعد</h2><p>هذا الإجراء نهائي ولا يمكن التراجع عنه من هذه الشاشة.</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></div>
      <div class="dialog-body"><div class="notice">سيتم إرسال طلب الإلغاء للخدمة، وقد ترفضه قواعد الحالة أو نطاق الوصول. لن يتغير الموعد حتى تؤكد الخدمة نجاح الطلب.</div><div id="cancel-error" class="inline-message" style="margin-top:14px" hidden></div><div class="dialog-footer dialog-footer-end"><button class="btn btn-quiet" type="button" data-action="close-modal">العودة</button><button class="btn btn-danger" type="button" data-action="cancel-confirmed" data-id="${escapeHtml(appointment.id)}">تأكيد الإلغاء</button></div></div>`);
  }

  function randomIdempotencyKey() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `appt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function setFormError(id, error) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = typeof error === 'string' ? error : apiMessage(error);
    node.hidden = false;
  }

  async function submitAppointment(form) {
    const kind = form.dataset.kind;
    const epoch = state.workspaceEpoch;
    const tenantId = state.workspace.tenantId;
    const data = new FormData(form);
    const errorNode = document.getElementById('appointment-form-error');
    if (errorNode) errorNode.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      let result;
      if (kind === 'create') {
        if (!form.dataset.idempotency) form.dataset.idempotency = randomIdempotencyKey();
        const patientId = String(data.get('patientId') || '');
        if (!patientId) throw new Error('ابحث عن مريض واختره قبل إنشاء الموعد.');
        const facilityId = String(data.get('facilityId') || '');
        const zone = await ensureFacilityTimeZone(facilityId, true);
        const inputTimeZone = zone.timeZone || browserZone;
        if (!inputTimeZone) throw new Error('لا توجد منطقة زمنية صالحة للمنشأة أو الجهاز.');
        const input = {
          patientId,
          doctorId: String(data.get('doctorId') || ''),
          facilityId,
          startsAt: toIso(data.get('startsAt'), facilityId),
          endsAt: toIso(data.get('endsAt'), facilityId),
          reason: String(data.get('reason') || '').trim() || null,
        };
        if (data.get('branchId')) input.branchId = String(data.get('branchId'));
        if (data.get('serviceId')) input.serviceId = String(data.get('serviceId'));
        if (!input.startsAt || !input.endsAt) throw new Error('أدخل وقت بداية ونهاية صالحين.');
        if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
          throw new Error('يجب أن يكون وقت النهاية بعد وقت البداية.');
        }
        result = await api.createAppointment(tenantId, input, form.dataset.idempotency);
      } else if (kind === 'edit') {
        const appointment = JSON.parse(
          modalRoot.querySelector('[role="dialog"]').dataset.appointment,
        );
        result = await api.updateAppointment(tenantId, appointment.id, {
          reason: String(data.get('reason') || '').trim() || null,
        });
      } else {
        const appointment = JSON.parse(
          modalRoot.querySelector('[role="dialog"]').dataset.appointment,
        );
        const zone = await ensureFacilityTimeZone(appointment.facilityId, true);
        if (!zone.timeZone && !browserZone)
          throw new Error('لا توجد منطقة زمنية صالحة للمنشأة أو الجهاز.');
        const startsAt = toIso(data.get('startsAt'), appointment.facilityId);
        const endsAt = toIso(data.get('endsAt'), appointment.facilityId);
        if (!startsAt || !endsAt) throw new Error('أدخل وقت بداية ونهاية صالحين.');
        if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
          throw new Error('يجب أن يكون وقت النهاية بعد وقت البداية.');
        }
        result = await api.rescheduleAppointment(tenantId, appointment.id, { startsAt, endsAt });
      }
      if (epoch !== state.workspaceEpoch) return;
      closeModal();
      toast(
        kind === 'create'
          ? 'تم إرسال إنشاء الموعد وتأكيده من الخدمة.'
          : kind === 'edit'
            ? 'حُفظ تحديث الموعد.'
            : 'تم تأكيد إعادة الجدولة من الخدمة.',
      );
      await loadAppointments();
      if (kind !== 'create' && result && result.id) await openAppointment(result.id);
    } catch (error) {
      if (epoch !== state.workspaceEpoch) return;
      if (error.status === 401) {
        expireSession();
        return;
      }
      if (submit) submit.disabled = false;
      setFormError('appointment-form-error', error);
    }
  }

  async function cancelAppointment(id) {
    const epoch = state.workspaceEpoch;
    const tenantId = state.workspace.tenantId;
    const button = modalRoot.querySelector('[data-action="cancel-confirmed"]');
    if (button) button.disabled = true;
    try {
      await api.cancelAppointment(tenantId, id);
      if (epoch !== state.workspaceEpoch) return;
      closeModal();
      toast('تم تأكيد إلغاء الموعد من الخدمة.');
      await loadAppointments();
    } catch (error) {
      if (epoch !== state.workspaceEpoch) return;
      if (error.status === 401) {
        expireSession();
        return;
      }
      if (button) button.disabled = false;
      setFormError('cancel-error', error);
    }
  }

  function parsePolicyPayload(form) {
    const data = new FormData(form);
    let rules;
    try {
      rules = JSON.parse(String(data.get('rules') || ''));
    } catch (error) {
      throw new Error('صيغة JSON للقواعد غير صالحة.');
    }
    if (!rules || typeof rules !== 'object' || Array.isArray(rules))
      throw new Error('يجب إدخال كائن قواعد بصيغة JSON.');
    const input = {
      timeZone: String(data.get('timeZone') || '').trim(),
      rules,
    };
    if (!input.timeZone) throw new Error('أدخل المنطقة الزمنية المعتمدة للمنشأة.');
    if (state.policy && Number.isInteger(state.policy.version))
      input.expectedVersion = state.policy.version;
    return input;
  }

  async function savePolicy(form) {
    const epoch = state.workspaceEpoch;
    const tenantId = state.workspace.tenantId;
    const button = form.querySelector('[type="submit"]');
    const errorNode = document.getElementById('policy-form-error');
    if (errorNode) errorNode.hidden = true;
    if (button) button.disabled = true;
    try {
      const input = parsePolicyPayload(form);
      const result = await api.saveSchedulingPolicy(tenantId, state.policyFacilityId, input);
      if (epoch !== state.workspaceEpoch) return;
      state.policy = result;
      toast('حُفظت السياسة وفق تأكيد الخدمة.');
      await loadPolicy(state.policyFacilityId);
    } catch (error) {
      if (epoch !== state.workspaceEpoch) return;
      if (error.status === 401) {
        expireSession();
        return;
      }
      if (button) button.disabled = false;
      setFormError('policy-form-error', error);
    }
  }

  async function setPolicyStatus(action) {
    if (!state.policy || !Number.isInteger(state.policy.version)) return;
    const epoch = state.workspaceEpoch;
    const tenantId = state.workspace.tenantId;
    const facilityId = state.policyFacilityId;
    const expectedVersion = state.policy.version;
    try {
      if (action === 'activate')
        await api.activateSchedulingPolicy(tenantId, facilityId, expectedVersion);
      else await api.deactivateSchedulingPolicy(tenantId, facilityId, expectedVersion);
      if (epoch !== state.workspaceEpoch) return;
      toast(action === 'activate' ? 'أكدت الخدمة تفعيل السياسة.' : 'أكدت الخدمة إيقاف السياسة.');
      await loadPolicy(facilityId);
    } catch (error) {
      if (epoch !== state.workspaceEpoch) return;
      if (error.status === 401) {
        expireSession();
        return;
      }
      toast(apiMessage(error), true);
    }
  }

  async function logout() {
    closeModal();
    try {
      await api.logout();
    } catch (_) {
      /* session is cleared by the client */
    }
    clearTenantData();
    state.workspace = null;
    state.workspaces = [];
    state.screen = 'signin';
    render();
  }

  async function switchWorkspace() {
    clearTenantData();
    state.workspace = null;
    state.view = 'appointments';
    await loadWorkspaces();
  }

  const handleSubmit = async (event) => {
    const form = event.target;
    if (form.id === 'signin-form') {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const errorNode = document.getElementById('signin-error');
      if (errorNode) errorNode.hidden = true;
      if (button) {
        button.disabled = true;
        button.textContent = 'جارٍ تسجيل الدخول…';
      }
      const data = new FormData(form);
      try {
        await api.login(String(data.get('email') || '').trim(), String(data.get('password') || ''));
        state.workspace = null;
        state.workspaces = [];
        await loadWorkspaces();
      } catch (error) {
        setFormError('signin-error', error);
        if (button) {
          button.disabled = false;
          button.textContent = 'دخول إلى مساحة العمل';
        }
      }
    } else if (form.id === 'filter-form') {
      event.preventDefault();
      const data = new FormData(form);
      const from = String(data.get('from') || '');
      const to = String(data.get('to') || '');
      const facilityId = String(data.get('facilityId') || '');
      if (from && to && from > to) {
        toast('يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساويًا له.', true);
        return;
      }
      if ((from || to) && !facilityId) {
        toast('اختر منشأة قبل تطبيق مرشح التاريخ حتى يُستخدم توقيتها الصحيح.', true);
        return;
      }
      state.filters = {
        search: String(data.get('search') || '').trim(),
        from,
        to,
        status: String(data.get('status') || ''),
        facilityId,
        doctorId: String(data.get('doctorId') || ''),
        branchId: String(data.get('branchId') || ''),
        serviceId: String(data.get('serviceId') || ''),
      };
      state.offset = 0;
      await loadAppointments();
    } else if (form.id === 'appointment-form') {
      event.preventDefault();
      await submitAppointment(form);
    } else if (form.id === 'policy-form') {
      event.preventDefault();
      await savePolicy(form);
    }
  };
  app.addEventListener('submit', handleSubmit);
  modalRoot.addEventListener('submit', handleSubmit);
  modalRoot.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'patient-search') {
      searchPatients(event.target);
    }
  });

  const handleClick = async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'choose-workspace')
      await chooseWorkspace(state.workspaces[Number(button.dataset.index)]);
    else if (action === 'logout') await logout();
    else if (action === 'switch-workspace') await switchWorkspace();
    else if (action === 'retry-boot') await boot();
    else if (action === 'retry-workspaces') await loadWorkspaces();
    else if (action === 'view-appointments') await changeView('appointments');
    else if (action === 'view-policy') await changeView('policy');
    else if (action === 'retry-appointments') await loadAppointments();
    else if (action === 'clear-filters') {
      state.filters = {
        search: '',
        from: '',
        to: '',
        status: '',
        facilityId: '',
        doctorId: '',
        branchId: '',
        serviceId: '',
      };
      state.branches = [];
      state.offset = 0;
      await loadAppointments();
    } else if (action === 'page-prev') {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      await loadAppointments();
    } else if (action === 'page-next') {
      if (state.hasNext) {
        state.offset += PAGE_SIZE;
        await loadAppointments();
      }
    } else if (action === 'new-appointment') {
      if (!permission(PERMISSIONS.create)) return;
      showModal(appointmentFormMarkup('create'), '#patientId');
      const form = modalRoot.querySelector('#appointment-form');
      form.dataset.idempotency = randomIdempotencyKey();
    } else if (action === 'reload-create-references') {
      if (!permission(PERMISSIONS.create)) return;
      const epoch = state.workspaceEpoch;
      state.resourceErrors = {};
      closeModal();
      await loadReferences();
      if (epoch !== state.workspaceEpoch || !hasWorkspace()) return;
      showModal(appointmentFormMarkup('create'), '#patientId');
      const form = modalRoot.querySelector('#appointment-form');
      form.dataset.idempotency = randomIdempotencyKey();
    } else if (action === 'open-appointment') await openAppointment(button.dataset.id);
    else if (action === 'retry-detail') await openAppointment(button.dataset.id);
    else if (action === 'close-modal') closeModal();
    else if (
      action === 'edit-appointment' ||
      action === 'reschedule-appointment' ||
      action === 'confirm-cancel'
    ) {
      const dialog = modalRoot.querySelector('[role="dialog"]');
      if (!dialog) return;
      const appointment = JSON.parse(dialog.dataset.appointment || '{}');
      if (action === 'edit-appointment' && permission(PERMISSIONS.update)) {
        showModal(appointmentFormMarkup('edit', appointment));
        modalRoot.querySelector('[role="dialog"]').dataset.appointment =
          JSON.stringify(appointment);
      }
      if (action === 'reschedule-appointment' && permission(PERMISSIONS.reschedule)) {
        try {
          await ensureFacilityTimeZone(appointment.facilityId, true);
        } catch (error) {
          if (error.status === 401) {
            expireSession();
            return;
          }
          toast(apiMessage(error), true);
          return;
        }
        showModal(appointmentFormMarkup('reschedule', appointment));
        modalRoot.querySelector('[role="dialog"]').dataset.appointment =
          JSON.stringify(appointment);
      }
      if (action === 'confirm-cancel' && permission(PERMISSIONS.cancel))
        openCancelConfirm(appointment);
    } else if (action === 'cancel-confirmed') await cancelAppointment(button.dataset.id);
    else if (action === 'reload-policy') {
      if (state.policyFacilityId) await loadPolicy(state.policyFacilityId);
      else await loadPolicyFacilities();
    } else if (action === 'reload-facilities') {
      state.resourceErrors.facilities = null;
      const epoch = state.workspaceEpoch;
      try {
        const facilities = await readOptions('listFacilities', state.workspace.tenantId, {
          limit: 100,
          offset: 0,
        });
        if (epoch !== state.workspaceEpoch) return;
        state.facilities = facilities;
        state.policyFacilityId = state.facilities.length ? String(state.facilities[0].id) : '';
        await loadPolicyFacilities();
      } catch (error) {
        if (epoch !== state.workspaceEpoch) return;
        if (error.status === 401) {
          expireSession();
          return;
        }
        state.resourceErrors.facilities = error;
        render();
      }
    } else if (action === 'toggle-policy-editor') {
      const wrap = document.getElementById('policy-editor-wrap');
      if (wrap) {
        wrap.hidden = !wrap.hidden;
        if (!wrap.hidden) wrap.querySelector('input')?.focus();
      }
    } else if (action === 'activate-policy') await setPolicyStatus('activate');
    else if (action === 'deactivate-policy') await setPolicyStatus('deactivate');
    else if (action === 'reload-history') await loadPolicy(state.policyFacilityId);
  };
  app.addEventListener('click', handleClick);
  modalRoot.addEventListener('click', handleClick);

  const handleChange = async (event) => {
    const target = event.target;
    if (target.id === 'policy-facility' && target.value) await loadPolicy(target.value);
    if (target.id === 'filter-facility') {
      const facilityId = target.value;
      state.filters.facilityId = facilityId;
      state.filters.branchId = '';
      const dateNote = app.querySelector('#filter-timezone-note');
      if (!facilityId) {
        state.filters.from = '';
        state.filters.to = '';
        const fromInput = app.querySelector('#filter-from');
        const toInput = app.querySelector('#filter-to');
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
        if (dateNote) dateNote.textContent = 'اختر منشأة لتفسير التاريخ حسب منطقتها الزمنية.';
      } else {
        if (dateNote) dateNote.textContent = 'جارٍ التحقق من المنطقة الزمنية للمنشأة…';
        try {
          await ensureFacilityTimeZone(facilityId);
          if (dateNote) dateNote.textContent = timeZoneLabel(facilityId);
        } catch (error) {
          if (error.status === 401) {
            expireSession();
            return;
          }
          state.timeZoneError = error;
          if (dateNote) dateNote.textContent = 'تعذّر التحقق من المنطقة الزمنية؛ لا تطبق مرشح التاريخ الآن.';
        }
      }
    }
    if (target.id === 'filter-facility' && permission(PERMISSIONS.branchesRead)) {
      const branch = app.querySelector('#filter-branch');
      if (!branch) return;
      const facilityId = target.value;
      const epoch = state.workspaceEpoch;
      const requestId = ++state.filterBranchRequestId;
      branch.innerHTML = `<option value="">${facilityId ? 'جارٍ تحميل الفروع…' : 'اختر منشأة أولًا'}</option>`;
      branch.disabled = true;
      state.branches = [];
      if (!facilityId) return;
      try {
        const branches = await readOptions('listBranches', state.workspace.tenantId, facilityId, {
          limit: 100,
          offset: 0,
        });
        if (
          epoch !== state.workspaceEpoch ||
          requestId !== state.filterBranchRequestId ||
          target.value !== facilityId
        )
          return;
        state.branches = branches;
        branch.innerHTML = `<option value="">${branches.length ? 'كل الفروع' : 'لا توجد فروع متاحة'}</option>${branches.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(humanName(item))}</option>`).join('')}`;
        branch.disabled = !branches.length;
      } catch (error) {
        if (epoch !== state.workspaceEpoch || requestId !== state.filterBranchRequestId) return;
        if (error.status === 401) {
          expireSession();
          return;
        }
        branch.innerHTML = '<option value="">تعذّر تحميل الفروع</option>';
        branch.disabled = true;
        toast(apiMessage(error), true);
      }
    }
    if (target.id === 'facilityId' && target.closest('#appointment-form')) {
      const facilityId = target.value;
      const note = document.getElementById('appointment-timezone-note');
      if (!facilityId) {
        if (note)
          note.textContent = browserZone
            ? `اختر المنشأة لتحميل منطقتها الزمنية. عند غياب سياسة نشطة، سيُستخدم توقيت الجهاز ${browserZone}.`
            : 'لا توجد منطقة زمنية صالحة للمنشأة أو الجهاز.';
      } else {
        if (note) note.textContent = 'جارٍ التحقق من المنطقة الزمنية للمنشأة…';
        try {
          await ensureFacilityTimeZone(facilityId);
          if (note) note.textContent = timeZoneLabel(facilityId);
        } catch (error) {
          if (error.status === 401) {
            expireSession();
            return;
          }
          state.timeZoneError = error;
          if (note) note.textContent = 'تعذّر التحقق من المنطقة الزمنية لهذه المنشأة.';
        }
      }
    }
    if (target.id === 'facilityId' && target.closest('#appointment-form')) {
      const form = target.closest('#appointment-form');
      const branch = form.querySelector('[name="branchId"]');
      if (!branch || !permission(PERMISSIONS.branchesRead)) return;
      const facilityId = target.value;
      const epoch = state.workspaceEpoch;
      const requestId = ++state.createBranchRequestId;
      if (!facilityId) {
        branch.innerHTML = '<option value="">بدون تحديد</option>';
        branch.disabled = false;
        return;
      }
      branch.innerHTML = '<option value="">جارٍ تحميل الفروع…</option>';
      branch.disabled = true;
      try {
        const branches = await readOptions('listBranches', state.workspace.tenantId, facilityId, {
          limit: 100,
          offset: 0,
        });
        if (
          epoch !== state.workspaceEpoch ||
          requestId !== state.createBranchRequestId ||
          !form.isConnected ||
          form.querySelector('[name="facilityId"]').value !== facilityId
        )
          return;
        branch.innerHTML = `<option value="">بدون تحديد</option>${branches.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(humanName(item))}</option>`).join('')}`;
        branch.disabled = false;
      } catch (error) {
        if (epoch !== state.workspaceEpoch || requestId !== state.createBranchRequestId) return;
        if (error.status === 401) {
          expireSession();
          return;
        }
        branch.innerHTML = '<option value="">تعذّر تحميل الفروع</option>';
        branch.disabled = true;
        toast(apiMessage(error), true);
      }
    }
  };
  app.addEventListener('change', handleChange);
  modalRoot.addEventListener('change', handleChange);

  modalRoot.addEventListener('click', (event) => {
    if (event.target.matches('[data-overlay="true"]')) closeModal();
  });

  function renderFatal(message) {
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brandMarkup()}<h1>تعذّر بدء مساحة العمل</h1><p class="auth-intro">${escapeHtml(message)}</p></div></section>`;
  }

  boot();
})();
