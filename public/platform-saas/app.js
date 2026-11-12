(function startPlatformSaaS() {
  'use strict';
  const api = window.ThanarahApi;
  const app = document.getElementById('app');
  const state = { screen:'boot', plans:[], features:[], subscriptions:[], tenants:[], transfers:[], paymentSettings:null, loading:false, saving:false, error:'', success:'' };
  const esc = value => String(value ?? '').replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusLabel = status => ({ACTIVE:'نشط',INACTIVE:'غير نشط',ARCHIVED:'مؤرشف',SCHEDULED:'مجدول',SUSPENDED:'موقوف',CANCELLED:'ملغى',EXPIRED:'منتهٍ',PENDING_REVIEW:'بانتظار المراجعة',APPROVED:'مقبول',REJECTED:'مرفوض'})[status] || status;
  const errorText = error => error?.status === 401 ? 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.' : error?.status === 403 ? 'لا تملك صلاحية تنفيذ هذا الإجراء.' : error?.status === 400 ? 'تحقق من الحقول والتواريخ المدخلة.' : error?.status === 409 ? 'تعذّر التغيير بسبب تعارض أو حالة غير مسموحة.' : error?.message || 'تعذّر إكمال الطلب. حاول مرة أخرى.';
  document.addEventListener('submit', onSubmit);
  document.addEventListener('click', onClick);
  void bootstrap();

  async function bootstrap() {
    try {
      if (!api || !(await api.restoreSession())) return renderLogin();
      await load();
    } catch (error) { state.error = errorText(error); state.screen = error?.status === 403 ? 'denied' : 'error'; render(); }
  }
  function renderLogin(error='') {
    state.screen='signin';
    app.innerHTML=`<section class="workspace-screen"><form class="workspace-card" data-form="login"><div class="auth-brand"><img src="/assets/logo-transparent.png" alt=""><div><strong>ثناره</strong><span>THANARAH · PLATFORM</span></div></div><span class="eyebrow">إدارة المنصة</span><h1>تسجيل الدخول</h1><label class="field"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>${error?`<p class="form-error" role="alert">${esc(error)}</p>`:''}<button class="btn btn-primary" type="submit">دخول</button></form></section>`;
  }
  async function load() {
    state.loading=true; state.error=''; state.screen='workspace'; render();
    try {
      const [plans,features,subscriptions,tenants,paymentSettings,transfers]=await Promise.all([
        api.listPlatformPlans({limit:100,offset:0}), api.listPlatformFeatures({limit:100,offset:0}),
        api.listPlatformSubscriptions({limit:100,offset:0}), api.listPlatformTenants({limit:100,offset:0}),
        api.getPlatformSubscriptionPaymentSettings(), api.listPlatformSubscriptionTransfers({limit:100,offset:0}),
      ]);
      state.plans=plans.items||[]; state.features=features.items||[]; state.subscriptions=subscriptions.items||[]; state.tenants=tenants.items||[];
      state.paymentSettings=paymentSettings; state.transfers=transfers.items||[];
    } catch(error) {
      state.error=error?.status===403?'لا تملك صلاحية قراءة خطط واشتراكات المنصة.':errorText(error); state.screen=error?.status===401?'signin':error?.status===403?'denied':'workspace';
    } finally { state.loading=false; render(); }
  }
  function render() {
    if(state.screen==='signin') return renderLogin(state.error);
    if(state.screen==='denied'||state.screen==='error') {
      app.innerHTML=`<section class="workspace-screen"><div class="workspace-card"><h1>${state.screen==='denied'?'الوصول محدود':'تعذّر فتح إدارة الاشتراكات'}</h1><p role="alert">${esc(state.error)}</p><button class="btn btn-secondary" data-action="${state.screen==='denied'?'logout':'retry'}" type="button">${state.screen==='denied'?'خروج':'إعادة المحاولة'}</button></div></section>`; return;
    }
     app.innerHTML=`<div class="app-frame"><aside class="sidebar"><a class="brand" href="/"><img src="/assets/logo-transparent.png" alt=""><span class="brand-copy"><strong>ثناره</strong><small>THANARAH</small></span></a><div class="side-kicker">إدارة المنصة</div><nav class="side-nav"><div class="nav-item active" aria-current="page">الخطط والاشتراكات</div></nav><div class="side-bottom"><div class="scope-note"><span class="scope-dot"></span>إدارة مركزية<span class="workspace-name">سجل يدوي</span></div><div class="side-actions"><button data-action="logout" type="button">خروج</button></div></div></aside><section class="main-area"><header class="topbar"><div class="breadcrumbs">إدارة المنصة / <strong>الخطط والاشتراكات</strong></div><button class="platform-signout" data-action="logout" type="button">خروج</button></header><div class="page-content"><div class="saas-page"><div class="saas-top"><div><span class="eyebrow">إدارة مركزية</span><h1>الخطط والاشتراكات</h1><p class="saas-note">إدارة يدوية فقط؛ اعتماد الإيصال لا يغيّر حالة الاشتراك أو مدته، ولا ينفذ تحصيلًا.</p></div><button class="btn btn-secondary" data-action="refresh" type="button">تحديث</button></div>${state.error?`<div class="platform-alert error" role="alert">${esc(state.error)}</div>`:''}${state.success?`<div class="platform-success" role="status">${esc(state.success)}</div>`:''}${state.loading?'<div class="platform-empty">جارٍ تحميل البيانات…</div>':''}<div class="saas-grid">${renderPlans()}${renderFeatures()}${renderSubscriptions()}${renderPaymentSettings()}${renderSubscriptionTransferForm()}${renderTransfers()}</div></div></div></section></div>`;
  }
  const statusClass = status => ['INACTIVE','SUSPENDED','SCHEDULED','PENDING_REVIEW'].includes(status)?'inactive':['ARCHIVED','CANCELLED','EXPIRED','REJECTED'].includes(status)?'archived':'';
  function renderPlans() {
    return `<section class="saas-card"><h2>الخطط</h2><form class="saas-form" data-form="plan"><label class="field"><span>المعرّف الثابت *</span><input name="key" required maxlength="64" dir="ltr" placeholder="STARTER"></label><label class="field"><span>الاسم *</span><input name="name" required maxlength="191"></label><label class="field"><span>الوصف</span><input name="description" maxlength="1000"></label><button class="btn btn-primary" type="submit" ${state.saving?'disabled':''}>إضافة خطة</button></form><div class="saas-list">${state.plans.length?state.plans.map(p=>`<article class="saas-item" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong> <span class="saas-status ${statusClass(p.status)}">${statusLabel(p.status)}</span><div class="saas-meta">${esc(p.key)} · ${esc(p.description||'بدون وصف')}</div><form class="saas-form" data-form="edit-plan" data-id="${esc(p.id)}"><label class="field"><span>تعديل الاسم</span><input name="name" value="${esc(p.name)}" required maxlength="191"></label><label class="field"><span>تعديل الوصف</span><input name="description" value="${esc(p.description||'')}" maxlength="1000"></label><button class="btn btn-secondary" type="submit">حفظ بيانات الخطة</button></form><div class="saas-actions">${p.status!=='ARCHIVED'?`<button class="btn btn-quiet" data-action="plan-status" data-id="${esc(p.id)}" data-status="${p.status==='ACTIVE'?'INACTIVE':'ACTIVE'}">${p.status==='ACTIVE'?'إيقاف':'تفعيل'}</button><button class="btn btn-quiet" data-action="plan-status" data-id="${esc(p.id)}" data-status="ARCHIVED">أرشفة</button>`:''}</div></article>`).join(''):'<div class="platform-empty">لا توجد خطط.</div>'}</div></section>`;
  }
  function renderFeatures() {
    return `<section class="saas-card"><h2>الميزات</h2><form class="saas-form" data-form="feature"><label class="field"><span>المعرّف الثابت *</span><input name="key" required maxlength="64" dir="ltr" placeholder="REPORTS"></label><label class="field"><span>الاسم *</span><input name="name" required maxlength="191"></label><label class="field"><span>الوصف</span><input name="description" maxlength="1000"></label><button class="btn btn-primary" type="submit" ${state.saving?'disabled':''}>إضافة ميزة</button></form><div class="saas-list">${state.features.length?state.features.map(f=>`<article class="saas-item" data-id="${esc(f.id)}"><strong>${esc(f.name)}</strong> <span class="saas-status ${statusClass(f.status)}">${statusLabel(f.status)}</span><div class="saas-meta">${esc(f.key)} · ${esc(f.description||'بدون وصف')}</div><form class="saas-form" data-form="edit-feature" data-id="${esc(f.id)}"><label class="field"><span>تعديل الاسم</span><input name="name" value="${esc(f.name)}" required maxlength="191"></label><label class="field"><span>تعديل الوصف</span><input name="description" value="${esc(f.description||'')}" maxlength="1000"></label><button class="btn btn-secondary" type="submit">حفظ بيانات الميزة</button></form><div class="saas-actions"><button class="btn btn-quiet" data-action="feature-status" data-id="${esc(f.id)}" data-status="${f.status==='ACTIVE'?'INACTIVE':'ACTIVE'}">${f.status==='ACTIVE'?'إيقاف':'تفعيل'}</button></div></article>`).join(''):'<div class="platform-empty">لا توجد ميزات.</div>'}</div></section>`;
  }
  function renderSubscriptions() {
    return `<section class="saas-card"><h2>إسناد اشتراك</h2><form class="saas-form" data-form="subscription"><label class="field"><span>المؤسسة *</span><select name="tenantId" required><option value="">اختر مؤسسة</option>${state.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.displayName||t.legalName)} · ${esc(t.status)}</option>`).join('')}</select></label><label class="field"><span>الخطة *</span><select name="planId" required><option value="">اختر خطة نشطة</option>${state.plans.filter(p=>p.status==='ACTIVE').map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.key)}</option>`).join('')}</select></label><div class="saas-period"><label class="field"><span>يبدأ في *</span><input type="datetime-local" name="startsAt" required></label><label class="field"><span>ينتهي في (اختياري)</span><input type="datetime-local" name="endsAt"></label></div><button class="btn btn-primary" type="submit" ${state.saving?'disabled':''}>إسناد اشتراك يدوي</button></form><h2>الاشتراكات</h2><div class="saas-list">${state.subscriptions.length?state.subscriptions.map(s=>`<article class="saas-item"><strong>${esc(state.tenants.find(t=>t.id===s.tenantId)?.displayName||s.tenantId)}</strong> <span class="saas-status ${statusClass(s.effectiveStatus)}">${statusLabel(s.effectiveStatus)}</span><div class="saas-meta">خطة: ${esc(state.plans.find(p=>p.id===s.planId)?.name||s.planId)}<br>الحالة المسجلة: ${statusLabel(s.status)} · من ${new Date(s.startsAt).toLocaleString(window.ThanarahLocale?.dateLocale('ar-SA') || 'ar-SA')} · إلى ${s.endsAt?new Date(s.endsAt).toLocaleString(window.ThanarahLocale?.dateLocale('ar-SA') || 'ar-SA'):'مفتوح'}</div><div class="saas-actions">${s.status==='ACTIVE'?`<button class="btn btn-quiet" data-action="subscription" data-id="${esc(s.id)}" data-status="suspend">إيقاف</button>`:''}${s.status==='SUSPENDED'?`<button class="btn btn-quiet" data-action="subscription" data-id="${esc(s.id)}" data-status="activate">إعادة تفعيل</button>`:''}${['ACTIVE','SUSPENDED'].includes(s.status)?`<button class="btn btn-quiet" data-action="subscription" data-id="${esc(s.id)}" data-status="cancel">إلغاء</button>`:''}${s.endsAt&&new Date(s.endsAt)<=new Date()&&['ACTIVE','SUSPENDED'].includes(s.status)?`<button class="btn btn-quiet" data-action="subscription" data-id="${esc(s.id)}" data-status="expire">إنهاء</button>`:''}</div></article>`).join(''):'<div class="platform-empty">لا توجد اشتراكات.</div>'}</div></section>`;
  }
  function renderPaymentSettings() {
    const s=state.paymentSettings||{enabled:false,bankName:'',accountHolder:'',iban:'',currencyCode:'',version:0};
    return `<section class="saas-card"><h2>إعدادات التحويل البنكي للاشتراكات</h2><p class="saas-note">المسار معطّل افتراضيًا. لا تُعرّف هذه الإعدادات سعر الخطة أو الضريبة أو الاستحقاق أو الاسترداد.</p><form class="saas-form" data-form="payment-settings"><input type="hidden" name="expectedVersion" value="${esc(s.version)}"><label class="field"><span>اسم البنك</span><input name="bankName" maxlength="100" value="${esc(s.bankName||'')}"></label><label class="field"><span>صاحب الحساب</span><input name="accountHolder" maxlength="191" value="${esc(s.accountHolder||'')}"></label><label class="field"><span>IBAN</span><input name="iban" maxlength="64" dir="ltr" value="${esc(s.iban||'')}"></label><label class="field"><span>العملة التي يقبلها الحساب</span><input name="currencyCode" maxlength="3" pattern="[A-Za-z]{3}" dir="ltr" value="${esc(s.currencyCode||'')}"></label><label class="field"><span><input type="checkbox" name="enabled" ${s.enabled?'checked':''}> تفعيل رفع الإيصالات</span></label><button class="btn btn-primary" type="submit" ${state.saving?'disabled':''}>حفظ الإعدادات</button></form><p class="saas-note">تحديث الإعدادات يُسجل في سجل المراجعة.</p>${auditHistoryMarkup(s.history)}</section>`;
  }
  function renderSubscriptionTransferForm() {
    const s=state.paymentSettings;
    const available=!!s?.enabled;
    return `<section class="saas-card"><h2>تسجيل إيصال اشتراك</h2>${available?`<p class="saas-note">هذه شاشة تسجيل لموظفي المنصة المخوّلين؛ لا توجد بوابة دفع ذاتية للعيادات. لن يغيّر تسجيل الإيصال مدة الاشتراك.</p><form class="saas-form" data-form="subscription-transfer"><label class="field"><span>الاشتراك *</span><select name="subscriptionId" required><option value="">اختر اشتراكًا</option>${state.subscriptions.map(x=>`<option value="${esc(x.id)}">${esc(state.tenants.find(t=>t.id===x.tenantId)?.displayName||x.tenantId)} · ${esc(state.plans.find(p=>p.id===x.planId)?.name||x.planId)} · ${esc(statusLabel(x.effectiveStatus))}</option>`).join('')}</select></label><label class="field"><span>الإيصال PDF أو JPG أو PNG *</span><input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required></label><button class="btn btn-primary" type="submit" ${state.saving?'disabled':''}>إرسال للمراجعة</button></form>`:'<div class="platform-empty">التحويل البنكي غير مفعّل. اضبط حساب البنك وفعّل المسار أولًا.</div>'}</section>`;
  }
  function renderTransfers() {
    return `<section class="saas-card"><h2>إيصالات تحويل الاشتراكات</h2><div class="saas-list">${state.transfers.length?state.transfers.map(t=>`<article class="saas-item"><strong>${esc(state.tenants.find(x=>x.id===t.tenantId)?.displayName||t.tenantId)}</strong> <span class="saas-status ${statusClass(t.status)}">${statusLabel(t.status)}</span><div class="saas-meta">الخطة: ${esc(state.plans.find(x=>x.id===state.subscriptions.find(s=>s.id===t.subscriptionId)?.planId)?.name||'—')}<br>الإرسال: ${new Date(t.submittedAt).toLocaleString(window.ThanarahLocale?.dateLocale('ar-SA')||'ar-SA')}<br>${t.reviewReason?`سبب القرار: ${esc(t.reviewReason)}`:'بانتظار المراجعة'}</div><div class="saas-actions"><button class="btn btn-quiet" type="button" data-action="download-receipt" data-id="${esc(t.id)}">تنزيل الإيصال</button></div>${auditHistoryMarkup(t.history)}${t.status==='PENDING_REVIEW'?`<form class="saas-form" data-form="transfer-review" data-id="${esc(t.id)}"><input type="hidden" name="expectedVersion" value="${esc(t.version)}"><label class="field"><span>سبب القرار *</span><textarea name="reason" maxlength="500" minlength="3" required></textarea></label><div class="saas-actions"><button class="btn btn-secondary" name="decision" value="approve" type="submit">قبول الإيصال</button><button class="btn btn-quiet" name="decision" value="reject" type="submit">رفض الإيصال</button></div></form>`:''}</article>`).join(''):'<div class="platform-empty">لا توجد إيصالات تحويل.</div>'}</div></section>`;
  }
  function auditHistoryMarkup(items) {
    const labels = {UPDATED:'تحديث الإعدادات',SUBMITTED:'إرسال الإيصال',APPROVED:'قبول الإيصال',REJECTED:'رفض الإيصال'};
    const entries = Array.isArray(items) ? items.slice(-10).reverse() : [];
    if (!entries.length) return '';
    return `<div class="saas-meta"><strong>سجل المراجعة</strong>${entries.map(event=>`<div>${esc(labels[event?.action]||event?.action||'حدث')} · ${esc(new Date(event?.at||'').toLocaleString(window.ThanarahLocale?.dateLocale('ar-SA')||'ar-SA'))}${event?.reason?`<br>السبب: ${esc(event.reason)}`:''}</div>`).join('')}</div>`;
  }
  async function onSubmit(event) {
    const form=event.target; if(!(form instanceof HTMLFormElement)) return;
    event.preventDefault(); const data=new FormData(form); const value=name=>String(data.get(name)||'').trim();
    if(form.dataset.form==='login') { try { await api.login(value('email'),value('password')); await load(); } catch(error){renderLogin(errorText(error));} return; }
    if(state.saving||state.loading) return;
    state.saving=true; state.error=''; state.success=''; render();
    try {
      if(form.dataset.form==='plan') await api.createPlatformPlan({key:value('key'),name:value('name'),description:value('description')||undefined});
      if(form.dataset.form==='feature') await api.createPlatformFeature({key:value('key'),name:value('name'),description:value('description')||undefined});
      if(form.dataset.form==='edit-plan') await api.updatePlatformPlan(form.dataset.id,{name:value('name'),description:value('description')||null});
      if(form.dataset.form==='edit-feature') await api.updatePlatformFeature(form.dataset.id,{name:value('name'),description:value('description')||null});
      if(form.dataset.form==='subscription') await api.createPlatformSubscription({tenantId:value('tenantId'),planId:value('planId'),startsAt:new Date(value('startsAt')).toISOString(),...(value('endsAt')?{endsAt:new Date(value('endsAt')).toISOString()}:{})});
      if(form.dataset.form==='payment-settings') await api.updatePlatformSubscriptionPaymentSettings({
        expectedVersion:Number(value('expectedVersion')),
        enabled:data.get('enabled')==='on',
        bankName:value('bankName')||null, accountHolder:value('accountHolder')||null,
        iban:value('iban')||null, currencyCode:value('currencyCode').toUpperCase()||null,
      });
      if(form.dataset.form==='subscription-transfer') {
        const file=data.get('receipt');
        if(!(file instanceof File)||!file.size) throw new Error('اختر إيصالًا صالحًا قبل الإرسال.');
        await api.submitPlatformSubscriptionTransfer(value('subscriptionId'),file);
      }
      if(form.dataset.form==='transfer-review') {
        const decision=event.submitter?.value;
        if(!['approve','reject'].includes(decision)) throw new Error('اختر قبول الإيصال أو رفضه.');
        await api.reviewPlatformSubscriptionTransfer(form.dataset.id,decision,Number(value('expectedVersion')),value('reason'));
      }
      await load();
      if(!state.error) state.success='تم حفظ التغيير.';
    } catch(error){state.error=errorText(error);}
    finally {state.saving=false; render();}
  }
  async function onClick(event) {
    const button=event.target.closest('[data-action]'); if(!button) return;
    if(button.dataset.action==='logout'){await api.logout();return renderLogin();}
    if(state.saving||state.loading) return;
    if(button.dataset.action==='refresh'||button.dataset.action==='retry') return load();
    state.saving=true; state.error=''; state.success=''; render();
    try {
      if(button.dataset.action==='plan-status') await api.changePlatformPlanStatus(button.dataset.id,button.dataset.status);
      if(button.dataset.action==='feature-status') await api.changePlatformFeatureStatus(button.dataset.id,button.dataset.status);
      if(button.dataset.action==='subscription') {
        const action=button.dataset.status;
        if(action==='cancel'&&!window.confirm('سيتم إلغاء الاشتراك دون حذفه. متابعة؟')) return;
        await api.changePlatformSubscriptionStatus(button.dataset.id,action);
      }
      if(button.dataset.action==='download-receipt') {
        await api.downloadPlatformSubscriptionTransferReceipt(button.dataset.id);
        state.success='تم تنزيل الإيصال.';
        render();
        return;
      }
      await load();
      if(!state.error) state.success='تم تحديث الحالة.';
    } catch(error){state.error=errorText(error);}
    finally {state.saving=false; render();}
  }
})();
