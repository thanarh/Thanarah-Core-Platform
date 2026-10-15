(function attachThanarahApi(root) {
  'use strict';

  const API_ROOT = '/api/v1';
  const AUTH_ROOT = `${API_ROOT}/auth`;
  let accessToken = null;

  const safeMessages = {
    APPOINTMENT_INPUT_INVALID: 'راجع بيانات الموعد ثم حاول مرة أخرى.',
    APPOINTMENT_TIME_ZONE_UNAVAILABLE:
      'لا توجد سياسة جدولة نشطة تحدد منطقة زمنية للمنشأة؛ تعذّر تطبيق مرشح التاريخ.',
    APPOINTMENT_REFERENCE_INVALID: 'أحد الاختيارات لم يعد متاحًا. حدّث البيانات وحاول مرة أخرى.',
    APPOINTMENT_SCHEDULE_CONFLICT: 'هذا الوقت لم يعد متاحًا. اختر وقتًا آخر.',
    APPOINTMENT_IDEMPOTENCY_CONFLICT: 'تعذّر تأكيد إعادة المحاولة. حدّث المواعيد قبل المتابعة.',
    APPOINTMENT_POLICY_VIOLATION: 'الموعد لا يطابق سياسة الجدولة الحالية.',
    APPOINTMENT_STATE_CONFLICT: 'تغيّرت حالة الموعد. حدّث الصفحة قبل المتابعة.',
    AUTH_INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
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
