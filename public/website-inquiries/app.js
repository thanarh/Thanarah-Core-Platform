(function () {
  'use strict';
  const api = window.CompanyApi;
  const root = document.getElementById('inbox');
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );

  function signIn(message = '') {
    root.innerHTML = `<section class="panel" style="max-width:540px;margin:auto"><div class="panel-body">
      <h1>استفسارات الموقع</h1><p>هذه المساحة لمديري عملاء الشركة المخوّلين فقط، وليست لحساب العيادة.</p>
      <form id="inbox-login" style="display:grid;gap:12px">
        <label for="email">البريد الإلكتروني</label><input id="email" name="email" type="email" autocomplete="username" required dir="ltr">
        <label for="password">كلمة المرور</label><input id="password" name="password" type="password" autocomplete="current-password" required dir="ltr">
        <p id="login-message" role="alert">${escape(message)}</p><button class="btn primary" type="submit">تسجيل الدخول</button>
      </form></div></section>`;
    document.getElementById('inbox-login').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        await api.login(form.email.value, form.password.value);
        form.password.value = '';
        await load();
      } catch (error) {
        document.getElementById('login-message').textContent =
          error.message || 'تعذر تسجيل الدخول.';
      } finally {
        button.disabled = false;
      }
    });
  }
  async function load() {
    root.innerHTML = '<p role="status">جارٍ تحميل الاستفسارات…</p>';
    try {
      const result = await api.request('/customer-admin/inquiries');
      root.innerHTML = `<div class="section-head"><h1>استفسارات الموقع</h1>
        <p>أحدث ${result.limit} استفسارًا كحد أقصى، مرتبة من الأحدث. لا تمثل هذه القائمة إجمالي الاستفسارات.</p>
        <button class="btn outline" id="reload-inbox">تحديث</button> <button class="btn outline" id="logout-inbox">تسجيل الخروج</button></div>
        <section aria-label="الاستفسارات">${
          result.items.length
            ? result.items
                .map(
                  (
                    item,
                  ) => `<article class="panel" style="margin-block:20px"><div class="panel-body">
          <h2>${escape(item.organization)}</h2><p>${escape(item.fullName)} · <span dir="ltr">${escape(item.email)}</span></p>
          ${item.phone ? `<p dir="ltr">${escape(item.phone)}</p>` : ''}
          <p>${escape(item.topic)}${item.packageCode ? ' · ' + escape(item.packageCode) : ''}</p>
          <p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(item.message)}</p>
          <small dir="ltr">${escape(item.reference)} · ${escape(new Date(item.receivedAt).toLocaleString('ar-SA'))}</small>
        </div></article>`,
                )
                .join('')
            : '<p class="notice">لا توجد استفسارات محفوظة حتى الآن.</p>'
        }</section>`;
      document.getElementById('reload-inbox').addEventListener('click', load);
      document.getElementById('logout-inbox').addEventListener('click', async () => {
        try {
          await api.logout();
          signIn();
        } catch {
          root.innerHTML =
            '<p role="alert">تعذر تأكيد تسجيل الخروج. أعد تحميل الصفحة للمحاولة مجددًا.</p>';
        }
      });
    } catch (error) {
      if (error.status === 401) {
        signIn();
        return;
      }
      root.innerHTML = `<h1>استفسارات الموقع</h1><p role="alert">${
        error.status === 403
          ? 'لا تملك صلاحية إدارة جميع عملاء الشركة. لم تُعرض أي بيانات.'
          : 'تعذر تحميل الاستفسارات. لم تُعرض نتائج قديمة.'
      }</p><button class="btn outline" id="retry-inbox">إعادة المحاولة</button>`;
      document.getElementById('retry-inbox').addEventListener('click', load);
    }
  }
  api
    .restoreSession()
    .then((ready) => (ready ? load() : signIn()))
    .catch(() => {
      signIn('خدمة الجلسات غير متاحة مؤقتًا. أعد المحاولة دون تغيير بيانات الحساب.');
    });
})();
