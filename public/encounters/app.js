(function startEncounterWorkspace() {
  'use strict';

  const app = document.getElementById('encounter-app');
  const toast = document.getElementById('encounter-toast');
  const api = window.ThanarahApi;
  const PERMISSIONS = Object.freeze({
    encounterCreate: 'tenant.encounters.create',
    directCreate: 'tenant.encounters.create.direct',
    encounterRead: 'tenant.encounters.read',
    patientHistoryRead: 'tenant.encounters.patient-history.read',
    clinicalWrite: 'tenant.encounters.clinical.write',
    diagnosesRead: 'tenant.encounters.diagnoses.read',
    diagnosesWrite: 'tenant.encounters.diagnoses.write',
    servicesRead: 'tenant.encounters.services.read',
    servicesWrite: 'tenant.encounters.services.write',
    amendmentsCreate: 'tenant.encounters.amendments.create',
    amendmentsUpdate: 'tenant.encounters.amendments.update',
    amendmentsFinalize: 'tenant.encounters.amendments.finalize',
    serviceCatalogRead: 'tenant.services.read',
    encounterComplete: 'tenant.encounters.complete',
    encounterCancel: 'tenant.encounters.cancel',
    historyRead: 'tenant.encounters.history.read',
    appointmentsRead: 'tenant.appointments.read',
    patientsRead: 'tenant.patients.read',
    doctorsRead: 'tenant.doctors.read',
    facilitiesRead: 'tenant.facilities.read',
    branchesRead: 'tenant.branches.read',
  });
  const CLINICAL_TEXT_FIELDS = [
    ['reason', 'سبب الزيارة', false],
    ['chiefComplaint', 'الشكوى الرئيسية', true],
    ['historyOfPresentIllness', 'تاريخ الحالة الحالية', true],
    ['examinationFindings', 'نتائج الفحص السريري', true],
    ['assessment', 'التقييم والانطباع السريري', true],
    ['plan', 'الخطة السريرية', true],
    ['followUp', 'توصيات المتابعة', true],
    ['internalNotes', 'ملاحظات سريرية داخلية', true],
  ];
  const FACT_FIELDS = [
    ['medicalHistory', 'التاريخ الطبي ذات الصلة'],
    ['allergies', 'الحساسية'],
    ['medicationHistory', 'تاريخ الأدوية الموثق'],
    ['reviewOfSystems', 'مراجعة الأجهزة'],
  ];
  const VITAL_FIELDS = [
    ['systolicBloodPressure', 'ضغط الدم الانقباضي', 'mmHg'],
    ['diastolicBloodPressure', 'ضغط الدم الانبساطي', 'mmHg'],
    ['heartRate', 'معدل النبض', 'bpm'],
    ['respiratoryRate', 'معدل التنفس', 'breaths/min'],
    ['temperature', 'درجة الحرارة', 'temperature'],
    ['oxygenSaturation', 'تشبع الأكسجين', '%'],
    ['height', 'الطول', 'cm'],
    ['weight', 'الوزن', 'kg'],
  ];

  const state = {
    screen: 'boot',
    workspace: null,
    workspaces: [],
    view: 'worklist',
    resourceErrors: {},
    facilities: [],
    branches: [],
    doctors: [],
    services: [],
    patients: [],
    appointments: [],
    list: [],
    listMeta: { total: 0, limit: 50, offset: 0, hasNext: false },
    listError: null,
    loadingList: false,
    listRequestId: 0,
    appointmentError: null,
    patientHistory: null,
    patientHistoryError: null,
    patientHistoryOffset: 0,
    detail: null,
    diagnosisDraft: null,
    serviceDraft: null,
    detailError: null,
    pendingMutationReview: null,
    detailLoading: false,
    history: null,
    historyError: null,
    filter: {
      date: localDateString(new Date()),
      search: '',
      facilityId: '',
      patientId: '',
      doctorId: '',
      branchId: '',
      status: '',
      offset: 0,
    },
    filterDateSetByUser: false,
    appointmentDate: localDateString(new Date()),
    appointmentDateSetByUser: false,
    appointmentBranchId: '',
    timezone: null,
    appointmentTimezone: null,
    detailTimezone: null,
    appointmentFacilityId: '',
    directFacilityId: '',
    directBranchId: '',
    selectedAppointmentId: '',
    selectedPatientId: '',
    directCreateKey: '',
    pendingDirectDraft: null,
    appointmentCreateKey: '',
    saving: false,
    pendingDraft: null,
    conflict: false,
    busy: false,
    screenError: null,
  };

  if (!app || !api) return;

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  void bootstrap();

  async function bootstrap() {
    try {
      const restored = await api.restoreSession();
      if (!restored) {
        state.screen = 'signin';
        render();
        return;
      }
      await loadWorkspaces();
    } catch (error) {
      if (error && error.status === 401) {
        state.screen = 'signin';
      } else {
        state.screen = 'screen-error';
        state.screenError = safeMessage(error);
      }
      render();
    }
  }

  async function loadWorkspaces() {
    state.screen = 'workspace-loading';
    render();
    try {
      const response = await api.listWorkspaces();
      state.workspaces = itemsOf(response);
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
      state.screen = error && error.status === 401 ? 'signin' : 'screen-error';
      state.screenError = safeMessage(error);
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
    state.workspace = workspace;
    state.resourceErrors = {};
    state.screen = 'workspace';
    state.view = can(PERMISSIONS.encounterRead)
      ? 'worklist'
      : can(PERMISSIONS.patientHistoryRead)
        ? 'patient-history'
        : can(PERMISSIONS.encounterCreate) &&
            (can(PERMISSIONS.directCreate) || can(PERMISSIONS.appointmentsRead))
          ? 'create'
          : 'no-access';
    render();
    await loadReferences();
    if (state.view === 'worklist') await loadEncounters();
  }

  async function loadReferences() {
    const tenantId = state.workspace.tenantId;
    const jobs = [];
    const load = (allowed, key, request) => {
      if (!allowed) return;
      jobs.push(
        request
          .then((response) => {
            state[key] = itemsOf(response);
          })
          .catch((error) => {
            state.resourceErrors[key] = error;
          }),
      );
    };
    load(
      can(PERMISSIONS.facilitiesRead),
      'facilities',
      api.listFacilities(tenantId, {
        limit: 100,
        offset: 0,
      }),
    );
    load(
      can(PERMISSIONS.doctorsRead),
      'doctors',
      api.listDoctors(tenantId, {
        limit: 100,
        offset: 0,
      }),
    );
    load(
      can(PERMISSIONS.patientsRead),
      'patients',
      api.listPatients(tenantId, {
        limit: 100,
        offset: 0,
      }),
    );
    load(
      can(PERMISSIONS.servicesWrite) && can(PERMISSIONS.serviceCatalogRead),
      'services',
      api.listServices(tenantId, { limit: 100, offset: 0 }),
    );
    await Promise.all(jobs);
    if (Object.values(state.resourceErrors).some((error) => error && error.status === 401)) {
      expireSession();
      return;
    }
    if (!state.filter.facilityId && state.facilities.length === 1) {
      state.filter.facilityId = state.facilities[0].id;
    }
    if (!state.appointmentFacilityId && state.facilities.length === 1) {
      state.appointmentFacilityId = state.facilities[0].id;
    }
    if (!state.directFacilityId && state.facilities.length === 1) {
      state.directFacilityId = state.facilities[0].id;
    }
    if (state.directFacilityId && can(PERMISSIONS.branchesRead)) {
      await loadBranches(state.directFacilityId);
    }
    render();
  }

  function can(permissionCode) {
    return !!(
      state.workspace &&
      Array.isArray(state.workspace.permissionCodes) &&
      state.workspace.permissionCodes.includes(permissionCode)
    );
  }

  function clearTenantData() {
    state.workspace = null;
    state.view = 'worklist';
    state.resourceErrors = {};
    state.facilities = [];
    state.branches = [];
    state.doctors = [];
    state.services = [];
    state.patients = [];
    state.appointments = [];
    state.list = [];
    state.listMeta = { total: 0, limit: 50, offset: 0, hasNext: false };
    state.listError = null;
    state.loadingList = false;
    state.appointmentError = null;
    state.patientHistory = null;
    state.patientHistoryError = null;
    state.patientHistoryOffset = 0;
    state.detail = null;
    state.diagnosisDraft = null;
    state.serviceDraft = null;
    state.detailError = null;
    state.detailLoading = false;
    state.history = null;
    state.historyError = null;
    state.filter = {
      date: localDateString(new Date()),
      search: '',
      facilityId: '',
      patientId: '',
      doctorId: '',
      branchId: '',
      status: '',
      offset: 0,
    };
    state.filterDateSetByUser = false;
    state.appointmentDate = localDateString(new Date());
    state.appointmentDateSetByUser = false;
    state.timezone = null;
    state.appointmentTimezone = null;
    state.detailTimezone = null;
    state.appointmentFacilityId = '';
    state.appointmentBranchId = '';
    state.directFacilityId = '';
    state.directBranchId = '';
    state.selectedAppointmentId = '';
    state.selectedPatientId = '';
    state.saving = false;
    state.pendingDraft = null;
    state.conflict = false;
    state.busy = false;
    state.screenError = null;
  }

  function expireSession() {
    clearTenantData();
    state.workspaces = [];
    state.screen = 'signin';
    state.screenError = 'انتهت جلسة الدخول. سجّل الدخول مجددًا.';
    render();
  }

  function handleUnauthorized(error) {
    if (!error || error.status !== 401) return false;
    expireSession();
    return true;
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'workspace-loading' || state.screen === 'boot') {
      app.innerHTML = screenCard(
        'جارٍ تحميل مساحة العمل',
        'نتحقق من جلسة الدخول وصلاحيات المساحة.',
        true,
      );
      return;
    }
    if (state.screen === 'workspace-select') return renderWorkspaceSelect();
    if (state.screen === 'no-workspaces') {
      app.innerHTML = screenCard('لا توجد مساحة متاحة', 'لا توجد مساحة عمل مرتبطة بحسابك حاليًا.');
      return;
    }
    if (state.screen === 'screen-error') {
      app.innerHTML = screenCard(
        'تعذّر فتح مساحة العمل',
        state.screenError || 'حاول مرة أخرى.',
        false,
        true,
      );
      return;
    }
    if (state.screen !== 'workspace' || !state.workspace) {
      app.innerHTML = screenCard(
        'تعذّر فتح مساحة العمل',
        'أعد المحاولة بعد التحقق من الاتصال.',
        false,
        true,
      );
      return;
    }
    if (state.view === 'no-access') {
      app.innerHTML =
        shellStart() +
        `
        <section class="encounter-card">
          <h1>لا توجد صلاحية للسجلات الطبية</h1>
          <p>تحتاج إلى صلاحية سريرية محددة. صلاحية المواعيد وحدها لا تمنح الوصول إلى السجلات الطبية.</p>
          ${workspacePickerButton()}
        </section>
      </div>`;
      return;
    }
    app.innerHTML =
      shellStart() +
      (state.view === 'detail'
        ? renderDetail()
        : state.view === 'patient-history'
          ? renderPatientHistory()
          : state.view === 'create'
            ? renderCreateOnly()
            : renderWorklist()) +
      '</div>';
  }

  function renderSignIn() {
    app.innerHTML = `
      <section class="encounter-screen">
        <a class="encounter-brand" href="/appointments/" aria-label="ثناره — المواعيد">
          <img src="/assets/logo-transparent.png" alt="">
          <span><strong>ثناره</strong><small>THANARAH</small></span>
        </a>
        <h1 style="margin-top:22px">تسجيل الدخول إلى السجلات الطبية</h1>
        <p>استخدم حساب ثناره للوصول إلى مساحة العمل المصرح بها.</p>
        ${state.screenError ? notice(state.screenError, true) : ''}
        <form data-form="signin" class="encounter-form-grid" autocomplete="off">
          <div class="encounter-field full">
            <label for="signin-email">البريد الإلكتروني</label>
            <input id="signin-email" name="email" type="email" autocomplete="username" required>
          </div>
          <div class="encounter-field full">
            <label for="signin-password">كلمة المرور</label>
            <input id="signin-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <div class="encounter-field full">
            <button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}</button>
          </div>
        </form>
        <p class="form-note">تظل الجلسة محمية بالمصادقة الحالية. لا تحفظ هذه الصفحة بيانات سريرية على الجهاز.</p>
      </section>`;
  }

  function renderWorkspaceSelect() {
    app.innerHTML = `
      <section class="encounter-screen">
        <a class="encounter-brand" href="/appointments/">
          <img src="/assets/logo-transparent.png" alt="">
          <span><strong>ثناره</strong><small>THANARAH</small></span>
        </a>
        <h1 style="margin-top:22px">اختر مساحة العمل</h1>
        <p>تُعرض المساحات المرتبطة بعضويتك النشطة فقط.</p>
        <div class="encounter-list">${state.workspaces
          .map(
            (workspace, index) => `
              <div class="encounter-list-item">
                <span><strong>${escapeHtml(workspace.displayName || 'مساحة عمل')}</strong><small>${escapeHtml(workspace.slug || '')}</small></span>
                <button class="btn btn-primary" type="button" data-action="choose-workspace" data-index="${index}">اختيار</button>
              </div>`,
          )
          .join('')}</div>
        <button class="btn btn-quiet" type="button" data-action="logout">تسجيل الخروج</button>
      </section>`;
  }

  function shellStart() {
    return `
      <div class="encounter-shell">
        <header class="encounter-header">
          <a class="encounter-brand" href="/appointments/" aria-label="العودة إلى المواعيد">
            <img src="/assets/logo-transparent.png" alt="">
            <span><strong>ثناره</strong><small>THANARAH</small></span>
          </a>
          <div class="encounter-actions">
            <span class="encounter-workspace-name">${escapeHtml(state.workspace.displayName || 'مساحة العمل')}</span>
            <button class="btn btn-quiet btn-small" type="button" data-action="logout">تسجيل الخروج</button>
          </div>
        </header>
        <nav class="encounter-tabs" aria-label="التنقل في السجلات الطبية">
          ${can(PERMISSIONS.encounterRead) ? `<button class="encounter-tab" type="button" data-action="view-worklist" ${state.view === 'worklist' || state.view === 'detail' ? 'aria-current="page"' : ''}>قائمة اللقاءات</button>` : ''}
          ${can(PERMISSIONS.patientHistoryRead) ? `<button class="encounter-tab" type="button" data-action="view-patient-history" ${state.view === 'patient-history' ? 'aria-current="page"' : ''}>تاريخ المريض السريري</button>` : ''}
          ${can(PERMISSIONS.encounterCreate) && (can(PERMISSIONS.directCreate) || can(PERMISSIONS.appointmentsRead)) ? `<button class="encounter-tab" type="button" data-action="view-create" ${state.view === 'create' ? 'aria-current="page"' : ''}>إنشاء لقاء</button>` : ''}
        </nav>`;
  }

  function renderWorklist() {
    if (state.view === 'detail') return renderDetail();
    return `
      <section class="encounter-card">
        <div class="encounter-toolbar">
          <div>
            <span class="eyebrow">السجلات الطبية</span>
            <h1>قائمة اللقاءات</h1>
            <p>تُعرض ملخصات اللقاءات هنا؛ يتطلب فتح المحتوى السريري صلاحية قراءة مستقلة.</p>
          </div>
          <div class="encounter-actions">
            <button class="btn btn-quiet" type="button" data-action="previous-day" aria-label="اليوم السابق">اليوم السابق</button>
            <button class="btn btn-quiet" type="button" data-action="next-day" aria-label="اليوم التالي">اليوم التالي</button>
          </div>
        </div>
        ${state.listError ? notice(errorMessage(state.listError), true, 'retry-list') : ''}
        <form class="encounter-form-grid" data-form="filters">
          <div class="encounter-field">
            <label for="encounter-date">التاريخ حسب توقيت المنشأة</label>
            <input id="encounter-date" name="date" type="date" value="${escapeHtml(state.filter.date)}" required>
          </div>
          <div class="encounter-field">
            <label for="filter-search">معرّف اللقاء أو الموعد أو المريض أو المقدم</label>
            <input id="filter-search" name="search" value="${escapeHtml(state.filter.search)}" placeholder="UUID">
          </div>
          ${facilityFilter()}
          ${branchFilter()}
          ${can(PERMISSIONS.patientHistoryRead) ? `<div class="encounter-field"><label for="filter-patient">معرّف المريض</label><input id="filter-patient" name="patientId" inputmode="text" value="${escapeHtml(state.filter.patientId)}" placeholder="UUID"></div>` : ''}
          ${doctorFilter()}
          <div class="encounter-field">
            <label for="encounter-status">الحالة</label>
            <select id="encounter-status" name="status">
              <option value="">كل الحالات</option>
              ${statusOptions(state.filter.status)}
            </select>
          </div>
          <div class="encounter-field" style="align-self:end">
            <button class="btn btn-primary" type="submit" ${state.loadingList ? 'disabled' : ''}>${state.loadingList ? 'جارٍ البحث…' : 'بحث'}</button>
          </div>
        </form>
        ${state.timezone ? `<p class="form-note">الوقت المحلي المعتمد: ${escapeHtml(state.timezone)} وفق سياسة المنشأة النشطة.</p>` : `<p class="form-note">يتطلب البحث بالتاريخ سياسة جدولة نشطة للمنشأة. لا يُستخدم توقيت الجهاز بدلًا عنها.</p>`}
      </section>
      ${renderAppointmentCreation()}
      ${renderDirectCreation()}
      <section class="encounter-card">
        <div class="encounter-section-heading">
          <h2>النتائج</h2>
          <span class="encounter-workspace-name">${state.listMeta.total} لقاء</span>
        </div>
        ${state.loadingList && !state.list.length ? loadingBlock('جارٍ تحميل اللقاءات…') : ''}
        ${!state.loadingList && !state.list.length && !state.listError ? `<div class="encounter-empty"><h3>لا توجد لقاءات ضمن هذه المعايير</h3><p>غيّر التاريخ أو عوامل البحث أو أعد المحاولة لاحقًا.</p></div>` : ''}
        <div class="encounter-list">${state.list.map(renderEncounterSummary).join('')}</div>
        <div class="encounter-actions">
          <button class="btn btn-quiet" type="button" data-action="previous-page" ${state.filter.offset === 0 || state.loadingList ? 'disabled' : ''}>السابق</button>
          <button class="btn btn-quiet" type="button" data-action="next-page" ${!state.listMeta.hasNext || state.loadingList ? 'disabled' : ''}>التالي</button>
          <span class="form-note">صفحة من ${state.listMeta.offset + 1} إلى ${state.listMeta.offset + state.list.length}</span>
        </div>
      </section>`;
  }

  function renderAppointmentCreation() {
    if (!can(PERMISSIONS.encounterCreate) || !can(PERMISSIONS.appointmentsRead)) return '';
    const facilityId = state.appointmentFacilityId || state.filter.facilityId;
    const branchId = state.appointmentBranchId || state.filter.branchId;
    return `
      <section class="encounter-card">
        <div class="encounter-section-heading">
          <h2>بدء لقاء من موعد مجدول</h2>
        </div>
        <p>يتطلب هذا الإجراء صلاحية قراءة المواعيد وصلاحية إنشاء اللقاءات. لا تمنح صلاحية الموعد وحدها وصولًا سريريًا.</p>
        ${state.appointmentError ? notice(errorMessage(state.appointmentError), true, 'load-appointments') : ''}
        <div class="encounter-form-grid">
          ${facilitySelector('appointment-facility', 'appointmentFacilityId', facilityId)}
          ${branchField('appointment-branch', 'branchId', state.branches, branchId)}
          <p class="form-note wide">وقت العرض: ${escapeHtml(timeZoneLabel(state.appointmentTimezone))}</p>
          <div class="encounter-field">
            <label for="appointment-date">تاريخ المواعيد</label>
            <input id="appointment-date" name="appointmentDate" type="date" value="${escapeHtml(state.appointmentDate)}" required>
          </div>
          <div class="encounter-field" style="align-self:end">
            <button class="btn btn-quiet" type="button" data-action="load-appointments" ${state.busy ? 'disabled' : ''}>تحميل المواعيد</button>
          </div>
          <div class="encounter-field wide">
            <label for="eligible-appointment">موعد مجدول</label>
            <select id="eligible-appointment">
              <option value="">اختر موعدًا محمّلًا</option>
              ${state.appointments
                .map(
                  (appointment) => `
                <option value="${escapeHtml(appointment.id)}" ${state.selectedAppointmentId === appointment.id ? 'selected' : ''}>
                  ${escapeHtml(formatDateTime(appointment.startsAt, state.appointmentTimezone))} · ${escapeHtml(shortId(appointment.patientId))} · ${escapeHtml(shortId(appointment.id))}
                </option>`,
                )
                .join('')}
            </select>
          </div>
          <div class="encounter-field" style="align-self:end">
            <button class="btn btn-primary" type="button" data-action="create-from-appointment" ${!state.selectedAppointmentId || state.busy ? 'disabled' : ''}>إنشاء مسودة لقاء</button>
          </div>
        </div>
      </section>`;
  }

  function renderDirectCreation() {
    if (!can(PERMISSIONS.encounterCreate) || !can(PERMISSIONS.directCreate)) return '';
    const draft = state.pendingDirectDraft || {};
    return `
      <section class="encounter-card">
        <div class="encounter-section-heading"><h2>إنشاء لقاء مباشر</h2></div>
        <p>إنشاء مسودة دون موعد. لا تُنسخ البيانات الديموغرافية إلى السجل السريري، ويجب أن تكون المراجع نشطة ضمن المنشأة.</p>
        ${state.screenError ? notice(state.screenError, true) : ''}
        ${
          state.resourceErrors.facilities ||
          state.resourceErrors.doctors ||
          state.resourceErrors.patients
            ? notice('تعذّر تحميل بعض القوائم. يمكن استخدام معرّفات UUID إذا كانت معروفة.', true)
            : ''
        }
        <form class="encounter-form-grid" data-form="direct-create" autocomplete="off">
          ${patientField('direct-patient', 'patientId', draft.patientId || '')}
          ${doctorField('direct-doctor', 'doctorId', draft.doctorId || '')}
          ${facilitySelector('direct-facility', 'facilityId', draft.facilityId || state.directFacilityId || state.filter.facilityId)}
          ${branchField('direct-branch', 'branchId', state.branches, draft.branchId || state.directBranchId)}
          <div class="encounter-field" style="align-self:end">
            <button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>إنشاء مسودة</button>
          </div>
        </form>
      </section>`;
  }

  function renderCreateOnly() {
    return `
      <section class="encounter-card">
        <span class="eyebrow">السجلات الطبية</span>
        <h1>إنشاء لقاء سريري</h1>
        ${renderDirectCreation()}
        ${renderAppointmentCreation()}
      </section>`;
  }

  function renderPatientHistory() {
    return `
      <section class="encounter-card">
        <span class="eyebrow">تاريخ المريض السريري</span>
        <h1>سجل اللقاءات حسب المريض</h1>
        <p>يُعرض التاريخ السريري فقط لمن لديه صلاحية مخصصة. أدخل معرّف المريض أو اختر مريضًا من الدليل إذا كانت صلاحية قراءة المرضى متاحة.</p>
        <form data-form="patient-history" class="encounter-form-grid" autocomplete="off">
          ${patientField('history-patient', 'patientId', state.selectedPatientId)}
          <div class="encounter-field" style="align-self:end">
            <button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>عرض التاريخ</button>
          </div>
        </form>
        <p class="form-note">أوقات هذه الصفحة بتوقيت الجهاز: ${escapeHtml(deviceTimeZone())}. هذا للتنسيق البصري فقط ولا يغيّر نطاقات التاريخ في واجهة اللقاءات.</p>
        ${state.patientHistoryError ? notice(errorMessage(state.patientHistoryError), true, 'retry-patient-history') : ''}
      </section>
      <section class="encounter-card">
        <h2>اللقاءات الموثقة</h2>
        ${state.busy ? loadingBlock('جارٍ تحميل التاريخ السريري…') : ''}
        ${
          state.patientHistory === null && !state.patientHistoryError
            ? `<div class="encounter-empty"><p>اختر مريضًا لعرض سجله السريري.</p></div>`
            : ''
        }
        ${
          state.patientHistory && !state.patientHistory.items.length
            ? `<div class="encounter-empty"><p>لا توجد لقاءات موثقة لهذا المريض ضمن النطاق المصرح به.</p></div>`
            : ''
        }
        <div class="encounter-list">${(state.patientHistory?.items || []).map(renderPatientHistoryItem).join('')}</div>
        ${state.patientHistory ? `<p class="form-note">إجمالي النتائج: ${state.patientHistory.total}</p>` : ''}
        ${
          state.patientHistory
            ? `<div class="encounter-actions">
          <button class="btn btn-quiet" type="button" data-action="previous-patient-history" ${state.patientHistoryOffset === 0 || state.busy ? 'disabled' : ''}>السابق</button>
          <button class="btn btn-quiet" type="button" data-action="next-patient-history" ${!state.patientHistory.hasNext || state.busy ? 'disabled' : ''}>التالي</button>
        </div>`
            : ''
        }
      </section>`;
  }

  function renderDetail() {
    const encounter = state.detail;
    if (state.detailLoading && !encounter)
      return `<section class="encounter-card">${loadingBlock('جارٍ تحميل اللقاء…')}</section>`;
    if (!encounter) {
      return `<section class="encounter-card">${notice(state.detailError || 'تعذّر تحميل اللقاء.', true, 'back-to-worklist')}<button class="btn btn-quiet" type="button" data-action="back-to-worklist">العودة إلى القائمة</button></section>`;
    }
    const amendmentOpen =
      encounter.status === 'COMPLETED' && encounter.currentRevision === 'AMENDMENT_DRAFT';
    const editable =
      (encounter.status === 'DRAFT' && can(PERMISSIONS.clinicalWrite)) ||
      (amendmentOpen && can(PERMISSIONS.clinicalWrite) && can(PERMISSIONS.amendmentsUpdate));
    const clinical = encounter.clinical || {};
    return `
      <section class="encounter-card">
        <div class="encounter-toolbar">
          <div>
            <button class="btn btn-quiet btn-small" type="button" data-action="back-to-worklist">العودة إلى اللقاءات</button>
            <h1 style="margin-top:12px">تفاصيل اللقاء</h1>
            <p>المريض ${escapeHtml(shortId(encounter.patientId))} · المقدم ${escapeHtml(shortId(encounter.doctorId))}</p>
          </div>
          <span class="encounter-status" data-status="${escapeHtml(encounter.status)}">${escapeHtml(statusLabel(encounter.status))}</span>
        </div>
        ${state.detailError ? notice(state.detailError, true, state.pendingMutationReview ? 'check-mutation-status' : undefined) : ''}
        ${state.conflict ? notice('تغيّر هذا السجل منذ تحميله. لم تُحفظ تعديلاتك. أعد تحميل النسخة الحالية بعد مراجعة ما ستفقده.', true, 'reload-detail') : ''}
        <div class="encounter-detail-grid">
          ${detailItem('وقت إنشاء اللقاء', formatDateTime(encounter.encounterAt, state.detailTimezone))}
          ${detailItem('المنشأة', encounter.facilityId)}
          ${detailItem('الفرع', encounter.branchId || 'غير محدد')}
          ${detailItem('الإصدار', String(encounter.version))}
          ${detailItem('نسخة التوثيق', revisionLabel(encounter.currentRevision))}
          ${detailItem('أنشأه', encounter.createdBy)}
          ${detailItem('آخر تحديث', formatDateTime(encounter.updatedAt, state.detailTimezone))}
        </div>
        <p class="form-note">وقت العرض: ${escapeHtml(timeZoneLabel(state.detailTimezone))}</p>
      </section>
      <section class="encounter-card">
        <div class="encounter-section-heading"><h2>التوثيق السريري</h2></div>
        ${
          editable
            ? renderClinicalForm(clinical)
            : `${clinicalReadOnly(clinical)}
             ${encounter.status === 'DRAFT' && !can(PERMISSIONS.clinicalWrite) ? notice('هذه المسودة للقراءة فقط؛ لا تملك صلاحية توثيقها.') : ''}
             ${encounter.status === 'COMPLETED' && !amendmentOpen ? notice('تم إتمام اللقاء. النسخة الأصلية مقفلة؛ أي تغيير يتطلب مسودة تعديل مستقلة وسببًا موثقًا.') : ''}
             ${encounter.status === 'CANCELLED' ? notice('تم إلغاء اللقاء وأُقفل التوثيق.') : ''}`
        }
      </section>
      ${renderDiagnosisSection(encounter, amendmentOpen)}
      ${renderServiceRecordSection(encounter, amendmentOpen)}
      <section class="encounter-card">
        <div class="encounter-section-heading"><h2>إجراءات اللقاء</h2></div>
        <div class="encounter-actions">
          ${encounter.status === 'DRAFT' && can(PERMISSIONS.encounterComplete) ? `<button class="btn btn-primary" type="button" data-action="complete-encounter" ${state.busy ? 'disabled' : ''}>إتمام اللقاء</button>` : ''}
          ${encounter.status === 'COMPLETED' && !amendmentOpen && can(PERMISSIONS.amendmentsCreate) ? `<button class="btn btn-primary" type="button" data-action="create-amendment" ${state.busy ? 'disabled' : ''}>بدء تعديل موثق</button>` : ''}
          ${amendmentOpen && can(PERMISSIONS.amendmentsFinalize) ? `<button class="btn btn-primary" type="button" data-action="finalize-amendment" ${state.busy ? 'disabled' : ''}>اعتماد التعديل</button>` : ''}
          ${
            encounter.status === 'DRAFT' && can(PERMISSIONS.encounterCancel)
              ? `
            <form data-form="cancel-encounter" class="encounter-actions">
              <label class="encounter-visually-hidden" for="cancel-reason">سبب الإلغاء (اختياري)</label>
              <input id="cancel-reason" name="reason" maxlength="500" placeholder="سبب الإلغاء (اختياري)">
              <button class="btn btn-quiet" type="submit" ${state.busy ? 'disabled' : ''}>إلغاء اللقاء</button>
            </form>`
              : ''
          }
        </div>
        ${amendmentOpen ? notice(`مسودة تعديل مفتوحة: ${encounter.amendments?.at(-1)?.reason || 'سبب التعديل غير متاح'}`) : ''}
        ${
          can(PERMISSIONS.historyRead)
            ? `
          <button class="btn btn-quiet" type="button" data-action="load-history" ${state.busy ? 'disabled' : ''}>عرض سجل التغييرات</button>
          ${state.historyError ? notice(state.historyError, true, 'load-history') : ''}
          ${state.history ? `<div class="encounter-list">${state.history.items.map(renderHistoryItem).join('')}</div>` : ''}`
            : ''
        }
      </section>`;
  }

  function renderClinicalForm(clinical) {
    const values = state.pendingDraft || {};
    const textField = (field, label, wide) => {
      const stored = clinical[field] || '';
      const value = values[`text.${field}`] !== undefined ? values[`text.${field}`] : stored;
      const isTextarea = field !== 'reason';
      return `
        <div class="encounter-field ${wide ? 'wide' : ''}">
          <label for="clinical-${field}">${escapeHtml(label)}</label>
          ${
            isTextarea
              ? `<textarea id="clinical-${field}" name="text.${field}" maxlength="8000" rows="3">${escapeHtml(value)}</textarea>`
              : `<input id="clinical-${field}" name="text.${field}" maxlength="8000" value="${escapeHtml(value)}">`
          }
        </div>`;
    };
    return `
      <form data-form="clinical" autocomplete="off">
        <div class="encounter-form-grid">
          ${CLINICAL_TEXT_FIELDS.map(([field, label, wide]) => textField(field, label, wide)).join('')}
          ${FACT_FIELDS.map(([field, label]) => renderFactField(field, label, clinical[field])).join('')}
        </div>
        <h3 style="margin:22px 0 12px">العلامات الحيوية</h3>
        <div class="encounter-vitals">
          ${VITAL_FIELDS.map(([field, label, unit]) => renderVitalField(field, label, unit, clinical.vitalSigns?.[field])).join('')}
        </div>
        <div class="encounter-actions">
          <button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}</button>
          <span class="form-note">الإصدار الحالي: ${escapeHtml(String(state.detail.version))}. يتطلب الحفظ إصدارًا متوقعًا مطابقًا.</span>
        </div>
      </form>`;
  }

  function renderDiagnosisSection(encounter, amendmentOpen) {
    const editable =
      (encounter.status === 'DRAFT' && can(PERMISSIONS.diagnosesWrite)) ||
      (amendmentOpen && can(PERMISSIONS.diagnosesWrite) && can(PERMISSIONS.amendmentsUpdate));
    const diagnoses =
      state.diagnosisDraft ??
      (encounter.diagnoses || []).map((item) => ({
        id: item.id,
        description: item.description,
        priority: item.priority,
        clinicalStatus: item.clinicalStatus,
        onsetAt: item.onsetAt,
      }));
    const content = diagnoses.length
      ? diagnoses
          .map((item, index) =>
            editable
              ? `<div class="encounter-record-row" data-diagnosis-row>
                  <input type="hidden" name="id" value="${escapeHtml(item.id || '')}">
                  <div class="encounter-form-grid">
                    <div class="encounter-field wide">
                      <label for="diagnosis-description-${index}">وصف التشخيص</label>
                      <textarea id="diagnosis-description-${index}" name="description" maxlength="2000" rows="2" required>${escapeHtml(item.description || '')}</textarea>
                    </div>
                    <div class="encounter-field">
                      <label for="diagnosis-priority-${index}">الأولوية</label>
                      <select id="diagnosis-priority-${index}" name="priority">
                        <option value="PRIMARY" ${item.priority === 'PRIMARY' ? 'selected' : ''}>أساسي</option>
                        <option value="SECONDARY" ${item.priority === 'SECONDARY' ? 'selected' : ''}>ثانوي</option>
                      </select>
                    </div>
                    <div class="encounter-field">
                      <label for="diagnosis-status-${index}">الحالة السريرية</label>
                      <select id="diagnosis-status-${index}" name="clinicalStatus">
                        ${diagnosisStatusOptions(item.clinicalStatus)}
                      </select>
                    </div>
                    <div class="encounter-field">
                      <label for="diagnosis-onset-${index}">تاريخ بدء التشخيص (اختياري)</label>
                      <input id="diagnosis-onset-${index}" name="onsetDate" type="date" value="${escapeHtml(dateInputValue(item.onsetAt))}">
                    </div>
                  </div>
                  <button class="btn btn-quiet btn-small" type="button" data-action="remove-diagnosis" data-index="${index}">حذف التشخيص</button>
                </div>`
              : `<article class="encounter-record-row">
                  <div class="encounter-detail-grid">
                    ${detailItem(item.priority === 'PRIMARY' ? 'تشخيص أساسي' : 'تشخيص ثانوي', item.description)}
                    ${detailItem('الحالة السريرية', diagnosisStatusLabel(item.clinicalStatus))}
                    ${item.onsetAt ? detailItem('تاريخ البدء', formatDateTime(item.onsetAt, null)) : ''}
                  </div>
                </article>`,
          )
          .join('')
      : `<div class="encounter-empty"><p>لا توجد تشخيصات منظمة لهذا اللقاء.</p></div>`;

    return `
      <section class="encounter-card">
        <div class="encounter-section-heading"><h2>التشخيصات المنظمة</h2></div>
        ${
          editable
            ? `<form data-form="diagnoses">
              <div class="encounter-record-list">${content}</div>
              <p class="form-note">الوصف نص سريري يدخله الممارس. لا تُضاف رموز أو أنظمة ترميز ما لم يتوفر مصدر اصطلاحي معتمد.</p>
              <div class="encounter-actions">
                <button class="btn btn-quiet" type="button" data-action="add-diagnosis">إضافة تشخيص</button>
                <button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ التشخيصات'}</button>
              </div>
            </form>`
            : `${content}
             ${(encounter.status === 'DRAFT' || amendmentOpen) && !can(PERMISSIONS.diagnosesWrite) ? notice('لا تملك صلاحية تعديل التشخيصات المنظمة.') : ''}`
        }
      </section>`;
  }

  function renderServiceRecordSection(encounter, amendmentOpen) {
    const editable =
      (encounter.status === 'DRAFT' && can(PERMISSIONS.servicesWrite)) ||
      (amendmentOpen && can(PERMISSIONS.servicesWrite) && can(PERMISSIONS.amendmentsUpdate));
    const records =
      state.serviceDraft ??
      (encounter.serviceRecords || []).map((item) => ({
        id: item.id,
        serviceId: item.serviceId,
        providerDoctorId: item.providerDoctorId,
        status: item.status,
        note: item.note,
        serviceName: item.serviceName,
        serviceCode: item.serviceCode,
      }));
    const content = records.length
      ? records
          .map((item, index) =>
            editable
              ? renderServiceRecordFormRow(item, index, amendmentOpen)
              : `<article class="encounter-record-row">
                  <div class="encounter-detail-grid">
                    ${detailItem('الخدمة أو الإجراء', item.serviceName || item.serviceId)}
                    ${detailItem('الحالة', serviceStatusLabel(item.status))}
                    ${detailItem('الممارس المسؤول', shortId(item.providerDoctorId))}
                    ${item.note ? detailItem('ملاحظة سريرية', item.note) : ''}
                    ${item.startedAt ? detailItem('وقت البدء', formatDateTime(item.startedAt, state.detailTimezone)) : ''}
                    ${item.completedAt ? detailItem('وقت الإتمام', formatDateTime(item.completedAt, state.detailTimezone)) : ''}
                    ${item.cancelledAt ? detailItem('وقت الإلغاء', formatDateTime(item.cancelledAt, state.detailTimezone)) : ''}
                  </div>
                </article>`,
          )
          .join('')
      : `<div class="encounter-empty"><p>لا توجد خدمات أو إجراءات سريرية مسجلة.</p></div>`;

    return `
      <section class="encounter-card">
        <div class="encounter-section-heading"><h2>الخدمات والإجراءات السريرية</h2></div>
        ${
          editable
            ? `<form data-form="services">
              <div class="encounter-record-list">${content}</div>
              <p class="form-note">تُسجل هذه العناصر سريريًا فقط؛ لا تنشئ فوترة أو مطالبة أو حركة مخزون.</p>
              ${state.resourceErrors.services ? notice(errorMessage(state.resourceErrors.services), true) : ''}
              <div class="encounter-actions">
                <button class="btn btn-quiet" type="button" data-action="add-service-record">إضافة خدمة أو إجراء</button>
                <button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ الخدمات والإجراءات'}</button>
              </div>
            </form>`
            : `${content}
             ${(encounter.status === 'DRAFT' || amendmentOpen) && !can(PERMISSIONS.servicesWrite) ? notice('لا تملك صلاحية تعديل الخدمات والإجراءات السريرية.') : ''}`
        }
      </section>`;
  }

  function renderServiceRecordFormRow(item, index, amendmentOpen) {
    const terminal = item.status === 'COMPLETED' || item.status === 'CANCELLED';
    const amendmentCorrection = terminal && amendmentOpen;
    const serviceOptions = state.services.map((service) => {
      const label = service.code ? `${service.code} — ${service.name}` : service.name;
      return `<option value="${escapeHtml(service.id)}" ${service.id === item.serviceId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    });
    if (item.serviceId && !state.services.some((service) => service.id === item.serviceId)) {
      serviceOptions.push(
        `<option value="${escapeHtml(item.serviceId)}" selected>${escapeHtml(item.serviceName || 'خدمة محفوظة')}</option>`,
      );
    }
    const knownDoctor = state.doctors.some((doctor) => doctor.id === item.providerDoctorId);
    const providerOptions = [
      `<option value="">مقدم اللقاء الحالي</option>`,
      ...state.doctors.map(
        (doctor) =>
          `<option value="${escapeHtml(doctor.id)}" ${doctor.id === item.providerDoctorId ? 'selected' : ''}>${escapeHtml(displayName(doctor))}</option>`,
      ),
    ];
    if (item.providerDoctorId && !knownDoctor) {
      providerOptions.push(
        `<option value="${escapeHtml(item.providerDoctorId)}" selected>الممارس الحالي (${escapeHtml(shortId(item.providerDoctorId))})</option>`,
      );
    }
    return `<div class="encounter-record-row" data-service-row>
      <input type="hidden" name="id" value="${escapeHtml(item.id || '')}">
      <div class="encounter-form-grid">
        <div class="encounter-field">
          <label for="service-${index}">الخدمة أو الإجراء من دليل المنشأة</label>
          <select id="service-${index}" name="serviceId" ${terminal && !amendmentCorrection ? 'disabled' : ''} required>
            <option value="">اختر من الدليل</option>${serviceOptions.join('')}
          </select>
        </div>
        <div class="encounter-field">
          <label for="provider-${index}">الممارس المسؤول</label>
          <select id="provider-${index}" name="providerDoctorId" ${terminal && !amendmentCorrection ? 'disabled' : ''}>${providerOptions.join('')}</select>
        </div>
        <div class="encounter-field">
          <label for="service-status-${index}">الحالة</label>
          <select id="service-status-${index}" name="status" ${terminal ? 'disabled' : ''}>
            ${serviceStatusOptions(item.status)}
          </select>
        </div>
        <div class="encounter-field wide">
          <label for="service-note-${index}">ملاحظة سريرية (اختياري)</label>
          <textarea id="service-note-${index}" name="note" maxlength="3000" rows="2" ${terminal && !amendmentCorrection ? 'disabled' : ''}>${escapeHtml(item.note || '')}</textarea>
        </div>
      </div>
      ${!terminal || amendmentCorrection ? `<button class="btn btn-quiet btn-small" type="button" data-action="remove-service-record" data-index="${index}" ${item.status === 'IN_PROGRESS' ? 'disabled' : ''}>إزالة السجل</button>` : ''}
    </div>`;
  }

  function diagnosisStatusOptions(selected) {
    return [
      ['ACTIVE', 'نشط'],
      ['RESOLVED', 'تمت معالجته'],
      ['INACTIVE', 'غير نشط'],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`,
      )
      .join('');
  }

  function serviceStatusOptions(selected) {
    const options =
      selected === 'PLANNED'
        ? [
            ['PLANNED', 'مخطط'],
            ['IN_PROGRESS', 'جارٍ التنفيذ'],
            ['CANCELLED', 'ملغى'],
          ]
        : selected === 'IN_PROGRESS'
          ? [
              ['IN_PROGRESS', 'جارٍ التنفيذ'],
              ['COMPLETED', 'مكتمل'],
              ['CANCELLED', 'ملغى'],
            ]
          : [[selected || 'PLANNED', serviceStatusLabel(selected)]];
    return options
      .map(
        ([value, label]) =>
          `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`,
      )
      .join('');
  }

  function diagnosisStatusLabel(status) {
    return { ACTIVE: 'نشط', RESOLVED: 'تمت معالجته', INACTIVE: 'غير نشط' }[status] || status || '—';
  }

  function serviceStatusLabel(status) {
    return (
      { PLANNED: 'مخطط', IN_PROGRESS: 'جارٍ التنفيذ', COMPLETED: 'مكتمل', CANCELLED: 'ملغى' }[
        status
      ] ||
      status ||
      '—'
    );
  }

  function revisionLabel(status) {
    return (
      { ORIGINAL: 'النسخة الأصلية', AMENDMENT_DRAFT: 'مسودة تعديل', AMENDED: 'نسخة معدّلة' }[
        status
      ] ||
      status ||
      '—'
    );
  }

  function dateInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function renderFactField(field, label, stored) {
    const values = state.pendingDraft || {};
    const selected =
      values[`fact.${field}.status`] !== undefined
        ? values[`fact.${field}.status`]
        : stored?.status || 'UNTOUCHED';
    const text =
      values[`fact.${field}.text`] !== undefined
        ? values[`fact.${field}.text`]
        : stored?.status === 'DOCUMENTED'
          ? stored.text
          : '';
    return `
      <div class="encounter-field wide">
        <span class="encounter-label">${escapeHtml(label)}</span>
        <div class="encounter-fact-controls">
          <select name="fact.${field}.status" aria-label="${escapeHtml(label)} — الحالة">
            <option value="UNTOUCHED" ${selected === 'UNTOUCHED' ? 'selected' : ''}>دون تغيير</option>
            <option value="UNKNOWN" ${selected === 'UNKNOWN' ? 'selected' : ''}>غير معروف</option>
            <option value="NEGATIVE" ${selected === 'NEGATIVE' ? 'selected' : ''}>تم السؤال والنفي</option>
            <option value="DOCUMENTED" ${selected === 'DOCUMENTED' ? 'selected' : ''}>معلومات موثقة</option>
            ${stored ? `<option value="CLEAR" ${selected === 'CLEAR' ? 'selected' : ''}>مسح هذا القسم</option>` : ''}
          </select>
          <textarea name="fact.${field}.text" maxlength="8000" rows="2" aria-label="${escapeHtml(label)} — النص" placeholder="اكتب النص الموثق فقط">${escapeHtml(text)}</textarea>
        </div>
        <small class="form-note">الحالة غير المسجلة تبقى مختلفة عن النفي الصريح.</small>
      </div>`;
  }

  function renderVitalField(field, label, unit, stored) {
    const values = state.pendingDraft || {};
    const fieldValue =
      values[`vital.${field}`] !== undefined ? values[`vital.${field}`] : (stored?.value ?? '');
    const selectedUnit = values['vital.temperatureUnit'] || stored?.unit || '°C';
    return `
      <div class="encounter-field">
        <label for="vital-${field}">${escapeHtml(label)}</label>
        <div class="encounter-row">
          <input id="vital-${field}" name="vital.${field}" type="number" step="any" inputmode="decimal" value="${escapeHtml(String(fieldValue))}" aria-label="${escapeHtml(label)}">
          ${
            unit === 'temperature'
              ? `<select name="vital.temperatureUnit" aria-label="وحدة درجة الحرارة"><option value="°C" ${selectedUnit === '°C' ? 'selected' : ''}>°C</option><option value="°F" ${selectedUnit === '°F' ? 'selected' : ''}>°F</option></select>`
              : `<span class="form-note">${escapeHtml(unit)}</span>`
          }
        </div>
      </div>`;
  }

  function clinicalReadOnly(clinical) {
    const textItems = CLINICAL_TEXT_FIELDS.map(([field, label]) => {
      const value = clinical[field];
      return value ? detailItem(label, value) : '';
    }).join('');
    const legacyDiagnoses = Array.isArray(clinical.diagnoses)
      ? clinical.diagnoses.join('\n')
      : typeof clinical.diagnoses === 'string'
        ? clinical.diagnoses
        : '';
    const legacyItem = legacyDiagnoses
      ? detailItem('تشخيصات نصية سابقة (غير مرمّزة)', legacyDiagnoses)
      : '';
    const factItems = FACT_FIELDS.map(([field, label]) => {
      const value = clinical[field];
      if (!value) return '';
      const description =
        value.status === 'DOCUMENTED'
          ? value.text
          : value.status === 'NEGATIVE'
            ? 'تم السؤال والنفي'
            : 'غير معروف';
      return detailItem(label, description);
    }).join('');
    const vitalItems = VITAL_FIELDS.map(([field, label]) => {
      const value = clinical.vitalSigns?.[field];
      return value ? detailItem(label, `${value.value} ${value.unit}`) : '';
    }).join('');
    const content = `${textItems}${legacyItem}${factItems}${vitalItems}`;
    return content
      ? `<div class="encounter-detail-grid">${content}</div>`
      : `<div class="encounter-empty"><p>لم يتم توثيق محتوى سريري في هذه المسودة.</p></div>`;
  }

  function renderEncounterSummary(encounter) {
    const canOpen = can(PERMISSIONS.encounterRead);
    return `
      <article class="encounter-list-item">
        <div>
          <strong>${escapeHtml(formatDateTime(encounter.encounterAt))} <span class="encounter-status" data-status="${escapeHtml(encounter.status)}">${escapeHtml(statusLabel(encounter.status))}</span> <span class="form-note">${escapeHtml(revisionLabel(encounter.currentRevision))}</span></strong>
          <small>المريض: ${escapeHtml(shortId(encounter.patientId))} · المقدم: ${escapeHtml(shortId(encounter.doctorId))} · المنشأة: ${escapeHtml(shortId(encounter.facilityId))}</small>
          <small>معرّف اللقاء: ${escapeHtml(encounter.id)}</small>
        </div>
        ${canOpen ? `<button class="btn btn-quiet" type="button" data-action="open-encounter" data-id="${escapeHtml(encounter.id)}">فتح التفاصيل</button>` : ''}
      </article>`;
  }

  function renderPatientHistoryItem(encounter) {
    const clinical = encounter.clinical || {};
    const legacyDiagnoses = Array.isArray(clinical.diagnoses)
      ? clinical.diagnoses.join('\n')
      : typeof clinical.diagnoses === 'string'
        ? clinical.diagnoses
        : '';
    const details = [
      clinical.reason && detailItem('سبب الزيارة', clinical.reason),
      clinical.chiefComplaint && detailItem('الشكوى الرئيسية', clinical.chiefComplaint),
      clinical.assessment && detailItem('التقييم', clinical.assessment),
      legacyDiagnoses && detailItem('تشخيصات نصية سابقة (غير مرمّزة)', legacyDiagnoses),
      ...(encounter.diagnoses || []).map((diagnosis) =>
        detailItem(
          diagnosis.priority === 'PRIMARY' ? 'تشخيص أساسي' : 'تشخيص ثانوي',
          `${diagnosis.description} — ${diagnosisStatusLabel(diagnosis.clinicalStatus)}`,
        ),
      ),
      ...(encounter.serviceRecords || []).map((service) =>
        detailItem(
          'الخدمة أو الإجراء',
          `${service.serviceName} — ${serviceStatusLabel(service.status)}`,
        ),
      ),
      clinical.plan && detailItem('الخطة', clinical.plan),
    ]
      .filter(Boolean)
      .join('');
    return `
      <article class="encounter-list-item" style="display:block">
        <div class="encounter-toolbar">
          <strong>${escapeHtml(formatDateTime(encounter.encounterAt, null))}</strong>
          <span class="encounter-status" data-status="${escapeHtml(encounter.status)}">${escapeHtml(statusLabel(encounter.status))}</span>
        </div>
        <div class="encounter-detail-grid">${details || '<p>لا توجد ملاحظات سريرية مسجلة.</p>'}</div>
        ${can(PERMISSIONS.encounterRead) ? `<button class="btn btn-quiet" type="button" data-action="open-encounter" data-id="${escapeHtml(encounter.id)}">فتح التفاصيل</button>` : ''}
      </article>`;
  }

  function renderHistoryItem(item) {
    const actionLabels = {
      CREATED: 'إنشاء اللقاء',
      CLINICAL_UPDATED: 'تحديث التوثيق السريري',
      DIAGNOSES_UPDATED: 'تحديث التشخيصات المنظمة',
      SERVICE_RECORDS_UPDATED: 'تحديث الخدمات والإجراءات',
      COMPLETED: 'إتمام اللقاء',
      CANCELLED: 'إلغاء اللقاء',
      AMENDMENT_OPENED: 'بدء تعديل موثق',
      AMENDMENT_UPDATED: 'تحديث مسودة التعديل',
      AMENDMENT_FINALIZED: 'اعتماد التعديل',
    };
    return `
      <article class="encounter-history-item">
        <strong>${escapeHtml(actionLabels[item.action] || item.action)}</strong>
        <small>${escapeHtml(formatDateTime(item.occurredAt, state.detailTimezone))} · المنفذ ${escapeHtml(item.actorUserId)} · الإصدار ${escapeHtml(String(item.fromVersion))} ← ${escapeHtml(String(item.toVersion))}</small>
        <small>الحقول: ${escapeHtml((item.changedFields || []).join('، '))}</small>
      </article>`;
  }

  function facilityFilter() {
    return facilitySelector('filter-facility', 'facilityId', state.filter.facilityId);
  }

  function branchFilter() {
    if (state.branches.length) {
      const options = [
        `<option value="">كل الفروع المسموح بها</option>`,
        ...state.branches.map(
          (branch) =>
            `<option value="${escapeHtml(branch.id)}" ${branch.id === state.filter.branchId ? 'selected' : ''}>${escapeHtml(branch.name || shortId(branch.id))}</option>`,
        ),
      ];
      if (
        state.filter.branchId &&
        !state.branches.some((branch) => branch.id === state.filter.branchId)
      ) {
        options.push(
          `<option value="${escapeHtml(state.filter.branchId)}" selected>الفرع المحدد (${escapeHtml(shortId(state.filter.branchId))})</option>`,
        );
      }
      return `
        <div class="encounter-field">
          <label for="filter-branch">الفرع (اختياري)</label>
          <select id="filter-branch" name="branchId">${options.join('')}</select>
        </div>`;
    }
    return `
      <div class="encounter-field">
        <label for="filter-branch">معرّف الفرع (اختياري)</label>
        <input id="filter-branch" name="branchId" value="${escapeHtml(state.filter.branchId)}" placeholder="UUID">
      </div>`;
  }

  function facilitySelector(id, name, selected) {
    if (can(PERMISSIONS.facilitiesRead) && state.facilities.length) {
      return `
        <div class="encounter-field">
          <label for="${escapeHtml(id)}">المنشأة</label>
          <select id="${escapeHtml(id)}" name="${escapeHtml(name)}" required>
            <option value="">اختر منشأة</option>
            ${state.facilities
              .map(
                (facility) => `
              <option value="${escapeHtml(facility.id)}" ${selected === facility.id ? 'selected' : ''}>${escapeHtml(displayName(facility))}</option>`,
              )
              .join('')}
          </select>
        </div>`;
    }
    return `
      <div class="encounter-field">
        <label for="${escapeHtml(id)}">معرّف المنشأة</label>
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(selected || '')}" placeholder="UUID" inputmode="text" required>
      </div>`;
  }

  function patientField(id, name, selected) {
    if (can(PERMISSIONS.patientsRead) && state.patients.length) {
      return `
        <div class="encounter-field">
          <label for="${escapeHtml(id)}">المريض</label>
          <select id="${escapeHtml(id)}" name="${escapeHtml(name)}" required>
            <option value="">اختر مريضًا</option>
            ${state.patients
              .map(
                (patient) => `
              <option value="${escapeHtml(patient.id)}" ${selected === patient.id ? 'selected' : ''}>${escapeHtml(patientLabel(patient))}</option>`,
              )
              .join('')}
          </select>
        </div>`;
    }
    return `
      <div class="encounter-field">
        <label for="${escapeHtml(id)}">معرّف المريض</label>
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(selected || '')}" placeholder="UUID" inputmode="text" required>
      </div>`;
  }

  function doctorField(id, name, selected) {
    if (can(PERMISSIONS.doctorsRead) && state.doctors.length) {
      return `
        <div class="encounter-field">
          <label for="${escapeHtml(id)}">المقدم السريري</label>
          <select id="${escapeHtml(id)}" name="${escapeHtml(name)}" required>
            <option value="">اختر مقدمًا</option>
            ${state.doctors
              .map(
                (doctor) => `
              <option value="${escapeHtml(doctor.id)}" ${selected === doctor.id ? 'selected' : ''}>${escapeHtml(displayName(doctor))}</option>`,
              )
              .join('')}
          </select>
        </div>`;
    }
    return `
      <div class="encounter-field">
        <label for="${escapeHtml(id)}">معرّف المقدم السريري</label>
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(selected || '')}" placeholder="UUID" inputmode="text" required>
      </div>`;
  }

  function branchField(id, name, branches, selected = '') {
    if (can(PERMISSIONS.branchesRead) && branches.length) {
      return `
        <div class="encounter-field">
          <label for="${escapeHtml(id)}">الفرع (اختياري)</label>
          <select id="${escapeHtml(id)}" name="${escapeHtml(name)}">
            <option value="">دون فرع</option>
            ${branches.map((branch) => `<option value="${escapeHtml(branch.id)}" ${selected === branch.id ? 'selected' : ''}>${escapeHtml(displayName(branch))}</option>`).join('')}
          </select>
        </div>`;
    }
    return `
      <div class="encounter-field">
        <label for="${escapeHtml(id)}">معرّف الفرع (اختياري)</label>
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(selected)}" placeholder="UUID">
      </div>`;
  }

  function doctorFilter() {
    if (can(PERMISSIONS.doctorsRead) && state.doctors.length) {
      return `
        <div class="encounter-field">
          <label for="filter-doctor">المقدم السريري</label>
          <select id="filter-doctor" name="doctorId">
            <option value="">كل المقدمين</option>
            ${state.doctors.map((doctor) => `<option value="${escapeHtml(doctor.id)}" ${state.filter.doctorId === doctor.id ? 'selected' : ''}>${escapeHtml(displayName(doctor))}</option>`).join('')}
          </select>
        </div>`;
    }
    return `
      <div class="encounter-field">
        <label for="filter-doctor">معرّف المقدم السريري</label>
        <input id="filter-doctor" name="doctorId" value="${escapeHtml(state.filter.doctorId)}" placeholder="UUID">
      </div>`;
  }

  async function loadEncounters() {
    const requestId = ++state.listRequestId;
    if (!can(PERMISSIONS.encounterRead)) return;
    const facilityId = state.filter.facilityId.trim();
    if (!facilityId) {
      state.timezone = null;
      state.list = [];
      state.listMeta = { total: 0, limit: 50, offset: 0, hasNext: false };
      state.filter.offset = 0;
      state.loadingList = false;
      state.listError = new Error('اختر منشأة لاستخدام نطاق التاريخ المحلي.');
      render();
      return;
    }
    state.loadingList = true;
    state.listError = null;
    state.timezone = null;
    render();
    try {
      const zones = await api.getEncounterTimeZones(state.workspace.tenantId, [facilityId]);
      if (requestId !== state.listRequestId) return;
      const zoneItem = itemsOf(zones).find((item) => item.facilityId === facilityId);
      state.timezone = zoneItem?.timeZone || null;
      if (!state.timezone) throw { status: 422, message: 'لا توجد سياسة جدولة نشطة لهذه المنشأة.' };
      if (!state.filterDateSetByUser) {
        state.filter.date = dateInTimeZone(new Date(), state.timezone);
      }
      const options = {
        facilityId,
        fromDate: state.filter.date,
        toDate: state.filter.date,
        limit: 50,
        offset: state.filter.offset,
      };
      if (state.filter.search) options.search = state.filter.search;
      if (state.filter.patientId) options.patientId = state.filter.patientId;
      if (state.filter.doctorId) options.doctorId = state.filter.doctorId;
      if (state.filter.branchId) options.branchId = state.filter.branchId;
      if (state.filter.status) options.status = state.filter.status;
      const response = await api.listEncounters(state.workspace.tenantId, options);
      if (requestId !== state.listRequestId) return;
      state.list = itemsOf(response);
      state.listMeta = {
        total: Number(response?.total) || 0,
        limit: Number(response?.limit) || 50,
        offset: Number(response?.offset) || 0,
        hasNext: response?.hasNext === true,
      };
      state.filter.offset = state.listMeta.offset;
    } catch (error) {
      if (requestId !== state.listRequestId) return;
      if (handleUnauthorized(error)) return;
      state.list = [];
      state.listError = error;
    } finally {
      if (requestId === state.listRequestId) {
        state.loadingList = false;
        render();
      }
    }
  }

  async function loadAppointments() {
    if (!can(PERMISSIONS.encounterCreate) || !can(PERMISSIONS.appointmentsRead)) return;
    const facilityId = state.appointmentFacilityId || state.filter.facilityId;
    if (!facilityId) {
      state.appointmentTimezone = null;
      state.appointmentError = new Error('اختر منشأة أولًا.');
      render();
      return;
    }
    state.busy = true;
    state.appointmentError = null;
    state.appointmentTimezone = null;
    render();
    try {
      const zones = itemsOf(
        await api.getAppointmentTimeZones(state.workspace.tenantId, [facilityId]),
      );
      const zone = zones.find((item) => String(item.facilityId) === String(facilityId));
      state.appointmentTimezone = zone?.timeZone || null;
      if (!state.appointmentTimezone) {
        throw new Error('لا توجد سياسة جدولة نشطة لهذه المنشأة لعرض المواعيد.');
      }
      if (!state.appointmentDateSetByUser) {
        state.appointmentDate = dateInTimeZone(new Date(), state.appointmentTimezone);
      }
      const response = await api.listAppointments(state.workspace.tenantId, {
        facilityId,
        ...(state.appointmentBranchId || state.filter.branchId
          ? { branchId: state.appointmentBranchId || state.filter.branchId }
          : {}),
        fromDate: state.appointmentDate,
        toDate: state.appointmentDate,
        status: 'SCHEDULED',
        limit: 100,
        offset: 0,
      });
      state.appointments = itemsOf(response).filter(
        (appointment) => appointment.status === 'SCHEDULED',
      );
      state.selectedAppointmentId = '';
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.appointmentError = error;
      state.appointments = [];
    } finally {
      state.busy = false;
      render();
    }
  }

  async function loadBranches(facilityId) {
    if (!can(PERMISSIONS.branchesRead) || !facilityId) {
      state.branches = [];
      return;
    }
    try {
      state.branches = itemsOf(
        await api.listBranches(state.workspace.tenantId, facilityId, {
          limit: 100,
          offset: 0,
        }),
      );
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.resourceErrors.branches = error;
      state.branches = [];
    }
  }

  async function loadPatientHistory(patientId, offset = 0) {
    if (!can(PERMISSIONS.patientHistoryRead)) return;
    state.busy = true;
    state.patientHistoryError = null;
    state.patientHistory = null;
    state.selectedPatientId = patientId;
    state.patientHistoryOffset = offset;
    render();
    try {
      state.patientHistory = await api.listPatientEncounterHistory(
        state.workspace.tenantId,
        patientId,
        { limit: 50, offset },
      );
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.patientHistoryError = error;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function openEncounter(encounterId) {
    if (!can(PERMISSIONS.encounterRead)) return;
    state.view = 'detail';
    state.detail = null;
    state.detailError = null;
    state.detailLoading = true;
    state.history = null;
    state.historyError = null;
    state.detailTimezone = null;
    state.conflict = false;
    state.pendingDraft = null;
    state.diagnosisDraft = null;
    state.serviceDraft = null;
    render();
    try {
      state.detail = await api.getEncounter(state.workspace.tenantId, encounterId);
      try {
        const zones = itemsOf(
          await api.getEncounterTimeZones(state.workspace.tenantId, [state.detail.facilityId]),
        );
        state.detailTimezone =
          zones.find((item) => String(item.facilityId) === String(state.detail.facilityId))
            ?.timeZone || null;
      } catch (error) {
        if (handleUnauthorized(error)) return;
        state.detailTimezone = null;
      }
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
    } finally {
      state.detailLoading = false;
      render();
    }
  }

  async function saveClinical(form) {
    if (!state.detail || !can(PERMISSIONS.clinicalWrite)) return;
    state.pendingDraft = Object.fromEntries(new FormData(form).entries());
    const clinical = buildClinicalPatch(form, state.detail.clinical || {});
    if (!Object.keys(clinical).length) {
      state.pendingDraft = null;
      showToast('لا توجد تغييرات لحفظها.');
      return;
    }
    state.saving = true;
    state.detailError = null;
    state.conflict = false;
    render();
    try {
      state.detail = state.detail.activeAmendmentId
        ? await api.updateEncounterAmendment(
            state.workspace.tenantId,
            state.detail.id,
            state.detail.activeAmendmentId,
            { expectedVersion: state.detail.version, clinical },
          )
        : await api.updateEncounterClinical(state.workspace.tenantId, state.detail.id, {
            expectedVersion: state.detail.version,
            clinical,
          });
      state.pendingDraft = null;
      state.conflict = false;
      showToast('تم حفظ المسودة.');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
      rememberMutationReview(error, 'clinical');
      if (error && error.status === 409) state.conflict = true;
    } finally {
      state.saving = false;
      render();
    }
  }

  async function saveDiagnoses(form) {
    if (!state.detail || !can(PERMISSIONS.diagnosesWrite)) return;
    const diagnoses = collectDiagnoses(form);
    state.diagnosisDraft = diagnoses;
    if (diagnoses.length && diagnoses.filter((item) => item.priority === 'PRIMARY').length !== 1) {
      state.detailError = 'يجب تحديد تشخيص أساسي واحد بالضبط.';
      render();
      return;
    }
    const encounter = state.detail;
    state.saving = true;
    state.detailError = null;
    state.conflict = false;
    render();
    try {
      state.detail = encounter.activeAmendmentId
        ? await api.updateEncounterAmendment(
            state.workspace.tenantId,
            encounter.id,
            encounter.activeAmendmentId,
            { expectedVersion: encounter.version, diagnoses },
          )
        : await api.replaceEncounterDiagnoses(state.workspace.tenantId, encounter.id, {
            expectedVersion: encounter.version,
            diagnoses,
          });
      state.diagnosisDraft = null;
      showToast('تم حفظ التشخيصات المنظمة.');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
      if (error && error.status === 409) state.conflict = true;
    } finally {
      state.saving = false;
      render();
    }
  }

  function collectDiagnoses(form) {
    return Array.from(form.querySelectorAll('[data-diagnosis-row]')).map((row) => {
      const id = row.querySelector('[name="id"]').value.trim();
      const description = row.querySelector('[name="description"]').value.trim();
      if (!description) throw new Error('اكتب وصفًا لكل تشخيص.');
      const onsetDate = row.querySelector('[name="onsetDate"]').value;
      return {
        ...(id ? { id } : {}),
        description,
        priority: row.querySelector('[name="priority"]').value,
        clinicalStatus: row.querySelector('[name="clinicalStatus"]').value,
        onsetAt: onsetDate ? new Date(`${onsetDate}T00:00:00.000Z`).toISOString() : null,
      };
    });
  }

  function captureDiagnosisDraft() {
    const form = app.querySelector('[data-form="diagnoses"]');
    if (!form) return;
    state.diagnosisDraft = Array.from(form.querySelectorAll('[data-diagnosis-row]')).map((row) => ({
      id: row.querySelector('[name="id"]').value.trim() || undefined,
      description: row.querySelector('[name="description"]').value,
      priority: row.querySelector('[name="priority"]').value,
      clinicalStatus: row.querySelector('[name="clinicalStatus"]').value,
      onsetAt: row.querySelector('[name="onsetDate"]').value
        ? `${row.querySelector('[name="onsetDate"]').value}T00:00:00.000Z`
        : null,
    }));
  }

  async function saveServiceRecords(form) {
    if (!state.detail || !can(PERMISSIONS.servicesWrite)) return;
    const serviceRecords = collectServiceRecords(form);
    state.serviceDraft = serviceRecords;
    const encounter = state.detail;
    state.saving = true;
    state.detailError = null;
    state.conflict = false;
    render();
    try {
      state.detail = encounter.activeAmendmentId
        ? await api.updateEncounterAmendment(
            state.workspace.tenantId,
            encounter.id,
            encounter.activeAmendmentId,
            { expectedVersion: encounter.version, serviceRecords },
          )
        : await api.replaceEncounterServiceRecords(state.workspace.tenantId, encounter.id, {
            expectedVersion: encounter.version,
            serviceRecords,
          });
      state.serviceDraft = null;
      showToast('تم حفظ الخدمات والإجراءات السريرية.');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
      if (error && error.status === 409) state.conflict = true;
    } finally {
      state.saving = false;
      render();
    }
  }

  function collectServiceRecords(form) {
    return Array.from(form.querySelectorAll('[data-service-row]')).map((row) => {
      const id = row.querySelector('[name="id"]').value.trim();
      const serviceId = row.querySelector('[name="serviceId"]').value.trim();
      if (!serviceId) throw new Error('اختر خدمة أو إجراءً من الدليل.');
      const providerDoctorId = row.querySelector('[name="providerDoctorId"]').value.trim();
      const note = row.querySelector('[name="note"]').value.trim();
      return {
        ...(id ? { id } : {}),
        serviceId,
        ...(providerDoctorId ? { providerDoctorId } : {}),
        status: row.querySelector('[name="status"]').value,
        note: note || null,
      };
    });
  }

  function captureServiceDraft() {
    const form = app.querySelector('[data-form="services"]');
    if (!form) return;
    state.serviceDraft = Array.from(form.querySelectorAll('[data-service-row]')).map((row) => ({
      id: row.querySelector('[name="id"]').value.trim() || undefined,
      serviceId: row.querySelector('[name="serviceId"]').value.trim(),
      providerDoctorId: row.querySelector('[name="providerDoctorId"]').value.trim() || undefined,
      status: row.querySelector('[name="status"]').value,
      note: row.querySelector('[name="note"]').value,
      serviceName: state.services.find(
        (service) => service.id === row.querySelector('[name="serviceId"]').value,
      )?.name,
    }));
  }

  function buildClinicalPatch(form, current) {
    const data = new FormData(form);
    const patch = {};
    for (const [field] of CLINICAL_TEXT_FIELDS) {
      const raw = String(data.get(`text.${field}`) || '');
      if (raw.trim()) {
        patch[field] = raw;
      } else if (current[field] !== undefined) {
        patch[field] = null;
      }
    }

    for (const [field] of FACT_FIELDS) {
      const selected = String(data.get(`fact.${field}.status`) || 'UNTOUCHED');
      const text = String(data.get(`fact.${field}.text`) || '').trim();
      if (selected === 'UNTOUCHED') continue;
      if (selected === 'CLEAR') {
        patch[field] = null;
      } else if (selected === 'DOCUMENTED') {
        if (!text) throw new Error(`أدخل نصًا موثقًا في قسم ${field}.`);
        patch[field] = { status: 'DOCUMENTED', text };
      } else if (selected === 'UNKNOWN' || selected === 'NEGATIVE') {
        patch[field] = { status: selected };
      }
    }

    const vitalPatch = {};
    for (const [field, , unit] of VITAL_FIELDS) {
      const raw = String(data.get(`vital.${field}`) || '').trim();
      if (!raw) {
        if (current.vitalSigns?.[field]) vitalPatch[field] = null;
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('أدخل قيمة رقمية صحيحة للعلامات الحيوية.');
      const measurementUnit =
        unit === 'temperature' ? String(data.get('vital.temperatureUnit') || '°C') : unit;
      vitalPatch[field] = { value, unit: measurementUnit };
    }
    if (Object.keys(vitalPatch).length) patch.vitalSigns = vitalPatch;
    return patch;
  }

  async function performLifecycle(action, reason) {
    if (!state.detail || state.busy) return;
    state.busy = true;
    state.detailError = null;
    render();
    try {
      state.detail =
        action === 'complete'
          ? await api.completeEncounter(
              state.workspace.tenantId,
              state.detail.id,
              state.detail.version,
            )
          : await api.cancelEncounter(
              state.workspace.tenantId,
              state.detail.id,
              state.detail.version,
              reason,
            );
      state.history = null;
      showToast(action === 'complete' ? 'تم إتمام اللقاء.' : 'تم إلغاء اللقاء مع الاحتفاظ بسجله.');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
      rememberMutationReview(error, action);
      if (error && error.status === 409) state.conflict = true;
    } finally {
      state.busy = false;
      render();
    }
  }

  function rememberMutationReview(error, action) {
    if (!error?.idempotencyKey || !error?.idempotencyRoute || !state.detail) return;
    state.pendingMutationReview = {
      encounterId: state.detail.id,
      route: error.idempotencyRoute,
      key: error.idempotencyKey,
      action,
    };
  }

  async function checkMutationStatus() {
    const pending = state.pendingMutationReview;
    if (!pending || !state.workspace || state.busy) return;
    state.busy = true;
    render();
    try {
      const result = await api.getEncounterMutationStatus(
        state.workspace.tenantId,
        pending.encounterId,
        pending.route,
        pending.key,
      );
      if (result.status === 'APPLIED') {
        state.pendingMutationReview = null;
        state.detailError = null;
        await openEncounter(pending.encounterId);
        return;
      }
      state.detailError =
        result.status === 'RETRY_SAFE'
          ? 'تأكد أن التغيير لم يُطبّق. يمكنك إعادة حفظ النموذج الحالي؛ سيُستخدم مفتاح المحاولة الأصلي.'
          : result.status === 'REVIEW_REQUIRED'
            ? 'ما زالت نتيجة التغيير غير مؤكدة. لا ترسله كعملية جديدة؛ يلزم التحقق أو مراجعة مسؤول.'
            : 'لم يُعثر على عملية مطابقة في هذا السجل. لم تُرسل أي تغييرات.';
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function createAmendment() {
    if (
      !state.detail ||
      state.detail.status !== 'COMPLETED' ||
      !can(PERMISSIONS.amendmentsCreate) ||
      state.busy
    ) {
      return;
    }
    const reason = window.prompt('اكتب سبب التعديل السريري. سيظهر السبب ضمن سجل التعديلات.');
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('سبب التعديل مطلوب.');
      return;
    }
    const encounter = state.detail;
    state.busy = true;
    state.detailError = null;
    render();
    try {
      state.detail = await api.createEncounterAmendment(state.workspace.tenantId, encounter.id, {
        expectedVersion: encounter.version,
        reason: reason.trim(),
      });
      state.history = null;
      state.diagnosisDraft = null;
      state.serviceDraft = null;
      state.pendingDraft = null;
      showToast('تم فتح مسودة تعديل مستقلة عن النسخة الأصلية.');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
      rememberMutationReview(error, 'amendment_opened');
      if (error && error.status === 409) state.conflict = true;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function finalizeAmendment() {
    if (
      !state.detail ||
      !state.detail.activeAmendmentId ||
      !can(PERMISSIONS.amendmentsFinalize) ||
      state.busy
    ) {
      return;
    }
    if (
      !window.confirm(
        'سيصبح التعديل نسخة سريرية معتمدة، مع بقاء النسخة الأصلية محفوظة. هل تريد الاعتماد؟',
      )
    ) {
      return;
    }
    const encounter = state.detail;
    state.busy = true;
    state.detailError = null;
    render();
    try {
      state.detail = await api.finalizeEncounterAmendment(
        state.workspace.tenantId,
        encounter.id,
        encounter.activeAmendmentId,
        encounter.version,
      );
      state.history = null;
      state.diagnosisDraft = null;
      state.serviceDraft = null;
      state.pendingDraft = null;
      showToast('تم اعتماد التعديل مع الاحتفاظ بالنسخة الأصلية.');
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.detailError = errorMessage(error);
      rememberMutationReview(error, 'amendment_finalized');
      if (error && error.status === 409) state.conflict = true;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function reloadDetail() {
    if (!state.detail) return;
    if (
      state.pendingDraft &&
      !window.confirm('سيتم تجاهل التعديلات غير المحفوظة. هل تريد تحميل النسخة الحالية؟')
    )
      return;
    const id = state.detail.id;
    state.pendingDraft = null;
    state.conflict = false;
    await openEncounter(id);
  }

  async function loadHistory() {
    if (!state.detail || !can(PERMISSIONS.historyRead)) return;
    state.busy = true;
    state.historyError = null;
    render();
    try {
      state.history = await api.getEncounterHistory(state.workspace.tenantId, state.detail.id);
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.historyError = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'choose-workspace') {
      const index = Number(button.dataset.index);
      void chooseWorkspace(state.workspaces[index]);
    } else if (action === 'logout') {
      void logout();
    } else if (action === 'view-worklist') {
      state.view = 'worklist';
      state.detail = null;
      render();
      void loadEncounters();
    } else if (action === 'view-patient-history') {
      state.view = 'patient-history';
      state.patientHistory = null;
      render();
    } else if (action === 'view-create') {
      state.view = 'create';
      render();
    } else if (action === 'previous-day' || action === 'next-day') {
      state.filter.date = shiftLocalDate(state.filter.date, action === 'previous-day' ? -1 : 1);
      state.filterDateSetByUser = true;
      state.filter.offset = 0;
      render();
      void loadEncounters();
    } else if (action === 'previous-page' || action === 'next-page') {
      state.filter.offset = Math.max(0, state.filter.offset + (action === 'next-page' ? 50 : -50));
      void loadEncounters();
    } else if (action === 'load-appointments') {
      void loadAppointments();
    } else if (action === 'create-from-appointment') {
      void createFromAppointment();
    } else if (action === 'open-encounter') {
      void openEncounter(button.dataset.id);
    } else if (action === 'add-diagnosis') {
      captureDiagnosisDraft();
      state.diagnosisDraft ||= [];
      state.diagnosisDraft.push({
        id: undefined,
        description: '',
        priority: state.diagnosisDraft.length ? 'SECONDARY' : 'PRIMARY',
        clinicalStatus: 'ACTIVE',
        onsetAt: null,
      });
      render();
    } else if (action === 'remove-diagnosis') {
      captureDiagnosisDraft();
      const removed = state.diagnosisDraft?.splice(Number(button.dataset.index), 1)[0];
      if (removed?.priority === 'PRIMARY' && state.diagnosisDraft.length) {
        state.diagnosisDraft[0].priority = 'PRIMARY';
      }
      render();
    } else if (action === 'add-service-record') {
      captureServiceDraft();
      state.serviceDraft ||= [];
      state.serviceDraft.push({
        id: undefined,
        serviceId: '',
        providerDoctorId: '',
        status: 'PLANNED',
        note: '',
      });
      render();
    } else if (action === 'remove-service-record') {
      captureServiceDraft();
      state.serviceDraft?.splice(Number(button.dataset.index), 1);
      render();
    } else if (action === 'back-to-worklist') {
      state.view = 'worklist';
      state.detail = null;
      state.pendingDraft = null;
      state.diagnosisDraft = null;
      state.serviceDraft = null;
      render();
      void loadEncounters();
    } else if (action === 'complete-encounter') {
      if (
        window.confirm(
          'سيؤدي إتمام اللقاء إلى قفل النسخة الأصلية. يمكن لاحقًا إضافة تعديل منفصل بسبب موثق. هل تريد المتابعة؟',
        )
      ) {
        void performLifecycle('complete');
      }
    } else if (action === 'create-amendment') {
      void createAmendment();
    } else if (action === 'finalize-amendment') {
      void finalizeAmendment();
    } else if (action === 'load-history') {
      void loadHistory();
    } else if (action === 'reload-detail') {
      void reloadDetail();
    } else if (action === 'check-mutation-status') {
      void checkMutationStatus();
    } else if (action === 'retry-list') {
      void loadEncounters();
    } else if (action === 'retry-workspaces') {
      void loadWorkspaces();
    } else if (action === 'retry-patient-history') {
      if (state.selectedPatientId) {
        void loadPatientHistory(state.selectedPatientId, state.patientHistoryOffset);
      }
    } else if (action === 'previous-patient-history') {
      if (state.selectedPatientId) {
        void loadPatientHistory(
          state.selectedPatientId,
          Math.max(0, state.patientHistoryOffset - 50),
        );
      }
    } else if (action === 'next-patient-history') {
      if (state.selectedPatientId) {
        void loadPatientHistory(state.selectedPatientId, state.patientHistoryOffset + 50);
      }
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
    if (target.closest('form[data-form="direct-create"]')) {
      state.directCreateKey = '';
      if (state.pendingDirectDraft && target.name) {
        state.pendingDirectDraft[target.name] = target.value;
      }
    }
    if (target.id === 'eligible-appointment') {
      if (state.selectedAppointmentId !== target.value) state.appointmentCreateKey = '';
      state.selectedAppointmentId = target.value;
      render();
    } else if (target.id === 'encounter-date') {
      state.filter.date = target.value;
      state.filterDateSetByUser = true;
    } else if (target.id === 'appointment-facility') {
      state.appointmentFacilityId = target.value;
      state.appointmentBranchId = '';
      state.appointments = [];
      state.selectedAppointmentId = '';
      state.appointmentTimezone = null;
      state.appointmentError = null;
      void loadBranches(target.value).then(render);
    } else if (target.id === 'appointment-branch') {
      state.appointmentBranchId = target.value;
      state.appointments = [];
      state.selectedAppointmentId = '';
      state.appointmentError = null;
    } else if (target.id === 'appointment-date') {
      state.appointmentDate = target.value;
      state.appointmentDateSetByUser = true;
    } else if (target.id === 'direct-facility') {
      state.directCreateKey = '';
      state.pendingDirectDraft = null;
      state.directFacilityId = target.value;
      state.directBranchId = '';
      void loadBranches(target.value).then(render);
    } else if (target.id === 'direct-branch') {
      state.directCreateKey = '';
      state.directBranchId = target.value;
    }
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const kind = form.dataset.form;
    if (!kind) return;
    event.preventDefault();
    if (kind === 'signin') {
      await signIn(form);
    } else if (kind === 'filters') {
      const submittedDate = String(new FormData(form).get('date') || state.filter.date);
      if (submittedDate !== state.filter.date) state.filterDateSetByUser = true;
      state.filter.date = submittedDate;
      state.filter.search = String(new FormData(form).get('search') || '').trim();
      state.filter.facilityId = String(new FormData(form).get('facilityId') || '');
      state.filter.patientId = String(new FormData(form).get('patientId') || '').trim();
      state.filter.doctorId = String(new FormData(form).get('doctorId') || '').trim();
      state.filter.branchId = String(new FormData(form).get('branchId') || '').trim();
      state.filter.status = String(new FormData(form).get('status') || '');
      state.filter.offset = 0;
      void loadEncounters();
    } else if (kind === 'direct-create') {
      await createDirect(form);
    } else if (kind === 'patient-history') {
      const patientId = String(new FormData(form).get('patientId') || '').trim();
      if (!patientId) {
        showToast('اختر مريضًا أو أدخل معرّفه.');
        return;
      }
      void loadPatientHistory(patientId, 0);
    } else if (kind === 'clinical') {
      try {
        await saveClinical(form);
      } catch (error) {
        state.detailError = errorMessage(error);
        state.pendingDraft = Object.fromEntries(new FormData(form).entries());
        if (error?.idempotencyKey && error?.idempotencyRoute) {
          state.pendingMutationReview = {
            encounterId: state.detail?.id,
            route: error.idempotencyRoute,
            key: error.idempotencyKey,
            action: 'clinical',
          };
        }
        render();
      }
    } else if (kind === 'diagnoses') {
      try {
        await saveDiagnoses(form);
      } catch (error) {
        captureDiagnosisDraft();
        state.detailError = errorMessage(error);
        rememberMutationReview(error, 'diagnoses_updated');
        render();
      }
    } else if (kind === 'services') {
      try {
        await saveServiceRecords(form);
      } catch (error) {
        captureServiceDraft();
        state.detailError = errorMessage(error);
        rememberMutationReview(error, 'service_records_updated');
        render();
      }
    } else if (kind === 'cancel-encounter') {
      const reason = String(new FormData(form).get('reason') || '').trim();
      if (
        window.confirm(
          'سيؤدي الإلغاء إلى الاحتفاظ باللقاء وسجله مع منع تعديل المسودة. هل تريد المتابعة؟',
        )
      ) {
        void performLifecycle('cancel', reason || undefined);
      }
    }
  }

  async function signIn(form) {
    const data = new FormData(form);
    state.busy = true;
    state.screenError = null;
    render();
    try {
      await api.login(String(data.get('email') || ''), String(data.get('password') || ''));
      await loadWorkspaces();
    } catch (error) {
      state.screen = 'signin';
      state.screenError = errorMessage(error);
      render();
    } finally {
      state.busy = false;
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // Clear the local clinical view even if the logout endpoint is unavailable.
    } finally {
      clearTenantData();
      state.workspaces = [];
      state.screen = 'signin';
      state.screenError = null;
      render();
    }
  }

  async function createFromAppointment() {
    if (!state.selectedAppointmentId || !can(PERMISSIONS.encounterCreate)) return;
    if (!state.appointmentCreateKey) state.appointmentCreateKey = createIdempotencyKey();
    state.busy = true;
    state.appointmentError = null;
    render();
    try {
      const encounter = await api.createEncounterFromAppointment(
        state.workspace.tenantId,
        {
          appointmentId: state.selectedAppointmentId,
        },
        state.appointmentCreateKey,
      );
      state.appointmentCreateKey = '';
      showToast('تم إنشاء مسودة اللقاء.');
      await openEncounter(encounter.id);
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.appointmentError = error;
      render();
    } finally {
      state.busy = false;
    }
  }

  async function createDirect(form) {
    const data = new FormData(form);
    const input = {
      patientId: String(data.get('patientId') || '').trim(),
      doctorId: String(data.get('doctorId') || '').trim(),
      facilityId: String(data.get('facilityId') || '').trim(),
    };
    const branchId = String(data.get('branchId') || '').trim();
    if (branchId) input.branchId = branchId;
    if (!state.directCreateKey) state.directCreateKey = createIdempotencyKey();
    state.busy = true;
    state.screenError = null;
    render();
    try {
      const encounter = await api.createDirectEncounter(
        state.workspace.tenantId,
        input,
        state.directCreateKey,
      );
      state.directCreateKey = '';
      state.pendingDirectDraft = null;
      showToast('تم إنشاء مسودة اللقاء.');
      await openEncounter(encounter.id);
    } catch (error) {
      if (handleUnauthorized(error)) return;
      state.screenError = errorMessage(error);
      state.pendingDirectDraft = Object.fromEntries(new FormData(form).entries());
      render();
    } finally {
      state.busy = false;
    }
  }

  function createIdempotencyKey() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `enc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function workspacePickerButton() {
    return `<button class="btn btn-quiet" type="button" data-action="logout">تسجيل الخروج</button>`;
  }

  function screenCard(title, message, loading, retry) {
    return `
      <section class="encounter-screen">
        <a class="encounter-brand" href="/appointments/">
          <img src="/assets/logo-transparent.png" alt="">
          <span><strong>ثناره</strong><small>THANARAH</small></span>
        </a>
        <h1 style="margin-top:22px">${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${loading ? '<div class="skeleton-row" aria-hidden="true"></div>' : ''}
        ${retry ? '<button class="btn btn-primary" type="button" data-action="retry-workspaces">إعادة المحاولة</button>' : ''}
      </section>`;
  }

  function statusOptions(selected) {
    return [
      ['DRAFT', 'مسودة'],
      ['COMPLETED', 'مكتمل'],
      ['CANCELLED', 'ملغى'],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`,
      )
      .join('');
  }

  function statusLabel(status) {
    return { DRAFT: 'مسودة', COMPLETED: 'مكتمل', CANCELLED: 'ملغى' }[status] || status;
  }

  function detailItem(label, value) {
    return `<div class="encounter-detail"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(String(value))}</span></div>`;
  }

  function notice(message, isError, action) {
    return `
      <div class="encounter-notice ${isError ? 'encounter-error' : ''}" role="${isError ? 'alert' : 'status'}">
        ${escapeHtml(message)}
        ${action ? ` <button class="btn btn-quiet btn-small" type="button" data-action="${escapeHtml(action)}">${action === 'check-mutation-status' ? 'التحقق من الحالة' : 'إعادة المحاولة'}</button>` : ''}
      </div>`;
  }

  function loadingBlock(message) {
    return `<div class="encounter-loading"><div class="skeleton-row" aria-hidden="true"></div><p>${escapeHtml(message)}</p></div>`;
  }

  function shellStartForSignIn() {
    return '';
  }

  function itemsOf(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    return [];
  }

  function displayName(item) {
    return item?.displayName || item?.name || item?.fullName || item?.id || '—';
  }

  function patientLabel(patient) {
    const name = [patient.firstName, patient.middleName, patient.lastName]
      .filter(Boolean)
      .join(' ');
    return [patient.patientNumber, name].filter(Boolean).join(' · ') || patient.id;
  }

  function shortId(value) {
    if (typeof value !== 'string') return '—';
    return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dateInTimeZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function shiftLocalDate(value, amount) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + amount);
    return localDateString(date);
  }

  function formatDateTime(value, timeZone = state.timezone) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    const options = { dateStyle: 'medium', timeStyle: 'short' };
    if (timeZone) options.timeZone = timeZone;
    return new Intl.DateTimeFormat(
      window.ThanarahLocale ? window.ThanarahLocale.dateLocale('ar-SA') : 'ar-SA',
      options,
    ).format(date);
  }

  function deviceTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'غير متاح';
  }

  function timeZoneLabel(timeZone) {
    return timeZone ? `توقيت المنشأة · ${timeZone}` : `توقيت الجهاز · ${deviceTimeZone()}`;
  }

  function errorMessage(error) {
    if (error && error.status === 401) return 'انتهت جلسة الدخول. سجّل الدخول مجددًا.';
    if (error && error.status === 403) return 'لا تملك الصلاحية المطلوبة لهذا الإجراء.';
    if (error && error.status === 404) return 'لم يُعثر على السجل ضمن مساحة العمل المصرح بها.';
    if (error && error.status === 409)
      return 'تعارض في الحالة أو الإصدار. أعد تحميل السجل قبل المتابعة.';
    if (error && error.status === 422)
      return 'تعذّر التحقق من المراجع أو سياسة المنطقة الزمنية. راجع المدخلات وإعداد المنشأة.';
    if (error && (error.status === 503 || error.status === 502))
      return 'التخزين السريري غير متاح حاليًا. لم يتم حفظ التغيير؛ حاول لاحقًا.';
    return safeMessage(error);
  }

  function safeMessage(error) {
    if (error && typeof error.message === 'string' && error.message.length < 300)
      return error.message;
    return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/gu,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character],
    );
  }

  let toastTimer;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }
})();
