(function (root) {
  'use strict';
  const publicPaths = ['/', '/welcome', '/site', '/about', '/services', '/packages', '/why-thanarah', '/contact'];
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const customerPage = path === '/customer';
  const protectedPage = !publicPaths.includes(path) && path !== '/platform';
  const legacySelector = 'form#auth-form, form#staff-login, form#login-form, form#inbox-login, form#signin-form, form[data-form="signin"], form[data-form="login"]';
  let dialog, opener, busy = false, mode = 'login', method = 'email', audience = 'customer';
  let pendingRegistration = null, registered = false, observedForm = null, dismissedForm = null;
  let ready = null;
  let pagePosition = { top: 0, left: 0 };
  let sessionReported = false;
  let knownAudience = '';
  const drafts = { login: {}, register: {} };
  const ar = () => document.documentElement.lang !== 'en';
  const text = (arabic, english) => ar() ? arabic : english;
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const formOnPage = () => document.querySelector(legacySelector);
  const isStaff = () => protectedPage && !customerPage;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error(text('تعذر تحميل خدمة الدخول. أعد المحاولة.', 'Could not load sign-in. Try again.'))); };
      document.head.append(script);
    });
  }
  async function services() {
    if (root.ThanarahApi && audience === 'staff') return root.ThanarahApi;
    if (!ready) ready = (async () => {
      if (!root.CompanyApi) await loadScript('/company/api.js');
      if (!root.JourneyApi) await loadScript('/journey/api.js');
    })().catch(error => { ready = null; throw error; });
    await ready;
    return root.CompanyApi;
  }
  function remember() {
    const form = dialog?.querySelector('#thanarah-auth-form');
    if (!form) return;
    drafts[mode] = Object.fromEntries(new FormData(form));
  }
  function message(value, bad = true) {
    const node = dialog.querySelector('[data-auth-message]');
    node.textContent = value;
    node.setAttribute('role', bad ? 'alert' : 'status');
  }
  function close() {
    if (busy) return;
    remember();
    dismissedForm = observedForm;
    dialog.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    root.scrollTo({ ...pagePosition, behavior: 'instant' });
  }
  function draw() {
    const register = mode === 'register';
    const draft = drafts[mode];
    dialog.lang = ar() ? 'ar' : 'en';
    dialog.dir = ar() ? 'rtl' : 'ltr';
    dialog.innerHTML = `<div class="ta-head"><a href="/" class="ta-brand"><img src="/assets/logo-mark.svg" width="34" height="34" alt=""><span>${text('ثنارة', 'Thanarah')}</span></a><button type="button" class="ta-close" data-auth-close aria-label="${text('إغلاق', 'Close')}">×</button></div>
      <h2 id="thanarah-auth-title">${register ? text('إنشاء حساب', 'Create an account') : text('تسجيل الدخول', 'Sign in')}</h2>
      <p class="ta-description">${audience === 'staff' ? text('لحسابات الفريق المخوّلة. تحدد صلاحيات حسابك مساحات العمل المتاحة.', 'For authorized team accounts. Your permissions determine available workspaces.') : text('حساب العميل لمتابعة طلباتك. إنشاء الحساب لا يفعّل عيادة أو يمنح صلاحيات موظف.', 'Your customer account follows your requests. Creating an account does not activate a clinic or grant staff permissions.')}</p>
      ${audience === 'customer' ? `<div class="ta-tabs ta-account-tabs" role="group" aria-label="${text('نوع العملية', 'Account action')}"><button type="button" data-auth-mode="login" aria-pressed="${!register}">${text('تسجيل الدخول', 'Sign in')}</button><button type="button" data-auth-mode="register" aria-pressed="${register}">${text('إنشاء حساب', 'Create account')}</button></div>` : ''}
      <div class="ta-tabs ta-method-tabs" role="group" aria-label="${text('طريقة الدخول', 'Sign-in method')}"><button type="button" data-auth-method="email" aria-pressed="${method === 'email'}">${text('البريد الإلكتروني', 'Email')}</button><button type="button" data-auth-method="phone" aria-pressed="${method === 'phone'}">${text('رقم الجوال', 'Mobile number')}</button></div>
      ${method === 'phone' ? `<div class="ta-phone"><label for="ta-phone">${text('رقم الجوال الدولي', 'International mobile number')}</label><input id="ta-phone" type="tel" dir="ltr" autocomplete="tel" placeholder="+9665…" value="${escape(draft.phone)}"><p role="status">${text('التحقق برقم الجوال عبر واتساب غير مفعّل بعد. ينتظر ربط الخدمة؛ لم تُرسل أي رسالة. يمكنك استخدام البريد الإلكتروني الآن.', 'WhatsApp mobile verification is not enabled yet. It awaits a provider connection; no message has been sent. You can use email now.')}</p><button type="button" disabled>${text('إرسال رمز عبر واتساب غير متاح حاليًا', 'WhatsApp verification is not available yet')}</button></div>` : `
      <form id="thanarah-auth-form">
      ${register ? `<label for="ta-name">${text('الاسم الكامل', 'Full name')}</label><input id="ta-name" name="fullName" autocomplete="name" maxlength="191" required value="${escape(draft.fullName)}">` : ''}
      <label for="ta-email">${text('البريد الإلكتروني', 'Email')}</label><input id="ta-email" name="email" type="email" dir="ltr" autocomplete="username" required value="${escape(draft.email)}">
      <label for="ta-password">${text('كلمة المرور', 'Password')}</label><input id="ta-password" name="password" type="password" dir="ltr" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="${register ? '12' : '1'}" ${register ? 'aria-describedby="ta-password-policy"' : ''} required value="${escape(draft.password)}">
      ${register ? `<p class="ta-help" id="ta-password-policy">${text('12 محرفًا على الأقل تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا خاصًا.', 'At least 12 characters including uppercase, lowercase, a number and a special character.')}</p>` : ''}
      <button class="ta-submit" type="submit">${register ? text('إنشاء الحساب', 'Create account') : text('دخول', 'Sign in')}</button></form>`}
      <p class="ta-message" data-auth-message role="alert" aria-live="polite"></p><p class="ta-help" data-auth-reference></p>`;
    if (pendingRegistration) {
      lockRegistration();
      message(text('نتيجة إنشاء الحساب لم تُحسم. أعد المحاولة بالبيانات نفسها والمرجع نفسه.', 'Registration outcome is uncertain. Retry with the same details and operation reference.'));
    }
    const initialFocus = dialog.querySelector('input') || dialog.querySelector('button[data-auth-mode]') || dialog.querySelector('.ta-close');
    initialFocus?.focus({ preventScroll: true });
  }
  function lockRegistration() {
    dialog.querySelectorAll('input').forEach(input => { input.readOnly = true; });
    dialog.querySelectorAll('[data-auth-mode], [data-auth-method]').forEach(button => { button.disabled = true; });
    dialog.querySelector('[data-auth-reference]').textContent = text('مرجع العملية: ', 'Operation reference: ') + pendingRegistration.operationId;
  }
  function ensureDialog() {
    if (dialog) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = '/assets/thanarah-auth.css';
    document.head.append(style);
    dialog = document.createElement('dialog');
    dialog.className = 'thanarah-auth';
    dialog.setAttribute('aria-labelledby', 'thanarah-auth-title');
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
        .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus({ preventScroll: true });
      }
    });
    dialog.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || busy) return;
      if (button.hasAttribute('data-auth-close')) return close();
      if (pendingRegistration) return;
      if (button.dataset.authMode) { remember(); mode = button.dataset.authMode; registered = false; draw(); }
      if (button.dataset.authMethod) {
        const phone = dialog.querySelector('#ta-phone');
        if (phone) drafts[mode].phone = phone.value;
        remember(); method = button.dataset.authMethod; draw();
      }
    });
  }
  function open(options = {}) {
    ensureDialog();
    if (busy) return;
    if (dialog.open) { dialog.querySelector('input')?.focus(); return; }
    pagePosition = { top: root.scrollY, left: root.scrollX };
    opener = document.activeElement;
    // Never change the identity underneath a signed-in workspace or its drafts.
    if (protectedPage && !formOnPage() && !document.body.classList.contains('thanarah-needs-auth')) {
      mode = 'login'; audience = isStaff() ? 'staff' : 'customer'; method = 'email';
      draw(); dialog.showModal();
      dialog.querySelectorAll('form, .ta-tabs').forEach(node => { node.hidden = true; });
      message(text('أنت داخل مساحة عمل. استخدم تسجيل الخروج الخاص بها قبل تغيير الحساب؛ لن نغيّر جلستك أو مسوداتك.', 'You are in a workspace. Use its sign-out before changing accounts; your session and drafts will not be changed.'), false);
      root.scrollTo({ ...pagePosition, behavior: 'instant' });
      return;
    }
    if (!pendingRegistration) {
      audience = options.audience === 'staff' ? 'staff' : 'customer';
      // Protected routes use their own account scope and existing API instance.
      if (protectedPage) audience = isStaff() ? 'staff' : 'customer';
      mode = audience === 'customer' && options.mode === 'register' ? 'register' : 'login';
      method = 'email';
    }
    dialog.showModal();
    draw();
    root.scrollTo({ ...pagePosition, behavior: 'instant' });
  }
  async function submit(event) {
    if (event.target.id !== 'thanarah-auth-form') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    const form = event.target;
    remember();
    const data = drafts[mode];
    if (mode === 'register' && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/.test(data.password)) {
      message(text('تحقق من متطلبات كلمة المرور قبل المتابعة.', 'Check the password requirements before continuing.')); return;
    }
    busy = true;
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    form.querySelectorAll('input').forEach(input => { input.readOnly = true; });
    message(text('جارٍ التحقق…', 'Checking…'), false);
    try {
      const api = await services();
      if (mode === 'register' && !registered) {
        if (!pendingRegistration) pendingRegistration = { operationId: root.crypto.randomUUID(), fullName: data.fullName, email: data.email.trim(), password: data.password };
        await root.JourneyApi.register(pendingRegistration);
        pendingRegistration = null;
        registered = true;
      }
      if (!await api.login(data.email.trim(), data.password)) throw new Error(text('تعذر بدء الجلسة.', 'Could not start the session.'));
      if (audience === 'customer') await root.JourneyApi.me();
      // The existing applications, not the dialog, load their authorized views.
      root.dispatchEvent(new CustomEvent('thanarah:authenticated', { detail: { audience } }));
      root.dispatchEvent(new CustomEvent('thanarah:auth-changed', { detail: { audience } }));
      drafts.login = {}; drafts.register = {}; registered = false;
      document.body.classList.remove('thanarah-needs-auth');
      busy = false;
      message('', false);
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      root.scrollTo({ ...pagePosition, behavior: 'instant' });
    } catch (error) {
      if (pendingRegistration && error.status && error.status < 500) pendingRegistration = null;
      message((registered ? text('تم إنشاء الحساب. تعذر بدء الجلسة؛ أعد محاولة الدخول. ', 'Account created. Sign-in failed; retry signing in. ') : '') +
        (error.status === 409 ? text('تعذر إنشاء الحساب بهذه البيانات. تحقق منها أو جرّب تسجيل الدخول.', 'Could not create this account. Check your details or try signing in.') :
          error.message || text('تعذر إتمام العملية. أعد المحاولة.', 'Could not complete the request. Try again.')));
    } finally {
      busy = false;
      dialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
      if (pendingRegistration) lockRegistration();
      else form.querySelectorAll('input').forEach(input => { input.readOnly = registered; });
      if (registered) form.querySelector('[type="submit"]').textContent = text('إعادة محاولة الدخول للحساب المنشأ', 'Retry sign-in to your new account');
    }
  }
  document.addEventListener('submit', submit, true);
  root.addEventListener('thanarah:auth-changed', event => {
    knownAudience = event.detail.authenticated === false ? '' : event.detail.audience || '';
  });
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-thanarah-auth], a[href]');
    if (!trigger || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button != null && event.button !== 0)) return;
    let options;
    if (trigger.dataset.thanarahAuth) options = { mode: trigger.dataset.thanarahAuth, audience: trigger.dataset.authAudience };
    else {
      const url = new URL(trigger.href, location.href);
      if (url.origin !== location.origin || url.pathname.replace(/\/+$/, '') !== '/customer' || url.hash || url.searchParams.has('order')) return;
      // Authenticated workspace links are navigation, not another sign-in.
      if (trigger.hasAttribute('data-authenticated-workspace') || knownAudience === 'customer') return;
      options = { mode: url.searchParams.get('mode') === 'register' ? 'register' : 'login', audience: 'customer' };
    }
    event.preventDefault(); open(options);
  });
  function discover() {
    const form = formOnPage();
    if (!form) {
      if (observedForm) document.body.classList.remove('thanarah-needs-auth');
      observedForm = null;
      const mount = document.getElementById('app') || document.getElementById('encounter-app') || document.getElementById('inbox');
      if (!sessionReported && protectedPage && mount?.querySelector('.app-frame, .app-shell, .appbar, .encounter-header, .platform-page, .saas-page')) {
        sessionReported = true;
        root.dispatchEvent(new CustomEvent('thanarah:auth-changed', { detail: { audience: isStaff() ? 'staff' : 'customer' } }));
      }
      return;
    }
    if (observedForm === form) return;
    observedForm = form;
    sessionReported = false;
    root.dispatchEvent(new CustomEvent('thanarah:auth-changed', { detail: { authenticated: false } }));
    const container = form.closest('.auth-screen, .workspace-screen, .login-shell, main.auth, .ai-screen, .encounter-screen') || form.parentElement;
    container.classList.add('thanarah-legacy-auth');
    document.body.classList.add('thanarah-needs-auth');
    let gate = document.getElementById('thanarah-auth-gate');
    if (!gate) {
      gate = document.createElement('section');
      gate.id = 'thanarah-auth-gate';
      gate.className = 'thanarah-auth-gate';
      gate.innerHTML = `<h1>${text('مساحة عملك في ثنارة', 'Your Thanarah workspace')}</h1><p>${text('سجّل الدخول للمتابعة ضمن صلاحيات حسابك.', 'Sign in to continue with your account permissions.')}</p><button type="button" data-thanarah-auth="login" data-auth-audience="${isStaff() ? 'staff' : 'customer'}">${text('تسجيل الدخول', 'Sign in')}</button>`;
      const mount = document.getElementById('app') || document.getElementById('encounter-app') || document.getElementById('inbox');
      mount.after(gate);
    }
    if (dismissedForm !== form && !dialog?.open) open({ audience: isStaff() ? 'staff' : 'customer', mode: customerPage && new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login' });
    const existingError = container.querySelector('[role="alert"]')?.textContent.trim();
    if (existingError && dialog?.open) message(existingError);
  }
  root.ThanarahAuth = { open, close };
  function initialize() {
    discover();
    const mount = document.getElementById('app') || document.getElementById('encounter-app') || document.getElementById('inbox');
    if (mount) new MutationObserver(discover).observe(mount, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
