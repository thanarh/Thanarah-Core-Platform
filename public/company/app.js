(function () {
  'use strict';
  const api = window.CompanyApi;
  window.addEventListener('thanarah:authenticated', event => {
    if (event.detail.audience === 'staff') void loadSession();
  });
  const app = document.getElementById('app');
  const toastRegion = document.getElementById('toast-region');
  const PERMS = [
    'organization.read','organization.manage','people.read','people.manage','access.manage','hr.read','hr.manage','hr.approve',
    'crm.read','crm.manage','requests.read','requests.manage','requests.approve','policies.read','policies.manage','policies.approve',
    'finance.read','finance.manage','finance.post','audit.read','dashboard.ceo','dashboard.cto','dashboard.director',
  ];
  const NAV = [
    { section:'الرؤية', items:[
      ['overview-ceo','الرئيس التنفيذي','dashboard.ceo','C'],
      ['overview-cto','الرئيس التقني','dashboard.cto','T'],
      ['overview-director','المدير التنفيذي العام','dashboard.director','D'],
    ]},
    { section:'الفريق والعمل', items:[
      ['hierarchy','الهيكل التنظيمي','organization.read','O'],
      ['employees','الموظفون والصلاحيات','people.read','P'],
      ['contracts','العقود والاستحقاقات','hr.read','H'],
      ['clients','العملاء والفرص','crm.read','C'],
      ['requests','الطلبات الداخلية','requests.read','R'],
    ]},
    { section:'المالية والحوكمة', items:[
      ['accounts','دليل الحسابات','finance.read','A'],
      ['journals','القيود المالية','finance.read','J'],
      ['policies','سياسات الاستحقاق','policies.read','S'],
      ['accruals','إنشاء استحقاق','finance.manage','+'],
      ['finance','ميزان المراجعة','finance.read','='],
      ['audit','سجل التدقيق','audit.read','L'],
    ]},
  ];
  const CONFIG = {
    units:{ title:'الهيكل التنظيمي', singular:'وحدة تنظيمية', permission:'organization.read', write:'organization.manage',
      fields:[['name','اسم الوحدة','text',true],['unitType','نوع الوحدة','select',true,['COMPANY','DEPARTMENT','SECTION']],['parentId','الوحدة الأم','ref',false,'units'],['status','الحالة','select',true,['ACTIVE','ARCHIVED']] ] },
    roles:{ title:'الأدوار المخصصة', singular:'دور مخصص', permission:'people.read', write:'access.manage',
      fields:[['name','اسم الدور','text',true],['permissions','الصلاحيات','permissions',true],['status','الحالة','select',true,['ACTIVE','ARCHIVED']]] },
    employees:{ title:'الموظفون', singular:'موظف', permission:'people.read', write:'people.manage',
      fields:[['name','الاسم','text',true],['userId','معرّف حساب المنصة','text',false],['unitId','الوحدة التنظيمية','ref',true,'units'],['jobTitle','المسمى الوظيفي','text',true],['roleIds','الأدوار','roles',true],['status','الحالة','select',true,['ACTIVE','INACTIVE']]] },
    contracts:{ title:'العقود والاستحقاقات الشهرية', singular:'عقد', permission:'hr.read', write:'hr.manage',
      fields:[['employeeId','الموظف','ref',true,'employees'],['title','عنوان العقد','text',true],['startDate','تاريخ البداية','date',true],['endDate','تاريخ النهاية','date',false],['monthlyMinor','الأجر الشهري (ريال)','money',true],['status','الحالة','select',true,['DRAFT']]] },
    clients:{ title:'العملاء والفرص', singular:'عميل أو فرصة', permission:'crm.read', write:'crm.manage',
      fields:[['name','اسم العميل','text',true],['contact','بيانات التواصل','text',false],['ownerId','مدير الحساب','ref',true,'employees'],['stage','المرحلة','select',true,['LEAD','QUALIFIED','PROPOSAL','WON','LOST']]] },
    requests:{ title:'الطلبات الداخلية', singular:'طلب', permission:'requests.read', write:'requests.manage',
      fields:[['title','عنوان الطلب','text',true],['description','التفاصيل','textarea',false],['category','التصنيف','select',true,['HR','SALES','FINANCE','TECHNICAL','OPERATIONS']],['ownerId','المسؤول','ref',true,'employees'],['dueDate','تاريخ الاستحقاق','date',true],['status','الحالة','select',true,['DRAFT']]] },
    accounts:{ title:'دليل الحسابات', singular:'حساب', permission:'finance.read', write:'finance.manage',
      fields:[['code','رمز الحساب','text',true],['name','اسم الحساب','text',true],['type','النوع','select',true,['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']],['status','الحالة','select',true,['ACTIVE','ARCHIVED']]] },
    policies:{ title:'سياسات الاستحقاق', singular:'سياسة', permission:'policies.read', write:'policies.manage',
      fields:[['name','اسم السياسة','text',true],['type','نوع السياسة','select',true,['PAYROLL','COMMISSION','PROFIT']],['rateBps','معدل الاستحقاق (%)','percent',true],['maxAmountMinor','الحد الأعلى (ريال)','money',true],['debitAccountId','حساب المدين','ref',true,'accounts'],['creditAccountId','حساب الدائن','ref',true,'accounts'],['effectiveFrom','سارية من','date',true],['effectiveTo','سارية حتى','date',false],['status','الحالة','select',true,['DRAFT']]] },
    journals:{ title:'القيود المالية', singular:'قيد', permission:'finance.read', write:'finance.manage',
      fields:[['memo','البيان','text',true],['kind','نوع القيد','select',true,['GENERAL','DEPOSIT','WITHDRAWAL']],['date','التاريخ','date',true],['clientId','العميل المرتبط بالإيراد','ref',false,'clients'],['lines','بنود القيد','lines',true]] },
  };
  const state = { session:null, view:'', period:new Date().toISOString().slice(0,7), records:{}, refs:{}, totals:{}, pages:{}, loading:false, error:'', modal:null, search:'', auditPage:1, navOpen:false };
  const arPermission = (permission) => permission;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const has = (permission) => Boolean(state.session?.isRoot || state.session?.permissions?.includes(permission));
  const moneyMinor = (minor) => {
    if (minor === null || minor === undefined || !Number.isSafeInteger(Number(minor))) return '—';
    return new Intl.NumberFormat('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(minor)/100) + ' ر.س';
  };
  const decimalToMinor = (value) => {
    const text = String(value).trim().replace(/٬/g,'').replace(/٫/g,'.');
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('أدخل مبلغًا موجبًا بدقتين عشريتين كحد أقصى.');
    const [units, fraction=''] = text.split('.');
    const result = Number(units)*100 + Number((fraction+'00').slice(0,2));
    if (!Number.isSafeInteger(result) || result > 1_000_000_000_000) throw new Error('المبلغ خارج النطاق الآمن.');
    return result;
  };
  const dateText = (value) => value ? new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium'}).format(new Date(value)) : '—';
  const label = (value) => ({
    ACTIVE:'نشط',ARCHIVED:'مؤرشف',INACTIVE:'غير نشط',DRAFT:'مسودة',APPROVED:'معتمد',ENDED:'منتهي',RETIRED:'متقاعد',CANCELLED:'ملغي',
    SUBMITTED:'مرسل للمراجعة',REJECTED:'مرفوض',ESCALATED:'مصعّد',POSTED:'مرحّل',COMPANY:'الشركة',DEPARTMENT:'إدارة',
    SECTION:'قسم',LEAD:'عميل محتمل',QUALIFIED:'مؤهل',PROPOSAL:'عرض مقدم',WON:'فوز',LOST:'مغلق دون اتفاق',
    HR:'موارد بشرية',SALES:'مبيعات',FINANCE:'مالية',TECHNICAL:'تقني',OPERATIONS:'تشغيل',
    ASSET:'أصول',LIABILITY:'التزامات',EQUITY:'حقوق ملكية',REVENUE:'إيرادات',EXPENSE:'مصروفات',
    GENERAL:'عام',DEPOSIT:'إيداع',WITHDRAWAL:'سحب',PAYROLL:'رواتب',COMMISSION:'عمولات',PROFIT:'أرباح',REVERSAL:'عكس قيد',
    CEO:'الرئيس التنفيذي',CTO:'الرئيس التقني',GENERAL_DIRECTOR:'المدير التنفيذي العام',
  }[value] || value || '—');
  function toast(message, bad=false) {
    const el=document.createElement('div'); el.className=`toast${bad?' bad':''}`; el.textContent=message;
    toastRegion.append(el); setTimeout(()=>el.remove(),5000);
  }
  function statusPill(status) {
    const warn=['DRAFT','SUBMITTED','ESCALATED','LEAD','PROPOSAL'].includes(status);
    const bad=['REJECTED','LOST','INACTIVE','ARCHIVED','CANCELLED'].includes(status);
    return `<span class="pill ${warn?'pill-warn':bad?'pill-bad':''}">${esc(label(status))}</span>`;
  }
  function navMarkup() {
    return NAV.map(group => {
      const items=group.items.filter(item=>canView(item[0]));
      if (!items.length) return '';
      return `<div class="nav-label">${esc(group.section)}</div>${items.map(([id,title,,glyph])=>`<button class="nav-link ${state.view===id?'active':''}" data-nav="${id}"><span class="nav-glyph">${glyph}</span><span>${esc(title)}</span></button>`).join('')}`;
    }).join('') + (has('customers.read') ? '<div class="nav-label">رحلة العميل</div><a class="nav-link" href="/customer-admin/"><span class="nav-glyph">C</span><span>طلبات العملاء والباقات</span></a>' : '');
  }
  function shell(content) {
    const roleNames=(state.session.roles||[]).map(label).join('، ') || (state.session.isRoot?'مالك المنصة':'عضو الفريق');
    const viewName=NAV.flatMap(group=>group.items).find(item=>item[0]===state.view)?.[1] || 'عمليات الشركة';
    app.innerHTML=`<div class="app-shell">
      <div class="mobile-backdrop ${state.navOpen?'show':''}" data-close-nav></div>
      <aside class="sidebar ${state.navOpen?'open':''}">
        <div class="brand"><img src="/assets/logo-mark.svg" alt=""><div><span class="brand-name">THANARAH</span><span class="brand-sub">company operations</span></div></div>
        <nav class="nav-scroll">${navMarkup()}</nav>
        <div class="sidebar-bottom"><div class="profile-line"><span>${state.session.isRoot?'مسؤول المنصة':'مساحة العمل الداخلية'}</span><span class="profile-role">متصل</span></div><div class="profile-role ar">${esc(roleNames)}</div>
          <div class="sidebar-actions"><button class="quiet-btn" data-logout>تسجيل الخروج</button><button class="quiet-btn" data-refresh>تحديث</button></div></div>
      </aside>
      <main class="main"><header class="topbar"><div class="top-actions"><button class="btn btn-outline mobile-menu" data-menu aria-label="القائمة">القائمة</button><span class="crumb ar">عمليات الشركة / ${esc(viewName)}</span></div>
        <div class="top-actions">${has('finance.read')?`<label class="help" for="global-period">الفترة</label><input id="global-period" class="input period-input" type="month" value="${esc(state.period)}" aria-label="الفترة المالية">`:''}<span class="pill">SAR</span></div></header>
        <section class="content">${content}</section></main></div>`;
    bindShell();
  }
  function loginPage(message='') {
    app.innerHTML=`<main class="login-shell"><section class="login-aside"><div><img class="login-mark" src="/assets/logo-mark.svg" alt="Thanarah"><p class="eyebrow" style="color:#bdd1c5">INTERNAL OPERATIONS</p><h1>إدارة الشركة،<br>بصورة أوضح.</h1><p>مساحة Thanarah الداخلية للفرق والقرارات المالية اليومية — منفصلة عن مساحات عمل العملاء.</p></div><footer>THANARAH · منصة تشغيل سعودية</footer></section>
      <section class="login-panel"><form class="login-form" id="login-form"><p class="eyebrow">دخول آمن</p><h2 class="ar">مرحبًا بعودتك</h2><p class="page-intro ar">استخدم حساب Thanarah المرتبط بصلاحية داخلية.</p>${message?`<div class="notice" role="alert">${esc(message)}</div>`:''}
      <div class="field"><label for="email">البريد الإلكتروني</label><input class="input" type="email" id="email" name="email" autocomplete="username" required></div>
      <div class="field"><label for="password">كلمة المرور</label><input class="input" type="password" id="password" name="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary" type="submit">تسجيل الدخول</button><p class="help ar" style="margin-top:14px">تُحفظ جلسة الوصول في الذاكرة فقط؛ الاستعادة تتم عبر جلسة الخادم.</p></form></section></main>`;
    document.getElementById('login-form').addEventListener('submit', async event=>{
      event.preventDefault(); const form=event.currentTarget; const button=form.querySelector('button');
      button.disabled=true; button.textContent='جارٍ التحقق…';
      try { await api.login(form.email.value,form.password.value); await loadSession(); }
      catch(error) { api.clearSession(); loginPage(error.message || 'تعذّر تسجيل الدخول.'); }
    });
  }
  async function loadSession() {
    try {
      state.session=await api.session();
      if (!state.session?.permissions) throw new Error('تعذّر قراءة صلاحيات الحساب.');
      const first=NAV.flatMap(group=>group.items).find(item=>canView(item[0]));
      state.view=location.hash.replace(/^#\/?/,'') || first?.[0] || '';
      if (!canView(state.view)) state.view=first?.[0]||'';
      if (!state.view) { shell(emptyPage('لا توجد صلاحيات تشغيلية مفعّلة لهذا الحساب.')); return; }
      history.replaceState(null,'',`#/${state.view}`); await renderView();
    } catch (error) {
      api.clearSession(); state.session=null; loginPage(error.message==='انتهت الجلسة. سجّل الدخول مجددًا.'?'انتهت الجلسة. سجّل الدخول للمتابعة.':'');
    }
  }
  function canView(view) {
    const item=NAV.flatMap(group=>group.items).find(entry=>entry[0]===view);
    if(view==='accruals') return has('finance.manage')&&has('policies.read')&&has('people.read');
    return item?has(item[2]):false;
  }
  function bindShell() {
    app.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.nav)));
    app.querySelector('[data-menu]')?.addEventListener('click',()=>{state.navOpen=true; renderView();});
    app.querySelector('[data-close-nav]')?.addEventListener('click',()=>{state.navOpen=false; renderView();});
    app.querySelector('[data-logout]')?.addEventListener('click',async()=>{try{await api.logout();state.session=null;state.records={};state.refs={};loginPage();}catch(error){toast(error.message||'تعذّر إبطال الجلسة؛ أعد محاولة الخروج.',true);}});
    app.querySelector('[data-refresh]')?.addEventListener('click',()=>{state.records={};state.refs={};state.totals={};renderView();});
    app.querySelector('#global-period')?.addEventListener('change',event=>{state.period=event.target.value;renderView();});
  }
  function navigate(view) { if (!canView(view)) return; state.view=view; state.search=''; state.navOpen=false; if(location.hash===`#/${view}`)renderView();else location.hash=`/${view}`; }
  window.addEventListener('hashchange',()=>{if(!state.session)return;const view=location.hash.replace(/^#\/?/,'');if(canView(view)){state.view=view;renderView();}});
  function emptyPage(message) { return `<div class="empty-state panel"><div class="empty-mark">T</div><h2>المساحة جاهزة</h2><p>${esc(message)}</p></div>`; }
  function loadingPage() { return `<p class="eyebrow">THANARAH / INTERNAL</p><h1><span class="skeleton" style="width:180px;height:29px"></span></h1><div class="stat-grid">${[1,2,3,4].map(()=>'<div class="stat-card"><span class="skeleton"></span><br><br><span class="skeleton" style="width:65%;height:24px"></span></div>').join('')}</div><div class="panel loading-state"><span class="skeleton"></span></div>`; }
  async function records(kind, search='', page=1, limit=100) {
    const result=await api.list(kind,{q:search,page,limit});
    state.records[kind]=result?.items||[];
    state.totals[kind]=result?.total||0;
    state.pages[kind]=result?.page||page;
    return result;
  }
  async function allRecords(kind) {
    let page=1, all=[], total=0;
    do {
      const result=await api.list(kind,{page,limit:100});
      const batch=result?.items||[];
      all=all.concat(batch);total=result?.total||0;page++;
      if(!batch.length) break;
    } while(all.length<total);
    state.records[kind]=all;state.totals[kind]=total;state.refs[kind]=true;
    return all;
  }
  async function renderView() {
    if(!state.session)return;
    state.loading=true; shell(loadingPage());
    try {
      let html;
      if(state.view.startsWith('overview-')) html=await dashboardPage(state.view.slice(9));
      else if(state.view==='finance') html=await financePage();
      else if(state.view==='audit') html=await auditPage();
      else if(state.view==='accruals') html=await accrualPage();
      else if(state.view==='hierarchy') html=await hierarchyPage();
      else if(['employees','contracts','clients','requests','accounts','journals','policies'].includes(state.view)) { await resourcePage(state.view); state.loading=false; return; }
      else html=emptyPage('هذه الصفحة غير متاحة للصلاحيات الحالية.');
      state.loading=false; if(html!==null) shell(html);
    } catch(error) {
      state.loading=false;
      shell(`<div class="error-state panel"><div class="empty-mark">!</div><h2>تعذّر تحميل البيانات</h2><p>${esc(error.message||'حدث خطأ غير متوقع.')}</p><button class="btn btn-outline" data-retry>إعادة المحاولة</button></div>`);
      app.querySelector('[data-retry]')?.addEventListener('click',renderView);
    }
  }
  function pageHead(title, intro, actions='') {
    return `<div class="page-head"><div><p class="eyebrow">THANARAH / INTERNAL</p><h1 class="ar">${esc(title)}</h1><p class="page-intro ar">${esc(intro)}</p></div><div class="head-actions">${actions}</div></div>`;
  }
  function recordName(record) { return record?.data?.name || record?.data?.title || record?.data?.memo || record?._id || '—'; }
  function refName(kind,id) {
    const record=(state.records[kind]||[]).find(item=>item._id===id);
    return record?recordName(record):id||'—';
  }
  function statusOf(record) { return record?.data?.status || '—'; }
  function listCell(kind,record,key) {
    const data=record.data||{};
    const value=data[key];
    if(key==='status'||key==='stage') return statusPill(value);
    if(key==='monthlyMinor'||key==='maxAmountMinor'||key==='debitMinor'||key==='creditMinor'||key==='balanceMinor') return `<span class="mono">${moneyMinor(value)}</span>`;
    if(key.endsWith('Id')) return esc(refName(key==='unitId'||key==='parentId'?'units':key==='employeeId'||key==='ownerId'?'employees':key==='debitAccountId'||key==='creditAccountId'?'accounts':key==='clientId'?'clients':'units',value));
    if(key==='date'||key==='startDate'||key==='endDate'||key==='effectiveFrom'||key==='effectiveTo'||key==='dueDate') return esc(dateText(value));
    if(key==='rateBps') return `${(Number(value)/100).toFixed(2)}%`;
    if(key==='permissions') return `<span class="td-sub">${Array.isArray(value)?value.length:0} صلاحية</span>`;
    if(key==='lines') return `<span class="td-sub">${Array.isArray(value)?value.length:0} بنود</span>`;
    return esc(value||'—');
  }
  function columnKeys(kind) {
    return {
      employees:['name','jobTitle','unitId','roleIds','status'],
      contracts:['title','employeeId','startDate','endDate','monthlyMinor','status'],
      clients:['name','ownerId','stage','contact'],
      requests:['title','category','ownerId','dueDate','status'],
      accounts:['code','name','type','status'],
      journals:['memo','kind','date','clientId','lines','status'],
      policies:['name','type','rateBps','effectiveFrom','effectiveTo','status'],
      units:['name','unitType','parentId','status'],
      roles:['name','permissions','status'],
    }[kind]||[];
  }
  const FIELD_LABELS=Object.fromEntries(Object.values(CONFIG).flatMap(config=>config.fields.map(field=>[field[0],field[1]])));
  function actionsFor(kind,record) {
    const data=record.data||{}, status=data.status;
    const buttons=[`<button class="btn btn-outline btn-small" data-detail="${esc(record._id)}" data-kind="${kind}">تفاصيل</button>`];
      if(has(CONFIG[kind].write) && status!=='APPROVED' && status!=='POSTED' && status!=='ENDED' && status!=='RETIRED' && status!=='CANCELLED' && !data.calculation && !data.sourceKey && !data.reversalOf && !(kind==='roles' && record.builtin)) {
      if(['contracts','policies','requests','journals'].includes(kind)&&status!=='DRAFT'){} else buttons.push(`<button class="btn btn-outline btn-small" data-edit="${esc(record._id)}" data-kind="${kind}">تعديل</button>`);
    }
    const beneficiaryId=kind==='contracts'?data.employeeId:(kind==='journals'?data.calculation?.employeeId:null);
    const beneficiary=(state.records.employees||[]).find(employee=>employee._id===beneficiaryId);
    const beneficiaryIsViewer=Boolean(beneficiary?.data?.userId&&beneficiary.data.userId===state.session.userId);
    const independentReviewer=record.createdBy!==state.session.userId&&!beneficiaryIsViewer;
    if(kind==='contracts'&&status==='DRAFT'&&has('hr.approve')&&independentReviewer) buttons.push(`<button class="btn btn-outline btn-small" data-action="approve" data-id="${esc(record._id)}" data-kind="${kind}">اعتماد</button>`);
    if(kind==='contracts'&&status==='APPROVED'&&has('hr.manage')&&independentReviewer) buttons.push(`<button class="btn btn-outline btn-small" data-action="end" data-id="${esc(record._id)}" data-kind="${kind}">إنهاء</button>`);
    if(kind==='policies'&&status==='DRAFT'&&has('policies.approve')&&independentReviewer) buttons.push(`<button class="btn btn-outline btn-small" data-action="approve" data-id="${esc(record._id)}" data-kind="${kind}">اعتماد</button>`);
    if(kind==='policies'&&status==='APPROVED'&&has('policies.manage')&&independentReviewer) buttons.push(`<button class="btn btn-outline btn-small" data-action="retire" data-id="${esc(record._id)}" data-kind="${kind}">إيقاف السياسة</button>`);
    if(kind==='requests'&&status==='DRAFT'&&has('requests.manage')) buttons.push(`<button class="btn btn-outline btn-small" data-action="submit" data-id="${esc(record._id)}" data-kind="${kind}">إرسال</button>`);
    if(kind==='requests'&&['SUBMITTED','ESCALATED'].includes(status)&&has('requests.approve')&&independentReviewer) {
      buttons.push(`<button class="btn btn-outline btn-small" data-action="approve" data-id="${esc(record._id)}" data-kind="${kind}">اعتماد</button>`);
      buttons.push(`<button class="btn btn-danger btn-small" data-action="reject" data-id="${esc(record._id)}" data-kind="${kind}">رفض</button>`);
    }
    if(kind==='requests'&&['SUBMITTED','ESCALATED'].includes(status)&&has('requests.manage')) buttons.push(`<button class="btn btn-outline btn-small" data-action="escalate" data-id="${esc(record._id)}" data-kind="${kind}">تصعيد</button>`);
    if(kind==='journals'&&status==='DRAFT'&&has('finance.post')&&!data.calculation&&independentReviewer) buttons.push(`<button class="btn btn-primary btn-small" data-action="post" data-id="${esc(record._id)}" data-kind="${kind}">ترحيل</button>`);
    if(kind==='journals'&&status==='DRAFT'&&has('finance.post')&&data.calculation&&independentReviewer) buttons.push(`<button class="btn btn-primary btn-small" data-action="post" data-id="${esc(record._id)}" data-kind="${kind}">ترحيل الاستحقاق</button>`);
    if(kind==='journals'&&status==='POSTED'&&data.kind!=='REVERSAL'&&has('finance.manage')) buttons.push(`<button class="btn btn-outline btn-small" data-action="reverse" data-id="${esc(record._id)}" data-kind="${kind}">إنشاء قيد عكسي</button>`);
    const cancelPermission={contracts:'hr.manage',policies:'policies.manage',requests:'requests.manage',journals:'finance.manage'}[kind];
    if(status==='DRAFT'&&cancelPermission&&has(cancelPermission)) buttons.push(`<button class="btn btn-danger btn-small" data-action="cancel" data-id="${esc(record._id)}" data-kind="${kind}">إلغاء المسودة</button>`);
    if(!independentReviewer&&['DRAFT','SUBMITTED','ESCALATED'].includes(status)&&['contracts','policies','requests','journals'].includes(kind)&&has(kind==='contracts'?'hr.approve':kind==='policies'?'policies.approve':kind==='requests'?'requests.approve':'finance.post')) buttons.push(`<span class="help">${beneficiaryIsViewer?'المستفيد لا يراجع':'منشئ السجل لا يراجع'}</span>`);
    return buttons.join('');
  }
  async function resourcePage(kind) {
    const config=CONFIG[kind]; if(!has(config.permission)) return emptyPage('لا تملك صلاحية قراءة هذا القسم.');
    const page=state.pages[kind]||1;
    await records(kind,state.search,page);
    await ensureRefs(kind);
    if(['contracts','journals'].includes(kind)&&has('people.read')) {
      if(!state.refs.employees) await allRecords('employees');
    }
    const items=state.records[kind]||[], keys=columnKeys(kind);
    const total=state.totals[kind]||0, totalPages=Math.max(1,Math.ceil(total/100));
    const canCreate=has(config.write);
    const title=config.title+(kind==='employees'?' وأدوار مخصصة':'');
    const actions=canCreate?`<button class="btn btn-primary" data-create="${kind}">+ إضافة ${esc(config.singular)}</button>`:'';
    const searchbar=`<div class="toolbar"><input class="input search" id="record-search" type="search" placeholder="ابحث في السجلات…" value="${esc(state.search)}"><span class="help">${items.length} في هذه الصفحة · ${total} إجمالًا</span></div>`;
    const table=items.length?`<div class="panel table-wrap"><table><thead><tr>${keys.map(key=>`<th>${esc(FIELD_LABELS[key]||label(key))}</th>`).join('')}<th>الإصدار</th><th>الإجراءات</th></tr></thead><tbody>${items.map(record=>`<tr>${keys.map(key=>`<td>${key==='name'||key==='title'||key==='memo'?`<div class="td-main">${listCell(kind,record,key)}</div>`:listCell(kind,record,key)}</td>`).join('')}<td><span class="mono">v${esc(record.version)}</span></td><td><div class="row-actions">${actionsFor(kind,record)||'<span class="help">—</span>'}</div></td></tr>`).join('')}</tbody></table></div>`:
      `<div class="panel empty-state"><div class="empty-mark">—</div><h2>لا توجد سجلات</h2><p>${state.search?'لم يعثر البحث على نتائج.':'لا توجد بيانات متاحة لهذا القسم بعد.'}</p>${canCreate?`<button class="btn btn-primary" data-create="${kind}">إضافة أول ${esc(config.singular)}</button>`:''}</div>`;
    const notice=kind==='contracts'?`<div class="notice" style="margin-bottom:14px">لا يُنشأ استحقاق الرواتب إلا بعقد معتمد يغطي الشهر كاملًا وسياسة رواتب معتمدة. إنشاء الاستحقاق لا يعني الدفع أو التحويل.</div>`:
      kind==='requests'?`<div class="notice" style="margin-bottom:14px">تُجرى الموافقة أو الرفض بإجراء مستقل مع توضيح السبب. لا يستطيع منشئ السجل اعتماده، حتى لو كان مسؤولًا جذريًا.</div>`:
      kind==='journals'?`<div class="notice" style="margin-bottom:14px">القيود المرحلة غير قابلة للتعديل. العكس ينشئ مسودة منفصلة تتطلب مراجعًا مستقلًا للترحيل. يمكن إلغاء مسودة استحقاق قديمة مع سبب، ثم إنشاء احتساب مصحح.</div>`:'';
    let roleSection='';
    if(kind==='employees'&&has('people.read')) {
      const roles=(state.records.roles||[]).filter(role=>!role.builtin&&role.data);
      roleSection=`<section style="margin-top:26px"><div class="page-head"><div><p class="eyebrow">ACCESS / ROLES</p><h2 class="ar">الأدوار والصلاحيات</h2><p class="page-intro ar">الأدوار المضمنة للعرض فقط؛ الأدوار المخصصة تحفظ بقائمة صلاحيات صريحة.</p></div>${has('access.manage')?'<button class="btn btn-outline" data-create="roles">+ إنشاء دور مخصص</button>':''}</div>
      <div class="panel table-wrap"><table><thead><tr><th>الدور</th><th>النوع</th><th>الصلاحيات</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${(state.session.roleCatalog||[]).map(role=>`<tr><td class="td-main">${esc(role.name)}</td><td>مضمن</td><td>${role.permissions?.length||0}</td><td>${statusPill('ACTIVE')}</td><td><span class="help">للقراءة فقط</span></td></tr>`).join('')}${roles.map(role=>`<tr><td class="td-main">${esc(role.data.name)}</td><td>مخصص</td><td>${role.data.permissions?.length||0}</td><td>${statusPill(role.data.status)}</td><td><div class="row-actions">${actionsFor('roles',role)}</div></td></tr>`).join('')}</tbody></table>${roles.length?'':`<div class="empty-state"><p>لا توجد أدوار مخصصة حاليًا.</p></div>`}</div></section>`;
    }
    const pagination=`<div class="head-actions" style="justify-content:flex-end;margin-top:13px"><button class="btn btn-outline btn-small" data-list-prev ${page<=1?'disabled':''}>السابق</button><span class="help">${page} / ${totalPages}</span><button class="btn btn-outline btn-small" data-list-next ${page>=totalPages?'disabled':''}>التالي</button></div>`;
    shell(pageHead(title,`السجلات الفعلية للشركة. التعديلات تحفظ بإصدار متزامن مع الخادم.`,actions)+notice+searchbar+table+pagination+roleSection);
    app.querySelector('#record-search')?.addEventListener('input',debounce(event=>{state.search=event.target.value;state.pages[kind]=1;resourcePage(kind).catch(()=>{});},300));
    app.querySelector('[data-list-prev]')?.addEventListener('click',()=>{state.pages[kind]=page-1;resourcePage(kind);});
    app.querySelector('[data-list-next]')?.addEventListener('click',()=>{state.pages[kind]=page+1;resourcePage(kind);});
    bindResource(kind);
    return null; // shell already rendered
  }
  function debounce(fn, delay) { let timer; return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);}; }
  function bindResource(kind) {
    app.querySelectorAll('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetails(button.dataset.kind||kind,button.dataset.detail)));
    app.querySelectorAll('[data-create]').forEach(button=>button.addEventListener('click',()=>openForm(button.dataset.create||kind)));
    app.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',()=>openForm(button.dataset.kind||kind,button.dataset.edit)));
    app.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>openAction(button.dataset.kind,button.dataset.id,button.dataset.action)));
  }
  function selectOptions(values,selected='') {
    return `<option value="">اختر…</option>${values.map(value=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label(value))}</option>`).join('')}`;
  }
  function recordOptions(kind, selected='', predicate=()=>true) {
    const records=(state.records[kind]||[]).filter(predicate);
    return `<option value="">اختر…</option>${records.map(item=>{
      const data=item.data||{};
      const caption=kind==='accounts'?`${data.code||''} · ${data.name||''}`:recordName(item);
      return `<option value="${esc(item._id)}" ${item._id===selected?'selected':''}>${esc(caption)}</option>`;
    }).join('')}`;
  }
  async function ensureRefs(kind) {
    const needed=new Set((CONFIG[kind]?.fields||[]).filter(field=>field[2]==='ref').map(field=>field[4]));
    if(kind==='employees') needed.add('roles');
    if(kind==='journals') { needed.add('accounts'); needed.add('clients'); }
    if(kind==='policies') needed.add('accounts');
    for(const ref of needed) {
      if(state.refs[ref]) continue;
      const permission=CONFIG[ref]?.permission;
      if(permission&&!has(permission)) { state.records[ref]=ref==='employees'&&state.session.employeeId?[{_id:state.session.employeeId,data:{name:'ملفي الوظيفي',status:'ACTIVE'}}]:[];state.refs[ref]=true;continue; }
      await allRecords(ref);
    }
  }
  async function openForm(kind,id=null) {
    const config=CONFIG[kind]; if(!has(config.write)) return;
    try { await ensureRefs(kind); } catch(error) { toast(`تعذّر تحميل الاختيارات: ${error.message}`,true);return; }
    const record=id?(state.records[kind]||[]).find(item=>item._id===id):null;
    if(id&&!record) { toast('السجل غير موجود في القائمة الحالية. حدّث الصفحة.',true);return; }
    if(record&&(record.data.calculation||record.data.sourceKey||record.data.reversalOf||['APPROVED','POSTED','ENDED','RETIRED','CANCELLED'].includes(record.data.status))) { toast('هذا السجل غير قابل للتعديل وفق حالته.',true);return; }
    state.modal={type:'form',kind,id,record,opId:api.newOperationId(),lines:record?.data?.lines?.map(line=>({...line}))||[{accountId:'',debitMinor:0,creditMinor:0},{accountId:'',debitMinor:0,creditMinor:0}]};
    shell(await formMarkup(state.modal));
    bindModal();
  }
  function fieldInput(field, recordData={}) {
    const [key,title,type,required,arg]=field; const value=recordData[key];
    const attr=required?'required':'';
    if(type==='textarea') return `<div class="field span-2"><label for="f-${key}">${esc(title)}</label><textarea class="textarea" id="f-${key}" name="${key}" maxlength="2000">${esc(value||'')}</textarea></div>`;
    if(type==='select') return `<div class="field"><label for="f-${key}">${esc(title)}</label><select class="select" id="f-${key}" name="${key}" ${attr}>${selectOptions(arg,value||'')}</select></div>`;
    if(type==='ref') {
      const predicate=item=>item.data.status!=='ARCHIVED'&&item.data.status!=='INACTIVE'&&(key!=='parentId'||item._id!==modalRecordId());
      const options=(state.records[arg]||[]).filter(predicate);
      return `<div class="field"><label for="f-${key}">${esc(title)}</label><select class="select" id="f-${key}" name="${key}" ${attr}>${recordOptions(arg,value||'',predicate)}</select><span class="help">${options.length?esc(options.length+' مرجع متاح'): 'لا توجد سجلات مرجعية محمّلة؛ أضف المرجع أولًا.'}</span></div>`;
    }
    if(type==='roles') {
      const custom=state.records.roles||[], builtins=state.session.roleCatalog||[];
      const selected=Array.isArray(value)?value:[];
      return `<div class="field span-2"><label>${esc(title)}</label><div class="permission-grid">${[...builtins.map(role=>({id:role.id,name:role.name})),...custom.filter(r=>r.data?.status==='ACTIVE').map(r=>({id:r._id,name:r.data.name}))].map(role=>`<label class="permission-item"><input type="checkbox" name="roleIds" value="${esc(role.id)}" ${selected.includes(role.id)?'checked':''}>${esc(role.name)}</label>`).join('')||'<span class="help">لا توجد أدوار متاحة.</span>'}</div></div>`;
    }
    if(type==='permissions') return `<div class="field span-2"><label>${esc(title)}</label><div class="permission-grid">${PERMS.map(permission=>`<label class="permission-item"><input type="checkbox" name="permissions" value="${permission}" ${(value||[]).includes(permission)?'checked':''}><span>${esc(arPermission(permission))}</span></label>`).join('')}</div></div>`;
    if(type==='lines') return `<div class="field span-2"><label>${esc(title)}</label><div class="line-editor" id="journal-lines">${state.modal.lines.map((line,index)=>lineMarkup(line,index)).join('')}</div><button type="button" class="btn btn-outline btn-small" data-add-line>إضافة بند</button><p class="help">أدخل المبالغ بالريال؛ تتحول إلى هللات صحيحة. يجب توازن إجمالي المدين والدائن.</p></div>`;
    if(type==='money') return `<div class="field"><label for="f-${key}">${esc(title)}</label><input class="input" id="f-${key}" name="${key}" inputmode="decimal" placeholder="0.00" value="${value!=null?(Number(value)/100).toFixed(2):''}" ${attr}><span class="help">ريال سعودي، حتى منزلتين عشريتين.</span></div>`;
    if(type==='percent') return `<div class="field"><label for="f-${key}">${esc(title)}</label><input class="input" id="f-${key}" name="${key}" type="number" min="0" max="100" step=".01" value="${value!=null?(Number(value)/100).toFixed(2):''}" ${attr}><span class="help">يدخل كنسبة مئوية؛ يحفظ كأساس نقاط (0–10,000).</span></div>`;
    if(key==='userId') return `<div class="field"><label for="f-${key}">${esc(title)}</label><input class="input" id="f-${key}" name="${key}" value="${esc(value||'')}" placeholder="UUID أو اتركه فارغًا" ${attr}><span class="help">ربط حساب موجود فقط؛ إدارة الهوية في /platform-setup/.</span></div>`;
    if(key==='endDate'||key==='effectiveTo') return `<div class="field"><label for="f-${key}">${esc(title)}</label><input class="input" id="f-${key}" name="${key}" type="date" value="${esc(value||'')}" ${attr}></div>`;
    return `<div class="field"><label for="f-${key}">${esc(title)}</label><input class="input" id="f-${key}" name="${key}" type="${type}" value="${esc(value||'')}" ${attr} ${key==='code'?'maxlength="20"':''}></div>`;
  }
  function lineMarkup(line,index) {
    return `<div class="journal-line" data-line="${index}"><select class="select account-picker" data-line-account aria-label="الحساب">${recordOptions('accounts',line.accountId,item=>item.data.status==='ACTIVE')}</select><input class="input" data-line-debit inputmode="decimal" placeholder="مدين (ر.س)" value="${esc(line.debitInput ?? (line.debitMinor?Number(line.debitMinor/100).toFixed(2):''))}" aria-label="مدين بالريال"><input class="input" data-line-credit inputmode="decimal" placeholder="دائن (ر.س)" value="${esc(line.creditInput ?? (line.creditMinor?Number(line.creditMinor/100).toFixed(2):''))}" aria-label="دائن بالريال">${index>1?`<button type="button" class="btn btn-danger btn-small" data-remove-line="${index}">إزالة</button>`:'<span></span>'}</div>`;
  }
  function modalRecordId() { return state.modal?.id||''; }
  async function formMarkup(modal) {
    const config=CONFIG[modal.kind], data=modal.record?.data||{};
    const isNew=!modal.id;
    const fields=config.fields.filter(field=>
      !(field[0]==='status'&&field[1]==='الحالة'&&field[2]==='select'&&field[3]&&field[4]?.length===1&&field[4][0]==='DRAFT'&&modal.kind==='contracts') &&
      !(modal.kind==='employees'&&['roleIds','userId'].includes(field[0])&&!has('access.manage')));
    const body=fields.map(field=>fieldInput(field,data)).join('');
    const notice=modal.kind==='policies'?'<div class="notice span-2">السياسات المعتمدة تصبح غير قابلة للتعديل. يلزم مراجع مستقل، ولا تعني السياسة صرفًا أو تحويلًا ماليًا.</div>':
      modal.kind==='employees'?'<div class="notice span-2">تغيير الحساب المرتبط أو الأدوار يطلب صلاحية access.manage. لا تُنشئ حساب منصة من هنا.</div>':'';
    return `<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><p class="eyebrow">${isNew?'سجل جديد':'تعديل سجل'} · ${esc(config.title)}</p><h2 id="modal-title" class="ar">${isNew?'إضافة':'تعديل'} ${esc(config.singular)}</h2><p class="help">${modal.record?`الإصدار الحالي v${esc(modal.record.version)} · تحفظ العملية بتحديث متفائل.`:'تُحفظ البيانات في الخدمة الداخلية. لا يتم إنشاء بيانات تجريبية.'}</p>
      <form id="record-form"><div class="form-grid">${body}${notice}</div><div class="form-actions"><button type="button" class="btn btn-outline" data-close-modal>إلغاء</button><button type="submit" class="btn btn-primary">${isNew?'إنشاء سجل':'حفظ التعديلات'}</button></div></form></section></div>`;
  }
  function bindModal() {
    app.querySelector('[data-close-modal]')?.addEventListener('click',closeModal);
    app.querySelector('[data-modal-backdrop]')?.addEventListener('click',event=>{if(event.target.matches('[data-modal-backdrop]'))closeModal();});
    app.querySelector('[data-add-line]')?.addEventListener('click',()=>{captureLines();state.modal.lines.push({accountId:'',debitMinor:0,creditMinor:0});repaintModalLines();});
    bindLineRemoval();
    app.querySelector('#record-form')?.addEventListener('submit',submitRecord);
  }
  function captureLines() { state.modal.lines=[...app.querySelectorAll('.journal-line')].map(row=>({accountId:row.querySelector('[data-line-account]').value,debitInput:row.querySelector('[data-line-debit]').value,creditInput:row.querySelector('[data-line-credit]').value})); }
  function bindLineRemoval() { app.querySelectorAll('[data-remove-line]').forEach(button=>button.addEventListener('click',()=>{captureLines();state.modal.lines.splice(Number(button.dataset.removeLine),1);repaintModalLines();})); }
  function repaintModalLines() { const container=app.querySelector('#journal-lines');if(container)container.innerHTML=state.modal.lines.map((line,index)=>lineMarkup(line,index)).join('');bindLineRemoval(); }
  function closeModal() { state.modal=null;renderView(); }
  function openDetails(kind,id) {
    const record=(state.records[kind]||[]).find(row=>row._id===id);
    if(!record)return;
    state.modal={type:'details',kind,id,record};
    const fields=CONFIG[kind].fields.filter(field=>field[0]!=='lines').map(([key,title,type])=>{
      const value=record.data[key];
      const content=Array.isArray(value)?value.map(v=>esc(label(v))).join('، '):listCell(kind,record,key);
      return `<div class="brief-row"><strong>${esc(title)}</strong><span>${content||'—'}</span></div>`;
    }).join('');
    const lines=record.data.lines||[];
    const debit=lines.reduce((sum,line)=>sum+line.debitMinor,0),credit=lines.reduce((sum,line)=>sum+line.creditMinor,0);
    const ledger=lines.length?`<div class="table-wrap"><table><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${esc(refName('accounts',line.accountId))}</td><td>${moneyMinor(line.debitMinor)}</td><td>${moneyMinor(line.creditMinor)}</td></tr>`).join('')}</tbody><tfoot><tr><th>الإجمالي</th><th>${moneyMinor(debit)}</th><th>${moneyMinor(credit)}</th></tr></tfoot></table></div>`:'';
    const c=record.data.calculation;
    const calculation=c?`<div class="notice"><strong>لقطة الاحتساب المعتمدة</strong><p>الفترة ${esc(c.period)} · الأساس ${moneyMinor(c.basisMinor)} · النسبة ${esc((c.rateBps/100).toFixed(2))}% · الاستحقاق ${moneyMinor(c.amountMinor)}</p><p>السياسة: ${esc(refName('policies',c.policyId))} · الإصدار ${esc(c.policyVersion)}</p><p>المستفيد: ${esc(refName('employees',c.employeeId))}</p>${c.sourceJournalId?`<p>مرجع الإيراد: ${esc(c.sourceJournalId)}</p>`:''}</div>`:'';
    shell(`<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><p class="eyebrow">مراجعة السجل · v${esc(record.version)}</p><h2 id="detail-title">${esc(recordName(record))}</h2>${fields}${ledger}${calculation}<p class="help">المرجع: ${esc(record._id)}<br>أنشأه: ${esc(record.createdBy)}<br>المراجع: ${esc(record.approvedBy||'لم يُعتمد بعد')}</p><div class="form-actions"><button class="btn btn-outline" data-close-modal>إغلاق التفاصيل</button></div></section></div>`);
    bindModal();
  }
  function getFormData(form,kind) {
    const config=CONFIG[kind], data={};
    for(const [key,,type] of config.fields) {
      if(type==='lines') {
        const rows=[...form.querySelectorAll('.journal-line')];
        data.lines=rows.map(row=>{
          const debit=decimalToMinor(row.querySelector('[data-line-debit]').value||'0');
          const credit=decimalToMinor(row.querySelector('[data-line-credit]').value||'0');
          if((debit>0)===(credit>0)) throw new Error('لكل بند قيمة موجبة في جهة واحدة فقط.');
          return {accountId:row.querySelector('[data-line-account]').value,debitMinor:debit,creditMinor:credit};
        });
        const debitSum=data.lines.reduce((sum,line)=>sum+line.debitMinor,0), creditSum=data.lines.reduce((sum,line)=>sum+line.creditMinor,0);
        if(debitSum<=0||debitSum!==creditSum) throw new Error('يجب أن يتساوى إجمالي المدين والدائن وأن يكون موجبًا.');
        if(data.lines.some(line=>!line.accountId)) throw new Error('اختر حسابًا لكل بند.');
        continue;
      }
      if(type==='permissions') { data.permissions=[...form.querySelectorAll('[name="permissions"]:checked')].map(input=>input.value);if(!data.permissions.length)throw new Error('اختر صلاحية واحدة على الأقل.');continue; }
      if(type==='roles') { data.roleIds=has('access.manage')?[...form.querySelectorAll('[name="roleIds"]:checked')].map(input=>input.value):(state.modal.record?.data.roleIds||[]);continue; }
      const input=form.elements.namedItem(key);
      if(!input) {
        if(kind==='employees'&&key==='userId') data.userId=state.modal.record?.data.userId||null;
        if(kind==='employees'&&key==='unitId') continue;
        continue;
      }
      let value=input.value.trim();
      if(type==='money') value=decimalToMinor(value);
      if(type==='percent') { value=decimalToMinor(value);if(value>10000)throw new Error('المعدل بين 0 و100 بالمئة وبدقتين عشريتين كحد أقصى.'); }
      if((key==='userId'||key==='parentId'||key==='endDate'||key==='effectiveTo')&&!value) value=null;
      if(key==='rateBps'||key==='maxAmountMinor'||key==='monthlyMinor') value=Number(value);
      if(key==='status'&&kind==='contracts') value='DRAFT';
      if(key==='status'&&kind==='requests') value='DRAFT';
      if(key==='status'&&kind==='policies') value='DRAFT';
      data[key]=value;
    }
    if(kind==='journals'&&!data.clientId) delete data.clientId;
    if((kind==='contracts'||kind==='policies')&&data.endDate&&data.endDate<data.startDate) throw new Error('تاريخ النهاية يجب ألا يسبق تاريخ البداية.');
    if(kind==='policies'&&data.effectiveTo&&data.effectiveTo<data.effectiveFrom) throw new Error('تاريخ انتهاء السياسة يجب ألا يسبق تاريخ سريانها.');
    if((kind==='contracts'&&data.monthlyMinor<=0)||(kind==='policies'&&data.maxAmountMinor<=0)) throw new Error('أدخل مبلغًا أكبر من صفر.');
    if(kind==='contracts') Object.assign(data,{currency:'SAR',status:'DRAFT'});
    if(kind==='accounts') data.currency='SAR';
    if(kind==='policies') Object.assign(data,{currency:'SAR',rounding:'HALF_UP',status:'DRAFT'});
    if(kind==='journals') Object.assign(data,{currency:'SAR',status:'DRAFT'});
    if(kind==='policies') {
      const debit=(state.records.accounts||[]).find(item=>item._id===data.debitAccountId);
      const credit=(state.records.accounts||[]).find(item=>item._id===data.creditAccountId);
      if(!debit||debit.data.status!=='ACTIVE'||!credit||credit.data.status!=='ACTIVE') throw new Error('اختر حسابين نشطين من دليل الحسابات.');
      if(credit.data.type!=='LIABILITY') throw new Error('يجب أن يكون حساب الدائن التزامًا.');
      const expected=data.type==='PROFIT'?'EQUITY':'EXPENSE';
      if(debit.data.type!==expected) throw new Error(`يجب أن يكون حساب المدين من نوع ${label(expected)} لهذه السياسة.`);
      if(data.type==='PAYROLL'&&data.rateBps!==10000) throw new Error('سياسة الرواتب تستخدم معدل 100%.');
    }
    if(kind==='journals'&&['DEPOSIT','WITHDRAWAL'].includes(data.kind)) {
      const selected=data.lines.map(line=>(state.records.accounts||[]).find(item=>item._id===line.accountId));
      if(selected.some(account=>!account||account.data.status!=='ACTIVE'||account.data.type!=='ASSET')) throw new Error('الإيداع والسحب يتطلبان حسابي أصول نشطين.');
      if(data.lines.length!==2||new Set(data.lines.map(line=>line.accountId)).size!==2) throw new Error('الإيداع والسحب يتطلبان بندين فقط على حسابي أصول مختلفين.');
    }
    if(kind==='units'&&!data.parentId)data.parentId=null;
    if(kind==='employees'&&!data.userId)data.userId=null;
    if(kind==='requests') data.status='DRAFT';
    return data;
  }
  async function submitRecord(event) {
    event.preventDefault(); const form=event.currentTarget, button=form.querySelector('[type=submit]');
    try {
      const data=getFormData(form,state.modal.kind);
      const {kind,id,record,opId}=state.modal;
      button.disabled=true;button.textContent='جارٍ الحفظ…';
      if(id) await api.update(kind,id,data,record.version,opId); else await api.create(kind,data,opId);
      state.modal=null;state.records={};state.refs={};toast('تم حفظ السجل بنجاح.');await renderView();
    } catch(error) { button.disabled=false;button.textContent=state.modal.id?'حفظ التعديلات':'إنشاء سجل';toast(error.message||'تعذّر الحفظ. بيانات النموذج محفوظة.',true); }
  }
  function openAction(kind,id,action) {
    const record=(state.records[kind]||[]).find(item=>item._id===id);
    if(!record)return;
    state.modal={type:'action',kind,id,action,record,opId:api.newOperationId()};
    const reasonRequired=true;
    const title={approve:'مراجعة واعتماد',reject:'مراجعة ورفض',escalate:'تصعيد الطلب',submit:'إرسال للمراجعة',end:'إنهاء العقد',retire:'إحالة السياسة للتقاعد',post:'ترحيل القيد',reverse:'إنشاء قيد عكسي',cancel:'إلغاء المسودة'}[action]||action;
    const notice=action==='cancel'?'سيُسجّل السجل كملغي دون حذفه. يمكن إنشاء مسودة مصححة جديدة؛ تبقى النسخة السابقة في سجل التدقيق.':
      'يلزم مراجع مختلف عن منشئ السجل والمستفيد. يتحقق الخادم من الفصل بين المنشئ والمستفيد؛ لن تتغير الحالة إلا عبر الإجراء المعتمد.';
    const reassignment=action==='escalate'?`<div class="field" style="margin-bottom:14px"><label for="action-owner">مسؤول التصعيد الجديد</label><select id="action-owner" class="select" required><option value="">اختر مسؤولًا مختلفًا</option>${(state.records.employees||[]).filter(employee=>employee.data.status==='ACTIVE'&&employee._id!==record.data.ownerId).map(employee=>`<option value="${esc(employee._id)}">${esc(recordName(employee))}</option>`).join('')}</select></div>`:'';
    shell(`<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true"><p class="eyebrow">إجراء مستقل · ${esc(recordName(record))}</p><h2 class="ar">${esc(title)}</h2><div class="notice" style="margin:14px 0">${esc(notice)}</div><form id="action-form">${reassignment}<div class="field"><label for="action-reason">سبب الإجراء ${reasonRequired?'(مطلوب)':''}</label><textarea class="textarea" id="action-reason" minlength="3" maxlength="500" ${reasonRequired?'required':''} placeholder="اكتب توضيحًا مهنيًا للمراجعة وسجل التدقيق"></textarea></div><div class="form-actions"><button type="button" class="btn btn-outline" data-close-modal>إلغاء</button><button type="submit" class="btn ${['reject','cancel'].includes(action)?'btn-danger':'btn-primary'}">تأكيد الإجراء</button></div></form></section></div>`);
    bindModal();app.querySelector('#action-form')?.addEventListener('submit',submitAction);
  }
  async function submitAction(event) {
    event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');
    const modal=state.modal,reason=app.querySelector('#action-reason').value.trim();
    if(reason.length<3){toast('اكتب سببًا لا يقل عن 3 أحرف.',true);return;}
    button.disabled=true;
    try {
      const ownerId=app.querySelector('#action-owner')?.value||undefined;
      await api.action(modal.kind,modal.id,modal.record.version,modal.action,reason,ownerId,modal.opId);
      state.modal=null;state.records={};state.refs={};toast('اكتمل الإجراء.');await renderView();
    } catch(error) { button.disabled=false;toast(error.message||'تعذّر تنفيذ الإجراء.',true); }
  }
  function statCard(title,value,note='') {
    return `<article class="stat-card"><div class="stat-label ar">${esc(title)}</div><div class="stat-value">${esc(value??'—')}</div>${note?`<div class="stat-note ar">${esc(note)}</div>`:''}</article>`;
  }
  function summaryNumber(value) {
    if(value===null||value===undefined) return '—';
    return new Intl.NumberFormat('ar-SA').format(Number(value));
  }
  async function dashboardPage(view) {
    const data=await api.dashboard(view);
    const title=view==='ceo'?'نظرة الرئيس التنفيذي':view==='cto'?'نظرة الرئيس التقني':'نظرة المدير التنفيذي العام';
    const counts=data.counts||{}, requests=data.requests||{};
    const countItems=Object.entries(counts).filter(([,value])=>typeof value==='number');
    const cards=countItems.map(([key,value])=>statCard(label(key)||key,summaryNumber(value),'حسب السجلات المصرح بها'));
    if(!cards.length) cards.push(statCard('السجلات المتاحة','—','لا يعرض الخادم إحصاءات إضافية'));
    const finance=data.finance&&has('finance.read')?data.finance:null;
    if(finance) cards.push(statCard('صافي الفترة',moneyMinor(finance.profitMinor),'من القيود المرحلة فقط'));
    const queue=[['طلبات متأخرة',requests.overdue],['قيد المراجعة',requests.pending],['طلبات مصعّدة',requests.escalated]];
    const financePanel=finance?`<section class="panel"><div class="panel-title"><h2 class="ar">لمحة مالية · ${esc(finance.period||state.period)}</h2><button class="btn btn-outline btn-small" data-go-finance>ميزان المراجعة</button></div><div class="panel-body"><div class="finance-summary"><div class="finance-cell"><span class="stat-label">الإيرادات</span><strong>${moneyMinor(finance.revenueMinor)}</strong></div><div class="finance-cell"><span class="stat-label">المصروفات</span><strong>${moneyMinor(finance.expenseMinor)}</strong></div><div class="finance-cell"><span class="stat-label">صافي الربح</span><strong>${moneyMinor(finance.profitMinor)}</strong></div></div></div></section>`:'';
    const content=`${pageHead(title,'مؤشرات مأخوذة من سجلات الشركة الفعلية فقط.') }<div class="stat-grid">${cards.join('')}</div><div class="dash-grid"><section class="panel"><div class="panel-title"><h2 class="ar">حالة الطلبات</h2><span class="pill">مباشر</span></div><div class="panel-body list-stack">${queue.map(([title,value])=>`<div class="brief-row"><span class="brief-title ar">${title}</span><span class="mono">${value===undefined?'—':summaryNumber(value)}</span></div>`).join('')}<p class="help">لا تُعرض أرقام تشغيل أو مؤشرات غير متاحة في واجهة الخدمة.</p></div></section>
      <section class="panel"><div class="panel-title"><h2 class="ar">نطاق الدور</h2></div><div class="panel-body"><p class="ar">${view==='cto'?'تركيز على الهيكل والموظفين والطلبات التقنية، دون عرض الرواتب أو البيانات المالية.':view==='ceo'?'نظرة تنفيذية تجمع ما تسمح به صلاحيات الحساب، مع فصل الصلاحيات المالية.':'متابعة تشغيلية للفريق والعملاء والطلبات.'}</p><div class="brief-meta">الصلاحيات الفعلية من جلسة الدخول</div></div></section></div>${financePanel}`;
    shell(content);app.querySelector('[data-go-finance]')?.addEventListener('click',()=>navigate('finance'));
    return null;
  }
  async function financePage() {
    const data=await api.finance(state.period);
    const accounts=data.accounts||[];
    const table=accounts.length?`<div class="panel table-wrap"><table><thead><tr><th>رمز الحساب</th><th>الحساب</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${accounts.map(item=>`<tr><td class="mono">${esc(item.data?.code||'—')}</td><td class="td-main">${esc(item.data?.name||'—')}</td><td>${esc(label(item.data?.type))}</td><td class="mono">${moneyMinor(item.debitMinor)}</td><td class="mono">${moneyMinor(item.creditMinor)}</td><td class="mono">${moneyMinor(item.balanceMinor)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="panel empty-state"><div class="empty-mark">=</div><h2>لا توجد قيود مرحلة لهذه الفترة</h2><p>هذا التقرير يغطي الفترة كاملة، ولا يعتمد على قائمة القيود المعروضة.</p></div>`;
    return `${pageHead('ميزان المراجعة',`تسوية دورية من القيود المرحلة فقط · ${data.period||state.period}`)}<div class="stat-grid">${statCard('إجمالي المدين',moneyMinor(data.debitMinor),'SAR')}${statCard('إجمالي الدائن',moneyMinor(data.creditMinor),'SAR')}${statCard('الفرق',moneyMinor(data.differenceMinor),data.balanced?'متوازن':'يتطلب مراجعة')}${statCard('القيود المرحلة',summaryNumber(data.postedCount),'للفترة كاملة')}</div>
      <section class="panel" style="margin-bottom:15px"><div class="panel-title"><h2 class="ar">ملخص الفترة</h2>${data.balanced?'<span class="pill">متوازن</span>':'<span class="pill pill-bad">غير متوازن</span>'}</div><div class="panel-body"><div class="finance-summary"><div class="finance-cell"><span class="stat-label">الإيرادات</span><strong>${moneyMinor(data.revenueMinor)}</strong></div><div class="finance-cell"><span class="stat-label">المصروفات</span><strong>${moneyMinor(data.expenseMinor)}</strong></div><div class="finance-cell"><span class="stat-label">الربح</span><strong>${moneyMinor(data.profitMinor)}</strong></div></div><p class="help" style="margin:15px 0 0">عملة التقرير: ${esc(data.currency||'SAR')} · لا توجد رسوم بيانية أو تقديرات.</p></div></section>
      <div class="panel-title" style="padding-inline:2px;border:0"><h2 class="ar">أرصدة الحسابات</h2><span class="help">${accounts.length} حسابًا في التقرير</span></div>${table}`;
  }
  async function hierarchyPage() {
    await allRecords('units');
    const recordsList=state.records.units;
    const children=(parentId)=>recordsList.filter(item=>(item.data.parentId||null)===(parentId||null));
    function tree(parentId=null,depth=0,seen=new Set()) {
      return children(parentId).map(record=>{
        if(seen.has(record._id))return '';
        const next=new Set(seen);next.add(record._id);
        return `<div class="brief-row" style="padding-inline-start:${Math.min(depth*20,80)}px"><div><div class="brief-title ar">${esc(record.data.name)}</div><div class="brief-meta">${esc(label(record.data.unitType))} · ${statusPill(record.data.status)}</div></div><div class="row-actions"><span class="mono">v${record.version}</span>${actionsFor('units',record)}</div></div>${tree(record._id,depth+1,next)}`;
      }).join('');
    }
    const content=`${pageHead('الهيكل التنظيمي','عرض الوحدات كما سجلها الخادم، مع مستويات الشركة والإدارات والأقسام.',has('organization.manage')?'<button class="btn btn-primary" data-create="units">+ إضافة وحدة</button>':'')}<section class="panel"><div class="panel-title"><h2 class="ar">الوحدات</h2><span class="help">${recordsList.length} سجل</span></div><div class="panel-body">${recordsList.length?tree()||'<p class="help">لا يمكن تكوين شجرة من العلاقات الحالية؛ راجع الوحدات الأم.</p>':`<div class="empty-state"><div class="empty-mark">O</div><h2>لا توجد وحدات مسجلة</h2><p>أضف الشركة أو الإدارة الأولى لبدء بناء الهيكل.</p>${has('organization.manage')?'<button class="btn btn-primary" data-create="units">إضافة وحدة</button>':''}</div>`}</div></section>`;
    shell(content);bindResource('units');
    return null;
  }
  async function auditPage() {
    const data=await api.audit(state.auditPage,50), items=data.items||[];
    const content=`${pageHead('سجل التدقيق','سجل معاملات ثابت للشفافية التشغيلية. لا يحتوي نسخًا من بيانات الرواتب أو المعلومات الشخصية.')}${items.length?`<section class="panel">${items.map(item=>`<div class="audit-event"><span class="mono">${esc(dateText(item.at))}</span><div><div class="td-main">${esc(label(item.action))}</div><div class="brief-meta">${esc(item.resource)} · ${esc(item.recordId||'—')}</div></div><div class="brief-meta">المستخدم ${esc(item.actorUserId||'—')}<br>${item.fromVersion!=null?`v${item.fromVersion} → v${item.toVersion}`:''}</div></div>`).join('')}</section>`:`<div class="panel empty-state"><div class="empty-mark">L</div><h2>لا توجد أحداث في هذه الصفحة</h2><p>${data.total?`إجمالي الأحداث: ${data.total}`:'سيظهر هنا سجل المعاملات المسجل.'}</p></div>`}
      <div class="head-actions" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-outline" data-audit-prev ${state.auditPage<=1?'disabled':''}>السابق</button><span class="help">${state.auditPage} / ${Math.max(1,Math.ceil((data.total||0)/50))}</span><button class="btn btn-outline" data-audit-next ${state.auditPage*50>=(data.total||0)?'disabled':''}>التالي</button></div>`;
    shell(content);
    app.querySelector('[data-audit-prev]')?.addEventListener('click',()=>{state.auditPage--;renderView();});
    app.querySelector('[data-audit-next]')?.addEventListener('click',()=>{state.auditPage++;renderView();});
    return null;
  }
  async function accrualPage() {
    if(!has('finance.manage')) return emptyPage('لا تملك صلاحية إنشاء الاستحقاقات.');
    if(!has('policies.read')||!has('people.read')) return emptyPage('يلزم توفر صلاحية قراءة السياسات والموظفين لاختيار أساس الاستحقاق.');
    const kinds=['policies','employees','journals','clients','accounts'];
    for(const kind of kinds) {
      if(!state.refs[kind]) {
        if(kind==='clients'&&!has('crm.read')) {state.records.clients=[];state.refs.clients=true;continue;}
        if(['journals','accounts'].includes(kind)&&!has('finance.read')) {state.records[kind]=[];state.refs[kind]=true;continue;}
        await allRecords(kind);
      }
    }
    const policies=(state.records.policies||[]).filter(item=>item.data.status==='APPROVED'&&
      (item.data.type==='PAYROLL'||(item.data.type==='COMMISSION'&&has('finance.read')&&has('crm.read'))||(item.data.type==='PROFIT'&&has('finance.read'))));
    const allJournals=state.records.journals||[];
    const journals=allJournals.filter(item=>item.data.status==='POSTED');
    const clients=(state.records.clients||[]).filter(item=>item.data.stage==='WON');
    const content=`${pageHead('إنشاء استحقاق','يحسب الخادم المبلغ من السياسة والمراجع الفعلية. النتيجة قيد يومية مسودة؛ لا يوجد دفع أو تحويل.', '')}
      <div class="form-layout"><section class="panel"><div class="panel-title"><h2 class="ar">طلب احتساب</h2><span class="pill">لا تحويل بنكي</span></div><div class="panel-body"><form id="accrual-form"><div class="form-grid">
        <div class="field span-2"><label for="accrual-policy">السياسة المعتمدة</label><select id="accrual-policy" class="select" required>${recordOptions('policies','',item=>item.data.status==='APPROVED')}</select><span class="help">المعدل، الحد الأعلى، الحسابات، والتقريب تأتي من السياسة.</span></div>
        <div class="field"><label for="accrual-employee">الموظف</label><select id="accrual-employee" class="select" required>${recordOptions('employees','',item=>item.data.status==='ACTIVE')}</select></div>
        <div class="field"><label for="accrual-period">الشهر</label><input id="accrual-period" class="input" type="month" value="${esc(state.period)}" required></div>
        <div class="field"><label for="accrual-source">القيد المصدر للعمولة (إن لزم)</label><select id="accrual-source" class="select"><option value="">غير محدد</option>${journals.map(item=>`<option value="${esc(item._id)}">${esc(recordName(item))} · ${esc(item._id.slice(0,8))}</option>`).join('')}</select></div>
        <div class="field"><label for="accrual-client">العميل الفائز (إن لزم)</label><select id="accrual-client" class="select"><option value="">غير محدد</option>${clients.map(item=>`<option value="${esc(item._id)}">${esc(item.data.name)}</option>`).join('')}</select></div>
      </div><div id="accrual-policy-hint" class="notice" style="margin-top:15px">حدد سياسة لفهم المراجع اللازمة. سيُنشئ الخادم قيدًا في حالة مسودة فقط.</div>
      <div class="form-actions"><button class="btn btn-primary" type="submit" ${policies.length?'':'disabled'}>احتساب وإنشاء مسودة</button></div></form></div></section>
      <aside class="panel"><div class="panel-title"><h2 class="ar">متطلبات الاستحقاق</h2></div><div class="panel-body"><div class="list-stack"><div class="brief-row"><span>رواتب</span><span class="brief-meta">عقد معتمد يغطي الشهر كاملًا</span></div><div class="brief-row"><span>عمولة</span><span class="brief-meta">${has('crm.read')&&has('finance.read')?'عميل فائز مملوك للمستفيد وإيراد مرحّل':'تتطلب قراءة العملاء والمالية'}</span></div><div class="brief-row"><span>أرباح</span><span class="brief-meta">${has('finance.read')?'إيرادات ومصروفات الشهر المرحلة':'تتطلب قراءة المالية'}</span></div></div><p class="help" style="margin-top:16px">الحساب والإصدار وحسابات المصدر تحفظها الخدمة في لقطة غير قابلة للتعديل.</p></div></aside></div>`;
    shell(content);
    const policySelect=app.querySelector('#accrual-policy');
    const source=app.querySelector('#accrual-source'),client=app.querySelector('#accrual-client');
    const employeeSelect=app.querySelector('#accrual-employee'),periodInput=app.querySelector('#accrual-period');
    const optionsForClients=()=>clients.filter(item=>item.data.ownerId===employeeSelect.value);
    function hasRecognizedRevenue(journal) {
      const recognized=(journal?.data?.lines||[]).reduce((sum,line)=>{
        const account=(state.records.accounts||[]).find(candidate=>candidate._id===line.accountId);
        return account?.data?.type==='REVENUE'?sum+Number(line.creditMinor||0)-Number(line.debitMinor||0):sum;
      },0);
      return recognized>0;
    }
    function renderCommissionRefs() {
      const policy=policies.find(item=>item._id===policySelect.value);
      const isCommission=policy?.data.type==='COMMISSION';
      const oldClient=client.value, oldSource=source.value;
      const eligibleClients=isCommission?optionsForClients():[];
      client.innerHTML=`<option value="">${isCommission?'اختر عميلًا فائزًا':'غير محدد'}</option>${eligibleClients.map(item=>`<option value="${esc(item._id)}">${esc(item.data.name)}</option>`).join('')}`;
      if(eligibleClients.some(item=>item._id===oldClient)) client.value=oldClient;
      const chosenClient=eligibleClients.find(item=>item._id===client.value);
      const period=periodInput.value;
      const usedSources=new Set(allJournals.filter(item=>item.data.status!=='CANCELLED').map(item=>item.data.calculation?.sourceJournalId).filter(Boolean));
      const eligibleJournals=isCommission&&chosenClient?journals.filter(item=>{
        const data=item.data||{};
        const revenue=hasRecognizedRevenue(item);
        return data.date?.slice(0,7)===period&&data.clientId===chosenClient._id&&revenue&&!usedSources.has(item._id);
      }):[];
      source.innerHTML=`<option value="">${isCommission?'اختر قيد إيراد مرحّل':'غير محدد'}</option>${eligibleJournals.map(item=>`<option value="${esc(item._id)}">${esc(recordName(item))} · ${esc(item._id.slice(0,8))}</option>`).join('')}`;
      if(eligibleJournals.some(item=>item._id===oldSource)) source.value=oldSource;
    }
    function updateAccrualHint() {
      const policy=policies.find(item=>item._id===policySelect.value);
      const hint=app.querySelector('#accrual-policy-hint');
      if(!policy) {hint.textContent='حدد سياسة لفهم المراجع اللازمة. سيُنشئ الخادم قيدًا في حالة مسودة فقط.';source.required=false;client.required=false;renderCommissionRefs();return;}
      const type=policy.data.type;
      source.required=type==='COMMISSION';client.required=type==='COMMISSION';
      hint.textContent=type==='PAYROLL'?'سيشترط الخادم عقدًا معتمدًا يغطي الشهر كاملًا، دون توزيع جزئي.':
        type==='COMMISSION'?'يلزم عميل فائز مملوك للمستفيد، وقيد إيراد مرحّل للعميل نفسه وفي الشهر نفسه. لا يعاد استخدام مصدر استُخدم لاستحقاق قائم.':
        'يحتسب الخادم ربح الشهر من الإيرادات مطروحًا منها المصروفات المرحلة؛ لا تدخل مبلغًا يدويًا.';
      renderCommissionRefs();
    }
    policySelect?.addEventListener('change',updateAccrualHint);
    employeeSelect?.addEventListener('change',renderCommissionRefs);
    client?.addEventListener('change',renderCommissionRefs);
    periodInput?.addEventListener('change',renderCommissionRefs);
    updateAccrualHint();
    const accrualOperationId=api.newOperationId();
    app.querySelector('#accrual-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');
      const policy=policies.find(item=>item._id===policySelect.value);
      if(!policy) {toast('اختر سياسة استحقاق معتمدة.',true);return;}
      if(policy.data.type==='COMMISSION') {
        const selectedClient=clients.find(item=>item._id===client.value);
        const selectedSource=journals.find(item=>item._id===source.value);
        const hasRevenue=hasRecognizedRevenue(selectedSource);
        if(!selectedClient||selectedClient.data.stage!=='WON'||selectedClient.data.ownerId!==app.querySelector('#accrual-employee').value||
          !selectedSource||!hasRevenue||selectedSource.data.clientId!==selectedClient._id||selectedSource.data.date?.slice(0,7)!==app.querySelector('#accrual-period').value) {
          toast('تحقق من عميل فائز مملوك للمستفيد وقيد إيراد مرحّل لنفس العميل والشهر.',true);return;
        }
      }
      const input={policyId:policy._id,employeeId:app.querySelector('#accrual-employee').value,period:app.querySelector('#accrual-period').value};
      if(!input.employeeId||!input.period) {toast('اختر الموظف والفترة.',true);return;}
      if(policy.data.type==='COMMISSION') {input.sourceJournalId=source.value;input.clientId=client.value;}
      button.disabled=true;button.textContent='جارٍ الاحتساب…';
      try {
        const result=await api.accrue(input,accrualOperationId);
        const journal=result?.kind==='journals'?result:result?.journal;
        if(journal?._id) {
          toast(`أُنشئت مسودة الاستحقاق ${recordName(journal)}. لا يمثل ذلك دفعًا.`);
          state.records={};state.refs={};
          const notice=`تم إنشاء قيد مسودة للاستحقاق. لن يتم تنفيذ أي تحويل.`;
          state.modal={type:'result',message:notice,journal};
          shell(`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="empty-mark">تم</div><p class="eyebrow">ACCRUAL / DRAFT</p><h2 class="ar">اكتمل الاحتساب</h2><p class="ar">${esc(notice)}</p><p class="mono">${esc(journal._id)}</p><div class="form-actions"><button class="btn btn-outline" data-close-result>إغلاق</button><button class="btn btn-primary" data-open-journals>عرض القيود</button></div></section></div>`);
          app.querySelector('[data-close-result]')?.addEventListener('click',()=>{state.modal=null;renderView();});
          app.querySelector('[data-open-journals]')?.addEventListener('click',()=>{state.modal=null;navigate('journals');});
        } else {
          state.modal={type:'result',message:'أُنشئ الاستحقاق، لكن لم يتضمن رد الخدمة معرّف قيد واضحًا.'};
          toast('تم إرسال الطلب. راجع القيود لتأكيد النتيجة.');
          state.records={};state.refs={};await renderView();
        }
      } catch(error) {button.disabled=false;button.textContent='احتساب وإنشاء مسودة';toast(error.message||'تعذّر إنشاء الاستحقاق.',true);}
    });
    return null;
  }
  async function start() {
    try {
      const restored=await api.restoreSession();
      if(restored) await loadSession();
      else loginPage();
    } catch { loginPage(); }
  }
  start();
})();
