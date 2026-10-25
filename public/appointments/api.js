(function attachThanarahApi(root) {
  'use strict';

  const API_ROOT = '/api/v1';
  const AUTH_ROOT = `${API_ROOT}/auth`;
  let accessToken = null;
  const pendingMutationKeys = new Map();

  const safeMessages = {
    APPOINTMENT_INPUT_INVALID: 'راجع بيانات الموعد ثم حاول مرة أخرى.',
    APPOINTMENT_TIME_ZONE_UNAVAILABLE:
      'لا توجد سياسة جدولة نشطة تحدد منطقة زمنية للمنشأة؛ تعذّر تطبيق مرشح التاريخ.',
    APPOINTMENT_REFERENCE_INVALID: 'أحد الاختيارات لم يعد متاحًا. حدّث البيانات وحاول مرة أخرى.',
    APPOINTMENT_SCHEDULE_CONFLICT: 'هذا الوقت لم يعد متاحًا. اختر وقتًا آخر.',
    APPOINTMENT_IDEMPOTENCY_CONFLICT: 'تعذّر تأكيد إعادة المحاولة. حدّث المواعيد قبل المتابعة.',
    ENCOUNTER_IDEMPOTENCY_CONFLICT: 'استُخدم مفتاح إعادة المحاولة لطلب مختلف. ابدأ إجراءً جديدًا.',
    ENCOUNTER_IDEMPOTENCY_IN_PROGRESS: 'الطلب السابق ما زال قيد المعالجة. أعد المحاولة بعد قليل.',
    ENCOUNTER_IDEMPOTENCY_REVIEW_REQUIRED:
      'تعذّر تحديد نتيجة الطلب السابق. أوقف المحاولة واطلب المراجعة.',
    ENCOUNTER_VERSION_CONFLICT: 'تغيّر اللقاء منذ تحميله. حدّث البيانات قبل الحفظ.',
    APPOINTMENT_POLICY_VIOLATION: 'الموعد لا يطابق سياسة الجدولة الحالية.',
    APPOINTMENT_STATE_CONFLICT: 'تغيّرت حالة الموعد. حدّث الصفحة قبل المتابعة.',
    AUTH_INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    PATIENT_INPUT_INVALID: 'تحقق من بيانات المريض المطلوبة وصيغ الحقول.',
    PATIENT_ID_INVALID: 'معرّف المريض غير صالح.',
    PATIENT_NOT_FOUND: 'لم يعد سجل المريض متاحًا.',
    PATIENT_NUMBER_CONFLICT: 'رقم المريض مستخدم بالفعل في هذه المنشأة.',
    PATIENT_DUPLICATE_POSSIBLE:
      'قد يوجد سجل مكرر ببيانات مشابهة. راجع السجلات قبل إنشاء مريض جديد.',
    PATIENT_STATUS_TRANSITION_INVALID: 'تغيّرت حالة المريض. حدّث القائمة قبل المتابعة.',
    FACILITY_INPUT_INVALID: 'تحقق من اسم المنشأة.',
    FACILITY_ID_INVALID: 'معرّف المنشأة غير صالح.',
    FACILITY_NOT_FOUND: 'لم تعد المنشأة متاحة.',
    FACILITY_STATUS_TRANSITION_INVALID: 'تغيّرت حالة المنشأة. حدّث القائمة قبل المتابعة.',
    BRANCH_INPUT_INVALID: 'تحقق من اسم الفرع.',
    BRANCH_FACILITY_ID_INVALID: 'معرّف المنشأة غير صالح.',
    BRANCH_ID_INVALID: 'معرّف الفرع غير صالح.',
    BRANCH_FACILITY_NOT_FOUND: 'المنشأة غير متاحة ضمن مساحة العمل.',
    BRANCH_NOT_FOUND: 'لم يعد الفرع متاحًا ضمن هذه المنشأة.',
    BRANCH_PARENT_UNAVAILABLE: 'فعّل المنشأة أولًا لإدارة فروعها.',
    BRANCH_STATUS_TRANSITION_INVALID: 'تغيّرت حالة الفرع. حدّث القائمة قبل المتابعة.',
    SCHEDULING_POLICY_INPUT_INVALID: 'تحقق من بيانات سياسة الجدولة.',
    SCHEDULING_POLICY_REFERENCE_INVALID: 'أحد الأطباء أو الخدمات في السياسة لم يعد متاحًا.',
    SCHEDULING_POLICY_VERSION_CONFLICT: 'تغيّرت السياسة منذ فتحها. أعد تحميلها قبل الحفظ.',
    SCHEDULING_POLICY_UNAVAILABLE: 'تعذّر التحقق من سياسة الجدولة. حاول لاحقًا.',
  };

  class ApiError extends Error {
    constructor(status, code, message, rule) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.rule = rule;
    }
  }

  function responseError(response, payload) {
    const details = payload && typeof payload === 'object' ? payload.error || payload : {};
    const code = typeof details.code === 'string' ? details.code : 'REQUEST_FAILED';
    const message =
      safeMessages[code] ||
      (response.status === 401
        ? 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.'
        : response.status === 403
          ? 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'
          : response.status === 404
            ? 'لم يعد هذا السجل متاحًا.'
            : response.status === 503
              ? 'الخدمة غير متاحة مؤقتًا. حاول لاحقًا.'
              : 'تعذّر إكمال الطلب. حاول مرة أخرى.');
    return new ApiError(
      response.status,
      code,
      message,
      typeof details.rule === 'string' ? details.rule : undefined,
    );
  }

  async function readPayload(response) {
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function rawRequest(path, options, token) {
    const headers = new Headers(options.headers || {});
    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);

    return root.fetch(`${API_ROOT}${path}`, {
      ...options,
      body,
      headers,
      credentials: 'include',
    });
  }

  async function refreshAccessToken() {
    const response = await rawRequest(
      `${AUTH_ROOT.slice(API_ROOT.length)}/refresh`,
      {
        method: 'POST',
      },
      null,
    );
    const payload = await readPayload(response);
    if (!response.ok || !payload || typeof payload.accessToken !== 'string') {
      accessToken = null;
      return false;
    }
    accessToken = payload.accessToken;
    return true;
  }

  async function request(path, options = {}, refreshOnUnauthorized = true) {
    let response = await rawRequest(path, options, accessToken);

    if (
      response.status === 401 &&
      refreshOnUnauthorized &&
      path !== '/auth/login' &&
      path !== '/auth/refresh'
    ) {
      const refreshed = await refreshAccessToken();
      if (refreshed) response = await rawRequest(path, options, accessToken);
      else accessToken = null;
    }

    const payload = await readPayload(response);
    if (!response.ok) throw responseError(response, payload);
    return payload;
  }

  async function mutationRequest(path, options) {
    const fingerprint = JSON.stringify(options.body ?? null);
    const previous = pendingMutationKeys.get(path);
    if (previous?.uncertain && previous.fingerprint !== fingerprint) {
      throw new ApiError(
        409,
        'ENCOUNTER_IDEMPOTENCY_REVIEW_REQUIRED',
        safeMessages.ENCOUNTER_IDEMPOTENCY_REVIEW_REQUIRED,
      );
    }
    const key = previous?.fingerprint === fingerprint ? previous.key : createIdempotencyKey();
    const pending = { fingerprint, key, uncertain: previous?.uncertain || false };
    pendingMutationKeys.set(path, pending);
    try {
      const result = await request(path, {
        ...options,
        headers: { ...(options.headers || {}), 'Idempotency-Key': key },
      });
      pendingMutationKeys.delete(path);
      return result;
    } catch (error) {
      if (error && typeof error === 'object') {
        pending.uncertain =
          error.status >= 500 ||
          error.code === 'ENCOUNTER_IDEMPOTENCY_REVIEW_REQUIRED' ||
          error.code === 'ENCOUNTER_IDEMPOTENCY_IN_PROGRESS';
      }
      if (error && typeof error === 'object') {
        error.idempotencyKey = key;
        error.idempotencyRoute = mutationRoute(path);
      }
      throw error;
    }
  }

  function mutationRoute(path) {
    const routes = [
      ['/clinical', 'clinical_updated'],
      ['/diagnoses', 'diagnoses_updated'],
      ['/services', 'service_records_updated'],
      ['/amendments/finalize', 'amendment_finalized'],
      ['/amendments', 'amendment_opened'],
      ['/complete', 'completed'],
      ['/cancel', 'cancelled'],
    ];
    if (/\/amendments\/[^/]+$/u.test(path)) return 'amendment_updated';
    if (/\/amendments\/[^/]+\/finalize$/u.test(path)) return 'amendment_finalized';
    return routes.find(([suffix]) => path.endsWith(suffix))?.[1] || '';
  }

  function createIdempotencyKey() {
    return root.crypto?.randomUUID
      ? root.crypto.randomUUID()
      : `enc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function tenantPath(tenantId, suffix) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new TypeError('A selected tenant workspace is required.');
    }
    return `/tenants/${encodeURIComponent(tenantId)}${suffix}`;
  }

  function withQuery(path, values) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values || {})) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }
    const encoded = query.toString();
    return encoded ? `${path}?${encoded}` : path;
  }

  function listOptions(options) {
    return { limit: 50, offset: 0, ...options };
  }

  const api = {
    ApiError,

    async restoreSession() {
      accessToken = null;
      return refreshAccessToken();
    },

    async login(email, password) {
      const payload = await request(
        '/auth/login',
        { method: 'POST', body: { email, password } },
        false,
      );
      accessToken = payload.accessToken;
      return true;
    },

    async logout() {
      try {
        if (accessToken) await request('/auth/logout', { method: 'POST' });
      } finally {
        accessToken = null;
      }
    },

    clearSession() {
      accessToken = null;
    },

    listWorkspaces() {
      return request('/session/tenants');
    },

    listAppointments(tenantId, options = {}) {
      return request(withQuery(tenantPath(tenantId, '/appointments'), listOptions(options)));
    },

    getAppointmentTimeZones(tenantId, facilityIds) {
      return request(
        withQuery(tenantPath(tenantId, '/appointments/effective-time-zones'), {
          facilityIds: [...new Set(facilityIds || [])].join(','),
        }),
      );
    },

    getAppointment(tenantId, appointmentId) {
      return request(tenantPath(tenantId, `/appointments/${encodeURIComponent(appointmentId)}`));
    },

    createEncounterFromAppointment(tenantId, input, idempotencyKey) {
      return request(tenantPath(tenantId, '/encounters/from-appointment'), {
        method: 'POST',
        body: input,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      });
    },

    createDirectEncounter(tenantId, input, idempotencyKey) {
      return request(tenantPath(tenantId, '/encounters/direct'), {
        method: 'POST',
        body: input,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      });
    },

    listEncounters(tenantId, options = {}) {
      return request(withQuery(tenantPath(tenantId, '/encounters'), options));
    },

    listPatientEncounterHistory(tenantId, patientId, options = {}) {
      return request(
        withQuery(
          tenantPath(tenantId, `/patients/${encodeURIComponent(patientId)}/encounters`),
          options,
        ),
      );
    },

    getEncounter(tenantId, encounterId) {
      return request(tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}`));
    },

    getEncounterMutationStatus(tenantId, encounterId, route, idempotencyKey) {
      return request(
        tenantPath(
          tenantId,
          `/encounters/${encodeURIComponent(encounterId)}/mutation-status/${encodeURIComponent(route)}`,
        ),
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ).then((result) => {
        for (const [path, pending] of pendingMutationKeys) {
          if (pending.key !== idempotencyKey) continue;
          if (result.status === 'RETRY_SAFE') pending.uncertain = false;
          if (result.status === 'APPLIED') pendingMutationKeys.delete(path);
        }
        return result;
      });
    },

    updateEncounterClinical(tenantId, encounterId, input) {
      return mutationRequest(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/clinical`),
        { method: 'PATCH', body: input },
      );
    },

    replaceEncounterDiagnoses(tenantId, encounterId, input) {
      return mutationRequest(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/diagnoses`),
        { method: 'PUT', body: input },
      );
    },

    replaceEncounterServiceRecords(tenantId, encounterId, input) {
      return mutationRequest(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/services`),
        { method: 'PUT', body: input },
      );
    },

    createEncounterAmendment(tenantId, encounterId, input) {
      return mutationRequest(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/amendments`),
        { method: 'POST', body: input },
      );
    },

    updateEncounterAmendment(tenantId, encounterId, amendmentId, input) {
      return mutationRequest(
        tenantPath(
          tenantId,
          `/encounters/${encodeURIComponent(encounterId)}/amendments/${encodeURIComponent(amendmentId)}`,
        ),
        { method: 'PATCH', body: input },
      );
    },

    finalizeEncounterAmendment(tenantId, encounterId, amendmentId, expectedVersion) {
      return mutationRequest(
        tenantPath(
          tenantId,
          `/encounters/${encodeURIComponent(encounterId)}/amendments/${encodeURIComponent(amendmentId)}/finalize`,
        ),
        { method: 'POST', body: { expectedVersion } },
      );
    },

    completeEncounter(tenantId, encounterId, expectedVersion) {
      return mutationRequest(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/complete`),
        { method: 'POST', body: { expectedVersion } },
      );
    },

    cancelEncounter(tenantId, encounterId, expectedVersion, reason) {
      return mutationRequest(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/cancel`),
        {
          method: 'POST',
          body: { expectedVersion, ...(reason ? { reason } : {}) },
        },
      );
    },

    getEncounterHistory(tenantId, encounterId) {
      return request(
        tenantPath(tenantId, `/encounters/${encodeURIComponent(encounterId)}/history`),
      );
    },

    getEncounterTimeZones(tenantId, facilityIds) {
      return request(
        withQuery(tenantPath(tenantId, '/encounters/effective-time-zones'), {
          facilityIds: [...new Set(facilityIds || [])].join(','),
        }),
      );
    },

    createAppointment(tenantId, input, idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw new TypeError('A stable idempotency key is required for appointment creation.');
      }
      return request(tenantPath(tenantId, '/appointments'), {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: input,
      });
    },

    updateAppointment(tenantId, appointmentId, input) {
      return request(tenantPath(tenantId, `/appointments/${encodeURIComponent(appointmentId)}`), {
        method: 'PATCH',
        body: input,
      });
    },

    rescheduleAppointment(tenantId, appointmentId, input) {
      return request(
        tenantPath(tenantId, `/appointments/${encodeURIComponent(appointmentId)}/reschedule`),
        { method: 'POST', body: input },
      );
    },

    cancelAppointment(tenantId, appointmentId) {
      return request(
        tenantPath(tenantId, `/appointments/${encodeURIComponent(appointmentId)}/cancel`),
        { method: 'POST' },
      );
    },

    listPatients(tenantId, options = {}) {
      return request(withQuery(tenantPath(tenantId, '/patients'), listOptions(options)));
    },

    getPatient(tenantId, patientId) {
      return request(tenantPath(tenantId, `/patients/${encodeURIComponent(patientId)}`));
    },

    createPatient(tenantId, input) {
      return request(tenantPath(tenantId, '/patients'), { method: 'POST', body: input });
    },

    updatePatient(tenantId, patientId, input) {
      return request(tenantPath(tenantId, `/patients/${encodeURIComponent(patientId)}`), {
        method: 'PATCH',
        body: input,
      });
    },

    activatePatient(tenantId, patientId) {
      return request(
        tenantPath(tenantId, `/patients/${encodeURIComponent(patientId)}/activate`),
        { method: 'POST' },
      );
    },

    deactivatePatient(tenantId, patientId) {
      return request(
        tenantPath(tenantId, `/patients/${encodeURIComponent(patientId)}/deactivate`),
        { method: 'POST' },
      );
    },

    listDoctors(tenantId, options = {}) {
      return request(
        withQuery(tenantPath(tenantId, '/doctors'), { status: 'ACTIVE', ...listOptions(options) }),
      );
    },

    listFacilities(tenantId, options = {}) {
      return request(
        withQuery(tenantPath(tenantId, '/facilities'), {
          status: 'ACTIVE',
          ...listOptions(options),
        }),
      );
    },

    listBranches(tenantId, facilityId, options = {}) {
      const path = tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}/branches`);
      return request(withQuery(path, { status: 'ACTIVE', ...listOptions(options) }));
    },

    listSetupBranches(tenantId, facilityId, options = {}) {
      const path = tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}/branches`);
      return request(withQuery(path, listOptions(options)));
    },

    createFacility(tenantId, input) {
      return request(tenantPath(tenantId, '/facilities'), { method: 'POST', body: input });
    },

    updateFacility(tenantId, facilityId, input) {
      return request(tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}`), {
        method: 'PATCH',
        body: input,
      });
    },

    changeFacilityStatus(tenantId, facilityId, action) {
      if (!['activate', 'suspend', 'deactivate'].includes(action)) {
        throw new TypeError('A valid facility lifecycle action is required.');
      }
      return request(
        tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}/${action}`),
        { method: 'POST' },
      );
    },

    createBranch(tenantId, facilityId, input) {
      return request(
        tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}/branches`),
        { method: 'POST', body: input },
      );
    },

    updateBranch(tenantId, facilityId, branchId, input) {
      return request(
        tenantPath(
          tenantId,
          `/facilities/${encodeURIComponent(facilityId)}/branches/${encodeURIComponent(branchId)}`,
        ),
        { method: 'PATCH', body: input },
      );
    },

    changeBranchStatus(tenantId, facilityId, branchId, action) {
      if (!['activate', 'suspend', 'deactivate'].includes(action)) {
        throw new TypeError('A valid branch lifecycle action is required.');
      }
      return request(
        tenantPath(
          tenantId,
          `/facilities/${encodeURIComponent(facilityId)}/branches/${encodeURIComponent(branchId)}/${action}`,
        ),
        { method: 'POST' },
      );
    },

    listServices(tenantId, options = {}) {
      return request(
        withQuery(tenantPath(tenantId, '/services'), { status: 'ACTIVE', ...listOptions(options) }),
      );
    },

    getSchedulingPolicy(tenantId, facilityId) {
      return request(
        tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}/scheduling-policy`),
      );
    },

    saveSchedulingPolicy(tenantId, facilityId, input) {
      return request(
        tenantPath(tenantId, `/facilities/${encodeURIComponent(facilityId)}/scheduling-policy`),
        { method: 'PUT', body: input },
      );
    },

    activateSchedulingPolicy(tenantId, facilityId, expectedVersion) {
      return request(
        tenantPath(
          tenantId,
          `/facilities/${encodeURIComponent(facilityId)}/scheduling-policy/activate`,
        ),
        { method: 'POST', body: { expectedVersion } },
      );
    },

    deactivateSchedulingPolicy(tenantId, facilityId, expectedVersion) {
      return request(
        tenantPath(
          tenantId,
          `/facilities/${encodeURIComponent(facilityId)}/scheduling-policy/deactivate`,
        ),
        { method: 'POST', body: { expectedVersion } },
      );
    },

    getSchedulingPolicyHistory(tenantId, facilityId, options = {}) {
      return request(
        withQuery(
          tenantPath(
            tenantId,
            `/facilities/${encodeURIComponent(facilityId)}/scheduling-policy/history`,
          ),
          listOptions(options),
        ),
      );
    },
  };

  root.ThanarahApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
