(function (root) {
  'use strict';
  const publicPaths = ['/', '/welcome', '/site', '/about', '/services', '/packages', '/why-thanarah', '/contact'];
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const customerPage = path === '/customer';
  const patientPortalPage = path === '/patient-portal';
  const protectedPage = !publicPaths.includes(path) && path !== '/platform';
  const legacySelector = 'form#auth-form, form#staff-login, form#login-form, form#inbox-login, form#signin-form, form[data-form="signin"], form[data-form="login"]';
  let dialog, opener, busy = false, mode = 'login', method = 'email', audience = 'customer';
  let pendingRegistration = null, registered = false, observedForm = null, dismissedForm = null;
  let ready = null;
  let pagePosition = { top: 0, left: 0 };
  let sessionReported = false;
  let knownAudience = '';
  const drafts = {
    login: { phoneCountry: 'SA' },
    register: { phoneCountry: 'SA' }
  };
  // Region dialing metadata from Google's libphonenumber PhoneNumberMetadata.xml.
  const countryRows = 'AC:247:- AD:376:- AE:971:0 AF:93:0 AG:1:1 AI:1:1 AL:355:0 AM:374:0 AO:244:- AR:54:0 AS:1:1 AT:43:0 AU:61:0 AW:297:- AX:358:0 AZ:994:0 BA:387:0 BB:1:1 BD:880:0 BE:32:0 BF:226:- BG:359:0 BH:973:- BI:257:- BJ:229:- BL:590:0 BM:1:1 BN:673:- BO:591:0 BQ:599:- BR:55:0 BS:1:1 BT:975:- BW:267:- BY:375:8 BZ:501:- CA:1:1 CC:61:0 CD:243:0 CF:236:- CG:242:- CH:41:0 CI:225:- CK:682:- CL:56:- CM:237:- CN:86:0 CO:57:0 CR:506:- CU:53:0 CV:238:- CW:599:- CX:61:0 CY:357:- CZ:420:- DE:49:0 DJ:253:- DK:45:- DM:1:1 DO:1:1 DZ:213:0 EC:593:0 EE:372:- EG:20:0 EH:212:0 ER:291:0 ES:34:- ET:251:0 FI:358:0 FJ:679:- FK:500:- FM:691:- FO:298:- FR:33:0 GA:241:- GB:44:0 GD:1:1 GE:995:0 GF:594:0 GG:44:0 GH:233:0 GI:350:- GL:299:- GM:220:- GN:224:- GP:590:0 GQ:240:- GR:30:- GT:502:- GU:1:1 GW:245:- GY:592:- HK:852:- HN:504:- HR:385:0 HT:509:- HU:36:06 ID:62:0 IE:353:0 IL:972:0 IM:44:0 IN:91:0 IO:246:- IQ:964:0 IR:98:0 IS:354:- IT:39:- JE:44:0 JM:1:1 JO:962:0 JP:81:0 KE:254:0 KG:996:0 KH:855:0 KI:686:0 KM:269:- KN:1:1 KP:850:0 KR:82:0 KW:965:- KY:1:1 KZ:7:8 LA:856:0 LB:961:0 LC:1:1 LI:423:0 LK:94:0 LR:231:0 LS:266:- LT:370:0 LU:352:- LV:371:- LY:218:0 MA:212:0 MC:377:0 MD:373:0 ME:382:0 MF:590:0 MG:261:0 MH:692:1 MK:389:0 ML:223:- MM:95:0 MN:976:0 MO:853:- MP:1:1 MQ:596:0 MR:222:- MS:1:1 MT:356:- MU:230:- MV:960:- MW:265:0 MX:52:- MY:60:0 MZ:258:- NA:264:0 NC:687:- NE:227:- NF:672:- NG:234:0 NI:505:- NL:31:0 NO:47:- NP:977:0 NR:674:- NU:683:- NZ:64:0 OM:968:- PA:507:- PE:51:0 PF:689:- PG:675:- PH:63:0 PK:92:0 PL:48:- PM:508:0 PR:1:1 PS:970:0 PT:351:- PW:680:- PY:595:0 QA:974:- RE:262:0 RO:40:0 RS:381:0 RU:7:8 RW:250:0 SA:966:0 SB:677:- SC:248:- SD:249:0 SE:46:0 SG:65:- SH:290:- SI:386:0 SJ:47:- SK:421:0 SL:232:0 SM:378:- SN:221:- SO:252:0 SR:597:- SS:211:0 ST:239:- SV:503:- SX:1:1 SY:963:0 SZ:268:- TA:290:- TC:1:1 TD:235:- TG:228:- TH:66:0 TJ:992:- TK:690:- TL:670:- TM:993:8 TN:216:- TO:676:- TR:90:0 TT:1:1 TV:688:- TW:886:0 TZ:255:0 UA:380:0 UG:256:0 US:1:1 UY:598:0 UZ:998:- VA:39:- VC:1:1 VE:58:0 VG:1:1 VI:1:1 VN:84:0 VU:678:- WF:681:- WS:685:- XK:383:0 YE:967:0 YT:262:0 ZA:27:0 ZM:260:0 ZW:263:0';
  const countryDisplayNames = {};
  try {
    countryDisplayNames.ar = new Intl.DisplayNames(['ar'], { type: 'region' });
    countryDisplayNames.en = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {}
  const countryName = (region, locale) => {
    try {
      return countryDisplayNames[locale]?.of(region) || region;
    } catch {
      return region;
    }
  };
  const countries = countryRows.split(/\s+/u).map(row => {
    const [region, callingCode, nationalPrefix] = row.split(':');
    return {
      region,
      callingCode,
      nationalPrefix: nationalPrefix === '-' ? '' : nationalPrefix,
      nameAr: countryName(region, 'ar'),
      nameEn: countryName(region, 'en')
    };
  });
  function findCountry(region) {
    return countries.find(country => country.region === region);
  }
  function filterCountries(query = '') {
    const normalized = String(query).trim().toLocaleLowerCase();
    return countries
      .filter(country => !normalized || [
        country.nameAr, country.nameEn, country.region, country.callingCode, '+' + country.callingCode
      ].some(value => value.toLocaleLowerCase().includes(normalized)))
      .sort((left, right) => {
        if (left.region === 'SA') return -1;
        if (right.region === 'SA') return 1;
        return (ar() ? left.nameAr : left.nameEn).localeCompare(
          ar() ? right.nameAr : right.nameEn,
          ar() ? 'ar' : 'en'
        );
      });
  }
  function phoneDigits(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[٠-٩۰-۹]/gu, digit => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)))
      .replace(/\D/gu, '');
  }
  function normalizePhoneNumber(value, region) {
    const raw = String(value || '').normalize('NFKC').trim();
    const country = findCountry(region);
    if (!raw || !country) return null;
    const digits = phoneDigits(raw);
    if (!digits) return null;
    let international;
    if (raw.startsWith('+')) international = '+' + digits;
    else if (/^00/u.test(raw.replace(/[^\d٠-٩۰-۹]/gu, ''))) international = '+' + digits.slice(2);
    else {
      let national = digits;
      const prefix = country.nationalPrefix;
      const hasNationalPrefix = prefix && national.startsWith(prefix) && (
        (prefix === '0' && national.length >= 9) ||
        (country.callingCode === '1' && prefix === '1' && national.length > 10) ||
        (prefix !== '0' && national.length >= 10)
      );
      if (hasNationalPrefix) national = national.slice(prefix.length);
      international = '+' + country.callingCode + national;
    }
    return /^\+[1-9]\d{7,14}$/u.test(international) ? international : null;
  }
  const ar = () => document.documentElement.lang !== 'en';
  const text = (arabic, english) => ar() ? arabic : english;
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const formOnPage = () => document.querySelector(legacySelector);
  const isStaff = () => protectedPage && !customerPage;
  const workspaceName = () =>
    document.querySelector('.thanarah-shell-brand small')?.textContent ||
    text('مساحة الفريق', 'Team workspace');

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
    if (form) drafts[mode] = { ...drafts[mode], ...Object.fromEntries(new FormData(form)) };
    const phone = dialog?.querySelector('#ta-phone');
    const trigger = dialog?.querySelector('#ta-country-trigger');
    if (phone && typeof phone.value === 'string') drafts[mode].phone = phone.value;
    if (trigger) drafts[mode].phoneCountry = trigger.dataset?.region || drafts[mode].phoneCountry || 'SA';
  }
  function renderCountryOptions(query = '') {
    const list = dialog.querySelector('#ta-country-options');
    if (!list) return;
    const matches = filterCountries(query);
    list.innerHTML = matches.map(country => {
      const primary = ar() ? country.nameAr : country.nameEn;
      const secondary = ar() ? country.nameEn : country.nameAr;
      return `<div id="ta-country-option-${country.region}" role="option" aria-selected="${drafts[mode].phoneCountry === country.region}" tabindex="-1" data-country-option="${country.region}"><span class="ta-country-option-names"><span>${escape(primary)}</span><small>${escape(secondary)}</small></span><bdi dir="ltr">+${country.callingCode}</bdi></div>`;
    }).join('');
    const empty = dialog.querySelector('[data-country-empty]');
    if (empty) empty.hidden = matches.length > 0;
  }
  function updateCountryTrigger(region) {
    const country = findCountry(region) || findCountry('SA');
    const trigger = dialog.querySelector('#ta-country-trigger');
    if (!trigger) return;
    trigger.dataset.region = country.region;
    trigger.setAttribute('aria-label', text('الدولة ورمز الاتصال: ', 'Country calling code: ') +
      (ar() ? country.nameAr : country.nameEn) + ', +' + country.callingCode);
    trigger.innerHTML = `<span class="ta-country-trigger-code" dir="ltr">+${country.callingCode}</span><span>${escape(ar() ? country.nameAr : country.nameEn)}</span><span class="ta-country-chevron" aria-hidden="true">⌄</span>`;
    drafts[mode].phoneCountry = country.region;
  }
  function updatePhonePreview() {
    const phone = dialog.querySelector('#ta-phone');
    const preview = dialog.querySelector('[data-phone-preview]');
    if (!phone || !preview) return;
    const normalized = normalizePhoneNumber(phone.value, drafts[mode].phoneCountry);
    preview.hidden = !normalized;
    preview.innerHTML = normalized
      ? `${text('الصيغة الدولية: ', 'International format: ')}<bdi dir="ltr">${escape(normalized)}</bdi>`
      : '';
  }
  function closeCountryPicker(returnFocus = false) {
    const panel = dialog?.querySelector('#ta-country-panel');
    const trigger = dialog?.querySelector('#ta-country-trigger');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    dialog.querySelector('#ta-country-search')?.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger?.focus({ preventScroll: true });
  }
  function openCountryPicker() {
    const panel = dialog.querySelector('#ta-country-panel');
    const trigger = dialog.querySelector('#ta-country-trigger');
    const search = dialog.querySelector('#ta-country-search');
    if (!panel || !trigger || !search) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-expanded', 'true');
    search.value = '';
    search.removeAttribute('aria-activedescendant');
    renderCountryOptions();
    search.focus({ preventScroll: true });
  }
  function chooseCountry(region) {
    const country = findCountry(region);
    if (!country) return;
    updateCountryTrigger(country.region);
    const search = dialog.querySelector('#ta-country-search');
    search?.removeAttribute('aria-activedescendant');
    renderCountryOptions(search?.value || '');
    updatePhonePreview();
    closeCountryPicker(true);
  }
  function moveCountryOption(direction) {
    const search = dialog.querySelector('#ta-country-search');
    const matches = filterCountries(search?.value || '');
    if (!search || !matches.length) return;
    const activeId = search.getAttribute('aria-activedescendant');
    const currentIndex = matches.findIndex(country => 'ta-country-option-' + country.region === activeId);
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : matches.length - 1)
      : (currentIndex + direction + matches.length) % matches.length;
    const nextId = 'ta-country-option-' + matches[nextIndex].region;
    search.setAttribute('aria-activedescendant', nextId);
    dialog.querySelectorAll('[data-country-option]').forEach(option => {
      option.classList.toggle('is-active', option.id === nextId);
    });
    dialog.querySelector('#' + nextId)?.scrollIntoView?.({ block: 'nearest' });
  }
  function handleCountrySearchKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveCountryOption(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      const activeId = event.target.getAttribute('aria-activedescendant');
      if (activeId) {
        event.preventDefault();
        chooseCountry(activeId.replace('ta-country-option-', ''));
      } else {
        const firstMatch = filterCountries(event.target.value)[0];
        if (firstMatch) {
          event.preventDefault();
          chooseCountry(firstMatch.region);
        }
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCountryPicker(true);
    }
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
    const description = patientPortalPage
      ? text(
        'سجّل الدخول بحسابك في ثنارة للوصول إلى فواتير العيادة بعد التحقق من ملكية سجل المريض.',
        'Sign in with your Thanarah account to access clinic invoices after verifying the patient record.'
      )
      : audience === 'staff'
      ? text(
        'دخول حسابات الفريق المخوّلة إلى ' + workspaceName() + '. تحدد صلاحيات حسابك مساحات العمل المتاحة.',
        'Sign in to ' + workspaceName() + ' with an authorized team account. Your permissions determine available workspaces.'
      )
      : text(
        'حساب العميل لمتابعة طلباتك. إنشاء الحساب لا يفعّل عيادة أو يمنح صلاحيات موظف.',
        'Your customer account follows your requests. Creating an account does not activate a clinic or grant staff permissions.'
      );
    dialog.lang = ar() ? 'ar' : 'en';
    dialog.dir = ar() ? 'rtl' : 'ltr';
    dialog.innerHTML = `<div class="ta-head"><a href="/" class="ta-brand"><img src="/assets/logo-mark.svg" width="34" height="34" alt=""><span>${text('ثنارة', 'Thanarah')}</span></a><button type="button" class="ta-close" data-auth-close aria-label="${text('إغلاق', 'Close')}">×</button></div>
      <h2 id="thanarah-auth-title">${register ? text('إنشاء حساب', 'Create an account') : text('تسجيل الدخول', 'Sign in')}</h2>
      <p class="ta-description">${escape(description)}</p>
      ${audience === 'customer' ? `<div class="ta-tabs ta-account-tabs" role="group" aria-label="${text('نوع العملية', 'Account action')}"><button type="button" data-auth-mode="login" aria-pressed="${!register}">${text('تسجيل الدخول', 'Sign in')}</button><button type="button" data-auth-mode="register" aria-pressed="${register}">${text('إنشاء حساب', 'Create account')}</button></div>` : ''}
      <div class="ta-tabs ta-method-tabs" role="group" aria-label="${text('طريقة الدخول', 'Sign-in method')}"><button type="button" data-auth-method="email" aria-pressed="${method === 'email'}">${text('البريد الإلكتروني', 'Email')}</button><button type="button" data-auth-method="phone" aria-pressed="${method === 'phone'}">${text('رقم الجوال', 'Mobile number')}</button></div>
      ${method === 'phone' ? `<div class="ta-phone"><div class="ta-country-field"><label for="ta-country-trigger">${text('الدولة ورمز الاتصال', 'Country and calling code')}</label><button id="ta-country-trigger" class="ta-country-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="ta-country-options" data-region="${escape(draft.phoneCountry || 'SA')}"></button><div id="ta-country-panel" class="ta-country-panel" hidden><label class="ta-visually-hidden" for="ta-country-search">${text('ابحث باسم الدولة أو رمز الاتصال', 'Search country or calling code')}</label><input id="ta-country-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ta-country-options" autocomplete="off" placeholder="${text('ابحث باسم الدولة أو الرمز', 'Search country or code')}"><div id="ta-country-options" class="ta-country-options" role="listbox" aria-label="${text('الدول ورموز الاتصال', 'Countries and calling codes')}"></div><p class="ta-country-empty" data-country-empty hidden>${text('لا توجد دولة مطابقة.', 'No matching country.')}</p></div></div><div class="ta-phone-number"><label for="ta-phone">${text('رقم الجوال', 'Mobile number')}</label><input id="ta-phone" type="tel" dir="ltr" inputmode="tel" autocomplete="tel-national" placeholder="${text('مثال: 05xxxxxxxx', 'Example: 05xxxxxxxx')}" value="${escape(draft.phone)}"><p class="ta-phone-preview" data-phone-preview aria-live="polite" hidden></p></div><p role="status">${text('التحقق برقم الجوال عبر واتساب غير مفعّل بعد؛ لم تُرسل أي رسالة ولا تُنشأ جلسة. يُضاف رمز الدولة إلى الرقم بصيغة دولية. يمكنك استخدام البريد الإلكتروني الآن.', 'Phone sign-in over WhatsApp is not enabled; no message is sent and no session is created. The country code is combined with your number in international format. You can use email now.')}</p><button type="button" disabled>${text('إرسال رمز عبر واتساب غير متاح حاليًا', 'WhatsApp verification is not available yet')}</button></div>` : `
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
    if (method === 'phone') {
      updateCountryTrigger(draft.phoneCountry || 'SA');
      renderCountryOptions();
      updatePhonePreview();
    }
    const initialFocus = method === 'phone'
      ? dialog.querySelector('#ta-phone')
      : dialog.querySelector('input') || dialog.querySelector('button[data-auth-mode]') || dialog.querySelector('.ta-close');
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
      if (event.target?.id === 'ta-country-search') handleCountrySearchKeydown(event);
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
    dialog.addEventListener('input', event => {
      if (event.target?.id === 'ta-country-search') {
        event.target.removeAttribute('aria-activedescendant');
        renderCountryOptions(event.target.value);
      }
      if (event.target?.id === 'ta-phone') {
        drafts[mode].phone = event.target.value;
        updatePhonePreview();
      }
    });
    dialog.addEventListener('click', event => {
      if (!event.target.closest('.ta-country-field')) closeCountryPicker();
      const countryOption = event.target.closest('[data-country-option]');
      if (countryOption) return chooseCountry(countryOption.dataset.countryOption);
      const button = event.target.closest('button');
      if (!button || busy) return;
      if (button.hasAttribute('data-auth-close')) return close();
      if (pendingRegistration) return;
      if (button.id === 'ta-country-trigger') {
        if (button.getAttribute('aria-expanded') === 'true') closeCountryPicker();
        else openCountryPicker();
        return;
      }
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
    if (protectedPage && !patientPortalPage && !formOnPage() && !document.body.classList.contains('thanarah-needs-auth')) {
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
