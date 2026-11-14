(function startAiAdmin() {
  'use strict';

  const api = window.ThanarahApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void bootstrap();
  });
  const app = document.getElementById('app');
  const P = {
    read: 'tenant.ai.read',
    agentsManage: 'tenant.ai.manage',
    knowledgeManage: 'tenant.ai.knowledge.manage',
    budgetManage: 'tenant.ai.budget.manage',
    run: 'tenant.ai.run',
  };
  const state = {
    screen: 'boot', workspaces: [], workspace: null, tab: 'overview',
    providers: [], tools: [], agents: [], knowledge: [], budget: null,
    usage: null, audit: [], loading: {}, errors: {}, saving: false,
    error: '', success: '', agentForm: null, knowledgeForm: false,
    testAgentId: '', runResult: null, toast: '', epoch: 0,
  };
  let toastTimer = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/gu, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const allowed = (key) => {
    const codes = state.workspace?.permissionCodes || [];
    return codes.includes(P[key]);
  };
  const rows = (result) => Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
  const val = (value) => value == null || value === '' ? '—' : value;
  const providerName = (id) => state.providers.find((item) => item.id === id)?.label || id || '—';
  const toolName = (id) => state.tools.find((item) => item.id === id)?.label || id;
  const fmtNum = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('ar').format(Number(value)) : '—';
  const dateLabel = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(
      window.ThanarahLocale?.dateLocale('ar') || 'ar',
      { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    ).format(date);
  };
  const statusLabel = (status) => ({
    ACTIVE: 'نشط', INACTIVE: 'غير نشط', DISABLED: 'موقوف', DRAFT: 'مسودة',
    SUCCESS: 'مكتمل', SUCCEEDED: 'مكتمل', FAILED: 'فشل', PENDING: 'قيد المعالجة',
    AVAILABLE: 'متاح', BLOCKED: 'محجوب', READY: 'جاهز',
  })[status] || status || 'غير محدد';
  const statusClass = (status) => ['FAILED', 'DISABLED', 'INACTIVE', 'BLOCKED'].includes(status) ? 'bad' : ['PENDING', 'DRAFT'].includes(status) ? 'off' : '';
  const runResultText = (response) => {
    const result = typeof response === 'string'
      ? response
      : response && typeof response === 'object'
        ? response.result ?? response.output ?? response.response ?? response.text ?? response.data?.result
        : response;
    if (result == null) return 'اكتمل الاختبار دون نتيجة نصية.';
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  };
  const msg = (error) => {
    if (error?.status === 401) return 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.';
    if (error?.status === 403) return 'لا تملك الصلاحية المطلوبة. راجع مسؤول مساحة العمل.';
    if (error?.status === 404) return 'لم تعد البيانات المطلوبة متاحة. حدّث الصفحة وحاول مجددًا.';
    if (error?.status === 503) return 'الخدمة أو التخزين غير متاح مؤقتًا. أعد المحاولة لاحقًا.';
    return typeof error?.message === 'string' ? error.message : 'تعذّر إكمال الطلب. راجع الاتصال ثم أعد المحاولة.';
  };

  document.addEventListener('submit', onSubmit);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  void bootstrap();

  async function bootstrap() {
    state.screen = 'boot';
    render();
    if (!api) {
      state.screen = 'error';
      state.error = 'تعذّر تحميل خدمة مساحة العمل. أعد تحميل الصفحة أو تواصل مع مسؤول النظام.';
      return render();
    }
    try {
      if (!(await api.restoreSession())) return renderLogin();
      await loadWorkspaces();
    } catch (error) {
      state.screen = error?.status === 403 ? 'denied' : 'error';
      state.error = msg(error);
      render();
    }
  }

  async function loadWorkspaces() {
    state.screen = 'workspaces-loading';
    render();
    try {
      const result = await api.listWorkspaces();
      state.workspaces = rows(result);
      if (!state.workspaces.length) {
        state.screen = 'none';
        render();
      } else if (state.workspaces.length === 1) {
        await chooseWorkspace(state.workspaces[0]);
      } else {
        state.screen = 'select';
        render();
      }
    } catch (error) {
      if (error?.status === 401) return renderLogin(msg(error));
      state.error = msg(error);
      state.screen = error?.status === 403 ? 'denied' : 'error';
      render();
    }
  }

  function clearTenantData() {
    state.epoch += 1;
    state.providers = []; state.tools = []; state.agents = []; state.knowledge = [];
    state.budget = null; state.usage = null; state.audit = [];
    state.loading = {}; state.errors = {}; state.agentForm = null;
    state.knowledgeForm = false; state.testAgentId = ''; state.runResult = null; state.success = '';
  }

  async function chooseWorkspace(workspace) {
    clearTenantData();
    if (!workspace || typeof workspace.tenantId !== 'string' || !Array.isArray(workspace.permissionCodes)) {
      state.screen = 'none';
      return render();
    }
    state.workspace = workspace;
    state.screen = 'workspace';
    state.tab = 'overview';
    render();
    await loadTenantData();
  }

  function renderLogin(error = '') {
    state.screen = 'signin';
    state.error = error;
    render();
  }

  function brand() {
    return '<div class="ai-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><small>THANARAH · AI WORKSPACE</small></div></div>';
  }

  function screenCard(title, text, action = '', actionLabel = '') {
    app.innerHTML = `<section class="ai-screen"><div class="ai-auth-card">${brand()}<span class="ai-eyebrow">إدارة الذكاء الاصطناعي</span><h1>${esc(title)}</h1><p class="ai-intro">${esc(text)}</p>${state.error ? `<div class="ai-alert" role="alert">${esc(state.error)}</div>` : ''}${action ? `<div style="margin-top:18px"><button class="ai-btn ai-btn-secondary" type="button" data-action="${esc(action)}">${esc(actionLabel)}</button></div>` : ''}<p class="ai-screen-note">تُدار الإعدادات ضمن مساحة عمل واحدة، ولا تُدمج مع سير العمل السريري.</p></div></section>`;
  }

  async function loadTenantData() {
    const workspace = state.workspace;
    if (!workspace) return;
    const epoch = state.epoch;
    const tenantId = workspace.tenantId;
    state.errors = {};
    const jobs = [];
    const request = (key, method, assign, canRead = true) => {
      if (!canRead) return;
      state.loading[key] = true;
      jobs.push(api[method](tenantId).then((result) => {
        if (epoch === state.epoch && state.workspace === workspace) assign(result);
      }).catch((error) => {
        if (epoch !== state.epoch || state.workspace !== workspace) return;
        if (error?.status === 401) {
          state.workspace = null;
          return renderLogin(msg(error));
        }
        state.errors[key] = msg(error);
      }).finally(() => {
        if (epoch === state.epoch && state.workspace === workspace) {
          state.loading[key] = false;
          render();
        }
      }));
    };
    const canRead = allowed('read');
    request('providers', 'listAiProviders', (r) => { state.providers = rows(r); }, canRead);
    request('tools', 'listAiTools', (r) => { state.tools = rows(r); }, canRead);
    request('agents', 'listAiAgents', (r) => { state.agents = rows(r); }, canRead);
    request('knowledge', 'listAiKnowledge', (r) => { state.knowledge = rows(r); }, canRead);
    request('budget', 'getAiBudget', (r) => { state.budget = r?.budget || r; }, canRead);
    request('usage', 'getAiUsage', (r) => { state.usage = r; }, canRead);
    request('audit', 'listAiAudit', (r) => { state.audit = rows(r); }, canRead);
    render();
    await Promise.all(jobs);
    if (epoch === state.epoch && state.workspace === workspace) render();
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'select') return renderWorkspaceSelect();
    if (state.screen === 'boot' || state.screen === 'workspaces-loading') {
      return screenCard('جارٍ التحقق من مساحة العمل', 'نتحقق من جلسة الدخول والعضويات المرتبطة بحسابك.');
    }
    if (state.screen === 'none') return screenCard('لا توجد مساحة متاحة', 'لا توجد مساحة عمل مرتبطة بحسابك حاليًا.', 'logout', 'تسجيل الخروج');
    if (state.screen === 'denied') return screenCard('الوصول محدود', 'تعذّر التحقق من صلاحية الوصول إلى مساحة العمل. لم يتم تحميل إعدادات الذكاء الاصطناعي.', 'logout', 'تسجيل الخروج');
    if (state.screen === 'error') return screenCard('تعذّر فتح مساحة العمل', 'تعذّر استعادة بيانات الدخول أو تحميل العضويات.', 'retry', 'إعادة المحاولة');
    if (!state.workspace) return screenCard('انتهت الجلسة', 'سجّل الدخول مرة أخرى للمتابعة.', 'retry', 'إعادة المحاولة');
    if (!allowed('read')) {
      return screenCard('الوصول محدود', 'تتطلب هذه الصفحة صلاحية قراءة واحدة على الأقل لإعدادات الذكاء الاصطناعي. لم يتم تحميل بيانات الإدارة.', 'switch-workspace', 'اختيار مساحة أخرى');
    }
    app.innerHTML = shell();
    if (state.toast) {
      const toast = document.createElement('div');
      toast.className = 'ai-toast'; toast.setAttribute('role', 'status');
      toast.textContent = state.toast; app.appendChild(toast);
    }
  }

  function renderSignIn() {
    app.innerHTML = `<section class="ai-screen"><div class="ai-auth-card">${brand()}<span class="ai-eyebrow">مساحة عمل محمية</span><h1>تسجيل الدخول</h1><p class="ai-intro">سجّل الدخول لمراجعة إعدادات مساعدي الذكاء الاصطناعي ضمن صلاحيات منشأتك.</p>${state.error ? `<div class="ai-alert" role="alert">${esc(state.error)}</div>` : ''}<form class="ai-form" data-form="signin"><label class="ai-field">البريد الإلكتروني<input name="email" type="email" autocomplete="username" required></label><label class="ai-field">كلمة المرور<input name="password" type="password" autocomplete="current-password" required></label><button class="ai-btn ai-btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ تسجيل الدخول…' : 'دخول إلى مساحة العمل'}</button></form><p class="ai-screen-note">لا تحفظ الصفحة بيانات الدخول في التخزين المحلي.</p></div></section>`;
  }

  function renderWorkspaceSelect() {
    app.innerHTML = `<section class="ai-screen"><div class="ai-auth-card">${brand()}<span class="ai-eyebrow">نطاق الوصول</span><h1>اختر مساحة العمل</h1><p class="ai-intro">تُعرض بيانات وإعدادات مساحة واحدة في كل مرة. اختيار مساحة أخرى لا ينقل أي إعدادات بينها.</p><div class="ai-workspace-list">${state.workspaces.map((workspace, index) => `<button type="button" class="ai-workspace-option" data-action="choose" data-index="${index}"><span><strong>${esc(workspace.displayName || 'مساحة عمل')}</strong><small dir="ltr">${esc(workspace.tenantId)}</small></span><span aria-hidden="true">←</span></button>`).join('')}</div><button class="ai-btn ai-btn-quiet" type="button" data-action="logout">تسجيل الخروج</button></div></section>`;
  }

  function navButton(tab, label, index) {
    return `<button type="button" data-action="tab" data-tab="${tab}" aria-current="${state.tab === tab ? 'page' : 'false'}"><span class="ai-nav-index">${index}</span><span>${label}</span></button>`;
  }

  function shell() {
    const name = esc(state.workspace.displayName || state.workspace.slug || 'مساحة العمل');
    const nav = [
      ['overview', 'نظرة عامة', '01', true],
      ['agents', 'مساعدو الذكاء الاصطناعي', '02', allowed('read')],
      ['knowledge', 'مصادر المعرفة', '03', allowed('read')],
      ['budget', 'الميزانية والاستخدام', '04', allowed('read')],
      ['audit', 'سجل التدقيق', '05', allowed('read')],
    ].filter((x) => x[3]);
    return `<div class="ai-app"><div class="ai-shell"><aside class="ai-sidebar"><a class="ai-brand" href="/appointments/" aria-label="ثناره — مساحة العمل"><img src="/assets/logo-transparent.png" alt=""><span><strong>ثناره</strong><small>THANARAH</small></span></a><div class="ai-side-kicker">إدارة مساحة العمل</div><nav class="ai-nav" aria-label="أقسام الذكاء الاصطناعي">${nav.map((item) => navButton(...item.slice(0, 3))).join('')}</nav><div class="ai-side-bottom"><div class="ai-scope">مساحة نشطة<strong>${name}</strong></div><div class="ai-session-actions"><button type="button" data-action="switch-workspace">تبديل المساحة</button><button type="button" data-action="logout">خروج</button></div></div></aside><section class="ai-main"><header class="ai-topbar"><div class="ai-breadcrumb">إدارة مساحة العمل <span aria-hidden="true">/</span> <strong>الذكاء الاصطناعي</strong></div><div class="ai-top-actions"><span class="ai-workspace-chip" title="${name}">${name}</span><button class="ai-btn ai-btn-quiet ai-btn-small" type="button" data-action="refresh">تحديث</button></div></header><main class="ai-content">${pageMarkup()}</main></section></div><nav class="ai-bottom-mobile" aria-label="التنقل">${nav.map((item) => `<button type="button" data-action="tab" data-tab="${item[0]}" aria-current="${state.tab === item[0] ? 'page' : 'false'}"><span>${item[2]}</span><span>${item[1]}</span></button>`).join('')}</nav></div>`;
  }

  function pageMarkup() {
    const title = {
      overview: 'إدارة الذكاء الاصطناعي', agents: 'مساعدو الذكاء الاصطناعي',
      knowledge: 'مصادر المعرفة', budget: 'الميزانية والاستخدام', audit: 'سجل التدقيق',
    }[state.tab] || 'إدارة الذكاء الاصطناعي';
    return `<div class="ai-page-head"><div><span class="ai-eyebrow">تهيئة آمنة · نطاق مستقل لكل منشأة</span><h1>${title}</h1><p>إعداد مساعدات محدودة النطاق ومراجعة الاستهلاك دون دمجها في سير العمل السريري.</p></div><div class="ai-actions">${state.tab === 'agents' && allowed('agentsManage') ? '<button class="ai-btn ai-btn-primary" type="button" data-action="new-agent">إضافة مساعد</button>' : ''}${state.tab === 'knowledge' && allowed('knowledgeManage') ? '<button class="ai-btn ai-btn-primary" type="button" data-action="new-knowledge">إضافة مصدر</button>' : ''}</div></div>${state.error ? `<div class="ai-alert" role="alert">${esc(state.error)}</div>` : ''}${state.success ? `<div class="ai-alert success" role="status">${esc(state.success)}</div>` : ''}${state.tab === 'overview' ? overviewMarkup() : ''}${state.tab === 'agents' ? agentsPage() : ''}${state.tab === 'knowledge' ? knowledgePage() : ''}${state.tab === 'budget' ? budgetPage() : ''}${state.tab === 'audit' ? auditPage() : ''}`;
  }

  function overviewMarkup() {
    return `<div class="ai-notice"><div><strong>حماية البيانات أولًا</strong>تُقبل للاختبار فقط المطالبات الاصطناعية التي تبدأ حرفيًا بـ <bdi dir="ltr">[SYNTHETIC]</bdi>. لا تُدخل بيانات مرضى أو بيانات شخصية في مصادر المعرفة، ولا تستخدم هذه المساحة ضمن سير العمل السريري.</div></div><div class="ai-overview">${usagePanel()}${providersPanel()}</div><div class="ai-data-grid"><section class="ai-section">${agentListPanel(true)}</section><section class="ai-section">${knowledgeListPanel(true)}</section></div>`;
  }

  function sectionError(key, title) {
    if (!state.errors[key]) return '';
    return `<div class="ai-alert" role="alert"><strong>تعذّر تحميل ${title}.</strong> ${esc(state.errors[key])}<div style="margin-top:9px"><button class="ai-btn ai-btn-secondary ai-btn-small" type="button" data-action="retry-section" data-section="${key}">إعادة المحاولة</button></div></div>`;
  }

  function skeleton() {
    return '<div class="ai-panel ai-skeleton" aria-label="جارٍ التحميل"><span class="ai-skeleton-line"></span><span class="ai-skeleton-line"></span><span class="ai-skeleton-line"></span></div>';
  }

  function usagePanel() {
    const usage = state.usage;
    if (state.loading.usage && !usage) return skeleton();
    const monthly = usage?.monthlyUsage || usage?.currentMonth || usage?.monthly || usage;
    const used = Number(monthly?.usedTokens || 0);
    const reserved = Number(monthly?.reservedTokens || 0);
    const limit = Number(monthly?.limit || monthly?.monthlyTokenLimit || state.budget?.monthlyTokenLimit || 0);
    const percent = limit > 0 ? Math.min(100, Math.round((used + reserved) / limit * 100)) : 0;
    return `<section class="ai-panel"><div class="ai-panel-head"><div><h2>استهلاك الشهر</h2><p>استخدام تقديري وحد شهري لمساحة العمل الحالية.</p></div><button class="ai-btn ai-btn-quiet ai-btn-small" type="button" data-action="tab" data-tab="budget">التفاصيل</button></div>${state.errors.usage ? `<div class="ai-panel-body">${sectionError('usage', 'الاستخدام')}</div>` : `<div class="ai-panel-body"><div class="ai-usage-number"><strong>${fmtNum(used)}</strong><span>من ${fmtNum(limit)} رمزًا</span></div><div class="ai-progress" role="img" aria-label="استهلاك ${percent} بالمئة"><span style="width:${percent}%"></span></div><div class="ai-usage-meta"><span>محجوز ${fmtNum(reserved)}</span><span>${percent}% من الحد</span></div></div>`}</section>`;
  }

  function providersPanel() {
    if (state.loading.providers && !state.providers.length) return skeleton();
    return `<section class="ai-panel"><div class="ai-panel-head"><div><h2>موفرو الخدمة</h2><p>الحالة المعروضة مأخوذة من إعدادات المنشأة.</p></div></div><div class="ai-panel-body">${sectionError('providers', 'موفري الخدمة')}${state.errors.providers ? '' : state.providers.length ? `<div class="ai-provider-list">${state.providers.map((provider) => {
      const configured = provider.configured === true;
      const enabled = provider.enabled === true;
      return `<div class="ai-provider"><div class="ai-provider-name"><strong>${esc(provider.label || provider.id)}</strong><small>${configured ? 'إعداد مساحة العمل مكتمل' : 'لم يكتمل الإعداد'}</small></div><span class="ai-status ${!configured || !enabled ? 'off' : ''}">${!configured ? 'غير متاح' : enabled ? 'مهيأ حسب الإعداد' : 'معطّل'}</span></div>`;
    }).join('')}</div>` : empty('لا توجد بيانات موفري خدمة', 'لم تُرجع الخدمة موفرين لهذه المساحة.')}</div></section>`;
  }

  function empty(title, text, button = '') {
    return `<div class="ai-empty"><strong>${esc(title)}</strong><p>${esc(text)}</p>${button ? `<div style="margin-top:12px">${button}</div>` : ''}</div>`;
  }

  function agentListPanel(compact = false) {
    if (!allowed('read')) return empty('الصلاحية غير متاحة', 'تتطلب قراءة المساعدين صلاحية tenant.ai.read.');
    if (state.loading.agents && !state.agents.length) return skeleton();
    if (state.errors.agents) return sectionError('agents', 'المساعدين');
    return state.agents.length
      ? `<div class="ai-list">${state.agents.slice(0, compact ? 4 : undefined).map(agentCard).join('')}</div>`
      : empty('لا توجد مساعدات بعد', 'أنشئ إعدادًا محدود النطاق عند توفر صلاحية الإدارة.', allowed('agentsManage') && compact ? '<button class="ai-btn ai-btn-primary ai-btn-small" type="button" data-action="new-agent">إضافة مساعد</button>' : '');
  }

  function agentCard(agent) {
    const provider = state.providers.find((item) => item.id === agent.provider);
    const unavailable = !provider || provider.configured !== true || provider.enabled !== true;
    return `<article class="ai-card-item"><div class="ai-item-top"><h3>${esc(agent.name)}</h3><span class="ai-status ${statusClass(agent.status)}">${esc(statusLabel(agent.status))}</span></div>${agent.description ? `<p class="ai-item-copy">${esc(agent.description)}</p>` : ''}<div class="ai-meta"><span>المزوّد: ${esc(providerName(agent.provider))}</span><span>النموذج: <code>${esc(val(agent.model))}</code></span><span>الأدوات: ${fmtNum((agent.allowedTools || []).length)}</span><span>آخر تحديث: ${dateLabel(agent.updatedAt)}</span></div>${unavailable ? '<div class="ai-alert warning" style="margin-top:10px">المزوّد غير متاح لهذه المساحة لعدم اكتمال الإعداد أو تعطيله.</div>' : ''}<div class="ai-item-actions">${allowed('agentsManage') ? `<button class="ai-btn ai-btn-secondary ai-btn-small" type="button" data-action="edit-agent" data-id="${esc(agent.id)}">تعديل الإعداد</button>` : ''}${allowed('run') && agent.status === 'ACTIVE' && !unavailable ? `<button class="ai-btn ai-btn-quiet ai-btn-small" type="button" data-action="test-agent" data-id="${esc(agent.id)}">اختبار اصطناعي</button>` : ''}</div>${state.testAgentId === agent.id ? testForm(agent) : ''}</article>`;
  }

  function agentsPage() {
    return `<div class="ai-notice"><div><strong>اختبار مضبوط</strong>تُقبل فقط المطالبات الاصطناعية التي تبدأ بـ <bdi dir="ltr">[SYNTHETIC]</bdi>. لا تضع بيانات مرضى أو بيانات شخصية. لن تظهر المطالبة أو نتيجة الاستدلال في سجل الاستخدام أو التدقيق.</div></div>${state.runResult ? `<section class="ai-panel ai-run-result" aria-live="polite"><div class="ai-panel-head"><div><h2>نتيجة الاختبار الاصطناعي</h2><p>تُعرض مؤقتًا في الصفحة الحالية فقط، ولا تُحفظ في سجل الاستخدام أو التدقيق.</p></div><button class="ai-btn ai-btn-quiet ai-btn-small" type="button" data-action="clear-run-result">إخفاء</button></div><div class="ai-panel-body"><pre class="ai-result-text">${esc(state.runResult.text)}</pre></div></section>` : ''}${state.agentForm ? agentFormMarkup() : ''}<div class="ai-section-title"><div><h2>إعدادات المساعدين</h2><p>حالة كل إعداد وأدواته ومزوّده.</p></div></div>${agentListPanel(false)}`;
  }

  function providerOptions(selected) {
    const hasSelectedProvider = state.providers.some((provider) => provider.id === selected);
    const missingSelected = selected && !hasSelectedProvider
      ? `<option value="${esc(selected)}" selected>${esc(selected)} — غير متاح للاختبار</option>`
      : '';
    return missingSelected + state.providers.map((provider) => {
      const available = provider.configured === true && provider.enabled === true;
      return `<option value="${esc(provider.id)}" ${selected === provider.id ? 'selected' : ''}>${esc(provider.label || provider.id)}${available ? '' : ' — غير متاح للاختبار'}</option>`;
    }).join('');
  }

  function agentFormMarkup() {
    const form = state.agentForm;
    const agent = form.agent;
    const selectedTools = agent?.allowedTools || [];
    return `<section class="ai-form-panel" aria-label="${form.id ? 'تعديل مساعد' : 'مساعد جديد'}"><h3>${form.id ? 'تعديل إعداد المساعد' : 'إعداد مساعد جديد'}</h3>${form.error ? `<div class="ai-alert" role="alert">${esc(form.error)}</div>` : ''}<form class="ai-inline-form" data-form="agent"><div class="ai-form-row"><label class="ai-field">اسم المساعد *<input name="name" required maxlength="191" value="${esc(agent?.name || '')}"></label><label class="ai-field">المزوّد *<select name="provider" required><option value="">اختر موفرًا مهيأ</option>${providerOptions(agent?.provider)}</select></label></div><div class="ai-form-row"><label class="ai-field">النموذج *<input name="model" required maxlength="191" dir="ltr" value="${esc(agent?.model || '')}"></label><label class="ai-field">الحالة<select name="status"><option value="ACTIVE" ${agent?.status === 'ACTIVE' || !agent ? 'selected' : ''}>نشط</option><option value="INACTIVE" ${agent?.status === 'INACTIVE' ? 'selected' : ''}>غير نشط</option></select></label></div><label class="ai-field">وصف موجز<textarea name="description" maxlength="1000">${esc(agent?.description || '')}</textarea></label><label class="ai-field">تعليمات المساعد *<textarea name="instructions" required maxlength="10000">${esc(agent?.instructions || '')}</textarea></label><div class="ai-field"><span>الأدوات المسموح بها</span>${state.tools.length ? `<div class="ai-checkbox-grid">${state.tools.map((tool) => `<label class="ai-check"><input type="checkbox" name="allowedTools" value="${esc(tool.id)}" ${selectedTools.includes(tool.id) ? 'checked' : ''}><span>${esc(tool.label || tool.id)}</span></label>`).join('')}</div>` : '<div class="ai-alert warning">لا توجد أدوات معروضة لهذه المساحة. يمكن حفظ المساعد دون أدوات إذا سمحت السياسة.</div>'}</div><div class="ai-item-actions"><button class="ai-btn ai-btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ إعداد المساعد'}</button><button class="ai-btn ai-btn-quiet" type="button" data-action="cancel-agent">إلغاء</button></div></form></section>`;
  }

  function testForm(agent) {
    return `<form class="ai-form-panel ai-inline-form" data-form="run" data-id="${esc(agent.id)}"><h3>اختبار اصطناعي فقط</h3><label class="ai-field">مطالبة الاختبار *<textarea name="prompt" required maxlength="2000" placeholder="[SYNTHETIC] اكتب سيناريو اختبار غير حقيقي"></textarea></label><p class="ai-meta">يجب أن تبدأ المطالبة بـ <code>[SYNTHETIC]</code>. لا تستخدم بيانات شخصية أو سريرية.</p>${state.errors.run ? `<div class="ai-alert" role="alert">${esc(state.errors.run)}</div>` : ''}<div class="ai-item-actions"><button class="ai-btn ai-btn-primary ai-btn-small" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الاختبار…' : 'إرسال اختبار اصطناعي'}</button><button class="ai-btn ai-btn-quiet ai-btn-small" type="button" data-action="cancel-test">إلغاء</button></div></form>`;
  }

  function knowledgeListPanel(compact = false) {
    if (!allowed('read')) return empty('الصلاحية غير متاحة', 'تتطلب قراءة مصادر المعرفة صلاحية tenant.ai.read.');
    if (state.loading.knowledge && !state.knowledge.length) return skeleton();
    if (state.errors.knowledge) return sectionError('knowledge', 'مصادر المعرفة');
    return state.knowledge.length
      ? `<div class="ai-list">${state.knowledge.slice(0, compact ? 4 : undefined).map(knowledgeCard).join('')}</div>`
      : empty('لا توجد مصادر معرفة', 'أضف محتوى عامًا وآمنًا إذا كانت لديك صلاحية الإدارة.', allowed('knowledgeManage') && compact ? '<button class="ai-btn ai-btn-primary ai-btn-small" type="button" data-action="new-knowledge">إضافة مصدر</button>' : '');
  }

  function knowledgeCard(item) {
    return `<article class="ai-card-item"><div class="ai-item-top"><h3>${esc(item.title)}</h3><span class="ai-status ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span></div><div class="ai-meta"><span>النوع: ${esc(item.kind)}</span><span>أُنشئ: ${dateLabel(item.createdAt)}</span><span>آخر تحديث: ${dateLabel(item.updatedAt)}</span></div><p class="ai-item-copy">${esc(item.content)}</p>${allowed('knowledgeManage') ? `<div class="ai-item-actions"><button class="ai-btn ai-btn-danger ai-btn-small" type="button" data-action="delete-knowledge" data-id="${esc(item.id)}">حذف المصدر</button></div>` : ''}</article>`;
  }

  function knowledgePage() {
    return `<div class="ai-notice"><div><strong>تنبيه خصوصية مهم</strong>لا تُدخل بيانات مرضى أو أي بيانات شخصية في مصادر المعرفة. أضف محتوى مؤسسيًا عامًا ومصرحًا به فقط، وراجع الصلاحيات قبل الحفظ.</div></div>${state.knowledgeForm ? knowledgeFormMarkup() : ''}<div class="ai-section-title"><div><h2>مصادر مساحة العمل</h2><p>محتوى المعرفة المحفوظ ضمن هذا المستأجر فقط.</p></div></div>${knowledgeListPanel(false)}`;
  }

  function knowledgeFormMarkup() {
    return `<section class="ai-form-panel"><h3>مصدر معرفة جديد</h3>${state.errors.knowledgeCreate ? `<div class="ai-alert" role="alert">${esc(state.errors.knowledgeCreate)}</div>` : ''}<form class="ai-inline-form" data-form="knowledge"><div class="ai-form-row"><label class="ai-field">عنوان المصدر *<input name="title" required maxlength="191"></label><label class="ai-field">النوع *<input name="kind" required maxlength="64" placeholder="سياسة أو دليل عام"></label></div><label class="ai-field">المحتوى *<textarea name="content" required maxlength="20000"></textarea></label><div class="ai-alert warning">لا تُدخل بيانات مرضى أو بيانات شخصية. الإضافة تحفظ المصدر ضمن مساحة العمل الحالية.</div><div class="ai-item-actions"><button class="ai-btn ai-btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ المصدر'}</button><button class="ai-btn ai-btn-quiet" type="button" data-action="cancel-knowledge">إلغاء</button></div></form></section>`;
  }

  function budgetPage() {
    const budget = state.budget;
    const usage = state.usage?.monthlyUsage || state.usage?.currentMonth || state.usage?.monthly || state.usage;
    return `<div class="ai-data-grid"><section class="ai-section"><div class="ai-section-title"><div><h2>حدود الميزانية</h2><p>حدود الرموز المطبقة على مساحة العمل.</p></div></div>${state.loading.budget && !budget ? skeleton() : state.errors.budget ? sectionError('budget', 'الميزانية') : budget ? `<section class="ai-panel"><div class="ai-panel-body">${allowed('budgetManage') ? `<form class="ai-inline-form" data-form="budget"><label class="ai-field">الحد الشهري للرموز<input name="monthlyTokenLimit" type="number" min="0" step="1" required value="${esc(budget.monthlyTokenLimit ?? '')}"></label><div class="ai-form-row"><label class="ai-field">الحد الأقصى للمدخلات<input name="maxInputTokens" type="number" min="0" step="1" required value="${esc(budget.maxInputTokens ?? '')}"></label><label class="ai-field">الحد الأقصى للمخرجات<input name="maxOutputTokens" type="number" min="0" step="1" required value="${esc(budget.maxOutputTokens ?? '')}"></label></div><button class="ai-btn ai-btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'حفظ الحدود'}</button></form>` : `<div class="ai-provider-list"><div class="ai-provider"><span>الحد الشهري</span><strong>${fmtNum(budget.monthlyTokenLimit)}</strong></div><div class="ai-provider"><span>حد المدخلات</span><strong>${fmtNum(budget.maxInputTokens)}</strong></div><div class="ai-provider"><span>حد المخرجات</span><strong>${fmtNum(budget.maxOutputTokens)}</strong></div></div>`}</div></section>` : empty('لا توجد بيانات ميزانية', 'تعذّر تحميل حدود الرموز لهذه المساحة.')}</section><section class="ai-section"><div class="ai-section-title"><div><h2>ملخص الاستخدام</h2><p>الشهر الحالي حسب بيانات الخدمة.</p></div></div>${state.loading.usage && !state.usage ? skeleton() : state.errors.usage ? sectionError('usage', 'الاستخدام') : usage ? `<section class="ai-panel"><div class="ai-panel-body"><div class="ai-provider-list">${[['الشهر', usage.month], ['المستخدم', fmtNum(usage.usedTokens)], ['محجوز', fmtNum(usage.reservedTokens)], ['الحد', fmtNum(usage.limit)]].map(([label, value]) => `<div class="ai-provider"><span>${label}</span><strong>${esc(val(value))}</strong></div>`).join('')}</div></div></section>` : empty('لا توجد بيانات استخدام', 'لا يوجد ملخص استخدام متاح الآن.')}</section></div><div class="ai-section-title"><div><h2>سجل الاستهلاك</h2><p>بيانات تشغيل ومقادير رموز فقط؛ لا تُعرض المطالبات أو نتائج الاستدلال.</p></div></div>${usageItemsMarkup()}`;
  }

  function usageItemsMarkup() {
    const items = rows(state.usage?.items || state.usage?.usageItems);
    if (state.loading.usage && !state.usage) return skeleton();
    if (state.errors.usage) return sectionError('usage', 'الاستخدام');
    if (!items.length) return empty('لا توجد سجلات استخدام', 'لا تتوفر عناصر استخدام لهذه الفترة.');
    return `<div class="ai-table-wrap"><table class="ai-table"><thead><tr><th>المساعد</th><th>المزوّد</th><th>النموذج</th><th>مدخلات تقديرية</th><th>مخرجات تقديرية</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${items.map((item) => `<tr><td><code>${esc(item.agentId)}</code></td><td>${esc(providerName(item.provider))}</td><td><code>${esc(item.model)}</code></td><td>${fmtNum(item.inputTokenEstimate)}</td><td>${fmtNum(item.outputTokenEstimate)}</td><td><span class="ai-status ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span></td><td>${dateLabel(item.occurredAt)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function auditPage() {
    if (state.loading.audit && !state.audit.length) return skeleton();
    if (state.errors.audit) return sectionError('audit', 'سجل التدقيق');
    if (!state.audit.length) return empty('لا توجد أحداث تدقيق', 'لم تُرجع الخدمة أحداثًا لمساحة العمل هذه.');
    return `<div class="ai-notice"><div><strong>سجل إداري فقط</strong>لا يعرض هذا السجل المطالبات أو محتوى الاستدلال؛ يقتصر على بيانات الإجراء والهدف ومعلومات الاستخدام الوصفية.</div></div><div class="ai-table-wrap" style="margin-top:14px"><table class="ai-table"><thead><tr><th>الفاعل</th><th>الإجراء</th><th>الهدف</th><th>المزوّد</th><th>النموذج</th><th>تقدير الرموز</th><th>التاريخ</th></tr></thead><tbody>${state.audit.map((item) => `<tr><td><code>${esc(item.actorUserId)}</code></td><td>${esc(item.action)}</td><td><code>${esc(item.targetId)}</code></td><td>${esc(providerName(item.provider))}</td><td><code>${esc(item.model)}</code></td><td>${fmtNum(item.tokenEstimate)}</td><td>${dateLabel(item.occurredAt)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function onSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const type = form.dataset.form;
    const fd = new FormData(form);
    const get = (key) => String(fd.get(key) || '').trim();
    if (type === 'signin') {
      state.saving = true; state.error = ''; render();
      try {
        await api.login(get('email'), String(fd.get('password') || ''));
        state.saving = false;
        await loadWorkspaces();
      } catch (error) {
        state.saving = false; state.error = msg(error); renderSignIn(state.error);
      }
      return;
    }
    if (!state.workspace || state.saving) return;
    const tenantId = state.workspace.tenantId;
    const epoch = state.epoch;
    state.saving = true; state.success = '';
    if (type === 'run') { state.errors.run = ''; state.runResult = null; }
    if (type === 'knowledge') state.errors.knowledgeCreate = '';
    if (state.agentForm) state.agentForm.error = '';
    render();
    try {
      if (type === 'agent') {
        if (!allowed('agentsManage')) throw new Error('يتطلب إنشاء المساعد أو تعديله صلاحية tenant.ai.manage.');
        const input = {
          name: get('name'), description: get('description'),
          instructions: get('instructions'), provider: get('provider'), model: get('model'),
          status: get('status'), allowedTools: fd.getAll('allowedTools').map(String),
        };
        if (state.agentForm?.id) await api.updateAiAgent(tenantId, state.agentForm.id, input);
        else await api.createAiAgent(tenantId, input);
        if (epoch !== state.epoch) return;
        state.agentForm = null;
        await loadTenantData();
        if (epoch === state.epoch) setSuccess('تم حفظ إعداد المساعد.');
      } else if (type === 'knowledge') {
        if (!allowed('knowledgeManage')) throw new Error('يتطلب حفظ مصادر المعرفة صلاحية tenant.ai.knowledge.manage.');
        await api.createAiKnowledge(tenantId, { title: get('title'), kind: get('kind'), content: get('content') });
        if (epoch !== state.epoch) return;
        state.knowledgeForm = false;
        await loadTenantData();
        if (epoch === state.epoch) setSuccess('تم حفظ مصدر المعرفة.');
      } else if (type === 'budget') {
        if (!allowed('budgetManage')) throw new Error('يتطلب حفظ حدود الميزانية صلاحية tenant.ai.budget.manage.');
        await api.saveAiBudget(tenantId, {
          monthlyTokenLimit: Number(get('monthlyTokenLimit')),
          maxInputTokens: Number(get('maxInputTokens')),
          maxOutputTokens: Number(get('maxOutputTokens')),
        });
        if (epoch !== state.epoch) return;
        await loadTenantData();
        if (epoch === state.epoch) setSuccess('تم حفظ حدود الميزانية.');
      } else if (type === 'run') {
        if (!allowed('run')) throw new Error('يتطلب تشغيل الاختبار الاصطناعي صلاحية tenant.ai.run.');
        const prompt = get('prompt');
        if (!prompt.startsWith('[SYNTHETIC]')) throw new Error('يجب أن تبدأ المطالبة بـ [SYNTHETIC]. لا تُدخل بيانات مرضى أو بيانات شخصية.');
        const response = await api.runAiAgent(tenantId, form.dataset.id, prompt);
        if (epoch !== state.epoch) return;
        state.runResult = { agentId: form.dataset.id, text: runResultText(response) };
        state.testAgentId = '';
        state.errors.run = '';
        await loadTenantData();
        if (epoch === state.epoch) setSuccess('اكتمل الاختبار الاصطناعي. تظهر النتيجة مؤقتًا في هذه الصفحة فقط؛ ولا تُعرض المطالبة في سجل الاستخدام أو التدقيق.');
      }
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (error?.status === 401) {
        state.saving = false; state.workspace = null; return renderLogin(msg(error));
      }
      if (type === 'run') state.errors.run = msg(error);
      else if (type === 'knowledge') state.errors.knowledgeCreate = msg(error);
      else if (type === 'agent' && state.agentForm) state.agentForm.error = msg(error);
      else state.error = msg(error);
    } finally {
      if (epoch === state.epoch) {
        state.saving = false;
        render();
      }
    }
  }

  function setSuccess(text) {
    state.success = text;
    render();
  }

  function onChange(event) {
    if (event.target.matches('[data-action="tab-select"]')) {
      state.tab = event.target.value;
      render();
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'logout') return logout();
    if (action === 'retry') return bootstrap();
    if (action === 'choose') return chooseWorkspace(state.workspaces[Number(button.dataset.index)]);
    if (action === 'switch-workspace') {
      clearTenantData(); state.workspace = null;
      if (state.workspaces.length > 1) { state.screen = 'select'; render(); }
      else await loadWorkspaces();
      return;
    }
    if (action === 'tab') {
      state.tab = button.dataset.tab; state.success = ''; state.error = ''; render(); return;
    }
    if (action === 'refresh') return loadTenantData();
    if (action === 'new-agent' && allowed('agentsManage')) {
      state.agentForm = { id: null, agent: null, error: '' }; render(); return;
    }
    if (action === 'edit-agent' && allowed('agentsManage')) {
      const agent = state.agents.find((item) => item.id === id);
      if (agent) state.agentForm = { id, agent, error: '' };
      render(); return;
    }
    if (action === 'cancel-agent') { state.agentForm = null; render(); return; }
    if (action === 'new-knowledge' && allowed('knowledgeManage')) {
      state.knowledgeForm = true; state.errors.knowledgeCreate = ''; render(); return;
    }
    if (action === 'cancel-knowledge') { state.knowledgeForm = false; render(); return; }
    if (action === 'delete-knowledge' && allowed('knowledgeManage')) {
      if (!window.confirm('حذف مصدر المعرفة من مساحة العمل؟ لا يمكن التراجع عن هذا الإجراء.')) return;
      return mutate('knowledge', async () => api.deleteAiKnowledge(state.workspace.tenantId, id), 'تم حذف مصدر المعرفة.');
    }
    if (action === 'test-agent' && allowed('run')) {
      state.testAgentId = id; state.errors.run = ''; render(); return;
    }
    if (action === 'cancel-test') { state.testAgentId = ''; state.errors.run = ''; render(); return; }
    if (action === 'clear-run-result') { state.runResult = null; render(); return; }
    if (action === 'retry-section') return retrySection(button.dataset.section);
  }

  async function retrySection(section) {
    if (!allowed('read')) return;
    const calls = {
      providers: ['listAiProviders', (r) => { state.providers = rows(r); }],
      tools: ['listAiTools', (r) => { state.tools = rows(r); }],
      agents: ['listAiAgents', (r) => { state.agents = rows(r); }],
      knowledge: ['listAiKnowledge', (r) => { state.knowledge = rows(r); }],
      budget: ['getAiBudget', (r) => { state.budget = r?.budget || r; }],
      usage: ['getAiUsage', (r) => { state.usage = r; }],
      audit: ['listAiAudit', (r) => { state.audit = rows(r); }],
    };
    const entry = calls[section];
    if (!entry || !state.workspace) return;
    state.loading[section] = true; delete state.errors[section]; render();
    const epoch = state.epoch;
    try {
      const result = await api[entry[0]](state.workspace.tenantId);
      if (epoch === state.epoch) entry[1](result);
    } catch (error) {
      if (epoch === state.epoch) {
        if (error?.status === 401) { state.workspace = null; return renderLogin(msg(error)); }
        state.errors[section] = msg(error);
      }
    } finally {
      if (epoch === state.epoch) { state.loading[section] = false; render(); }
    }
  }

  async function mutate(section, task, success) {
    if (state.saving || !state.workspace) return;
    const epoch = state.epoch;
    state.saving = true; state.error = ''; state.success = ''; render();
    try {
      await task();
      if (epoch !== state.epoch) return;
      await retrySection(section);
      if (epoch === state.epoch && !state.errors[section]) setSuccess(success);
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (error?.status === 401) { state.workspace = null; return renderLogin(msg(error)); }
      state.error = msg(error); render();
    } finally {
      if (epoch === state.epoch) { state.saving = false; render(); }
    }
  }

  async function logout() {
    try { await api.logout(); } catch (_) { /* Clear the local session UI even if logout cannot reach the server. */ }
    clearTenantData();
    state.workspace = null; state.workspaces = [];
    renderLogin();
  }
})();
