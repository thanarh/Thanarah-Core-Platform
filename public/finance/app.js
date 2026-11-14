(function startClinicFinance() {
  'use strict';

  const api = window.ThanarahApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void bootstrap();
  });
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRegion = document.getElementById('toast-region');
  const PAGE_SIZE = 50;
  const PERMISSIONS = {
    read: 'tenant.finance.read',
    manage: 'tenant.finance.manage',
    settings: 'tenant.finance.settings.manage',
    review: 'tenant.finance.review',
    issue: 'tenant.finance.issue',
    paymentRead: 'tenant.finance.payments.read',
    paymentSubmit: 'tenant.finance.payments.submit',
    paymentReview: 'tenant.finance.payments.review',
    paymentSettings: 'tenant.finance.payments.settings.manage',
    subscriptionRead: 'tenant.subscriptions.read',
    subscriptionSubmit: 'tenant.subscriptions.payments.submit',
  };
  const state = {
    screen: 'boot', workspaces: [], workspace: null, view: 'invoices',
    invoices: [], total: 0, offset: 0, hasNext: false, statusFilter: '', search: '',
    listLoading: false, listError: null, settings: null, paymentSettings: null,
    paymentSettingsError: null, settingsLoading: false,
    settingsError: null, savingSettings: false, settingsForm: null,
    subscriptionPortal: null, subscriptionLoading: false, subscriptionError: null,
    subscriptionUploading: false,
    invoiceTransfers: [], transferLoading: false, transferBusy: false,
    savingPaymentSettings: false,
    transferError: null,
    invoice: null, detailLoading: false, detailError: null, detailId: null,
    editor: null, transition: null, busy: false, workspaceEpoch: 0, listRequestId: 0,
  };
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const allowed = (code) => !!state.workspace?.permissionCodes?.includes(code);
  const canRead = () => allowed(PERMISSIONS.read);
  const itemsOf = (response) => Array.isArray(response?.items) ? response.items : [];
  const message = (error) => error && typeof error.message === 'string'
    ? error.message : 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  const statusLabel = (status) => ({ DRAFT: 'مسودة', REVIEWED: 'تمت المراجعة', ISSUED: 'صادرة' })[status] || 'غير محددة';
  const roundingLabel = (value) => ({ HALF_UP: 'تقريب للنصف للأعلى', DOWN: 'تقريب للأسفل', UP: 'تقريب للأعلى' })[value] || 'غير مضبوط';
  const dateLocale = () => window.ThanarahLocale ? window.ThanarahLocale.dateLocale('ar') : 'ar';
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const uuid = () => window.crypto?.randomUUID ? window.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  void bootstrap();

  function currencyDigits(code) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2; }
    catch (_) { return 2; }
  }
  function formatMinor(minor, currency) {
    if (minor == null || !Number.isFinite(Number(minor))) return '—';
    const digits = currencyDigits(currency || 'SAR');
    const amount = BigInt(Math.trunc(Number(minor)));
    const divisor = 10n ** BigInt(digits);
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(digits, '0');
    const grouped = new Intl.NumberFormat('ar', { maximumFractionDigits: 0 }).format(Number(whole));
    const amountText = digits ? `${grouped}.${fraction}` : grouped;
    return `<bdi dir="ltr">${esc(amountText)} ${esc(currency || 'SAR')}</bdi>`;
  }
  function moneyText(minor, currency) {
    if (minor == null || !Number.isFinite(Number(minor))) return '—';
    const digits = currencyDigits(currency || 'SAR');
    const amount = BigInt(Math.trunc(Number(minor)));
    const divisor = 10n ** BigInt(digits);
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(digits, '0');
    const grouped = new Intl.NumberFormat('ar', { maximumFractionDigits: 0 }).format(Number(whole));
    return `${grouped}${digits ? `.${fraction}` : ''} ${currency || 'SAR'}`;
  }
  function normalizeDecimal(value) {
    return String(value ?? '').replace(/[٠-٩۰-۹]/gu, (digit) => {
      const code = digit.codePointAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    }).replace(/\u066b/gu, '.').trim();
  }
  function decimalFromScaled(value, scale, max) {
    const raw = normalizeDecimal(value);
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(raw)) throw new Error('أدخل رقمًا عشريًا موجبًا صالحًا.');
    const [whole, fraction = ''] = raw.split('.');
    if (fraction.length > scale) throw new Error(`عدد المنازل العشرية المسموح به هو ${scale}.`);
    const integer = BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
    if (integer > BigInt(max) || integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('القيمة أكبر من الحد المسموح.');
    return Number(integer);
  }
  function amountInput(minor, currency) {
    if (minor == null) return '';
    const digits = currencyDigits(currency || 'SAR');
    const value = BigInt(minor);
    const divisor = 10n ** BigInt(digits);
    const whole = value / divisor;
    const fraction = (value % divisor).toString().padStart(digits, '0').replace(/0+$/u, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
  }
  function quantityInput(quantityMilli) {
    const value = BigInt(quantityMilli || 0);
    const whole = value / 1000n;
    const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/u, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
  }
  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }
  function formatStamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  function toast(text, error) {
    const node = document.createElement('div');
    node.className = `toast${error ? ' error' : ''}`;
    node.setAttribute('role', error ? 'alert' : 'status');
    node.textContent = text;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }
  function brand() {
    return '<div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · CLINIC FINANCE</span></div></div>';
  }
  function expireSession() {
    clearWorkspaceData();
    state.workspace = null;
    state.workspaces = [];
    state.screen = 'signin';
    render();
  }
  function clearWorkspaceData() {
    state.workspaceEpoch++;
    state.listRequestId++;
    state.invoices = []; state.total = 0; state.offset = 0; state.hasNext = false;
    state.listError = null; state.listLoading = false; state.settings = null;
    state.paymentSettings = null; state.paymentSettingsError = null;
    state.subscriptionPortal = null; state.subscriptionLoading = false;
    state.subscriptionError = null; state.subscriptionUploading = false;
    state.invoiceTransfers = []; state.transferLoading = false; state.transferBusy = false;
    state.savingPaymentSettings = false;
    state.transferError = null;
    state.settingsError = null; state.settingsLoading = false; state.invoice = null;
    state.detailError = null; state.detailLoading = false; state.editor = null;
    state.transition = null; state.busy = false; state.settingsForm = null;
    state.search = ''; state.statusFilter = ''; modalRoot.innerHTML = '';
  }
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
      state.workspaces = itemsOf(result);
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
    state.screen = 'workspace';
    state.view = canRead()
      ? 'invoices'
      : allowed(PERMISSIONS.subscriptionRead)
        ? 'subscription'
        : allowed(PERMISSIONS.settings) || allowed(PERMISSIONS.paymentSettings) ||
          allowed(PERMISSIONS.paymentRead)
          ? 'settings'
          : 'no-access';
    render();
    if (canRead()) {
      await Promise.all([
        loadSettings(),
        loadInvoices(),
        allowed(PERMISSIONS.paymentRead) ? loadPaymentSettings() : Promise.resolve(),
      ]);
    } else if (allowed(PERMISSIONS.paymentRead)) {
      await loadPaymentSettings();
    } else if (allowed(PERMISSIONS.settings) || allowed(PERMISSIONS.paymentSettings)) {
      state.settingsError = new Error('تتطلب قراءة الإعدادات صلاحية tenant.finance.read.');
      render();
    }
    if (allowed(PERMISSIONS.subscriptionRead)) await loadSubscriptionPortal();
  }
  async function loadSubscriptionPortal() {
    if (!state.workspace || !allowed(PERMISSIONS.subscriptionRead)) return;
    const workspace = state.workspace;
    const epoch = state.workspaceEpoch;
    state.subscriptionLoading = true;
    state.subscriptionError = null;
    render();
    try {
      const result = await api.getTenantSubscriptionPortal(workspace.tenantId);
      if (epoch !== state.workspaceEpoch || workspace !== state.workspace) return;
      state.subscriptionPortal = result;
    } catch (error) {
      if (epoch !== state.workspaceEpoch || workspace !== state.workspace) return;
      if (error.status === 401) return expireSession();
      state.subscriptionError = error;
    } finally {
      if (epoch === state.workspaceEpoch && workspace === state.workspace) {
        state.subscriptionLoading = false;
        render();
      }
    }
  }
  async function loadSettings() {
    if (!canRead() || !state.workspace) return;
    const workspace = state.workspace;
    const epoch = state.workspaceEpoch;
    state.settingsLoading = true; state.settingsError = null; render();
    try {
      const result = await api.getClinicFinanceSettings(workspace.tenantId);
      if (epoch !== state.workspaceEpoch || workspace !== state.workspace) return;
      state.settings = result;
    } catch (error) {
      if (epoch !== state.workspaceEpoch) return;
      if (error.status === 401) return expireSession();
      state.settingsError = error;
    } finally {
      if (epoch === state.workspaceEpoch && workspace === state.workspace) {
        state.settingsLoading = false; render();
      }
    }
  }
  async function loadPaymentSettings() {
    if (!state.workspace || !allowed(PERMISSIONS.paymentRead)) return;
    const workspace = state.workspace;
    const epoch = state.workspaceEpoch;
    state.paymentSettingsError = null;
    try {
      state.paymentSettings = await api.getClinicPaymentSettings(workspace.tenantId);
    } catch (error) {
      if (epoch !== state.workspaceEpoch || workspace !== state.workspace) return;
      if (error.status === 401) return expireSession();
      state.paymentSettingsError = error;
    } finally {
      if (epoch === state.workspaceEpoch && workspace === state.workspace) {
        render();
        if (state.detailId) renderModal();
      }
    }
  }
  async function loadInvoices() {
    if (!canRead() || !state.workspace) return;
    const workspace = state.workspace;
    const epoch = state.workspaceEpoch;
    const requestId = ++state.listRequestId;
    state.listLoading = true; state.listError = null; render();
    try {
      const result = await api.listClinicInvoices(workspace.tenantId, {
        limit: PAGE_SIZE, offset: state.offset,
        status: state.statusFilter || undefined,
        search: state.search.trim() || undefined,
      });
      if (epoch !== state.workspaceEpoch || requestId !== state.listRequestId) return;
      state.invoices = itemsOf(result);
      state.total = Number.isFinite(result?.total) ? result.total : state.invoices.length;
      state.offset = Number.isFinite(result?.offset) ? result.offset : state.offset;
      state.hasNext = !!result?.hasNext;
    } catch (error) {
      if (epoch !== state.workspaceEpoch || requestId !== state.listRequestId) return;
      if (error.status === 401) return expireSession();
      state.listError = error;
    } finally {
      if (epoch === state.workspaceEpoch && requestId === state.listRequestId) {
        state.listLoading = false; render();
      }
    }
  }
  async function openInvoice(id) {
    if (!canRead() || !state.workspace) return;
    state.detailId = id; state.invoice = null; state.detailError = null; state.detailLoading = true;
    state.invoiceTransfers = []; state.transferError = null; state.transferBusy = false;
    renderModal();
    const workspace = state.workspace; const epoch = state.workspaceEpoch;
    try {
      const [result, transfers] = await Promise.all([
        api.getClinicInvoice(workspace.tenantId, id),
        allowed(PERMISSIONS.paymentRead)
          ? api.listClinicInvoiceTransfers(workspace.tenantId, id)
          : Promise.resolve([]),
      ]);
      if (epoch !== state.workspaceEpoch || state.detailId !== id) return;
      state.invoice = result;
      state.invoiceTransfers = Array.isArray(transfers) ? transfers : itemsOf(transfers);
      state.detailLoading = false; renderModal();
    } catch (error) {
      if (epoch !== state.workspaceEpoch || state.detailId !== id) return;
      state.detailLoading = false; state.detailError = error;
      if (error.status === 401) return expireSession();
      renderModal();
    }
  }
  async function changeView(view) {
    state.view = view;
    render();
    if (view === 'invoices') await loadInvoices();
    if (view === 'subscription' && !state.subscriptionPortal && !state.subscriptionLoading) {
      await loadSubscriptionPortal();
    }
    if (view === 'settings' && canRead() && !state.settings && !state.settingsLoading) {
      await loadSettings();
    }
    if (view === 'settings' && allowed(PERMISSIONS.paymentRead) && !state.paymentSettings) {
      await loadPaymentSettings();
    }
  }
  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'loading' || state.screen === 'boot') return screenCard('جارٍ تحميل مساحة العمل', 'نتحقق من جلسة الدخول وصلاحيات الوصول.', true);
    if (state.screen === 'select') return renderWorkspaceSelect();
    if (state.screen === 'none') return screenCard('لا توجد مساحة متاحة', 'لا توجد مساحة عمل مرتبطة بحسابك حاليًا.', false, 'logout');
    if (state.screen === 'error') return screenCard('تعذّر الوصول إلى مساحة العمل', state.screenMessage || 'حدث خطأ غير متوقع.', false, 'retry');
    if (!state.workspace) return screenCard('تعذّر فتح مساحة العمل', 'سجّل الدخول مجددًا للمتابعة.', false, 'retry');
    if (state.view === 'no-access') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brand()}<span class="eyebrow">الوصول محدود</span><h1>لا توجد صلاحية للمالية</h1><p class="auth-intro">تتطلب هذه المساحة صلاحية <bdi dir="ltr">${PERMISSIONS.read}</bdi>. لم يتم تحميل أي بيانات للفواتير.</p><button class="btn btn-secondary" data-action="switch-workspace">اختيار مساحة أخرى</button><button class="btn btn-quiet" data-action="logout">تسجيل الخروج</button></div></section>`;
      return;
    }
    app.innerHTML = shellMarkup();
    if (state.view === 'invoices') renderInvoices();
    else if (state.view === 'settings') renderSettings();
    else renderSubscriptionPortal();
    if (state.view === 'settings') enhanceSettingsView();
    renderModal();
  }
  function renderSignIn() {
    app.innerHTML = `<section class="auth-screen"><div class="auth-card">${brand()}<span class="eyebrow">الفواتير التشغيلية للعيادة</span><h1>مرحبًا بعودتك</h1><p class="auth-intro">سجّل الدخول للوصول إلى مساحة الفواتير ضمن صلاحيات منشأتك.</p>${state.screenMessage ? `<div class="inline-message" role="alert">${esc(state.screenMessage)}</div>` : ''}<form class="auth-form" data-form="signin"><div class="field"><label for="signin-email">البريد الإلكتروني</label><input class="control" id="signin-email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="signin-password">كلمة المرور</label><input class="control" id="signin-password" name="password" type="password" autocomplete="current-password" required></div><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'جارٍ تسجيل الدخول…' : 'دخول إلى مساحة العمل'}</button></form><p class="screen-footer">الفواتير هنا منفصلة عن اشتراكات ثناره. لا تُحفظ بيانات الدخول على هذا الجهاز.</p></div></section>`;
  }
  function renderWorkspaceSelect() {
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brand()}<span class="eyebrow">اختيار المساحة</span><h1>اختر مساحة العمل</h1><p class="auth-intro">اختر عيادتك لمتابعة فواتيرها التشغيلية.</p><div class="workspace-list">${state.workspaces.map((workspace, index) => `<button class="workspace-option" type="button" data-action="choose-workspace" data-index="${index}"><span><strong>${esc(workspace.displayName || 'مساحة عمل')}</strong><small>${esc(workspace.slug || workspace.tenantId || '')}</small></span><span class="workspace-arrow" aria-hidden="true">←</span></button>`).join('')}</div><button class="btn btn-quiet" style="margin-top:16px" data-action="logout">تسجيل الخروج</button><p class="screen-footer">بيانات كل مساحة عمل تبقى ضمن نطاقها.</p></div></section>`;
  }
  function screenCard(title, text, loading, action) {
    const btn = action ? `<button class="btn btn-secondary" data-action="${action}">${action === 'logout' ? 'تسجيل الخروج' : 'إعادة المحاولة'}</button>` : '';
    app.innerHTML = `<section class="workspace-screen"><div class="workspace-card">${brand()}<span class="eyebrow">مساحة الفواتير</span><h1>${esc(title)}</h1><p class="auth-intro">${esc(text)}</p>${loading ? '<div class="loading-state"><div class="skeleton-row"></div><div class="skeleton-row"></div><p class="form-note">لحظات من فضلك…</p></div>' : btn}<p class="screen-footer">تُدار صلاحيات الموظفين ونطاق مساحة العمل من الخادم.</p></div></section>`;
  }
  function shellMarkup() {
    const name = esc(state.workspace.displayName || state.workspace.slug || 'مساحة العمل');
    const links = [];
    if (canRead()) links.push(`<button class="nav-item ${state.view === 'invoices' ? 'active' : ''}" data-action="view-invoices" type="button" ${state.view === 'invoices' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('invoice')}</span><span>الفواتير</span></button>`);
    if (allowed(PERMISSIONS.settings) || allowed(PERMISSIONS.paymentSettings) || allowed(PERMISSIONS.paymentRead)) links.push(`<button class="nav-item ${state.view === 'settings' ? 'active' : ''}" data-action="view-settings" type="button" ${state.view === 'settings' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('settings')}</span><span>الإعدادات</span></button>`);
    if (allowed(PERMISSIONS.subscriptionRead)) links.push(`<button class="nav-item ${state.view === 'subscription' ? 'active' : ''}" data-action="view-subscription" type="button" ${state.view === 'subscription' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('invoice')}</span><span>اشتراك ثناره</span></button>`);
    const title = state.view === 'settings' ? 'إعدادات الفوترة' : state.view === 'subscription' ? 'اشتراك ثناره' : 'فواتير العيادة';
    return `<div class="app-frame"><aside class="sidebar" aria-label="التنقل الرئيسي"><a class="brand" href="/finance/" aria-label="ثناره — الإدارة المالية"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">الإدارة المالية للعيادة</div><nav class="side-nav">${links.join('')}</nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>مساحة نشطة<span class="workspace-name">${name}</span></div><div class="side-actions"><button type="button" data-action="switch-workspace">تبديل المساحة</button><button type="button" data-action="logout">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs"><span>إدارة العيادة</span><span aria-hidden="true"> / </span><strong>${title}</strong></div><div class="top-actions"><span class="user-chip">${name}</span></div></header><div class="page-content"><div id="page-view"></div></div></section></div>`;
  }
  function icon(name) {
    const icons = {
      invoice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
      settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2A1.7 1.7 0 0 0 7.8 17l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2A1.7 1.7 0 0 0 5.4 5.8l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2A1.7 1.7 0 0 0 17 3.4l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></svg>',
    };
    return icons[name] || '';
  }
  function renderInvoices() {
    const host = document.getElementById('page-view');
    if (!host) return;
    const canCreate = allowed(PERMISSIONS.manage);
    host.innerHTML = `<div class="page-heading"><div><span class="eyebrow">فواتير تشغيلية مستقلة</span><h1>فواتير العيادة</h1><p>أنشئ المسودات، راجعها، ثم أصدرها عند اكتمال الإعداد.</p></div><div class="heading-actions">${canCreate ? '<button class="btn btn-primary" type="button" data-action="new-invoice"><span aria-hidden="true">＋</span> فاتورة جديدة</button>' : ''}</div></div><form class="filters-panel" data-form="filters"><label class="field search-field"><span>بحث</span><input class="control" name="search" type="search" maxlength="100" placeholder="ابحث باسم المستلم أو رقم الفاتورة" value="${esc(state.search)}"></label><label class="field"><span>الحالة</span><select class="control" name="status"><option value="">كل الحالات</option>${['DRAFT','REVIEWED','ISSUED'].map((status) => `<option value="${status}" ${state.statusFilter === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}</select></label><button class="btn btn-secondary filter-submit" type="submit">تطبيق المرشحات</button></form><div class="list-status"><span>${state.listLoading ? 'جارٍ تحديث قائمة الفواتير…' : `عدد النتائج: ${new Intl.NumberFormat('ar').format(state.total)}`}</span><span>تعرض هذه المساحة فواتير العيادة فقط، وليست اشتراكات ثناره.</span></div><section class="records">${state.listLoading && !state.invoices.length ? loadingMarkup() : state.listError ? errorMarkup('invoices') : !state.invoices.length ? emptyInvoices(canCreate) : invoiceTable()}${state.invoices.length && !state.listError ? pagination() : ''}</section>`;
  }
  function subscriptionStatusLabel(status) {
    return ({
      ACTIVE: 'نشط',
      SUSPENDED: 'معلّق',
      CANCELLED: 'ملغى',
      EXPIRED: 'منتهي',
      PENDING_REVIEW: 'بانتظار المراجعة',
      APPROVED: 'مقبول',
      REJECTED: 'مرفوض',
    })[status] || 'غير محدد';
  }
  function hasCurrentSubscription(subscription) {
    if (!subscription || subscription.status !== 'ACTIVE') return false;
    const now = Date.now();
    const start = new Date(subscription.startsAt).getTime();
    const end = subscription.endsAt ? new Date(subscription.endsAt).getTime() : null;
    return Number.isFinite(start) && start <= now && (end === null || (Number.isFinite(end) && end > now));
  }
  function renderSubscriptionPortal() {
    const host = document.getElementById('page-view');
    if (!host) return;
    const portal = state.subscriptionPortal;
    const subscription = portal?.subscription;
    const bank = portal?.bankTransfer || {};
    const transfers = Array.isArray(portal?.transfers) ? portal.transfers : [];
    const bankReady = !!(bank.enabled && bank.bankName && bank.accountHolder && bank.iban && bank.currencyCode);
    const canSubmit = allowed(PERMISSIONS.subscriptionRead) &&
      allowed(PERMISSIONS.subscriptionSubmit) && bankReady && hasCurrentSubscription(subscription);
    const rows = transfers.length ? transfers.map((transfer) => {
      const reason = transfer.status === 'REJECTED' && transfer.reviewReason
        ? `<p class="form-note"><strong>سبب الرفض:</strong> ${esc(transfer.reviewReason)}</p>`
        : transfer.status === 'PENDING_REVIEW'
          ? '<p class="form-note">الإيصال لدى فريق ثناره للمراجعة.</p>'
          : transfer.status === 'APPROVED'
            ? '<p class="notice">تمت مراجعة الإيصال فقط؛ لم يتغير الاشتراك ولم يُنفذ تحصيل.</p>'
            : '';
      return `<article class="settings-item"><div class="settings-item-row"><div><h3>${subscriptionStatusLabel(transfer.status)}</h3><p>تاريخ الإرسال: ${esc(formatStamp(transfer.submittedAt))} · ${esc(transfer.receiptFileName || 'إيصال')}</p></div></div>${reason}</article>`;
    }).join('') : '<div class="permission-note">لا توجد إيصالات تحويل مسجلة لهذا الحساب.</div>';
    host.innerHTML = `<div class="page-heading"><div><span class="eyebrow">مسار اشتراك مستقل</span><h1>اشتراك ثناره</h1><p>تابع اشتراك منشأتك وتعليمات التحويل وحالة الإيصال. لا تظهر أسعار غير معتمدة هنا.</p></div><div class="heading-actions"><button class="btn btn-secondary" type="button" data-action="retry-subscription" ${state.subscriptionLoading ? 'disabled' : ''}>تحديث</button></div></div>${state.subscriptionLoading && !portal ? loadingMarkup() : ''}${state.subscriptionError ? `<div class="error-state" role="alert"><h2>تعذّر تحميل بيانات الاشتراك</h2><p>${esc(message(state.subscriptionError))}</p><button class="btn btn-secondary" type="button" data-action="retry-subscription">إعادة المحاولة</button></div>` : ''}${!state.subscriptionLoading && portal ? `<section class="settings-section"><div class="settings-head"><h2>اشتراك المنشأة</h2></div><div class="settings-body">${subscription ? `<div class="detail-grid"><div class="detail-item"><small>الخطة</small><strong>${esc(subscription.planName || subscription.planKey || '—')}</strong></div><div class="detail-item"><small>الحالة</small><strong>${subscriptionStatusLabel(subscription.status)}</strong></div><div class="detail-item"><small>تاريخ البداية</small><strong>${esc(formatStamp(subscription.startsAt))}</strong></div><div class="detail-item"><small>تاريخ النهاية</small><strong>${esc(formatStamp(subscription.endsAt))}</strong></div></div>` : '<div class="permission-note">لا يوجد اشتراك مسجل لهذه المنشأة حاليًا.</div>'}</div></section><section class="settings-section"><div class="settings-head"><h2>تعليمات التحويل البنكي</h2></div><div class="settings-body">${bankReady ? `<div class="detail-grid"><div class="detail-item"><small>البنك</small><strong>${esc(bank.bankName)}</strong></div><div class="detail-item"><small>اسم المستفيد</small><strong>${esc(bank.accountHolder)}</strong></div><div class="detail-item"><small>رقم الحساب الدولي</small><strong class="mono"><bdi dir="ltr">${esc(bank.iban)}</bdi></strong></div><div class="detail-item"><small>العملة المسجلة</small><strong class="mono"><bdi dir="ltr">${esc(bank.currencyCode)}</bdi></strong></div></div><p class="form-note">لا يُعرض مبلغ مستحق لعدم وجود قيمة اشتراك معتمدة في هذا السجل. أرفق الإيصال للتحقق اليدوي فقط.</p>` : '<div class="permission-note">تعليمات التحويل غير متاحة بعد. لا ترسل أي مبلغ حتى تهيئ المنصة بيانات التحويل المعتمدة.</div>'}</div></section><section class="settings-section"><div class="settings-head"><h2>إيصالات التحويل ومراجعتها</h2></div><div class="settings-body">${canSubmit ? `<form class="transfer-upload-form" data-form="subscription-transfer"><label class="field"><span>إرفاق إيصال PDF أو JPG أو PNG</span><input class="control" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required></label><p class="form-note">الإرسال يضيف طلب مراجعة فقط. لا يمدد الاشتراك ولا ينفذ تحصيلًا تلقائيًا.</p><button class="btn btn-primary" type="submit" ${state.subscriptionUploading ? 'disabled' : ''}>${state.subscriptionUploading ? 'جارٍ الإرسال…' : 'إرسال الإيصال للمراجعة'}</button></form>` : allowed(PERMISSIONS.subscriptionRead) && !allowed(PERMISSIONS.subscriptionSubmit) ? '<div class="permission-note">حسابك يستطيع قراءة الاشتراك فقط، ولا يملك صلاحية إرسال إيصال.</div>' : bankReady && !hasCurrentSubscription(subscription) ? '<div class="permission-note">يتطلب إرسال إيصال وجود اشتراك نشط حاليًا.</div>' : ''}${rows}</div></section>` : ''}`;
  }
  function loadingMarkup() { return `<div class="loading-state" aria-label="جارٍ التحميل"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div><p class="form-note">جارٍ تحميل البيانات…</p></div>`; }
  function errorMarkup(kind) {
    const error = kind === 'invoices' ? state.listError : state.settingsError;
    return `<div class="error-state" role="alert"><div class="empty-mark">${icon('invoice')}</div><h2>تعذّر تحميل ${kind === 'invoices' ? 'الفواتير' : 'الإعدادات'}</h2><p>${esc(message(error))}</p><button class="btn btn-secondary" type="button" data-action="retry-${kind}">إعادة المحاولة</button></div>`;
  }
  function emptyInvoices(canCreate) {
    return `<div class="empty-state"><div class="empty-mark">${icon('invoice')}</div><h2>لا توجد فواتير هنا بعد</h2><p>${state.search || state.statusFilter ? 'لا تطابق الفواتير المرشحات الحالية. جرّب تعديل البحث أو الحالة.' : canCreate ? 'ابدأ بمسودة فاتورة. لن تُصدر أو تُحصّل أي مبالغ قبل إجراء الإصدار من قبل مستخدم مخوّل.' : 'لا توجد فواتير ضمن نطاق وصولك حاليًا.'}</p>${canCreate && !state.search && !state.statusFilter ? '<button class="btn btn-primary" type="button" data-action="new-invoice">إنشاء مسودة فاتورة</button>' : ''}</div>`;
  }
  function invoiceTable() {
    const currency = state.settings?.currencyCode || 'SAR';
    return `<div class="table-wrap"><table class="invoice-table"><thead><tr><th>رقم الفاتورة</th><th>المستلم</th><th>التاريخ</th><th>الحالة</th><th>الإجمالي</th><th><span class="sr-only">إجراء</span></th></tr></thead><tbody>${state.invoices.map((invoice) => `<tr><td><span class="primary-cell">${esc(invoice.invoiceNumber || invoice.manualInvoiceNumber || 'مسودة بلا رقم')}</span><span class="cell-sub">الإصدار ${esc(invoice.version)}</span></td><td>${esc(invoice.recipientName || '—')}</td><td>${esc(formatDate(invoice.invoiceDate))}</td><td><span class="status-pill" data-status="${esc(invoice.status)}">${statusLabel(invoice.status)}</span></td><td>${formatMinor(invoice.totals?.totalMinor, invoice.currencyCode || currency)}</td><td><button class="row-open" type="button" data-action="open-invoice" data-id="${esc(invoice.id)}">عرض التفاصيل ←</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function pagination() {
    const start = state.total ? state.offset + 1 : 0;
    const end = state.offset + state.invoices.length;
    return `<div class="pagination"><span>النتائج ${new Intl.NumberFormat('ar').format(start)}–${new Intl.NumberFormat('ar').format(end)} من ${new Intl.NumberFormat('ar').format(state.total)}</span><div class="pagination-controls"><button class="btn btn-secondary btn-small" type="button" data-action="previous" ${state.offset === 0 || state.listLoading ? 'disabled' : ''}>السابق</button><button class="btn btn-secondary btn-small" type="button" data-action="next" ${!state.hasNext || state.listLoading ? 'disabled' : ''}>التالي</button></div></div>`;
  }
  function renderSettings() {
    const host = document.getElementById('page-view');
    if (!host) return;
    const writable = allowed(PERMISSIONS.settings);
    if (!canRead()) {
      host.innerHTML = `<div class="page-heading"><div><span class="eyebrow">تهيئة واضحة قبل التشغيل</span><h1>إعدادات التحويل</h1><p>تظهر هنا إعدادات التحويل فقط وفق صلاحيات مساحة العمل.</p></div></div><div class="permission-note">قراءة إعدادات الفواتير تتطلب صلاحية <bdi dir="ltr">${PERMISSIONS.read}</bdi>. لم يتم طلب بياناتها.</div>${!allowed(PERMISSIONS.paymentRead) ? '<div class="permission-note">عرض بيانات التحويل يتطلب صلاحية tenant.finance.payments.read.</div>' : ''}`;
      return;
    }
    host.innerHTML = `<div class="page-heading"><div><span class="eyebrow">سياسات يحددها مسؤول المنشأة</span><h1>إعدادات الفوترة</h1><p>لا تُفترض سياسة ضريبة أو ترقيم. يجب ضبط الخيارات صراحةً قبل مراجعة الفاتورة.</p></div><div class="heading-actions">${writable && !state.settingsForm ? '<button class="btn btn-primary" type="button" data-action="edit-settings">تعديل الإعدادات</button>' : ''}</div></div>${state.settingsLoading && !state.settings ? loadingMarkup() : state.settingsForm ? settingsEditor() : state.settingsError ? errorMarkup('settings') : state.settings ? settingsMarkup(state.settings, writable) : '<div class="permission-note">لم تُحمّل الإعدادات بعد.</div>'}`;
  }
  function enhanceSettingsView() {
    const host = document.getElementById('page-view');
    if (!host) return;
    if (allowed(PERMISSIONS.paymentSettings) || allowed(PERMISSIONS.paymentRead)) {
      host.insertAdjacentHTML('beforeend', bankTransferSectionMarkup());
    }
  }
  function bankTransferSectionMarkup() {
    const settings = state.paymentSettings;
    if (state.paymentSettingsError) {
      return `<section class="settings-section"><h2>التحويل البنكي للفواتير</h2><p class="form-note" role="alert">${esc(message(state.paymentSettingsError))}</p></section>`;
    }
    if (!settings) {
      return `<section class="settings-section"><h2>التحويل البنكي للفواتير</h2><p class="form-note">بيانات التحويل غير متاحة أو لم تُحمّل. يتطلب العرض صلاحية قراءة التحويلات.</p>${allowed(PERMISSIONS.paymentRead) ? '<button class="btn btn-secondary btn-small" type="button" data-action="retry-payment-settings">إعادة المحاولة</button>' : ''}</section>`;
    }
    const transfer = settings.bankTransfer || {};
    const editable = allowed(PERMISSIONS.paymentSettings);
    const content = editable
      ? bankTransferEditorMarkup(transfer, settings.version)
      : `<section class="settings-section"><div class="settings-head"><h2>التحويل البنكي للفواتير</h2><span class="status-pill" data-status="${transfer.enabled ? 'ISSUED' : 'DRAFT'}">${transfer.enabled ? 'مفعّل' : 'معطّل'}</span></div><div class="settings-body">${transfer.enabled ? `<div class="detail-grid"><div class="detail-item"><small>البنك</small><strong>${esc(transfer.bankName)}</strong></div><div class="detail-item"><small>صاحب الحساب</small><strong>${esc(transfer.accountHolder)}</strong></div><div class="detail-item"><small>IBAN</small><strong class="mono" dir="ltr">${esc(transfer.iban)}</strong></div><div class="detail-item"><small>العملة</small><strong class="mono">${esc(transfer.currencyCode)}</strong></div></div>` : '<div class="permission-note">التحويل البنكي غير مفعّل.</div>'}</div></section>`;
    const revisions = Array.isArray(settings.revisions) ? settings.revisions : [];
    const history = revisions.length
      ? `<div class="settings-section"><h3>سجل تغييرات التحويل</h3><div class="history-list">${revisions.slice().reverse().map((revision) => `<div class="history-entry"><strong>الإصدار ${esc(revision.version)}</strong><span>${esc(formatStamp(revision.changedAt))} · ${esc(revision.changedBy)}</span></div>`).join('')}</div></div>`
      : '';
    return `${content}${history}<p class="form-note">لا تُستنتج رسوم أو مواعيد استحقاق أو قواعد استرداد. قبول الإيصال يسجل المراجعة فقط ولا ينفذ تحصيلًا.</p>`;
  }
  function bankTransferEditorMarkup(bank, version) {
    const transfer = bank || {};
    return `<form class="settings-section" data-form="payment-settings"><div class="settings-head"><h2>التحويل البنكي للفواتير</h2><span class="form-note">الإصدار ${esc(version)} · معطّل افتراضيًا</span></div><input type="hidden" name="expectedVersion" value="${esc(version)}"><div class="settings-body"><div class="form-grid"><label class="field"><span>تفعيل استقبال الإيصالات</span><select class="control" name="bankTransferEnabled"><option value="false" ${!transfer.enabled ? 'selected' : ''}>معطّل</option><option value="true" ${transfer.enabled ? 'selected' : ''}>مفعّل</option></select></label><label class="field"><span>اسم البنك</span><input class="control" name="bankName" maxlength="100" value="${esc(transfer.bankName||'')}"></label><label class="field"><span>صاحب الحساب</span><input class="control" name="accountHolder" maxlength="191" value="${esc(transfer.accountHolder||'')}"></label><label class="field"><span>IBAN</span><input class="control mono" name="iban" maxlength="64" dir="ltr" value="${esc(transfer.iban||'')}"></label><label class="field"><span>عملة التحويل</span><input class="control mono" name="bankTransferCurrency" maxlength="3" pattern="[A-Za-z]{3}" dir="ltr" value="${esc(transfer.currencyCode||'')}"></label></div><p class="form-note" style="margin-top:10px">يجب أن تطابق العملة عملة الفاتورة قبل السماح برفع الإيصال.</p><div class="dialog-footer"><span class="form-note">يتطلب الحفظ صلاحية إدارة إعدادات التحويل.</span><button class="btn btn-primary" type="submit" ${state.savingPaymentSettings?'disabled':''}>${state.savingPaymentSettings?'جارٍ الحفظ…':'حفظ إعدادات التحويل'}</button></div></div></form>`;
  }
  function settingsMarkup(settings, writable) {
    const numbering = settings.numberingPolicy;
    return `<section class="settings-section"><div class="settings-head"><h2>العملة والتقريب</h2><span class="cell-sub">الإصدار <bdi dir="ltr">${esc(settings.version)}</bdi></span></div><div class="settings-body"><div class="detail-grid"><div class="detail-item"><small>عملة الفواتير الجديدة</small><strong class="mono">${esc(settings.currencyCode || 'غير مضبوط')}</strong></div><div class="detail-item"><small>تقريب بنود الفاتورة</small><strong>${roundingLabel(settings.lineRounding)}</strong></div></div><p class="form-note" style="margin:12px 0 0">الريال السعودي هو العملة الابتدائية للنظام فقط؛ تغيير العملة أو التقريب من مسؤولية الإدارة.</p></div></section><section class="settings-section"><div class="settings-head"><h2>سياسة الترقيم</h2></div><div class="settings-body">${numbering ? `<div class="settings-item"><div class="settings-item-row"><div><h3>${numbering.mode === 'MANUAL' ? 'إدخال يدوي' : 'تسلسل'}</h3><p>البادئة: <bdi dir="ltr">${esc(numbering.prefix || '—')}</bdi> · الحد الأدنى للأرقام: <bdi dir="ltr">${esc(numbering.minimumDigits)}</bdi>${numbering.mode === 'SEQUENTIAL' ? ` · رقم البداية: <bdi dir="ltr">${esc(numbering.startingNumber)}</bdi> · الرقم التالي المعروض من الخادم: <bdi dir="ltr">${esc(settings.nextSequence ?? '—')}</bdi>` : settings.nextSequence !== null ? ` · آخر عداد تسلسلي محفوظ: <bdi dir="ltr">${esc(settings.nextSequence)}</bdi>` : ''}</p></div></div><p class="form-note">لا تعيد تغييرات الإعدادات ضبط العداد. لا توجد إعادة ضبط دورية أو سياسة قانونية مفترضة.</p></div>` : `<div class="permission-note">لم تُضبط سياسة ترقيم. يلزم أن يحدد مسؤول المنشأة سياسة صراحةً قبل الإصدار؛ لا توجد سياسة افتراضية.${settings.nextSequence !== null ? ` العداد التسلسلي المحفوظ: <bdi dir="ltr">${esc(settings.nextSequence)}</bdi>.` : ''}</div>`}</div></section><section class="settings-section"><div class="settings-head"><h2>سياسات الضريبة</h2></div><div class="settings-body">${settings.taxPolicies?.length ? settings.taxPolicies.map((policy) => `<div class="settings-item"><h3>${esc(policy.name)}</h3><p>${policy.type === 'NO_TAX' ? 'لا توجد ضريبة ضمن هذه السياسة.' : `معدل مُدخل من الإدارة: <bdi dir="ltr">${esc(policy.rateBasisPoints / 100)}%</bdi> · طريقة الحساب: ${policy.calculation === 'PER_LINE' ? 'لكل بند' : 'على المجموع الفرعي'} · التقريب: ${roundingLabel(policy.rounding)}`}</p></div>`).join('') : '<div class="permission-note">لا توجد سياسة ضريبية مضبوطة. لا يُفترض أي معدل أو إعفاء؛ يجب أن يحدد مسؤول المنشأة السياسة المطلوبة صراحةً.</div>'}</div></section><section class="settings-section"><div class="settings-head"><h2>الحقول الإضافية</h2></div><div class="settings-body">${settings.customFields?.length ? settings.customFields.map((field) => `<div class="settings-item"><h3>${esc(field.label)} ${field.required ? '· مطلوب' : '· اختياري'}</h3><p><bdi dir="ltr">${esc(field.key)}</bdi> · ${({ TEXT: 'نص', DATE: 'تاريخ', BOOLEAN: 'نعم أو لا' })[field.type] || esc(field.type)}</p></div>`).join('') : '<div class="permission-note">لا توجد حقول إضافية مضبوطة.</div>'}</div></section><section class="settings-section"><div class="settings-head"><h2>سجل مراجعات الإعدادات</h2></div><div class="settings-body">${settings.revisions?.length ? `<div class="setting-revision">${settings.revisions.map((revision) => `<div class="history-entry"><strong>الإصدار ${esc(revision.version)}</strong><span>${esc(formatStamp(revision.changedAt))}</span></div>`).join('')}</div>` : '<p class="form-note">لا توجد مراجعات سابقة.</p>'}</div></section>${!writable ? `<div class="permission-note">العرض فقط. يتطلب التعديل صلاحية <bdi dir="ltr">${PERMISSIONS.settings}</bdi>.</div>` : ''}`;
  }
  function editorDefaults(invoice) {
    const currencyCode = state.settings?.currencyCode || 'SAR';
    const invoiceCurrency = invoice?.currencyCode || currencyCode;
    const currencyChanged = !!invoice && invoiceCurrency !== currencyCode;
    return {
      id: invoice?.id || null, version: invoice?.version || null, recipientName: invoice?.recipientName || '',
      currencyCode, currencyChanged,
      invoiceDate: invoice?.invoiceDate || today(), manualInvoiceNumber: invoice?.manualInvoiceNumber || '',
      taxPolicyId: invoice?.taxPolicyId || '', customFieldValues: { ...(invoice?.customFieldValues || {}) },
      lines: (invoice?.lines || [{ id: uuid(), description: '', quantityMilli: 0, unitPriceMinor: null }]).map((line) => ({
        id: line.id || uuid(), description: line.description || '',
        quantity: line.quantityMilli ? quantityInput(line.quantityMilli) : '',
        unitPrice: currencyChanged ? '' : amountInput(line.unitPriceMinor, invoiceCurrency),
      })),
      error: null, saving: false,
    };
  }
  function openEditor(invoice) {
    if (!allowed(PERMISSIONS.manage)) return;
    if (!state.settings) {
      toast('تعذّر فتح المحرر قبل تحميل إعدادات الفوترة.', true);
      return;
    }
    state.editor = editorDefaults(invoice);
    renderModal();
  }
  function renderModal() {
    if (state.editor) { modalRoot.innerHTML = editorMarkup(); return; }
    if (state.transition) { modalRoot.innerHTML = transitionMarkup(); return; }
    if (state.detailId) {
      modalRoot.innerHTML = detailMarkup();
      const auditHeading = [...modalRoot.querySelectorAll('.detail-section h3')]
        .find((heading) => heading.textContent === 'سجل التدقيق');
      if (auditHeading && state.invoice) {
        auditHeading.closest('.detail-section')?.insertAdjacentHTML(
          'beforebegin',
          invoiceTransferMarkup(state.invoice),
        );
      }
      return;
    }
    modalRoot.innerHTML = '';
  }
  function editorMarkup() {
    const e = state.editor;
    const settings = state.settings || {};
    const currency = e.currencyCode || settings.currencyCode || 'SAR';
    const manual = settings.numberingPolicy?.mode === 'MANUAL';
    const fields = (settings.customFields || []).map((field) => {
      const id = `custom-${esc(field.key)}`;
      const value = e.customFieldValues[field.key];
      if (field.type === 'BOOLEAN') return `<label class="field"><span>${esc(field.label)}${field.required ? ' *' : ''}</span><select class="control" data-custom-key="${esc(field.key)}"><option value="">اختر</option><option value="true" ${value === true ? 'selected' : ''}>نعم</option><option value="false" ${value === false ? 'selected' : ''}>لا</option></select></label>`;
      return `<label class="field"><span>${esc(field.label)}${field.required ? ' *' : ''}</span><input class="control" id="${id}" data-custom-key="${esc(field.key)}" type="${field.type === 'DATE' ? 'date' : 'text'}" maxlength="1000" value="${esc(value ?? '')}" ${field.required ? 'required' : ''}></label>`;
    }).join('');
     return `<div class="overlay" data-action="overlay-close"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title"><header class="dialog-header"><div><h2 id="editor-title">${e.id ? 'تعديل مسودة الفاتورة' : 'مسودة فاتورة جديدة'}</h2><p>المسودة قابلة للتعديل ولا تعني إصدار الفاتورة أو تحصيل مبلغ.</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></header><div class="dialog-body"><form data-form="invoice-editor">${e.currencyChanged ? '<div class="notice">تغيرت العملة المضبوطة منذ إنشاء المسودة. أعد إدخال أسعار جميع البنود بعملة الإعداد الحالية قبل الحفظ.</div>' : ''}<div class="form-grid"><label class="field"><span>اسم المستلم *</span><input class="control" name="recipientName" maxlength="191" required value="${esc(e.recipientName)}"></label><label class="field"><span>تاريخ الفاتورة *</span><input class="control" name="invoiceDate" type="date" required value="${esc(e.invoiceDate)}"></label>${manual ? `<label class="field"><span>رقم الفاتورة اليدوي *</span><input class="control" name="manualInvoiceNumber" maxlength="64" required value="${esc(e.manualInvoiceNumber)}"></label>` : ''}<label class="field"><span>سياسة الضريبة</span><select class="control" name="taxPolicyId"><option value="">غير محددة</option>${(settings.taxPolicies || []).map((policy) => `<option value="${esc(policy.id)}" ${e.taxPolicyId === policy.id ? 'selected' : ''}>${esc(policy.name)}${policy.type === 'NO_TAX' ? ' · بلا ضريبة' : ''}</option>`).join('')}</select></label>${fields ? `<div class="span-all form-grid">${fields}</div>` : ''}<div class="span-all line-editor"><div class="line-editor-head"><h3>بنود الفاتورة</h3><button class="btn btn-secondary btn-small" type="button" data-action="add-line">إضافة بند</button></div>${e.lines.map((line, index) => `<div class="line-row" data-line-index="${index}"><label class="field description-field"><span>وصف البند *</span><input class="control" data-line="description" maxlength="256" required value="${esc(line.description)}"></label><label class="field"><span>الكمية *</span><input class="control mono" data-line="quantity" inputmode="decimal" required value="${esc(line.quantity)}" aria-label="كمية البند ${index + 1}"></label><label class="field"><span>سعر الوحدة (${esc(currency)}) *</span><input class="control mono" data-line="unitPrice" inputmode="decimal" required value="${esc(line.unitPrice)}" aria-label="سعر الوحدة للبند ${index + 1}"></label><button class="line-remove" type="button" data-action="remove-line" data-index="${index}" aria-label="حذف البند ${index + 1}" ${e.lines.length === 1 ? 'disabled' : ''}>حذف</button></div>`).join('')}<div class="line-preview"><span>العملة · ${esc(currency)}. يظهر الإجمالي المعتمد بعد المراجعة وفق سياسة المنشأة.</span><strong>بعد المراجعة</strong></div></div></div>${e.error ? `<div class="inline-message" role="alert" style="margin-top:15px">${esc(message(e.error))}${e.error.status === 409 && e.id ? '<button class="btn btn-secondary btn-small" type="button" data-action="refresh-editor">تحميل النسخة الحالية من الخادم</button>' : ''}</div>` : ''}<div class="dialog-footer"><span class="form-note">تُرسل الكميات بالألف والأسعار بوحدات العملة الصغرى.</span><div class="heading-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">إلغاء</button><button class="btn btn-primary" type="submit" ${e.saving ? 'disabled' : ''}>${e.saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}</button></div></div></form></div></section></div>`;
  }
  function detailMarkup() {
    if (state.detailLoading) return `<div class="overlay"><section class="dialog dialog-narrow" role="dialog" aria-modal="true"><header class="dialog-header"><div><h2>تفاصيل الفاتورة</h2><p>جارٍ تحميل بيانات الفاتورة وسجلها.</p></div><button class="icon-button" data-action="close-modal" type="button" aria-label="إغلاق">×</button></header>${loadingMarkup()}</section></div>`;
    if (state.detailError) return `<div class="overlay"><section class="dialog dialog-narrow" role="dialog" aria-modal="true"><header class="dialog-header"><div><h2>تعذّر تحميل الفاتورة</h2><p>${esc(message(state.detailError))}</p></div><button class="icon-button" data-action="close-modal" type="button" aria-label="إغلاق">×</button></header><div class="dialog-body"><div class="error-state"><button class="btn btn-secondary" type="button" data-action="retry-detail">إعادة المحاولة</button></div></div></section></div>`;
    const invoice = state.invoice;
    if (!invoice) return '';
    const currency = invoice.currencyCode || 'SAR';
    const lines = invoice.lines || [];
    const customFields = Object.entries(invoice.customFieldValues || {}).map(([key, value]) => {
      const field = state.settings?.customFields?.find((item) => item.key === key);
      return `<div class="detail-item"><small>${esc(field?.label || key)}</small><strong>${esc(typeof value === 'boolean' ? value ? 'نعم' : 'لا' : value)}</strong></div>`;
    }).join('');
    const tax = state.settings?.taxPolicies?.find((policy) => policy.id === invoice.taxPolicyId);
    const history = Array.isArray(invoice.history) ? invoice.history : [];
    return `<div class="overlay" data-action="overlay-close"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header class="dialog-header"><div><span class="status-pill" data-status="${esc(invoice.status)}">${statusLabel(invoice.status)}</span><h2 id="detail-title" style="margin-top:9px">${esc(invoice.invoiceNumber || invoice.manualInvoiceNumber || 'مسودة بلا رقم')}</h2><p>${esc(invoice.recipientName)} · ${esc(formatDate(invoice.invoiceDate))}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">×</button></header><div class="dialog-body"><div class="detail-grid"><div class="detail-item"><small>الحالة</small><strong>${statusLabel(invoice.status)}</strong></div><div class="detail-item"><small>العملة</small><strong class="mono">${esc(currency)}</strong></div><div class="detail-item"><small>الإصدار الحالي</small><strong class="mono">${esc(invoice.version)}</strong></div><div class="detail-item"><small>السياسة المرتبطة</small><strong>${esc(invoice.reviewedPolicy?.taxPolicy?.name || tax?.name || 'غير محددة')}</strong></div>${customFields}</div><section class="detail-section"><h3>بنود الفاتورة</h3>${lines.length ? `<div class="table-wrap"><table class="detail-lines"><thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${lines.map((line, index) => `<tr><td>${esc(line.description)}</td><td class="mono">${esc(quantityInput(line.quantityMilli))}</td><td>${formatMinor(line.unitPriceMinor, currency)}</td><td>${formatMinor(invoice.totals?.lineTotalsMinor?.[index], currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="permission-note">لا توجد بنود.</div>'}${invoice.totals ? `<div class="totals"><div class="total-row"><span>المجموع الفرعي</span><strong>${moneyText(invoice.totals.subtotalMinor, currency)}</strong></div><div class="total-row"><span>الضريبة وفق السياسة</span><strong>${moneyText(invoice.totals.taxMinor, currency)}</strong></div><div class="total-row grand"><span>الإجمالي</span><strong>${moneyText(invoice.totals.totalMinor, currency)}</strong></div></div>` : '<p class="form-note">الإجماليات النهائية تظهر بعد مراجعة المسودة.</p>'}</section>${invoice.status === 'ISSUED' ? '<div class="notice">تم إصدار الفاتورة. الإصدار لا يجمع أي مدفوعات ولا ينفذ عملية تحصيل.</div>' : ''}${invoice.status === 'REVIEWED' ? '<div class="notice">تم تثبيت إجماليات المراجعة وفق نسخة السياسات المحفوظة. الإصدار لا يجمع أي مدفوعات.</div>' : ''}<section class="detail-section"><h3>سجل التدقيق</h3>${history.length ? `<div class="history-list">${history.map((event) => `<div class="history-entry"><strong>${({ CREATED: 'إنشاء المسودة', UPDATED: 'تحديث المسودة', REVIEWED: 'مراجعة', RETURNED_TO_DRAFT: 'إعادة إلى المسودة', ISSUED: 'إصدار' })[event.action] || esc(event.action)} · الإصدار ${esc(event.version)}</strong><span>${esc(formatStamp(event.at))}<br>${esc(event.summary || '')}</span></div>`).join('')}</div>` : '<p class="form-note">لا توجد أحداث تدقيق معروضة.</p>'}</section><div class="detail-actions">${invoice.status === 'DRAFT' && allowed(PERMISSIONS.manage) ? '<button class="btn btn-secondary" type="button" data-action="edit-invoice">تعديل المسودة</button>' : ''}${invoice.status === 'DRAFT' && allowed(PERMISSIONS.review) ? '<button class="btn btn-primary" type="button" data-action="review-invoice">إرسال للمراجعة</button>' : ''}${invoice.status === 'REVIEWED' && allowed(PERMISSIONS.review) ? '<button class="btn btn-secondary" type="button" data-action="return-draft">إعادة إلى المسودة</button>' : ''}${invoice.status === 'REVIEWED' && allowed(PERMISSIONS.issue) ? '<button class="btn btn-primary" type="button" data-action="issue-invoice">إصدار الفاتورة</button>' : ''}</div></div></section></div>`;
  }
  function invoiceTransferMarkup(invoice) {
    if (!invoice || invoice.status !== 'ISSUED') return '';
    const bank = state.paymentSettings?.bankTransfer || {};
    const canSubmit = allowed(PERMISSIONS.paymentRead) && allowed(PERMISSIONS.paymentSubmit);
    const canReadTransfers = allowed(PERMISSIONS.paymentRead);
    const canReview = canReadTransfers && allowed(PERMISSIONS.paymentReview);
    if (!canSubmit && !canReadTransfers && !canReview) return '';
    const configured = bank.enabled && bank.bankName && bank.accountHolder && bank.iban &&
      bank.currencyCode && bank.currencyCode === invoice.currencyCode;
    const transfers = state.invoiceTransfers || [];
    const activeTransfer = transfers.find((item) =>
      item.status === 'PENDING_REVIEW' || item.status === 'APPROVED',
    );
    const transferCards = transfers.map((transfer) => {
      const history = Array.isArray(transfer.history) ? transfer.history : [];
      return `<article class="settings-item"><div class="settings-item-row"><div><h3>${transferStatusLabel(transfer.status)}</h3><p>إرسال: ${esc(formatStamp(transfer.submittedAt))} · ${esc(transfer.receiptFileName)}</p></div><button class="btn btn-secondary btn-small" type="button" data-action="download-invoice-transfer" data-id="${esc(transfer.id)}">تنزيل الإيصال</button></div>${transfer.reviewReason ? `<p class="form-note">سبب المراجعة: ${esc(transfer.reviewReason)}</p>` : ''}${history.length ? `<div class="history-list">${history.map((event) => `<div class="history-entry"><strong>${transferStatusLabel(event.action)}</strong><span>${esc(formatStamp(event.at))}${event.reason ? `<br>${esc(event.reason)}` : ''}</span></div>`).join('')}</div>` : ''}${transfer.status === 'PENDING_REVIEW' && canReview ? `<form class="transfer-review-form" data-form="invoice-transfer-review" data-id="${esc(transfer.id)}"><input type="hidden" name="expectedVersion" value="${esc(transfer.version)}"><label class="field"><span>سبب القرار *</span><textarea class="control" name="reason" minlength="3" maxlength="500" required></textarea></label><div class="detail-actions"><button class="btn btn-primary" name="decision" value="approve" type="submit" ${state.transferBusy ? 'disabled' : ''}>قبول الإيصال</button><button class="btn btn-secondary" name="decision" value="reject" type="submit" ${state.transferBusy ? 'disabled' : ''}>رفض الإيصال</button></div></form>` : ''}${transfer.status === 'APPROVED' ? '<p class="notice">تم قبول الإيصال للمراجعة فقط. لا يغيّر ذلك حالة الفاتورة أو يسجل تحصيلًا آليًا.</p>' : ''}</article>`;
    }).join('');
    const uploadForm = canSubmit && configured && !activeTransfer
      ? `<form class="transfer-upload-form" data-form="invoice-transfer"><label class="field"><span>إرفاق إيصال PDF أو JPG أو PNG *</span><input class="control" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required></label><p class="form-note">المبلغ المعروض على الفاتورة: ${moneyText(invoice.totals?.totalMinor, invoice.currencyCode)}. لا يوجد تحصيل تلقائي.</p><button class="btn btn-primary" type="submit" ${state.transferBusy ? 'disabled' : ''}>إرسال الإيصال للمراجعة</button></form>`
      : canSubmit && !configured
        ? '<div class="permission-note">رفع الإيصال غير متاح: التحويل معطّل أو بياناته غير مكتملة أو عملته لا تطابق الفاتورة.</div>'
        : '';
    return `<section class="detail-section"><h3>التحويل البنكي وإيصالات المراجعة</h3>${configured ? `<div class="detail-grid"><div class="detail-item"><small>البنك</small><strong>${esc(bank.bankName)}</strong></div><div class="detail-item"><small>صاحب الحساب</small><strong>${esc(bank.accountHolder)}</strong></div><div class="detail-item"><small>IBAN</small><strong class="mono" dir="ltr">${esc(bank.iban)}</strong></div></div>` : '<p class="form-note">تعليمات التحويل غير مفعّلة أو غير مضبوطة لهذه الفاتورة.</p>'}${state.transferError ? `<div class="inline-message" role="alert">${esc(message(state.transferError))}</div>` : ''}${state.transferLoading ? loadingMarkup() : transferCards || (canReadTransfers ? '<p class="form-note">لا توجد إيصالات مسجلة.</p>' : '')}${uploadForm}<p class="form-note">قبول الإيصال يسجل قرار المراجعة فقط؛ لا يغيّر حالة الفاتورة، ولا ينفذ تحصيلًا أو استردادًا.</p></section>`;
  }
  function transferStatusLabel(status) {
    return ({ PENDING_REVIEW: 'بانتظار المراجعة', APPROVED: 'مقبول', REJECTED: 'مرفوض', SUBMITTED: 'تم الإرسال' })[status] || esc(status);
  }
  function transitionMarkup() {
    const isReturn = state.transition.type === 'return';
    const isReview = state.transition.type === 'review';
    const isIssue = state.transition.type === 'issue';
    const title = isReturn ? 'إعادة الفاتورة إلى المسودة' : isReview ? 'إرسال المسودة للمراجعة' : 'إصدار الفاتورة';
    const subtitle = isReturn ? 'أدخل سبب الإعادة ليظهر في سجل التدقيق.' : isReview ? 'سيتم التحقق من اكتمال الإعدادات ثم تثبيت إجماليات المراجعة.' : 'الإصدار يثبت تفاصيل الفاتورة ولا يجمع أي مدفوعات.';
    const body = isReturn
      ? '<label class="field"><span>سبب الإعادة *</span><textarea class="control" name="reason" maxlength="500" required></textarea></label>'
      : isIssue
        ? '<div class="notice">هل تريد إصدار هذه الفاتورة؟ لن يتم تحصيل أي مبلغ أو تنفيذ دفع.</div>'
        : '<div class="notice">تُراجع السياسة والحقول المطلوبة قبل تثبيت إجماليات الفاتورة.</div>';
    const submitLabel = isReturn ? 'إعادة للمسودة' : isReview ? 'إرسال للمراجعة' : 'تأكيد الإصدار';
    return `<div class="overlay"><section class="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby="transition-title"><header class="dialog-header"><div><h2 id="transition-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" type="button" data-action="close-transition" aria-label="إغلاق">×</button></header><div class="dialog-body"><form data-form="transition">${body}${state.transition.error ? `<div class="inline-message" role="alert" style="margin-top:12px">${esc(message(state.transition.error))}${state.transition.error.status === 409 ? '<button class="btn btn-secondary btn-small" type="button" data-action="refresh-transition">تحميل النسخة الحالية من الخادم</button>' : ''}</div>` : ''}<div class="dialog-footer dialog-footer-end"><button class="btn btn-secondary" type="button" data-action="close-transition">إلغاء</button><button class="btn btn-primary" type="submit" ${state.transition.busy ? 'disabled' : ''}>${state.transition.busy ? 'جارٍ التنفيذ…' : submitLabel}</button></div></form></div></section></div>`;
  }
  function currentInvoice() { return state.invoice; }
  function readEditorFields(form) {
    const data = new FormData(form);
    const e = state.editor;
    e.recipientName = String(data.get('recipientName') || '').trim();
    e.invoiceDate = String(data.get('invoiceDate') || '');
    e.manualInvoiceNumber = String(data.get('manualInvoiceNumber') || '').trim();
    e.taxPolicyId = String(data.get('taxPolicyId') || '');
    const values = {};
    (state.settings?.customFields || []).forEach((field) => {
      const input = form.querySelector(`[data-custom-key="${CSS.escape(field.key)}"]`);
      if (!input || input.value === '') return;
      values[field.key] = field.type === 'BOOLEAN' ? input.value === 'true' : input.value;
    });
    e.customFieldValues = values;
    e.lines = [...form.querySelectorAll('.line-row')].map((row, index) => ({
      id: e.lines[index]?.id || uuid(),
      description: row.querySelector('[data-line="description"]')?.value.trim() || '',
      quantity: row.querySelector('[data-line="quantity"]')?.value.trim() || '',
      unitPrice: row.querySelector('[data-line="unitPrice"]')?.value.trim() || '',
    }));
  }
  function invoicePayload(form) {
    readEditorFields(form);
    const e = state.editor;
    const settings = state.settings || {};
    const lines = e.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantityMilli: decimalFromScaled(line.quantity, 3, 1_000_000),
      unitPriceMinor: decimalFromScaled(line.unitPrice, currencyDigits(e.currencyCode || settings.currencyCode || 'SAR'), Number.MAX_SAFE_INTEGER),
    }));
    const payload = {
      ...(e.id ? { currencyCode: e.currencyCode } : {}),
      recipientName: e.recipientName,
      invoiceDate: e.invoiceDate,
      customFieldValues: e.customFieldValues,
      taxPolicyId: e.taxPolicyId || null,
      lines,
    };
    payload.manualInvoiceNumber = settings.numberingPolicy?.mode === 'MANUAL'
      ? e.manualInvoiceNumber || null
      : null;
    return payload;
  }
  function validateCustomFields(values) {
    const missing = (state.settings?.customFields || []).filter((field) => field.required && (values[field.key] === undefined || values[field.key] === ''));
    if (missing.length) throw new Error(`أكمل الحقول المطلوبة: ${missing.map((item) => item.label).join('، ')}.`);
  }
  async function saveInvoice(form) {
    if (!allowed(PERMISSIONS.manage) || !state.editor || !state.workspace) return;
    const e = state.editor;
    e.saving = true; e.error = null; renderModal();
    try {
      const payload = invoicePayload(form);
      validateCustomFields(payload.customFieldValues);
      if (!payload.recipientName || !payload.invoiceDate) throw new Error('أكمل اسم المستلم وتاريخ الفاتورة.');
      if (payload.lines.some((line) => !line.description || line.quantityMilli < 1)) throw new Error('تحقق من وصف كل بند والكمية.');
      if (state.settings?.numberingPolicy?.mode === 'MANUAL' && !payload.manualInvoiceNumber) throw new Error('أدخل رقم الفاتورة وفق سياسة الترقيم اليدوي.');
      if (e.id) {
        await api.updateClinicInvoice(state.workspace.tenantId, e.id, { expectedVersion: e.version, ...payload });
      } else {
        await api.createClinicInvoice(state.workspace.tenantId, payload);
      }
      state.editor = null; modalRoot.innerHTML = ''; toast('تم حفظ المسودة.');
      state.offset = 0; await loadInvoices();
    } catch (error) {
      if (error.status === 401) return expireSession();
      if (state.editor) { state.editor.saving = false; state.editor.error = error; renderModal(); }
    }
  }
  async function saveSettings(form) {
    if (!allowed(PERMISSIONS.settings) || !state.settings || !state.workspace) return;
    state.savingSettings = true;
    try {
      const formData = new FormData(form);
      const customFields = [];
      form.querySelectorAll('[data-setting-field]').forEach((row) => {
        const key = row.querySelector('[name="fieldKey"]').value.trim();
        const label = row.querySelector('[name="fieldLabel"]').value.trim();
        if (!key && !label) return;
        customFields.push({
          key, label, type: row.querySelector('[name="fieldType"]').value,
          required: row.querySelector('[name="fieldRequired"]').value === 'true',
        });
      });
      const taxPolicies = [];
      form.querySelectorAll('[data-tax-policy]').forEach((row) => {
        const name = row.querySelector('[name="taxName"]').value.trim();
        if (!name) return;
        const type = row.querySelector('[name="taxType"]').value;
        const policy = { id: row.dataset.id || uuid(), name, type };
        if (type === 'RATE') {
          policy.rateBasisPoints = decimalToBasisPoints(row.querySelector('[name="taxRate"]').value);
          policy.calculation = row.querySelector('[name="calculation"]').value;
          policy.rounding = row.querySelector('[name="rounding"]').value;
        }
        taxPolicies.push(policy);
      });
      let numberingPolicy = null;
      const mode = String(formData.get('numberingMode') || '');
      if (mode === 'MANUAL' || mode === 'SEQUENTIAL') {
        numberingPolicy = {
          mode,
          prefix: String(formData.get('prefix') || ''),
          minimumDigits: Number(formData.get('minimumDigits')),
        };
        if (mode === 'SEQUENTIAL') numberingPolicy.startingNumber = Number(formData.get('startingNumber'));
      }
      const input = {
        expectedVersion: state.settings.version,
        currencyCode: String(formData.get('currencyCode') || '').trim().toUpperCase(),
        lineRounding: String(formData.get('lineRounding') || '') || null,
        customFields, taxPolicies, numberingPolicy,
      };
      const updated = await api.updateClinicFinanceSettings(state.workspace.tenantId, input);
      state.settings = updated; state.settingsForm = null; toast('تم حفظ إعدادات الفوترة وتسجيل مراجعتها.');
      render();
    } catch (error) {
      if (error.status === 401) return expireSession();
      state.settingsError = error;
      state.settingsForm = true;
      render();
      const messageNode = document.getElementById('settings-error');
      if (messageNode) { messageNode.hidden = false; messageNode.textContent = message(error); }
    } finally {
      state.savingSettings = false;
      if (state.settingsForm) render();
    }
  }
  async function savePaymentSettings(form) {
    if (!allowed(PERMISSIONS.paymentSettings) || !state.paymentSettings || !state.workspace) return;
    const data = new FormData(form);
    state.savingPaymentSettings = true;
    state.paymentSettingsError = null;
    render();
    try {
      const updated = await api.updateClinicPaymentSettings(state.workspace.tenantId, {
        expectedVersion: Number(data.get('expectedVersion')),
        bankTransfer: {
          enabled: String(data.get('bankTransferEnabled') || 'false') === 'true',
          bankName: String(data.get('bankName') || '').trim() || null,
          accountHolder: String(data.get('accountHolder') || '').trim() || null,
          iban: String(data.get('iban') || '').trim() || null,
          currencyCode: String(data.get('bankTransferCurrency') || '').trim().toUpperCase() || null,
        },
      });
      state.paymentSettings = updated;
      toast('تم حفظ إعدادات التحويل.');
    } catch (error) {
      if (error.status === 401) return expireSession();
      state.paymentSettingsError = error;
    } finally {
      state.savingPaymentSettings = false;
      render();
    }
  }
  async function submitInvoiceTransfer(form) {
    if (!state.invoice || !state.workspace ||
        !allowed(PERMISSIONS.paymentRead) || !allowed(PERMISSIONS.paymentSubmit)) return;
    const file = new FormData(form).get('receipt');
    if (!(file instanceof File) || !file.size) {
      state.transferError = new Error('اختر إيصالًا صالحًا قبل الإرسال.');
      renderModal();
      return;
    }
    const invoiceId = state.invoice.id;
    state.transferBusy = true; state.transferError = null; renderModal();
    try {
      await api.submitClinicInvoiceTransfer(state.workspace.tenantId, invoiceId, file);
      toast('تم حفظ الإيصال بانتظار المراجعة.');
      state.transferBusy = false;
      await openInvoice(invoiceId);
    } catch (error) {
      if (error.status === 401) return expireSession();
      state.transferError = error;
      state.transferBusy = false;
      renderModal();
    }
  }
  async function submitSubscriptionTransfer(form) {
    if (!state.workspace ||
        !allowed(PERMISSIONS.subscriptionRead) ||
        !allowed(PERMISSIONS.subscriptionSubmit)) return;
    const file = new FormData(form).get('receipt');
    if (!(file instanceof File) || !file.size) {
      state.subscriptionError = new Error('اختر إيصالًا صالحًا قبل الإرسال.');
      render();
      return;
    }
    state.subscriptionUploading = true;
    state.subscriptionError = null;
    render();
    try {
      await api.submitTenantSubscriptionTransfer(state.workspace.tenantId, file);
      toast('تم إرسال الإيصال للمراجعة اليدوية.');
      state.subscriptionUploading = false;
      await loadSubscriptionPortal();
    } catch (error) {
      if (error.status === 401) return expireSession();
      state.subscriptionError = error;
      state.subscriptionUploading = false;
      render();
    }
  }
  async function reviewInvoiceTransfer(form, decision) {
    if (!state.invoice || !state.workspace ||
        !allowed(PERMISSIONS.paymentRead) || !allowed(PERMISSIONS.paymentReview)) return;
    if (!['approve', 'reject'].includes(decision)) {
      state.transferError = new Error('اختر قبول الإيصال أو رفضه.');
      renderModal();
      return;
    }
    const data = new FormData(form);
    const invoiceId = state.invoice.id;
    state.transferBusy = true; state.transferError = null; renderModal();
    try {
      await api.reviewClinicInvoiceTransfer(
        state.workspace.tenantId,
        form.dataset.id,
        decision,
        Number(data.get('expectedVersion')),
        String(data.get('reason') || '').trim(),
      );
      toast(decision === 'approve' ? 'تم قبول الإيصال وتسجيل سبب المراجعة.' : 'تم رفض الإيصال وتسجيل السبب.');
      state.transferBusy = false;
      await openInvoice(invoiceId);
    } catch (error) {
      if (error.status === 401) return expireSession();
      state.transferError = error;
      state.transferBusy = false;
      renderModal();
    }
  }
  function decimalToBasisPoints(value) {
    const raw = normalizeDecimal(value);
    if (!/^\d+(?:\.\d{1,2})?$/u.test(raw)) throw new Error('أدخل معدلًا مئويًا يصل إلى منزلتين عشريتين كما قررته الإدارة.');
    const [whole, fraction = ''] = raw.split('.');
    const result = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
    if (result < 1n || result > 1000000n) throw new Error('معدل السياسة خارج الحدود المقبولة.');
    return Number(result);
  }
  function settingsEditor() {
    const s = state.settings || {};
    const numbering = s.numberingPolicy;
     return `<form data-form="settings"><section class="settings-section"><div class="settings-head"><h2>العملة والتقريب</h2><span class="form-note">الإصدار الحالي ${esc(s.version)}</span></div><div class="settings-body"><div class="form-grid"><label class="field"><span>رمز العملة *</span><input class="control mono" name="currencyCode" maxlength="3" required value="${esc(s.currencyCode || 'SAR')}" dir="ltr"></label><label class="field"><span>تقريب بنود الفاتورة</span><select class="control" name="lineRounding"><option value="">غير مضبوط</option>${['HALF_UP','DOWN','UP'].map((value) => `<option value="${value}" ${s.lineRounding === value ? 'selected' : ''}>${roundingLabel(value)}</option>`).join('')}</select></label></div><p class="form-note" style="margin-top:10px">SAR هو الإعداد الابتدائي فقط. لا يُفترض تقريب أو سياسة عند ترك الحقل غير مضبوط.</p></div></section><section class="settings-section"><div class="settings-head"><h2>سياسة الترقيم</h2></div><div class="settings-body"><div class="form-grid"><label class="field"><span>النمط</span><select class="control" name="numberingMode" id="numbering-mode"><option value="">غير مضبوط</option><option value="MANUAL" ${numbering?.mode === 'MANUAL' ? 'selected' : ''}>يدوي</option><option value="SEQUENTIAL" ${numbering?.mode === 'SEQUENTIAL' ? 'selected' : ''}>تسلسلي</option></select></label><label class="field"><span>البادئة</span><input class="control" name="prefix" maxlength="24" value="${esc(numbering?.prefix || '')}"></label><label class="field"><span>الحد الأدنى للأرقام</span><input class="control" name="minimumDigits" type="number" min="1" max="12" value="${esc(numbering?.minimumDigits ?? '')}"></label><label class="field" id="starting-number-field" ${numbering?.mode !== 'SEQUENTIAL' ? 'hidden' : ''}><span>رقم البداية الأولي</span><input class="control" name="startingNumber" type="number" min="1" value="${esc(numbering?.startingNumber ?? '')}"></label></div><p class="form-note" style="margin-top:10px">رقم البداية يهيئ العداد عند أول تفعيل فقط. لا تعيد تغييرات الإعدادات ضبط العداد، ولا توجد إعادة ضبط دورية أو سياسة قانونية مفترضة.</p></div></section><section class="settings-section"><div class="settings-head"><h2>سياسات الضريبة</h2><button class="btn btn-secondary btn-small" type="button" data-action="add-tax">إضافة سياسة</button></div><div class="settings-body"><p class="form-note">لا يُقترح معدل ضريبة. أدخل فقط سياسة اعتمدتها إدارة العيادة. يمكن تعريف خيار بلا ضريبة بشكل صريح.</p><div id="tax-policy-list">${(s.taxPolicies || []).map(taxEditorItem).join('')}</div></div></section><section class="settings-section"><div class="settings-head"><h2>الحقول الإضافية</h2><button class="btn btn-secondary btn-small" type="button" data-action="add-field">إضافة حقل</button></div><div class="settings-body"><div id="custom-field-list">${(s.customFields || []).map(fieldEditorItem).join('')}</div></div></section><div class="inline-message" id="settings-error" role="alert" ${state.settingsError ? '' : 'hidden'}>${state.settingsError ? esc(message(state.settingsError)) : ''} ${state.settingsError ? '<button class="btn btn-secondary btn-small" type="button" data-action="retry-settings">تحميل أحدث إصدار قبل المتابعة</button>' : ''}</div><div class="dialog-footer"><span class="form-note">يحفظ التعديل إصدارًا جديدًا في سجل المراجعات.</span><div class="heading-actions"><button class="btn btn-secondary" type="button" data-action="cancel-settings">إلغاء</button><button class="btn btn-primary" type="submit" ${state.savingSettings ? 'disabled' : ''}>${state.savingSettings ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button></div></div></form>`;
  }
  function taxEditorItem(policy) {
    const isRate = policy.type === 'RATE';
    const basis = isRate ? (policy.rateBasisPoints / 100).toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '') : '';
    return `<div class="settings-item" data-tax-policy data-id="${esc(policy.id)}"><div class="form-grid"><label class="field"><span>اسم السياسة *</span><input class="control" name="taxName" maxlength="80" value="${esc(policy.name)}"></label><label class="field"><span>النوع *</span><select class="control" name="taxType" required><option value="" ${!policy.type ? 'selected' : ''}>حدد النوع صراحةً</option><option value="NO_TAX" ${policy.type === 'NO_TAX' ? 'selected' : ''}>بلا ضريبة</option><option value="RATE" ${isRate ? 'selected' : ''}>معدل محدد من الإدارة</option></select></label><label class="field" ${!isRate ? 'hidden' : ''}><span>المعدل % (تدخله الإدارة)</span><input class="control mono" name="taxRate" inputmode="decimal" ${isRate ? 'required' : ''} value="${esc(basis)}"></label><label class="field" ${!isRate ? 'hidden' : ''}><span>طريقة الحساب</span><select class="control" name="calculation" ${isRate ? 'required' : ''}><option value="" ${!policy.calculation ? 'selected' : ''}>حدد الطريقة</option><option value="PER_LINE" ${policy.calculation === 'PER_LINE' ? 'selected' : ''}>لكل بند</option><option value="SUBTOTAL" ${policy.calculation === 'SUBTOTAL' ? 'selected' : ''}>على المجموع الفرعي</option></select></label><label class="field" ${!isRate ? 'hidden' : ''}><span>طريقة التقريب</span><select class="control" name="rounding" ${isRate ? 'required' : ''}><option value="" ${!policy.rounding ? 'selected' : ''}>حدد الطريقة</option>${['HALF_UP','DOWN','UP'].map((value) => `<option value="${value}" ${policy.rounding === value ? 'selected' : ''}>${roundingLabel(value)}</option>`).join('')}</select></label><div class="field"><span>إجراء</span><button class="btn btn-quiet btn-small" type="button" data-action="remove-setting-item">حذف السياسة</button></div></div></div>`;
  }
  function fieldEditorItem(field) {
    return `<div class="settings-item" data-setting-field><div class="form-grid"><label class="field"><span>المعرّف *</span><input class="control mono" name="fieldKey" maxlength="32" pattern="[a-z][a-zA-Z0-9_]{0,31}" value="${esc(field.key)}" dir="ltr"></label><label class="field"><span>الاسم الظاهر *</span><input class="control" name="fieldLabel" maxlength="100" value="${esc(field.label)}"></label><label class="field"><span>نوع الحقل</span><select class="control" name="fieldType">${['TEXT','DATE','BOOLEAN'].map((type) => `<option value="${type}" ${field.type === type ? 'selected' : ''}>${({ TEXT: 'نص', DATE: 'تاريخ', BOOLEAN: 'نعم أو لا' })[type]}</option>`).join('')}</select></label><label class="field"><span>مطلوب</span><select class="control" name="fieldRequired"><option value="false" ${!field.required ? 'selected' : ''}>لا</option><option value="true" ${field.required ? 'selected' : ''}>نعم</option></select></label><div class="field"><span>إجراء</span><button class="btn btn-quiet btn-small" type="button" data-action="remove-setting-item">حذف الحقل</button></div></div></div>`;
  }
  function openTransition(type) {
    if (!state.invoice) return;
    if (type === 'return' && !allowed(PERMISSIONS.review)) return;
    if (type === 'issue' && !allowed(PERMISSIONS.issue)) return;
    state.transition = { type, busy: false, error: null };
    renderModal();
  }
  async function submitTransition(form) {
    const transition = state.transition;
    const invoice = currentInvoice();
    if (!transition || !invoice || !state.workspace) return;
    transition.busy = true; transition.error = null; renderModal();
    try {
      let updated;
      if (transition.type === 'review') {
        if (!allowed(PERMISSIONS.review)) return;
        updated = await api.reviewClinicInvoice(state.workspace.tenantId, invoice.id, invoice.version);
      } else if (transition.type === 'return') {
        if (!allowed(PERMISSIONS.review)) return;
        const reason = String(new FormData(form).get('reason') || '').trim();
        if (!reason) throw new Error('أدخل سبب إعادة الفاتورة إلى المسودة.');
        updated = await api.returnClinicInvoiceToDraft(state.workspace.tenantId, invoice.id, invoice.version, reason);
      } else {
        if (!allowed(PERMISSIONS.issue)) return;
        updated = await api.issueClinicInvoice(state.workspace.tenantId, invoice.id, invoice.version);
      }
      state.transition = null; state.invoice = updated; toast(transition.type === 'review' ? 'تمت مراجعة الفاتورة.' : transition.type === 'return' ? 'أعيدت الفاتورة إلى المسودة.' : 'تم إصدار الفاتورة. لم يتم تحصيل أي مبلغ.');
      await loadInvoices(); renderModal();
    } catch (error) {
      if (error.status === 401) return expireSession();
      if (state.transition) { state.transition.busy = false; state.transition.error = error; renderModal(); }
    }
  }
  async function onSubmit(event) {
    const form = event.target;
    const type = form?.dataset?.form;
    if (!type) return;
    event.preventDefault();
    if (type === 'signin') {
      const data = new FormData(form);
      state.busy = true; state.screenMessage = ''; render();
      try { await api.login(String(data.get('email') || '').trim(), String(data.get('password') || '')); state.busy = false; await loadWorkspaces(); }
      catch (error) { state.busy = false; state.screenMessage = message(error); render(); }
    } else if (type === 'filters') {
      const data = new FormData(form);
      state.search = String(data.get('search') || '').trim();
      state.statusFilter = String(data.get('status') || '');
      state.offset = 0; await loadInvoices();
    } else if (type === 'invoice-editor') {
      await saveInvoice(form);
    } else if (type === 'settings') {
      await saveSettings(form);
    } else if (type === 'payment-settings') {
      await savePaymentSettings(form);
    } else if (type === 'transition') {
      await submitTransition(form);
    } else if (type === 'invoice-transfer') {
      await submitInvoiceTransfer(form);
    } else if (type === 'subscription-transfer') {
      await submitSubscriptionTransfer(form);
    } else if (type === 'invoice-transfer-review') {
      await reviewInvoiceTransfer(form, event.submitter?.value);
    }
  }
  function onChange(event) {
    const target = event.target;
    if (target.name === 'taxType') {
      const row = target.closest('[data-tax-policy]');
      row?.querySelectorAll('[name="taxRate"],[name="calculation"],[name="rounding"]').forEach((node) => {
        const enabled = target.value === 'RATE';
        node.closest('.field').hidden = !enabled;
        node.required = enabled;
      });
    }
    if (target.id === 'numbering-mode') {
      const field = document.getElementById('starting-number-field');
      if (field) field.hidden = target.value !== 'SEQUENTIAL';
    }
    if (target.name === 'bankTransferEnabled') {
      const enabled = target.value === 'true';
      target.form?.querySelectorAll('[name="bankName"],[name="accountHolder"],[name="iban"],[name="bankTransferCurrency"]')
        .forEach((field) => { field.required = enabled; });
    }
    if (target.dataset.customKey && state.editor) {
      state.editor.customFieldValues[target.dataset.customKey] = target.type === 'checkbox' ? target.checked : target.value;
    }
  }
  async function logout() {
    try { await api.logout(); } catch (_) { /* local session cleanup still follows */ }
    expireSession();
  }
  async function switchWorkspace() {
    clearWorkspaceData();
    state.workspace = null;
    if (state.workspaces.length > 1) { state.screen = 'select'; render(); }
    else await loadWorkspaces();
  }
  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'overlay-close' && event.target === button) { closeModal(); return; }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'close-transition') { state.transition = null; renderModal(); return; }
    if (action === 'choose-workspace') { await chooseWorkspace(state.workspaces[Number(button.dataset.index)]); return; }
    if (action === 'logout') { await logout(); return; }
    if (action === 'switch-workspace') { await switchWorkspace(); return; }
    if (action === 'retry') { await bootstrap(); return; }
    if (action === 'retry-invoices') { await loadInvoices(); return; }
    if (action === 'retry-subscription' && allowed(PERMISSIONS.subscriptionRead)) {
      await loadSubscriptionPortal(); return;
    }
    if (action === 'retry-settings') { state.settingsForm = null; state.settingsError = null; await loadSettings(); return; }
    if (action === 'retry-payment-settings') { await loadPaymentSettings(); return; }
    if (action === 'retry-detail') { if (state.detailId) await openInvoice(state.detailId); return; }
    if (action === 'download-invoice-transfer') {
      if (!state.workspace || !allowed(PERMISSIONS.paymentRead)) return;
      try {
        await api.downloadClinicInvoiceTransferReceipt(state.workspace.tenantId, id);
      } catch (error) {
        if (error.status === 401) return expireSession();
        state.transferError = error; renderModal();
      }
      return;
    }
    if (action === 'refresh-editor') {
      const invoiceId = state.editor?.id;
      state.editor = null;
      if (invoiceId) await openInvoice(invoiceId);
      return;
    }
    if (action === 'refresh-transition') {
      const invoiceId = state.invoice?.id;
      state.transition = null;
      if (invoiceId) await openInvoice(invoiceId);
      return;
    }
    if (action === 'view-invoices' && canRead()) { await changeView('invoices'); return; }
    if (action === 'view-settings' && (allowed(PERMISSIONS.settings) || allowed(PERMISSIONS.paymentSettings) || allowed(PERMISSIONS.paymentRead))) { await changeView('settings'); return; }
    if (action === 'view-subscription' && allowed(PERMISSIONS.subscriptionRead)) {
      await changeView('subscription'); return;
    }
    if (action === 'new-invoice') { openEditor(null); return; }
    if (action === 'open-invoice' && canRead()) { await openInvoice(id); return; }
    if (action === 'edit-invoice' && state.invoice?.status === 'DRAFT' && allowed(PERMISSIONS.manage)) { const invoice = state.invoice; state.detailId = null; openEditor(invoice); return; }
    if (action === 'review-invoice' && state.invoice?.status === 'DRAFT' && allowed(PERMISSIONS.review)) { state.transition = { type: 'review', busy: false, error: null }; renderModal(); return; }
    if (action === 'return-draft') { openTransition('return'); return; }
    if (action === 'issue-invoice') { openTransition('issue'); return; }
    if (action === 'previous') { state.offset = Math.max(0, state.offset - PAGE_SIZE); await loadInvoices(); return; }
    if (action === 'next' && state.hasNext) { state.offset += PAGE_SIZE; await loadInvoices(); return; }
    if (action === 'edit-settings' && allowed(PERMISSIONS.settings)) { state.settingsForm = true; state.settingsError = null; render(); return; }
    if (action === 'cancel-settings') { state.settingsForm = null; state.settingsError = null; render(); return; }
    if (action === 'add-line' && state.editor) {
      if (state.editor.lines.length >= 50) { toast('الحد الأقصى هو 50 بندًا للفاتورة.', true); return; }
      readEditorFields(button.closest('form'));
      state.editor.lines.push({ id: uuid(), description: '', quantity: '', unitPrice: '' });
      renderModal(); return;
    }
    if (action === 'remove-line' && state.editor && state.editor.lines.length > 1) { readEditorFields(button.closest('form')); state.editor.lines.splice(Number(button.dataset.index), 1); renderModal(); return; }
    if (action === 'add-tax') {
      const list = document.getElementById('tax-policy-list');
      if (list && list.children.length < 20) list.insertAdjacentHTML('beforeend', taxEditorItem({ id: uuid(), name: '', type: '' }));
      else toast('الحد الأقصى هو 20 سياسة ضريبية.', true);
      return;
    }
    if (action === 'add-field') {
      const list = document.getElementById('custom-field-list');
      if (list && list.children.length < 20) list.insertAdjacentHTML('beforeend', fieldEditorItem({ key: '', label: '', type: 'TEXT', required: false }));
      else toast('الحد الأقصى هو 20 حقلًا إضافيًا.', true);
      return;
    }
    if (action === 'remove-setting-item') { button.closest('.settings-item')?.remove(); return; }
  }
  function closeModal() {
    state.editor = null; state.invoice = null; state.detailId = null; state.detailError = null;
    state.detailLoading = false; state.transition = null; state.invoiceTransfers = [];
    state.transferError = null; state.transferBusy = false; modalRoot.innerHTML = '';
  }
})();
