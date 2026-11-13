(function (root) {
  'use strict';
  const API = '/api/v1';
  const INTERNAL = `${API}/internal`;
  let token = null;
  let refreshPending = null;
  const pending = new Map();
  const operationFingerprints = new Map();

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message); this.name = 'ApiError'; this.status = status; this.code = code;
    }
  }
  const safeErrors = {
    AUTH_INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    COMPANY_VERSION_CONFLICT: 'تغيّر السجل؛ أعد تحميله قبل الحفظ.',
    COMPANY_INDEPENDENT_REVIEW_REQUIRED: 'يلزم مراجع مختلف عن منشئ السجل، حتى لمسؤول المنصة.',
    COMPANY_BENEFICIARY_REVIEW: 'لا يمكن للمستفيد اعتماد عقده أو استحقاقه الشخصي.',
    COMPANY_PERMISSION_DENIED: 'لا تملك صلاحية هذا الإجراء.',
    COMPANY_INPUT_INVALID: 'تحقق من جميع الحقول وصيغ البيانات.',
    COMPANY_POLICY_NOT_APPROVED: 'يلزم اعتماد سياسة سارية طوال الفترة قبل الاحتساب.',
    COMPANY_APPROVED_CONTRACT_REQUIRED: 'يلزم عقد معتمد يغطي كامل الشهر دون تداخل.',
    COMPANY_ACCOUNT_IN_USE: 'الحساب مرتبط بقيود أو سياسات؛ لا يمكن تغيير نوعه أو رمزه أو حالته.',
    COMPANY_ROOT_EXISTS: 'يوجد سجل شركة نشط؛ أضف إدارة أو قسمًا تحته.',
    COMPANY_CALCULATION_CHANGED: 'تغير أساس الاحتساب؛ ألغِ المسودة القديمة ثم أعد الاحتساب.',
    COMPANY_ACCRUAL_EXISTS: 'يوجد استحقاق لهذه العملية بالفعل؛ راجعه في القيود.',
    COMPANY_PROFIT_OVERALLOCATED: 'سيؤدي القيد إلى تجاوز الأرباح الموزعة لصافي الربح المتاح.',
    COMPANY_JOURNAL_UNBALANCED: 'يجب أن يتساوى إجمالي المدين والدائن مع طرف موجب واحد لكل بند.',
    COMPANY_SELF_ACCESS_CHANGE: 'لا يمكن تعديل صلاحيات أو ربط أو حالة ملفك الشخصي بنفسك.',
    COMPANY_USER_UNAVAILABLE: 'معرّف حساب المنصة غير موجود أو غير نشط.',
    COMPANY_USER_ALREADY_LINKED: 'حساب المنصة مرتبط بموظف آخر.',
    COMPANY_UNIT_IN_USE: 'انقل الموظفين والوحدات التابعة أولًا قبل أرشفة الجهة.',
    COMPANY_HIERARCHY_INVALID: 'الإدارة تتبع الشركة والقسم يتبع إدارة نشطة.',
    COMPANY_ESCALATION_OWNER_REQUIRED: 'اختر مسؤول تصعيد نشطًا مختلفًا عن المسؤول الحالي.',
    INTERNAL_VERSION_CONFLICT: 'تغيّر السجل منذ تحميله. أعد تحميل البيانات قبل المتابعة.',
    INTERNAL_REFERENCE_INVALID: 'أحد السجلات المرتبطة لم يعد متاحًا. حدّث الاختيارات.',
    INTERNAL_SELF_APPROVAL: 'يلزم مراجع مستقل غير منشئ السجل.',
    INTERNAL_PERMISSION_DENIED: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
    INTERNAL_INPUT_INVALID: 'راجع الحقول المطلوبة وصيغ البيانات.',
    OPERATION_RETRY_MISMATCH: 'بيانات العملية تغيّرت بعد تعذّر التأكد من نتيجتها. أعد المحاولة بالبيانات نفسها.',
  };
  async function read(response) {
    if (response.status === 204) return null;
    try { return await response.json(); } catch { return null; }
  }
  async function raw(path, options = {}, bearer = token) {
    const headers = new Headers(options.headers || {});
    let body = options.body;
    if (body != null && typeof body !== 'string' && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    return fetch(`${API}${path}`, { ...options, body, headers, credentials: 'include' });
  }
  async function refresh() {
    if(refreshPending)return refreshPending;
    refreshPending=(async()=>{
      const response = await raw('/auth/refresh', { method: 'POST' }, null);
      const data = await read(response);
      if(response.status>=500)throw new ApiError(response.status,'AUTH_DEPENDENCY_UNAVAILABLE','خدمة الجلسات غير متاحة مؤقتًا؛ أعد المحاولة دون فقد النموذج.');
      if (!response.ok || typeof data?.accessToken !== 'string') { token = null; return false; }
      token = data.accessToken; return true;
    })();
    try{return await refreshPending;}finally{refreshPending=null;}
  }
  async function request(path, options = {}, noRefresh = false) {
    let response = await raw(path, options);
    if (response.status === 401 && !noRefresh && path !== '/auth/refresh' && path !== '/auth/login') {
      if (await refresh()) response = await raw(path, options);
      else token = null;
    }
    const payload = await read(response);
    if (!response.ok) {
      const details = payload?.error || payload || {};
      const code = details.code || 'REQUEST_FAILED';
      const message = safeErrors[code] || (code.startsWith('CUSTOMER_') && typeof details.message === 'string' ? details.message : null) || (response.status === 401 ? 'انتهت الجلسة. سجّل الدخول مجددًا.' :
        response.status === 403 ? 'ليست لديك صلاحية لهذا الإجراء.' :
        response.status === 404 ? 'لم يعد السجل متاحًا.' :
        response.status === 409 ? 'تعارضت البيانات. حدّث الصفحة للمراجعة.' :
        response.status === 503 ? 'الخدمة غير متاحة مؤقتًا.' : 'تعذّر إكمال الطلب. حاول مرة أخرى.');
      throw new ApiError(response.status, code, message);
    }
    return payload;
  }
  function uuid() {
    if (!root.crypto?.randomUUID) throw new Error('يلزم متصفح يدعم إنشاء معرّفات آمنة.');
    return root.crypto.randomUUID();
  }
  function query(path, values) {
    const params = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    const suffix = params.toString();
    return suffix ? `${path}?${suffix}` : path;
  }
  async function mutation(path, method, body, operationId) {
    const data = { ...body, operationId: operationId || uuid() };
    const fingerprint = JSON.stringify(data);
    const old = operationFingerprints.get(data.operationId);
    if (old && old.fingerprint !== fingerprint) {
      throw new ApiError(409, 'OPERATION_RETRY_MISMATCH', 'بيانات العملية تغيّرت بعد تعذّر التأكد من نتيجتها. أعد المحاولة بالبيانات نفسها.');
    }
    const key = data.operationId;
    operationFingerprints.set(key, { fingerprint, path, method });
    try {
      const result = await request(path, { method, body: data });
      operationFingerprints.delete(key);
      return result;
    } catch (error) {
      if (error.status && error.status < 500) operationFingerprints.delete(key);
      throw error;
    }
  }
  const api = {
    ApiError,
    request,
    async download(path) {
      let response = await raw(path);
      if (response.status === 401 && await refresh()) response = await raw(path);
      if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'تعذّر تنزيل الملف أو انتهت صلاحيتك.');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      let name = 'document';
      try { name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || 'document'); } catch {}
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
    async restoreSession() { token = null; return refresh(); },
    async login(email, password) {
      const result = await request('/auth/login', { method: 'POST', body: { email, password } }, true);
      token = result?.accessToken || null;
      return Boolean(token);
    },
    async logout() { if (token) await request('/auth/logout', { method: 'POST' }); token = null; },
    clearSession() { token = null; },
    session() { return request('/internal/session'); },
    list(kind, options = {}) { return request(query(`/internal/records/${encodeURIComponent(kind)}`, { page: 1, limit: 100, ...options })); },
    create(kind, data, operationId) { return mutation(`/internal/records/${encodeURIComponent(kind)}`, 'POST', { data }, operationId); },
    update(kind, id, data, version, operationId) {
      return mutation(`/internal/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, 'PUT', { data, version }, operationId);
    },
    action(kind, id, version, action, reason, ownerId, operationId) {
      return mutation(`/internal/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/actions`, 'POST',
        { version, action, reason, ...(ownerId ? { ownerId } : {}) }, operationId);
    },
    accrue(input, operationId) { return mutation('/internal/accruals', 'POST', input, operationId); },
    finance(period) { return request(query('/internal/finance', { period })); },
    dashboard(view) { return request(`/internal/dashboard/${encodeURIComponent(view)}`); },
    audit(page = 1, limit = 50) { return request(query('/internal/audit', { page, limit })); },
    newOperationId: uuid,
  };
  root.CompanyApi = api;
})(window);
