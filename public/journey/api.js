(function (root) {
  'use strict';
  const auth = root.CompanyApi;
  const attempts = new Map();
  const call = (path, options) => auth.request(path, options);
  const encode = encodeURIComponent;
  function fingerprint(body) {
    if (body instanceof FormData) return JSON.stringify([...body.entries()].map(([key, value]) =>
      [key, value instanceof File ? { name: value.name, type: value.type, size: value.size, lastModified: value.lastModified } : value]));
    return JSON.stringify(body);
  }
  async function change(path, method, body, operationId = body?.operationId) {
    if (!operationId) throw new auth.ApiError(400, 'CUSTOMER_OPERATION_REQUIRED', 'مرجع العملية مطلوب.');
    const identity = JSON.stringify({ path, method, body: fingerprint(body) });
    const prior = attempts.get(operationId);
    if (prior && prior !== identity)
      throw new auth.ApiError(409, 'CUSTOMER_RETRY_CHANGED', 'تغيّرت بيانات عملية لم تُحسم نتيجتها. راجع حالتها أولًا، ولا تستخدم المرجع نفسه لبيانات مختلفة.');
    attempts.set(operationId, identity);
    try {
      const response = await call(path, { method, body,
        ...(body instanceof FormData && !body.has('operationId') ? { headers: { 'Idempotency-Key': operationId } } : {}),
      });
      attempts.delete(operationId); return response;
    } catch (error) {
      if (error.status && error.status < 500) attempts.delete(operationId);
      throw error;
    }
  }
  const orderPath = id => `/customer/orders/${encode(id)}`;
  const adminOrderPath = id => `/customer-admin/orders/${encode(id)}`;
  const query = (path, values) => {
    const params = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    return params.size ? `${path}?${params}` : path;
  };
  async function linked(id) {
    const detail = await call(orderPath(id));
    if (!['ACTIVE', 'DELIVERED'].includes(detail.order.status) || !detail.order.tenantId)
      throw new auth.ApiError(409, 'CUSTOMER_SUBSCRIPTION_NOT_LINKED', 'لم يُربط اشتراك مفعّل بهذا الطلب بعد.');
    return `/tenants/${encode(detail.order.tenantId)}/subscription-portal`;
  }
  root.JourneyApi = {
    catalog: () => call('/customer-public/catalog'),
    register: input => change('/customer-public/register', 'POST', input),
    login: (email, password) => auth.login(email, password),
    restoreSession: () => auth.restoreSession(),
    logout: () => auth.logout(),
    me: () => call('/customer/me'),
    profile: input => change('/customer/profile', 'PUT', input),
    createOrder: input => change('/customer/orders', 'POST', input),
    order: id => call(orderPath(id)),
    customerAction: (id, input) => change(`${orderPath(id)}/actions`, 'POST', input),
    upload: (id, form) => change(`${orderPath(id)}/documents`, 'POST', form, form.get('operationId')),
    downloadDocument: id => auth.download(`/customer/documents/${encode(id)}/download`),
    sendWhatsApp: input => call('/customer/whatsapp/send', { method: 'POST', body: input }),
    review: (id, input) => change(`${orderPath(id)}/review`, 'POST', input),
    subscription: async id => call(await linked(id)),
    uploadTransfer: async (id, form, operationId) => change(`${await linked(id)}/transfers`, 'POST', form, operationId),
    adminSession: () => call('/customer-admin/session'),
    adminCatalog: () => call('/customer-admin/catalog'),
    saveCatalog: input => change('/customer-admin/catalog', 'PUT', input),
    publishCatalog: input => change('/customer-admin/catalog/publish', 'POST', input),
    adminOrders: options => call(query('/customer-admin/orders', options)),
    adminOrder: id => call(adminOrderPath(id)),
    adminAction: (id, input) => change(`${adminOrderPath(id)}/actions`, 'POST', input),
    reviewDocument: (id, input) => change(`/customer-admin/documents/${encode(id)}/review`, 'POST', input),
    adminDownloadDocument: id => auth.download(`/customer-admin/documents/${encode(id)}/download`),
    createInvoice: (id, input) => change(`${adminOrderPath(id)}/invoices`, 'POST', input),
    invoiceAction: (id, input) => change(`/customer-admin/invoices/${encode(id)}/actions`, 'POST', input),
    adminEvents: options => call(query('/customer-admin/events', options)),
  };
})(window);
