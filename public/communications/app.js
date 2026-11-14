(function startCommunicationsWorkspace() {
  'use strict';

  const api = window.ThanarahApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void bootstrap();
  });
  const root = document.getElementById('app');
  const permissions = {
    read: 'tenant.communications.read',
    manage: 'tenant.communications.manage',
    consent: 'tenant.communications.consent.manage',
    simulate: 'tenant.communications.simulate',
  };
  const state = {
    screen: 'boot',
    workspaces: [],
    workspace: null,
    providers: [],
    policy: null,
    events: [],
    consent: null,
    simulation: null,
    error: '',
    success: '',
    loading: false,
    saving: false,
  };

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/gu, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
  const allowed = (permission) =>
    (state.workspace?.permissionCodes || []).includes(permissions[permission]);
  const listItems = (result) =>
    Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
  const message = (error) => {
    if (error?.status === 401) return 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.';
    if (error?.status === 403) return 'لا تملك الصلاحية المطلوبة في هذه المساحة.';
    if (error?.status === 503) return 'التخزين أو موفر الخدمة غير متاح. لم يتم أي إرسال.';
    return error?.message || 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  };

  document.addEventListener('submit', onSubmit);
  document.addEventListener('click', onClick);
  void bootstrap();

  async function bootstrap() {
    if (!api) return renderFatal('تعذّر تحميل خدمة مساحة العمل.');
    try {
      if (!(await api.restoreSession())) return renderSignIn();
      const result = await api.listWorkspaces();
      state.workspaces = listItems(result);
      if (state.workspaces.length === 1) return chooseWorkspace(state.workspaces[0]);
      if (!state.workspaces.length) {
        state.screen = 'none';
        return render();
      }
      state.screen = 'select';
      render();
    } catch (error) {
      if (error?.status === 401) return renderSignIn();
      renderFatal(message(error));
    }
  }

  function clearWorkspaceData() {
    state.providers = [];
    state.policy = null;
    state.events = [];
    state.consent = null;
    state.simulation = null;
    state.error = '';
    state.success = '';
  }

  async function chooseWorkspace(workspace) {
    clearWorkspaceData();
    state.workspace = workspace;
    state.screen = 'workspace';
    render();
    await loadWorkspace();
  }

  async function loadWorkspace() {
    if (!state.workspace || !allowed('read')) return render();
    state.loading = true;
    state.error = '';
    render();
    const tenantId = state.workspace.tenantId;
    const results = await Promise.allSettled([
      api.listCommunicationProviders(tenantId),
      api.getCommunicationPolicy(tenantId),
      api.listCommunicationEvents(tenantId, { limit: 50 }),
    ]);
    if (state.workspace?.tenantId !== tenantId) return;
    const unauthorized = results.find(
      (result) => result.status === 'rejected' && result.reason?.status === 401,
    );
    if (unauthorized) {
      state.loading = false;
      state.workspace = null;
      return renderSignIn();
    }
    state.providers = results[0].status === 'fulfilled' ? listItems(results[0].value) : [];
    state.policy = results[1].status === 'fulfilled' ? results[1].value : null;
    state.events = results[2].status === 'fulfilled' ? listItems(results[2].value) : [];
    const failed = results.find((result) => result.status === 'rejected');
    state.error = failed?.reason ? message(failed.reason) : '';
    state.loading = false;
    render();
  }

  function renderSignIn() {
    state.screen = 'signin';
    root.innerHTML = `<section class="screen"><div class="auth-card"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span><strong>ثناره</strong><small>THANARAH</small></span></a><p class="eyebrow">مساحة عمل محمية</p><h1>تسجيل الدخول</h1><p class="intro">راجع تفضيلات التواصل وسجل الحالة ضمن صلاحيات منشأتك.</p><form class="form" data-form="login"><label>البريد الإلكتروني<input type="email" name="email" autocomplete="username" required></label><label>كلمة المرور<input type="password" name="password" autocomplete="current-password" required></label><button class="button primary" type="submit" ${state.saving ? 'disabled' : ''}>دخول إلى مساحة العمل</button></form><p class="note">لا تحفظ الصفحة بيانات الدخول في التخزين المحلي.</p></div></section>`;
  }

  function renderFatal(text) {
    state.screen = 'fatal';
    state.error = text;
    render();
  }

  function render() {
    if (state.screen === 'signin') return renderSignIn();
    if (state.screen === 'fatal') {
      root.innerHTML = `<section class="screen"><div class="auth-card"><p class="eyebrow">قنوات التواصل</p><h1>تعذّر فتح مساحة العمل</h1><p class="alert error" role="alert">${esc(state.error)}</p><button class="button secondary" type="button" data-action="retry">إعادة المحاولة</button></div></section>`;
      return;
    }
    if (state.screen === 'none') {
      root.innerHTML = `<section class="screen"><div class="auth-card"><p class="eyebrow">قنوات التواصل</p><h1>لا توجد مساحة عمل متاحة</h1><p class="intro">لا توجد عضوية مرتبطة بحسابك.</p><button class="button secondary" type="button" data-action="logout">خروج</button></div></section>`;
      return;
    }
    if (state.screen === 'select') {
      root.innerHTML = `<section class="screen"><div class="auth-card"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span><strong>ثناره</strong><small>THANARAH</small></span></a><p class="eyebrow">نطاق البيانات</p><h1>اختر مساحة العمل</h1><p class="intro">تُعرض بيانات مساحة واحدة في كل مرة.</p><div class="workspace-list">${state.workspaces.map((workspace, index) => `<button class="workspace-option" type="button" data-action="choose" data-index="${index}"><strong>${esc(workspace.displayName || 'مساحة عمل')}</strong><small dir="ltr">${esc(workspace.tenantId)}</small></button>`).join('')}</div><button class="button quiet" type="button" data-action="logout">تسجيل الخروج</button></div></section>`;
      return;
    }
    if (!state.workspace) return renderSignIn();
    if (!allowed('read')) {
      root.innerHTML = `<section class="screen"><div class="auth-card"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span><strong>ثناره</strong><small>THANARAH</small></span></a><p class="eyebrow">الوصول محدود</p><h1>الصلاحية غير متاحة</h1><p class="intro">تتطلب الصفحة صلاحية tenant.communications.read. لم تُحمّل بيانات التواصل.</p><button class="button quiet" type="button" data-action="switch">اختيار مساحة أخرى</button></div></section>`;
      return;
    }
    root.innerHTML = `<div class="layout"><header class="topbar"><a class="brand" href="/appointments/"><img src="/assets/logo-transparent.png" alt=""><span><strong>ثناره</strong><small>THANARAH</small></span></a><div class="top-actions"><span class="workspace-label">${esc(state.workspace.displayName || state.workspace.slug || 'مساحة العمل')}</span><button class="button quiet small" type="button" data-action="switch">تبديل المساحة</button><button class="button quiet small" type="button" data-action="logout">خروج</button></div></header><main class="content"><div class="page-heading"><div><p class="eyebrow">إدارة مساحة العمل · خصوصية أولًا</p><h1>قنوات التواصل والأتمتة</h1><p class="intro">إدارة موافقات التواصل، سياسات الاحتفاظ، واختبارات اصطناعية دون اتصال حي.</p></div><button class="button secondary" type="button" data-action="refresh" ${state.loading ? 'disabled' : ''}>${state.loading ? 'جارٍ التحديث…' : 'تحديث'}</button></div>${state.error ? `<p class="alert error" role="alert">${esc(state.error)}</p>` : ''}${state.success ? `<p class="alert success" role="status">${esc(state.success)}</p>` : ''}<section class="notice" role="note"><strong>الإرسال والمكالمات الحية معطّلة</strong><p>لم يتم اختيار موفر أو إعداد بيانات اعتماد. جميع سيناريوهات الاختبار محلية، ولا تُخزّن نصوص الرسائل أو أرقام الاتصال أو حمولات الويب هوك.</p></section><div class="grid"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">حالة الاتصال</p><h2>موفرو الخدمة</h2></div></div><div class="provider-list">${state.providers.length ? state.providers.map(providerRow).join('') : '<p class="muted">لا توجد موفّرات حية مهيّأة.</p>'}</div></section>${policyPanel()}${consentPanel()}${simulationPanel()}</div><section class="panel events"><div class="panel-heading"><div><p class="eyebrow">سجل محدود</p><h2>حالات التسليم والمحاكاة</h2><p class="muted">يعرض السجل رموز الحالة والوقت فقط، ولا يعرض الرسالة أو بيانات الاتصال.</p></div></div>${state.events.length ? `<div class="table-wrap"><table><thead><tr><th>القناة</th><th>النوع</th><th>الحالة</th><th>القالب</th><th>المحاولات</th><th>الوقت</th></tr></thead><tbody>${state.events.map(eventRow).join('')}</tbody></table></div>` : '<p class="empty">لا توجد أحداث ضمن فترة الاحتفاظ الحالية.</p>'}</section></main></div>`;
  }

  function providerRow(provider) {
    const label = provider.channel === 'WHATSAPP' ? 'WhatsApp' : 'الصوت';
    return `<div class="provider-row"><div><strong>${label}</strong><small>${provider.configured ? 'مهيأ' : 'غير مهيأ'}</small></div><span class="status disabled">${provider.liveEnabled ? 'مفعّل' : 'معطّل'}</span></div>`;
  }

  function policyPanel() {
    const policy = state.policy || {};
    return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">سياسة المنشأة</p><h2>الاحتفاظ وإعادة المحاولة</h2></div></div><p class="muted">يلزم تحديد سياسة الاحتفاظ التي تعتمدها المنشأة قبل حفظ أحداث المحاكاة أو قبول أحداث موفر. لا يؤدي ضبط هذه القيم إلى تفعيل الإرسال. إعداد عدد المحاولات يوثّق السياسة فقط؛ إعادة المحاولة الآلية غير مفعّلة.</p>${allowed('manage') ? `<form class="form compact" data-form="policy"><label>مدة الاحتفاظ بالأحداث بالأيام<input type="number" name="retentionDays" min="1" step="1" value="${policy.retentionDays ?? ''}" placeholder="مطلوب للتسجيل"></label><label>الحد الأقصى للمحاولات<input type="number" name="maxRetryAttempts" min="0" step="1" value="${Number(policy.maxRetryAttempts ?? 0)}"></label><button class="button primary" type="submit" ${state.saving ? 'disabled' : ''}>حفظ السياسة</button></form>` : `<p class="read-only">الاحتفاظ: ${esc(policy.retentionDays ?? 'غير محدد')} يوم · إعادة المحاولة: ${esc(policy.maxRetryAttempts ?? 0)}</p>`}</section>`;
  }

  function consentPanel() {
    return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">تفضيلات التواصل</p><h2>الموافقة والإيقاف</h2></div></div><p class="muted">أدخل معرّف المريض الداخلي فقط؛ لا تدخل اسمه أو رقم هاتفه. الإيقاف محفوظ لكل قناة على حدة.</p>${allowed('consent') ? `<form class="form compact" data-form="consent"><label>معرّف المريض<input name="subjectRef" maxlength="36" dir="ltr" placeholder="UUID" required></label><label>القناة<select name="channel"><option value="WHATSAPP">WhatsApp</option><option value="VOICE">الصوت</option></select></label><label>الحالة<select name="status"><option value="OPTED_OUT">موقوف</option><option value="OPTED_IN">موافق</option></select></label><label>مصدر الموافقة<select name="source"><option value="PATIENT_DIRECT">من المريض مباشرة</option><option value="STAFF_RECORDED">سجّلها الموظف</option></select></label><label>مرجع إثبات غير شخصي<input name="evidenceRef" maxlength="128" dir="ltr" placeholder="مطلوب للموافقة"></label><label>اللغة<select name="language"><option value="">غير محددة</option><option value="ar">العربية</option><option value="en">English</option></select></label><div class="form-actions"><button class="button primary" type="submit" ${state.saving ? 'disabled' : ''}>حفظ التفضيل</button><button class="button secondary" type="button" data-action="load-consent">عرض التفضيل</button></div></form>` : '<p class="read-only">لا تملك صلاحية تعديل الموافقات.</p>'}${state.consent ? `<div class="consent-result"><strong>${state.consent.status === 'OPTED_IN' ? 'موافقة مسجلة' : 'الإيقاف مسجل'}</strong><span>${state.consent.channel === 'WHATSAPP' ? 'WhatsApp' : 'الصوت'} · اللغة ${esc(state.consent.language || 'غير محددة')} · آخر تحديث ${esc(formatDate(state.consent.updatedAt))}</span></div>` : ''}</section>`;
  }

  function simulationPanel() {
    return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">بيانات اصطناعية فقط</p><h2>اختبار محاكاة</h2></div></div><p class="muted">لا يُرسل هذا الاختبار رسالة ولا يُجري مكالمة. يجب أن يبدأ مرجع المستلم بـ <code>synthetic:</code>.</p>${allowed('simulate') ? `<form class="form compact" data-form="simulate"><label>مرجع اصطناعي<input name="subjectRef" value="synthetic:demo" maxlength="73" dir="ltr" required></label><label>القناة<select name="channel"><option value="WHATSAPP">WhatsApp</option><option value="VOICE">الصوت</option></select></label><label>سيناريو محكوم<select name="template"><option value="APPOINTMENT_REMINDER">تذكير موعد</option><option value="HUMAN_HANDOFF_NOTICE">إشعار تصعيد لموظف</option></select></label><button class="button primary" type="submit" ${state.saving ? 'disabled' : ''}>تشغيل المحاكاة</button></form>` : '<p class="read-only">لا تملك صلاحية تشغيل المحاكاة.</p>'}${state.simulation ? `<div class="simulation-result"><strong>${esc(statusLabel(state.simulation.status))}</strong><span>${state.simulation.liveSent ? 'تم الإرسال' : 'لم يحدث إرسال حي.'}${state.simulation.recorded ? ' حُفظت حالة اصطناعية وفق مدة الاحتفاظ.' : ' لم يُحفظ حدث لعدم اكتمال سياسة الاحتفاظ.'}</span></div>` : ''}</section>`;
  }

  function eventRow(event) {
    const channel = event.channel === 'WHATSAPP' ? 'WhatsApp' : 'الصوت';
    const type = {
      SIMULATION: 'محاكاة',
      DELIVERY_STATUS: 'تسليم',
      CALL_STATUS: 'مكالمة',
      HANDOFF_STATUS: 'تسليم بشري',
      AUTOMATION_BLOCKED: 'إيقاف آلي',
      CONSENT_CHANGED: 'تفضيل',
    }[event.type] || event.type;
    return `<tr><td>${channel}</td><td>${type}</td><td>${esc(statusLabel(event.status))}</td><td>${esc(event.template || '—')}</td><td>${Number(event.attemptCount) || 0}</td><td>${esc(formatDate(event.occurredAt))}</td></tr>`;
  }

  function statusLabel(status) {
    return ({
      SIMULATED: 'محاكاة فقط',
      BLOCKED_CONSENT: 'محجوب: لا توجد موافقة',
      BLOCKED_RETENTION_POLICY: 'محجوب: سياسة الاحتفاظ',
      SENT: 'أُرسل',
      DELIVERED: 'تم التسليم',
      READ: 'تمت القراءة',
      FAILED: 'فشل',
      RETRY_PENDING: 'إعادة محاولة مجدولة',
      RINGING: 'يرن',
      ANSWERED: 'تم الرد',
      COMPLETED: 'مكتمل',
      NO_ANSWER: 'لا يوجد رد',
      HANDOFF_REQUESTED: 'طلب تسليم',
      HANDOFF_ACCEPTED: 'قُبل التسليم',
      HANDOFF_COMPLETED: 'اكتمل التسليم',
      HANDOFF_CANCELLED: 'أُلغي التسليم',
      OPTED_IN: 'موافقة',
      OPTED_OUT: 'إيقاف',
    })[status] || status || 'غير محدد';
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(window.ThanarahLocale?.dateLocale('ar') || 'ar', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const kind = form.dataset.form;
    const data = new FormData(form);
    event.preventDefault();
    state.error = '';
    state.success = '';
    state.saving = true;
    render();
    try {
      if (kind === 'login') {
        await api.login(String(data.get('email') || ''), String(data.get('password') || ''));
        state.saving = false;
        return bootstrap();
      }
      const tenantId = state.workspace?.tenantId;
      if (!tenantId) return;
      if (kind === 'policy') {
        const rawRetention = String(data.get('retentionDays') || '').trim();
        await api.saveCommunicationPolicy(tenantId, {
          retentionDays: rawRetention ? Number(rawRetention) : null,
          maxRetryAttempts: Number(data.get('maxRetryAttempts')),
        });
        state.success = 'حُفظت السياسة. لا يزال الإرسال الحي معطّلًا.';
      } else if (kind === 'consent') {
        const consent = await api.saveCommunicationConsent(tenantId, {
          subjectRef: String(data.get('subjectRef') || '').trim(),
          channel: String(data.get('channel') || ''),
          status: String(data.get('status') || ''),
          source: String(data.get('source') || ''),
          evidenceRef: String(data.get('evidenceRef') || '').trim() || null,
          language: String(data.get('language') || '') || null,
        });
        state.consent = consent;
        state.success = 'حُفظ تفضيل القناة للمستأجر الحالي.';
      } else if (kind === 'simulate') {
        const result = await api.simulateCommunication(tenantId, {
          subjectRef: String(data.get('subjectRef') || '').trim(),
          channel: String(data.get('channel') || ''),
          template: String(data.get('template') || ''),
        });
        state.simulation = result;
        state.success = result.status === 'SIMULATED'
          ? 'نجحت المحاكاة فقط. لم يُرسل أي شيء.'
          : statusLabel(result.status);
      }
      await loadWorkspace();
    } catch (error) {
      if (error?.status === 401) {
        state.workspace = null;
        state.saving = false;
        return renderSignIn();
      }
      state.error = message(error);
    } finally {
      state.saving = false;
      render();
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'refresh') return loadWorkspace();
    if (button.dataset.action === 'retry') return bootstrap();
    if (button.dataset.action === 'logout') {
      await api.logout();
      state.workspace = null;
      clearWorkspaceData();
      return renderSignIn();
    }
    if (button.dataset.action === 'switch') {
      clearWorkspaceData();
      state.workspace = null;
      state.screen = 'select';
      return render();
    }
    if (button.dataset.action === 'choose') {
      const workspace = state.workspaces[Number(button.dataset.index)];
      if (workspace) await chooseWorkspace(workspace);
      return;
    }
    if (button.dataset.action === 'load-consent') {
      const form = root.querySelector('[data-form="consent"]');
      if (!form) return;
      const data = new FormData(form);
      const subjectRef = String(data.get('subjectRef') || '').trim();
      const channel = String(data.get('channel') || '');
      if (!subjectRef || !channel || !state.workspace || !allowed('read')) return;
      state.error = '';
      try {
        state.consent = await api.getCommunicationConsent(
          state.workspace.tenantId,
          subjectRef,
          channel,
        );
        if (!state.consent) state.success = 'لا يوجد تفضيل مسجل لهذه القناة.';
      } catch (error) {
        state.error = message(error);
      }
      render();
    }
  }
})();
