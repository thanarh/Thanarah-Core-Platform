(function startPlatformSetup() {
  'use strict';

  const api = window.ThanarahApi;
  const app = document.getElementById('app');
  const PAGE_SIZE = 100;
  const state = {
    screen: 'boot',
    tenants: [],
    selectedId: '',
    memberships: [],
    loading: false,
    saving: false,
    error: '',
    success: '',
  };
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/gu,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character],
    );
  const selectedTenant = () => state.tenants.find((tenant) => tenant.id === state.selectedId);
  const tenantStatus = (status) =>
    ({ ACTIVE: 'نشطة', SUSPENDED: 'موقوفة مؤقتًا', DEACTIVATED: 'غير نشطة' })[status] || status;
  const membershipStatus = (status) =>
    ({ INVITED: 'بانتظار التفعيل', ACTIVE: 'نشطة', SUSPENDED: 'موقوفة', REMOVED: 'أزيلت' })[
      status
    ] || status;

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  void bootstrap();

  async function bootstrap() {
    try {
      if (!api || !(await api.restoreSession())) return renderSignIn();
      await loadTenants();
    } catch (error) {
      state.screen = 'error';
      state.error = message(error);
      render();
    }
  }

  function message(error) {
    if (error?.status === 401) return 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.';
    if (error?.status === 403) return 'لا تملك صلاحية قراءة بيانات المنصة.';
    return error?.message || 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  }

  function renderSignIn(error = '') {
    state.screen = 'signin';
    app.innerHTML = `<section class="workspace-screen"><form class="workspace-card" data-form="login"><div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · PLATFORM</span></div></div><span class="eyebrow">إدارة المنصة</span><h1>تسجيل الدخول</h1><label class="field"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}<button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الدخول…' : 'دخول'}</button></form></section>`;
  }

  async function loadTenants() {
    state.loading = true;
    state.error = '';
    state.screen = 'workspace';
    render();
    try {
      const result = await api.listPlatformTenants({ limit: PAGE_SIZE, offset: 0 });
      state.tenants = result.items || [];
      if (!state.tenants.some((tenant) => tenant.id === state.selectedId)) {
        state.selectedId = state.tenants[0]?.id || '';
      }
      if (state.selectedId) await loadMemberships();
      else state.memberships = [];
    } catch (error) {
      state.tenants = [];
      state.memberships = [];
      state.error = message(error);
      state.screen = error?.status === 401 ? 'signin' : error?.status === 403 ? 'denied' : 'workspace';
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadMemberships() {
    const tenantId = state.selectedId;
    if (!tenantId) return;
    try {
      const result = await api.listPlatformTenantMemberships(tenantId, {
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (state.selectedId === tenantId) state.memberships = result.items || [];
    } catch (error) {
      if (state.selectedId === tenantId) {
        state.memberships = [];
        state.error = message(error);
      }
    }
  }

  function render() {
    if (state.screen === 'signin') return;
    if (state.screen === 'error') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><h1>تعذّر فتح إدارة المنصة</h1><p role="alert">${esc(state.error)}</p><button class="btn btn-secondary" data-action="retry" type="button">إعادة المحاولة</button></div></section>`;
      return;
    }
    if (state.screen === 'denied') {
      app.innerHTML = `<section class="workspace-screen"><div class="workspace-card"><h1>الوصول محدود</h1><p role="alert">لا تملك صلاحية قراءة بيانات المنصة.</p><button class="btn btn-secondary" data-action="logout" type="button">خروج</button></div></section>`;
      return;
    }
    const tenant = selectedTenant();
    app.innerHTML = `<div class="app-frame"><aside class="sidebar"><a class="brand" href="/"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">إدارة المنصة</div><nav class="side-nav"><div class="nav-item active" aria-current="page">المؤسسات والعضويات</div><a class="nav-item" href="/platform-saas/">الخطط والاشتراكات</a></nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>إدارة مركزية<span class="workspace-name">المؤسسات</span></div><div class="side-actions"><button type="button" data-action="logout">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs"><span>إدارة المنصة</span><span aria-hidden="true"> / </span><strong>المؤسسات والعضويات</strong></div><button class="platform-signout" type="button" data-action="logout">خروج</button></header><div class="page-content"><div class="platform-page"><div class="platform-head"><div><span class="eyebrow">إدارة مركزية</span><h1>المؤسسات والعضويات</h1><p>إدارة المؤسسات وحسابات المنصة المرتبطة بها.</p></div></div>${state.error ? `<div class="platform-alert error" role="alert">${esc(state.error)}</div>` : ''}${state.success ? `<div class="platform-success" role="status">${esc(state.success)}</div>` : ''}<div class="platform-grid"><section class="platform-card"><div class="platform-card-head"><div><h2>إنشاء مؤسسة</h2><p class="platform-muted">ستبدأ المؤسسة بحالة نشطة.</p></div></div><form class="platform-form" data-form="tenant"><label class="field"><span>المعرّف المختصر *</span><input name="slug" maxlength="64" required dir="ltr" autocomplete="off" placeholder="clinic-name"></label><label class="field"><span>الاسم القانوني *</span><input name="legalName" maxlength="191" required></label><label class="field"><span>الاسم الظاهر</span><input name="displayName" maxlength="191"></label><button class="btn btn-primary" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'جارٍ الحفظ…' : 'إنشاء المؤسسة'}</button></form></section><section class="platform-card"><div class="platform-card-head"><div><h2>المؤسسات</h2><p class="platform-muted">${state.tenants.length} مؤسسة محمّلة</p></div><button class="btn btn-secondary" type="button" data-action="refresh">تحديث</button></div>${state.loading ? '<div class="platform-empty">جارٍ تحميل المؤسسات…</div>' : state.tenants.length ? `<div class="platform-list">${state.tenants.map(renderTenant).join('')}</div>` : '<div class="platform-empty">لا توجد مؤسسات لعرضها.</div>'}</section></div>${tenant ? renderMemberships(tenant) : ''}<p class="platform-muted">تُطبق صلاحيات المنصة والتحقق من كل تغيير على الخادم. إضافة العضوية تتطلب معرّف حساب منصة موجودًا؛ لا تنشئ هذه الصفحة حسابات أو ترسل دعوات بريدية.</p></div></div></section></div>`;
  }

  function renderTenant(tenant) {
    const action =
      tenant.status === 'ACTIVE'
        ? 'suspend'
        : tenant.status === 'SUSPENDED'
          ? 'activate'
          : '';
    const label = action === 'suspend' ? 'إيقاف مؤقت' : 'تفعيل';
    return `<article class="platform-item ${tenant.id === state.selectedId ? 'selected' : ''}" data-id="${esc(tenant.id)}"><div class="platform-item-main"><button class="platform-item-select" type="button" data-action="select-tenant" data-id="${esc(tenant.id)}"><strong>${esc(tenant.displayName || tenant.legalName)}</strong><small>${esc(tenant.slug)}</small></button><span class="platform-status ${tenant.status === 'SUSPENDED' ? 'suspended' : tenant.status === 'DEACTIVATED' ? 'deactivated' : ''}">${tenantStatus(tenant.status)}</span></div>${tenant.status !== 'DEACTIVATED' ? `<div class="platform-actions"><button class="btn btn-quiet" type="button" data-action="tenant-status" data-id="${esc(tenant.id)}" data-status="${action === 'suspend' ? 'SUSPENDED' : 'ACTIVE'}">${label}</button><button class="btn btn-quiet" type="button" data-action="tenant-status" data-id="${esc(tenant.id)}" data-status="DEACTIVATED">تعطيل نهائي</button></div>` : ''}</article>`;
  }

  function renderMemberships(tenant) {
    return `<section class="platform-card" style="margin-top:16px"><div class="platform-card-head"><div><h2>عضويات ${esc(tenant.displayName || tenant.legalName)}</h2><p class="platform-muted">${esc(tenant.slug)} · ${state.memberships.length} عضوية</p></div></div><form class="platform-form" data-form="membership"><label class="field"><span>معرّف حساب المنصة *</span><input name="platformUserId" required maxlength="36" dir="ltr" autocomplete="off" placeholder="UUID"></label><button class="btn btn-primary" type="submit" ${state.saving || tenant.status !== 'ACTIVE' ? 'disabled' : ''}>إضافة عضوية</button>${tenant.status !== 'ACTIVE' ? '<p class="platform-muted">فعّل المؤسسة قبل إضافة عضويات.</p>' : ''}</form><div class="platform-members">${state.memberships.length ? state.memberships.map(renderMembership).join('') : '<div class="platform-empty">لا توجد عضويات لهذه المؤسسة.</div>'}</div></section>`;
  }

  function renderMembership(membership) {
    const actions = {
      INVITED: [['activate', 'تفعيل'], ['remove', 'إزالة']],
      ACTIVE: [['suspend', 'إيقاف'], ['remove', 'إزالة']],
      SUSPENDED: [['activate', 'إعادة تفعيل'], ['remove', 'إزالة']],
      REMOVED: [],
    }[membership.status] || [];
    return `<article class="platform-member" data-id="${esc(membership.id)}"><div><strong>${membershipStatus(membership.status)}</strong><br><code>${esc(membership.platformUserId)}</code></div><div class="platform-actions">${actions.map(([action, label]) => `<button class="btn btn-quiet" type="button" data-action="membership-status" data-id="${esc(membership.id)}" data-status="${action}">${label}</button>`).join('')}</div></article>`;
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'login') {
      state.saving = true;
      renderSignIn();
      try {
        await api.login(String(data.get('email') || ''), String(data.get('password') || ''));
        state.saving = false;
        await loadTenants();
      } catch (error) {
        state.saving = false;
        renderSignIn(message(error));
      }
      return;
    }
    state.saving = true;
    state.error = '';
    state.success = '';
    render();
    try {
      if (form.dataset.form === 'tenant') {
        const tenant = await api.createPlatformTenant({
          slug: String(data.get('slug') || ''),
          legalName: String(data.get('legalName') || ''),
          displayName: String(data.get('displayName') || '').trim() || undefined,
        });
        state.selectedId = tenant.id;
        state.success = 'تم إنشاء المؤسسة.';
      } else if (form.dataset.form === 'membership' && state.selectedId) {
        await api.invitePlatformTenantMembership(
          state.selectedId,
          String(data.get('platformUserId') || '').trim(),
        );
        state.success = 'تمت إضافة العضوية بحالة انتظار التفعيل.';
      }
      state.saving = false;
      await loadTenants();
    } catch (error) {
      state.saving = false;
      state.error = message(error);
      render();
    }
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'retry' || action === 'refresh') return loadTenants();
    if (action === 'logout') {
      await api.logout();
      state.tenants = [];
      state.memberships = [];
      return renderSignIn();
    }
    if (action === 'select-tenant') {
      state.selectedId = button.dataset.id;
      state.error = '';
      state.success = '';
      state.memberships = [];
      state.loading = true;
      render();
      await loadMemberships();
      state.loading = false;
      return render();
    }
    if (action === 'tenant-status') {
      const status = button.dataset.status;
      if (
        status === 'DEACTIVATED' &&
        !window.confirm('سيتم تعطيل المؤسسة نهائيًا. هل تريد المتابعة؟')
      )
        return;
      try {
        await api.changePlatformTenantStatus(button.dataset.id, status);
        state.success = 'تم تحديث حالة المؤسسة.';
        await loadTenants();
      } catch (error) {
        state.error = message(error);
        render();
      }
    }
    if (action === 'membership-status') {
      const nextAction = button.dataset.status;
      if (
        nextAction === 'remove' &&
        !window.confirm('ستُزال العضوية نهائيًا. هل تريد المتابعة؟')
      )
        return;
      try {
        await api.changePlatformTenantMembershipStatus(
          state.selectedId,
          button.dataset.id,
          nextAction,
        );
        state.success = 'تم تحديث حالة العضوية.';
        await loadTenants();
      } catch (error) {
        state.error = message(error);
        render();
      }
    }
  }
})();
