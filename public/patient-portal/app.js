(function startPatientPortal() {
  'use strict';

  const app = document.getElementById('app');
  const api = window.ThanarahApi;
  const tenantId = new URLSearchParams(window.location.search).get('tenantId') || '';
  const state = {
    screen: 'loading',
    invoices: [],
    selectedInvoice: null,
    challengeId: '',
    busy: false,
    error: null,
    info: '',
  };
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const uuid = () => window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (character) => {
      const random = Math.random() * 16 | 0;
      return (character === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  const apiMessage = (error) => {
    if (error?.code === 'PATIENT_PORTAL_LINK_REQUIRED') {
      return 'أكمل التحقق من ملكية سجل المريض لعرض الفواتير.';
    }
    if (error?.code === 'PATIENT_PORTAL_VERIFICATION_FAILED') {
      return 'تعذر التحقق من الرمز. تأكد منه أو ابدأ طلبًا جديدًا.';
    }
    if (error?.status === 401) return 'انتهت الجلسة. سجّل الدخول مرة أخرى.';
    if (error?.status === 503) return 'الخدمة غير متاحة مؤقتًا. حاول لاحقًا.';
    return error?.message || 'تعذر إكمال الطلب. حاول مرة أخرى.';
  };

  window.addEventListener('thanarah:authenticated', (event) => {
    if (event.detail?.audience === 'staff') void bootstrap();
  });
  document.addEventListener('submit', onSubmit);
  document.addEventListener('click', onClick);
  document.addEventListener('DOMContentLoaded', () => void bootstrap(), { once: true });

  async function bootstrap() {
    state.error = null;
    if (!api) {
      state.screen = 'error';
      state.error = 'تعذر تحميل خدمة الدخول. أعد تحميل الصفحة.';
      render();
      return;
    }
    render();
    try {
      if (!(await api.restoreSession())) {
        state.screen = 'signin';
        render();
        window.ThanarahAuth?.open({ audience: 'staff', mode: 'login' });
        return;
      }
      if (!tenantId) {
        state.screen = 'missing-link';
        render();
        return;
      }
      await loadInvoices();
    } catch (error) {
      if (error?.status === 401) {
        state.screen = 'signin';
        render();
        window.ThanarahAuth?.open({ audience: 'staff', mode: 'login' });
        return;
      }
      state.screen = 'error';
      state.error = apiMessage(error);
      render();
    }
  }

  async function loadInvoices() {
    state.screen = 'loading';
    state.error = null;
    render();
    try {
      const result = await api.listPatientPortalInvoices(tenantId);
      state.invoices = Array.isArray(result?.items) ? result.items : [];
      state.screen = 'invoices';
      state.selectedInvoice = null;
      state.error = null;
    } catch (error) {
      if (error?.status === 401) {
        state.screen = 'signin';
        render();
        window.ThanarahAuth?.open({ audience: 'staff', mode: 'login' });
        return;
      }
      if (error?.code === 'PATIENT_PORTAL_LINK_REQUIRED' || error?.status === 403) {
        state.screen = 'claim';
        state.challengeId = '';
        state.info = '';
        state.error = null;
      } else {
        state.screen = 'error';
        state.error = apiMessage(error);
      }
    }
    render();
  }

  function render() {
    app.innerHTML = `<div class="portal-wrap"><section class="portal-card">${brand()}${screenContent()}</section></div>`;
  }

  function brand() {
    return '<div class="portal-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثنارة</strong><span>بوابة المريض</span></div></div>';
  }

  function screenContent() {
    if (state.screen === 'signin') {
      return `<div class="portal-heading"><div><span class="portal-kicker">دخول آمن</span><h1>فواتيرك في مكان واحد</h1><p>سجّل الدخول بحساب ثنارة لمتابعة التحقق.</p></div></div><button class="btn btn-primary" type="button" data-action="signin">تسجيل الدخول</button>`;
    }
    if (state.screen === 'missing-link') {
      return `<div class="portal-heading"><div><span class="portal-kicker">رابط العيادة مطلوب</span><h1>افتح رابط بوابة المريض</h1><p>استخدم الرابط الذي أرسلته لك العيادة للوصول إلى فواتيرها.</p></div></div><div class="portal-empty">لا يظهر رقم الفاتورة أو بيانات المريض في رابط البوابة.</div>`;
    }
    if (state.screen === 'loading') {
      return `<div class="portal-loading" role="status">جارٍ تحميل بيانات الفواتير…</div>`;
    }
    if (state.screen === 'claim') return claimMarkup();
    if (state.screen === 'invoices') return invoiceListMarkup();
    if (state.screen === 'error') {
      return `<div class="portal-heading"><div><span class="portal-kicker">تعذر التحميل</span><h1>حاول مرة أخرى</h1><p>${esc(state.error)}</p></div></div><button class="btn btn-secondary" type="button" data-action="retry">إعادة المحاولة</button>`;
    }
    return '';
  }

  function claimMarkup() {
    if (state.challengeId) {
      return `<div class="portal-heading"><div><span class="portal-kicker">التحقق من ملكية السجل</span><h1>أدخل رمز التحقق</h1><p>إذا تطابق بريد حسابك مع سجل العيادة، سيصل الرمز إلى رقم الجوال المسجل لديها.</p></div></div>${state.info ? `<div class="portal-message">${esc(state.info)}</div>` : ''}${state.error ? `<div class="portal-message error" role="alert">${esc(state.error)}</div>` : ''}<form class="portal-form" data-form="verify"><label class="field"><span>رمز التحقق المكوّن من 6 أرقام</span><input class="control mono" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><div class="portal-toolbar"><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'جارٍ التحقق…' : 'تحقق واعرض الفواتير'}</button><button class="btn btn-secondary" type="button" data-action="new-claim" ${state.busy ? 'disabled' : ''}>طلب رمز جديد</button></div></form><p class="portal-note">الرمز صالح خمس دقائق. لا تُعرض أي فواتير قبل نجاح التحقق.</p>`;
    }
    return `<div class="portal-heading"><div><span class="portal-kicker">التحقق من ملكية السجل</span><h1>تحقق للوصول إلى فواتيرك</h1><p>سنطابق بريد حساب ثنارة مع سجل العيادة، ثم نرسل رمزًا إلى الجوال المحفوظ في ذلك السجل.</p></div></div><div class="portal-message">لا نعرض ما إذا كان البريد موجودًا في سجلات العيادة. إذا لم يصلك رمز، تواصل مع العيادة لتحديث بياناتك.</div>${state.error ? `<div class="portal-message error" role="alert">${esc(state.error)}</div>` : ''}<form class="portal-form" data-form="claim"><label class="portal-consent"><input type="checkbox" name="consent" required><span>أوافق على مطابقة بريد حسابي مع سجل العيادة وإرسال رمز تحقق إلى رقم الجوال المسجل للتحقق من ملكيتي للسجل.</span></label><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'جارٍ إرسال الطلب…' : 'إرسال رمز التحقق'}</button></form>`;
  }

  function invoiceListMarkup() {
    const list = state.invoices.length
      ? `<div class="portal-invoice-list">${state.invoices.map(invoiceCard).join('')}</div>`
      : '<div class="portal-empty">لا توجد فواتير صادرة مرتبطة بسجل المريض الذي تم التحقق منه.</div>';
    return `<div class="portal-heading"><div><span class="portal-kicker">وصول موثّق</span><h1>فواتير العيادة</h1><p>تظهر هنا الفواتير الصادرة المرتبطة بسجل المريض فقط.</p></div><div class="portal-toolbar"><button class="btn btn-secondary btn-small" type="button" data-action="refresh">تحديث</button><button class="btn btn-secondary btn-small" type="button" data-action="logout">خروج</button></div></div>${state.error ? `<div class="portal-message error" role="alert">${esc(state.error)}</div>` : ''}${list}${state.selectedInvoice ? detailMarkup(state.selectedInvoice) : ''}`;
  }

  function invoiceCard(invoice) {
    return `<article class="portal-invoice"><div><h2>${esc(invoice.invoiceNumber || 'فاتورة')}</h2><p>${esc(invoice.recipientName || '')} · ${esc(formatDate(invoice.invoiceDate))}</p></div><div class="portal-invoice-total">${money(invoice.totals?.totalMinor, invoice.currencyCode)}</div><div class="portal-invoice-actions"><span class="status-pill" data-status="ISSUED">صادرة</span><button class="btn btn-secondary btn-small" type="button" data-action="open-invoice" data-id="${esc(invoice.id)}">عرض الفاتورة</button></div></article>`;
  }

  function detailMarkup(invoice) {
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const transfer = invoice.transferStatus;
    const bank = invoice.bankTransfer;
    const transferMarkup = transfer
      ? `<div class="portal-transfer" data-status="${esc(transfer.status)}"><strong>${transferLabel(transfer.status)}</strong>${transfer.reviewReason ? `<p>ملاحظة المراجعة: ${esc(transfer.reviewReason)}</p>` : ''}${transfer.status === 'APPROVED' ? '<p>تم قبول الإيصال في المراجعة اليدوية. تواصل مع العيادة لتأكيد تسجيل السداد.</p>' : ''}</div>`
      : '';
    const bankMarkup = bank
      ? `<section class="portal-bank"><h3>تعليمات التحويل البنكي</h3><div class="portal-bank-grid"><div><small>البنك</small><strong>${esc(bank.bankName)}</strong></div><div><small>اسم المستفيد</small><strong>${esc(bank.accountHolder)}</strong></div><div><small>رقم الحساب الدولي</small><strong class="mono" dir="ltr">${esc(bank.iban)}</strong></div><div><small>العملة</small><strong class="mono" dir="ltr">${esc(bank.currencyCode)}</strong></div></div><p class="portal-note">حوّل المبلغ إلى الحساب أعلاه ثم أرفق الإيصال. لا يوجد دفع إلكتروني مفعّل.</p></section>`
      : '<div class="portal-message">تعليمات التحويل غير متاحة لهذه الفاتورة حاليًا. تواصل مع العيادة قبل إرسال أي مبلغ.</div>';
    const canUpload = Boolean(bank) && (!transfer || transfer.status === 'REJECTED');
    const upload = canUpload
      ? `<form class="portal-transfer-form" data-form="transfer" data-id="${esc(invoice.id)}"><label class="field"><span>إرفاق إيصال التحويل PDF أو JPG أو PNG</span><input class="control" type="file" name="receipt" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required></label><p class="portal-note">الحد الأقصى 4 ميجابايت. إرسال الإيصال يطلب مراجعة يدوية فقط ولا ينفذ تحصيلًا آليًا.</p><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'جارٍ الإرسال…' : 'إرسال الإيصال للمراجعة'}</button></form>`
      : '';
    return `<section class="portal-detail"><div class="portal-heading"><div><span class="portal-kicker">تفاصيل الفاتورة</span><h2>${esc(invoice.invoiceNumber || 'فاتورة')}</h2></div><button class="btn btn-secondary btn-small" type="button" data-action="close-invoice">إغلاق</button></div><div class="portal-bank-grid"><div><small>التاريخ</small><strong>${esc(formatDate(invoice.invoiceDate))}</strong></div><div><small>الإجمالي</small><strong>${money(invoice.totals?.totalMinor, invoice.currencyCode)}</strong></div></div><div class="table-wrap"><table class="portal-lines"><thead><tr><th>البند</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>${lines.map((line, index) => `<tr><td>${esc(line.description)}</td><td class="mono">${esc(quantity(line.quantityMilli))}</td><td>${money(invoice.totals?.lineTotalsMinor?.[index], invoice.currencyCode)}</td></tr>`).join('')}</tbody></table></div>${invoice.totals ? `<div class="totals"><div class="total-row"><span>المجموع الفرعي</span><strong>${money(invoice.totals.subtotalMinor, invoice.currencyCode)}</strong></div><div class="total-row"><span>الضريبة</span><strong>${money(invoice.totals.taxMinor, invoice.currencyCode)}</strong></div><div class="total-row grand"><span>الإجمالي</span><strong>${money(invoice.totals.totalMinor, invoice.currencyCode)}</strong></div></div>` : ''}${transferMarkup}${bankMarkup}${upload}${futurePaymentMethodsMarkup()}</section>`;
  }

  function futurePaymentMethodsMarkup() {
    return '<section class="portal-bank"><h3>وسائل دفع أخرى</h3><div class="portal-toolbar"><button class="btn btn-secondary btn-small" type="button" disabled>بطاقة · قريبًا</button><button class="btn btn-secondary btn-small" type="button" disabled>Apple Pay · قريبًا</button></div><p class="portal-note">هذه الوسائل غير مفعّلة ولا ترسل أي طلب دفع.</p></section>';
  }

  function money(minor, currency) {
    if (minor == null || !Number.isFinite(Number(minor))) return '—';
    const code = currency || 'SAR';
    const digits = currencyDigits(code);
    const amount = BigInt(Math.trunc(Number(minor)));
    const divisor = 10n ** BigInt(digits);
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(digits, '0');
    const grouped = new Intl.NumberFormat('ar', { maximumFractionDigits: 0 }).format(Number(whole));
    const amountText = `${grouped}${digits ? `.${fraction}` : ''}`;
    return code === 'SAR' && window.ThanarahCurrency
      ? window.ThanarahCurrency.valueMarkup(amountText, code)
      : `<bdi dir="ltr">${esc(amountText)} ${esc(code)}</bdi>`;
  }

  function currencyDigits(code) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch (_) {
      return 2;
    }
  }

  function quantity(value) {
    const milli = BigInt(value || 0);
    const whole = milli / 1000n;
    const fraction = (milli % 1000n).toString().padStart(3, '0').replace(/0+$/u, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function transferLabel(status) {
    return ({
      PENDING_REVIEW: 'الإيصال بانتظار مراجعة العيادة',
      APPROVED: 'تم قبول الإيصال في المراجعة',
      REJECTED: 'تم رفض الإيصال',
    })[status] || 'حالة الإيصال غير محددة';
  }

  async function onSubmit(event) {
    const form = event.target;
    const kind = form.dataset.form;
    if (!['claim', 'verify', 'transfer'].includes(kind)) return;
    event.preventDefault();
    state.busy = true;
    state.error = null;
    render();
    try {
      if (kind === 'claim') {
        const result = await api.startPatientPortalClaim(tenantId, uuid(), true);
        state.challengeId = result.challengeId;
        state.info = result.message;
      } else if (kind === 'verify') {
        const code = String(new FormData(form).get('code') || '').trim();
        await api.verifyPatientPortalClaim(tenantId, state.challengeId, code);
        state.challengeId = '';
        state.info = '';
        state.busy = false;
        await loadInvoices();
        return;
      } else {
        const file = new FormData(form).get('receipt');
        if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024) {
          throw new Error('اختر ملف إيصال صالحًا لا يتجاوز 4 ميجابايت.');
        }
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
          throw new Error('الملفات المقبولة هي PDF أو JPG أو PNG.');
        }
        await api.submitPatientPortalInvoiceTransfer(tenantId, form.dataset.id, file);
        state.info = 'تم إرسال الإيصال للمراجعة اليدوية.';
        state.selectedInvoice = null;
        state.busy = false;
        await loadInvoices();
        return;
      }
    } catch (error) {
      if (error?.status === 401) {
        state.screen = 'signin';
        state.busy = false;
        render();
        window.ThanarahAuth?.open({ audience: 'staff', mode: 'login' });
        return;
      }
      if (kind === 'transfer' && error?.status === 409) {
        state.info = 'هناك إيصال قيد المراجعة أو مقبول. حدّث الفاتورة للاطلاع على حالته.';
      } else {
        state.error = apiMessage(error);
      }
    }
    state.busy = false;
    render();
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'signin') {
      window.ThanarahAuth?.open({ audience: 'staff', mode: 'login' });
    } else if (action === 'retry' || action === 'refresh') {
      await loadInvoices();
    } else if (action === 'new-claim') {
      state.challengeId = '';
      state.error = '';
      state.info = '';
      render();
    } else if (action === 'open-invoice') {
      await openInvoice(button.dataset.id);
    } else if (action === 'close-invoice') {
      state.selectedInvoice = null;
      render();
    } else if (action === 'logout') {
      await api.logout();
      state.screen = 'signin';
      state.invoices = [];
      state.selectedInvoice = null;
      render();
      window.ThanarahAuth?.open({ audience: 'staff', mode: 'login' });
    }
  }

  async function openInvoice(invoiceId) {
    state.busy = true;
    state.error = null;
    render();
    try {
      state.selectedInvoice = await api.getPatientPortalInvoice(tenantId, invoiceId);
    } catch (error) {
      state.error = apiMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }
})();
