(function(){
 'use strict';
 const app=document.getElementById('app'),A=window.JourneyApi;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels=Object.freeze(Object.fromEntries(['DRAFT','SUBMITTED','CHANGES_REQUESTED','REJECTED','APPROVED','ACTIVE','DELIVERED','CANCELLED'].map(status=>[status,window.JourneyFormat.orderStatus(status)])));
  const op=()=>crypto.randomUUID(),money=window.JourneyFormat.money,eventLabel=window.JourneyFormat.eventAction;
 let meData=null,activeOrder=null,detail=null,catalog=null,operation=null,detailId=null;
 function filterCustomerOrders(orders,filter='all'){
  const groups={action:['DRAFT','CHANGES_REQUESTED'],review:['SUBMITTED','APPROVED'],active:['ACTIVE','DELIVERED'],closed:['REJECTED','CANCELLED']};
  return filter==='all'?orders:orders.filter(order=>groups[filter]?.includes(order.status));
 }
 function isOpenOrder(order){return order?.open===true||['DRAFT','CHANGES_REQUESTED','SUBMITTED','APPROVED','ACTIVE'].includes(order?.status)}
 function primaryOrderAction(orders){
  const open=orders.find(isOpenOrder);
  if(open)return{type:'open',orderId:open._id};
  const delivered=orders.filter(order=>order.status==='DELIVERED').slice().sort((left,right)=>(Date.parse(right.deliveredAt||right.updatedAt||right.createdAt||'')||0)-(Date.parse(left.deliveredAt||left.updatedAt||left.createdAt||'')||0))[0];
  if(delivered)return{type:'renew',orderId:delivered._id,packageCode:delivered.packageCode};
  return{type:'new'};
 }
 function configurePrimaryOrderButton(orders){
  const button=document.getElementById('new-order'),action=primaryOrderAction(orders);
  if(!button||action.type==='new')return;
  button.id=action.type==='open'?'open-current-order':'renew-latest-order';
  button.textContent=action.type==='open'?'متابعة الطلب المفتوح':'بدء تجديد';
  button.dataset.orderId=action.orderId;
 }
 function customerOrderRows(orders,filter='all'){
  const visible=filterCustomerOrders(orders,filter);
  if(!visible.length)return `<div class="empty">${orders.length?'لا توجد طلبات تطابق هذه التصفية.':'لا توجد طلبات حتى الآن. ابدأ بطلب جديد عند جاهزيتك.'}</div>`;
  return visible.map(o=>`<div class="row"><div><div class="row-title">${esc(o.packageCode)} <span class="tag ${o.status==='CHANGES_REQUESTED'?'warn':''}">${labels[o.status]||esc(o.status)}</span></div><div class="text-muted">${o.purpose==='RENEWAL'?'طلب تجديد · دورة مراجعة جديدة':'طلب جديد'} · ${new Date(o.updatedAt||o.createdAt).toLocaleDateString('ar-SA')}</div></div><button class="btn outline small" data-open="${esc(o._id)}">التفاصيل</button></div>`).join('');
 }
 function customerDashboardMarkup(data=meData){
  const orders=Array.isArray(data?.orders)?data.orders:[];
  const needsAction=orders.filter(order=>['DRAFT','CHANGES_REQUESTED'].includes(order.status)).length;
  const inReview=orders.filter(order=>['SUBMITTED','APPROVED'].includes(order.status)).length;
  const active=orders.filter(order=>['ACTIVE','DELIVERED'].includes(order.status)).length;
  return `<section class="customer-dashboard-summary" aria-label="ملخص حساب العميل"><article class="customer-summary-card"><span>إجمالي الطلبات</span><strong>${orders.length}</strong><small>جميع طلباتك وتجديداتك</small></article><article class="customer-summary-card ${needsAction?'needs-action':''}"><span>تحتاج إلى إجراء</span><strong>${needsAction}</strong><small>مسودات أو استكمال مطلوب</small></article><article class="customer-summary-card"><span>قيد المتابعة</span><strong>${inReview}</strong><small>مراجعة أو تجهيز من الفريق</small></article><article class="customer-summary-card"><span>عيادات مفعّلة</span><strong>${active}</strong><small>بانتظار إقرار الاستلام عند الجاهزية</small></article></section>`;
 }
 function configuredPackages(data){
  return (Array.isArray(data?.packages)?data.packages:[]).filter(item=>item.published===true&&(String(item.description||'').trim()||(Array.isArray(item.features)&&item.features.some(feature=>String(feature).trim()))));
 }
 function catalogOrderIssue(data,isRenewal=false){
  if(!data?.ordersOpen&&!isRenewal)return 'استقبال الطلبات الجديدة غير متاح حاليًا.';
  if(!String(data.termsText||'').trim())return 'لم تُنشر شروط تقديم الطلب بعد، لذلك لا يمكن إنشاء طلب قابل للإرسال.';
  if(!configuredPackages(data).length)return 'لم تُنشر تفاصيل أي باقة بعد، لذلك لا يمكن اختيار باقة الآن.';
  return null;
 }
 function documentRequirementsMarkup(order,documents){
  const requirements=Array.isArray(order.requirements)?order.requirements:[];
  if(!requirements.length)return '';
  return `<section class="customer-document-checklist"><h3>متطلبات مستندات العيادة</h3><p class="text-muted">تظهر حالة آخر نسخة رفعتها لكل مستند.</p><div class="customer-document-list">${requirements.map(requirement=>{
    const latest=(documents||[]).filter(document=>document.key===requirement.key).slice().sort((a,b)=>(Date.parse(b.createdAt||b.updatedAt||'')||0)-(Date.parse(a.createdAt||a.updatedAt||'')||0))[0];
    const status=latest?.status==='APPROVED'?'مقبول':latest?.status==='PENDING'?'بانتظار المراجعة':latest?.status==='REJECTED'?'مطلوب استكمال':latest?'حالة غير معروفة':requirement.required?'مطلوب رفعه':'اختياري — لم يُرفع';
    return `<div class="customer-document-item"><div><b>${esc(requirement.label||requirement.key)}</b><small>${requirement.required?'مطلوب':'اختياري'}${latest?.fileName?` · ${esc(latest.fileName)}`:''}</small>${latest?.reason?`<p class="text-muted">${esc(latest.reason)}</p>`:''}</div><span class="tag ${latest?.status==='REJECTED'?'warn':''}">${status}</span></div>`;
  }).join('')}</div></section>`;
 }
 function orderProgressMarkup(order){
  const status=order.status;
  const currentStep={DRAFT:0,CHANGES_REQUESTED:1,SUBMITTED:2,APPROVED:3,ACTIVE:4}[status];
  const steps=[
   {label:'إنشاء الطلب',complete:status!=='DRAFT'},
   {label:'استكمال المطلوب',complete:['SUBMITTED','APPROVED','ACTIVE','DELIVERED','REJECTED'].includes(status)},
   {label:'مراجعة الفريق',complete:['APPROVED','ACTIVE','DELIVERED','REJECTED'].includes(status)},
   {label:'تجهيز العيادة',complete:['ACTIVE','DELIVERED'].includes(status)},
   {label:'استلام العيادة',complete:status==='DELIVERED'},
  ];
  return `<ol class="customer-order-progress" aria-label="مراحل الطلب">${steps.map((step,index)=>`<li class="${step.complete?'is-complete':''}" ${currentStep===index?'aria-current="step"':''}><span class="customer-journey-number">${String(index+1).padStart(2,'0')}</span><span>${step.label}</span><small>${step.complete?'مكتمل':currentStep===index?'الخطوة الحالية':'لاحقًا'}</small></li>`).join('')}</ol>`;
 }
  window.addEventListener?.('thanarah:authenticated',event=>{if(event.detail.audience==='customer')void loadPortal().catch(handlePortalError)});
 const toast=(msg,bad=false)=>{let e=document.createElement('div');e.className='toast'+(bad?' bad':'');e.setAttribute('role',bad?'alert':'status');e.setAttribute('aria-live',bad?'assertive':'polite');e.textContent=bad&&operation&&!msg.includes(operation.id)?`${msg} مرجع إعادة المحاولة: ${operation.id}`:msg;document.body.append(e);setTimeout(()=>e.remove(),6000)};
 function operationCall(key,fn){if(operation&&operation.key!==key)throw Object.assign(new Error('هناك عملية سابقة غير مؤكدة. أعد المحاولة بالبيانات نفسها أولًا.'),{status:503});if(!operation)operation={key,id:op()};const operationId=operation.id;return fn(operationId).then(result=>{if(operation?.id===operationId)operation=null;return result}).catch(e=>{if((e.status&&e.status<500)||e.code==='CUSTOMER_WHATSAPP_UNAVAILABLE')operation=null;throw e})}
 function appbar(){return `<header class="appbar"><div class="wrap appbar-inner"><a class="brand" href="/welcome/"><img src="/assets/logo-mark.svg"><span>ثنارة<small>حساب العيادة</small></span></a><div><a class="btn outline small" href="/welcome/">العودة للخدمات</a> <button class="btn outline small" id="logout">خروج</button></div></div></header>`}
 function auth(mode='login',error=''){const registering=mode==='register';app.innerHTML=`<main class="auth"><aside class="auth-side"><a href="/welcome/" class="brand" style="color:inherit"><img src="/assets/logo-mark.svg"><span>ثنارة<small style="color:#bdd1c5">مسار تأسيس العيادة</small></span></a><div><span class="eyebrow" style="color:#c5d89b">مساحة آمنة لمتابعة طلبك</span><h1>${registering?'خطوتك الأولى تبدأ بحسابك.':'كل تفاصيل طلب عيادتك، في مكان واحد.'}</h1><p>تابع المراجعة، المستندات، الفواتير المرتبطة، وإقرار الاستلام. لا نطلب منك مشاركة كلمة المرور خارج هذه الصفحة.</p></div><small>ثنارة · حساب العميل</small></aside><section class="auth-main"><form class="auth-form" id="auth-form"><span class="eyebrow">${registering?'حساب جديد':'مرحبًا بعودتك'}</span><h2>${registering?'إنشاء حساب العيادة':'تسجيل الدخول'}</h2><p class="text-muted">${registering?'الحساب ينشئ هوية دخول ومساحة عميل فقط؛ لا يفعّل عيادة تلقائيًا.':'استخدم بيانات حسابك لمتابعة الطلبات.'}</p>${error?`<div class="statusline" role="alert">${esc(error)}</div>`:''}${registering?`<div class="field"><label for="auth-fullname">الاسم الكامل</label><input id="auth-fullname" class="input" name="fullName" required autocomplete="name"></div>`:''}<div class="field"><label for="auth-email">البريد الإلكتروني</label><input id="auth-email" class="input" type="email" name="email" required autocomplete="email"></div><div class="field"><label for="auth-password">كلمة المرور</label><input id="auth-password" class="input" type="password" name="password" required autocomplete="${registering?'new-password':'current-password'}" minlength="${registering?'12':'1'}"></div>${registering?'<p class="help" id="password-policy">يجب أن تتكون كلمة المرور من 12 محرفًا على الأقل، وأن تشمل حرفًا كبيرًا وحرفًا صغيرًا ورقمًا ورمزًا خاصًا.</p>':''}<div class="auth-error" role="alert">${error?esc(error):''}</div><p class="retry-ref text-muted" aria-live="polite"></p><button class="btn primary" type="submit">${registering?'إنشاء الحساب':'دخول'}</button><p class="text-muted" style="margin-top:18px">${registering?'لديك حساب؟':'ليس لديك حساب؟'} <a class="muted-link" href="?mode=${registering?'login':'register'}">${registering?'تسجيل الدخول':'إنشاء حساب'}</a></p><a class="text-muted" href="/welcome/">استعراض الخدمات والباقات</a></form></section></main>`;
 document.getElementById('auth-form').onsubmit=async ev=>{ev.preventDefault();const form=ev.currentTarget,b=form.querySelector('button[type=submit]'),d=Object.fromEntries(new FormData(form));if(registering&&!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/.test(d.password)){form.querySelector('.auth-error').textContent='تحقق من متطلبات كلمة المرور الموضحة قبل المتابعة.';return}b.disabled=true;try{if(registering){await operationCall('register:'+d.email,id=>A.register({operationId:id,fullName:d.fullName,email:d.email,password:d.password}));if(!await A.login(d.email,d.password))throw Error('تم إنشاء الحساب؛ تعذر بدء الجلسة. سجّل الدخول الآن.')}else if(!await A.login(d.email,d.password))throw Error('تعذر تسجيل الدخول.');await loadPortal()}catch(e){const msg=registering&&(e.code==='CUSTOMER_ACCOUNT_CONFLICT'||e.status===409)?'تعذر إنشاء الحساب بهذه البيانات. تحقق منها أو جرّب تسجيل الدخول.':e.message||'تعذر إتمام العملية.';form.querySelector('.auth-error').textContent=msg;if(!e.status||e.status>=500){form.querySelector('.retry-ref').textContent='لم يتأكد الخادم من النتيجة. أعد المحاولة بالبيانات نفسها. مرجع العملية: '+(operation?.id||'');form.querySelectorAll('input').forEach(input=>{input.readOnly=true;input.setAttribute('aria-readonly','true')});b.textContent='إعادة المحاولة بالبيانات نفسها'}else{operation=null;form.querySelectorAll('input').forEach(input=>{input.readOnly=false;input.removeAttribute('aria-readonly')});b.textContent=registering?'إنشاء الحساب':'دخول'}}finally{b.disabled=false}};
 }
 function profileForm(p){p=p||{};let fields=[['legalName','الاسم القانوني للمنشأة'],['displayName','الاسم التجاري'],['registrationNumber','رقم السجل'],['city','المدينة'],['address','العنوان'],['contactName','اسم جهة التواصل'],['phoneE164','رقم الجوال بصيغة دولية (+966…)']];return `<form id="profile-form" class="form-grid">${fields.map(([k,l])=>`<div class="field ${k==='address'?'span2':''}"><label for="profile-${k}">${l}</label><input id="profile-${k}" class="input" name="${k}" value="${esc(p[k]||'')}" ${k==='phoneE164'?'placeholder="+966500000001"':''} required></div>`).join('')}<p class="span2" id="profile-error" role="alert"></p><div class="span2 actions"><button class="btn primary">حفظ بيانات المنشأة</button><p class="retry-ref text-muted span2" aria-live="polite"></p></div></form>`}
 async function sendWhatsAppCode(){
  const button=document.getElementById('whatsapp'), consent=document.getElementById('wa-consent'), status=document.getElementById('wa-msg');
  if(!button||!consent?.checked){if(status)status.textContent='وافق على إرسال رسالة التحقق أولًا.';return}
  button.disabled=true;
  try{
   const result=await operationCall('whatsapp-send',id=>A.sendWhatsApp({operationId:id,consentAccepted:true}));
   operation=null;
   if(result.status==='VERIFIED'){toast('رقم الجوال متحقق بالفعل.');await loadPortal();return}
   status.innerHTML=`<p class="text-muted" role="status">قُبل طلب الإرسال إلى رقم ملفك. لم يؤكد ذلك وصول الرسالة. مرجع المتابعة: ${esc(result.requestId||'—')}.</p><form id="wa-verify-form" class="form-grid"><div class="field"><label for="wa-code">رمز التحقق المكوّن من ستة أرقام</label><input id="wa-code" name="code" class="input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button class="btn primary" type="submit">تأكيد الرقم</button><p id="wa-verify-status" class="text-muted" role="status" aria-live="polite"></p></form>`;
   const form=document.getElementById('wa-verify-form');
   form.onsubmit=async event=>{
    event.preventDefault();
    const code=form.elements.code.value, submit=form.querySelector('button'), feedback=document.getElementById('wa-verify-status');
    submit.disabled=true;
    try{
     await operationCall('whatsapp-verify:'+result.challengeId,id=>A.verifyWhatsApp({operationId:id,challengeId:result.challengeId,code}));
     operation=null;toast('تم التحقق من رقم الجوال.');await loadPortal();
    }catch(error){feedback.textContent=error.message||'تعذر تأكيد الرمز.'}
    finally{submit.disabled=false}
   };
  }catch(error){
   button.textContent=operation?.key==='whatsapp-send'?'إعادة المحاولة بالمرجع نفسه':'إرسال رمز التحقق';
   status.textContent=(error.message||'تعذر طلب رمز التحقق.')+(operation?.id?` مرجع إعادة المحاولة: ${operation.id}`:'');
  }finally{button.disabled=Boolean(consent&&!consent.checked)}
 }
 async function openAiAssistant(){
  const button=document.getElementById('ai-open'), status=document.getElementById('ai-status'), dialog=document.getElementById('ai-dialog'), frame=document.getElementById('ai-frame');
  if(!button||!dialog||!frame)return;
  button.disabled=true;status.textContent='جارٍ التحقق من الجلسة وبدء المساعد…';
  try{
   const bootstrap=await A.aiBootstrap(), frameUrl=new URL(bootstrap.frameUrl);
   if(frameUrl.origin!==bootstrap.frameOrigin||frameUrl.searchParams.has('code')||frameUrl.searchParams.has('token'))throw new Error('مسار المساعد غير آمن.');
   frame.addEventListener('load',()=>{
    if(frame.contentWindow)frame.contentWindow.postMessage({
     type:'thanarah:bootstrap',integrationId:bootstrap.integrationId,code:bootstrap.code,nonce:bootstrap.nonce
    },bootstrap.frameOrigin);
   },{once:true});
   frame.src=bootstrap.frameUrl;status.textContent='';
   if(!dialog.open)dialog.showModal();
  }catch(error){status.textContent=error.message||'المساعد غير متاح حاليًا.'}
  finally{button.disabled=false}
 }
   function customerJourneyMarkup(data=meData){
    const account=data?.account||{},profile=account.profile||{},orders=Array.isArray(data?.orders)?data.orders:[];
    const required=['legalName','displayName','registrationNumber','city','address','contactName','phoneE164'];
    const profileComplete=required.every(key=>String(profile[key]||'').trim().length>0);
    const latest=orders.find(isOpenOrder)||orders.slice().sort((left,right)=>{
      const leftTime=Date.parse(left.updatedAt||left.createdAt||'')||0;
      const rightTime=Date.parse(right.updatedAt||right.createdAt||'')||0;
      return rightTime-leftTime;
    })[0]||null;
    const status=latest?.status||'';
    const sent=!!latest&&['SUBMITTED','APPROVED','ACTIVE','DELIVERED','REJECTED'].includes(status);
    const reviewed=!!latest&&['APPROVED','ACTIVE','DELIVERED','REJECTED'].includes(status);
    const delivered=status==='DELIVERED';
    let action='profile',actionLabel='أكمل ملف المنشأة',hint='أدخل بيانات منشأتك أولًا لتسهيل متابعة الطلبات.';
    if(profileComplete){
      if(!latest||status==='CANCELLED'){
        action='new-order';actionLabel='ابدأ طلبك الأول';hint='اختر الباقة المناسبة وابدأ مسودة طلبك للمراجعة.';
      }else{
        action='open-order';actionLabel=status==='REJECTED'?'راجع قرار الطلب':status==='DELIVERED'?'عرض استلام العيادة':'تابع طلبك';
        hint=status==='DRAFT'?'أكمل تفاصيل الطلب والمستندات المطلوبة قبل إرساله.':
          status==='CHANGES_REQUESTED'?'راجع ملاحظات الفريق واستكمل المطلوب.':
          status==='SUBMITTED'?'طلبك لدى الفريق للمراجعة؛ يمكنك متابعة حالته من التفاصيل.':
          status==='APPROVED'?'تم اعتماد الطلب، وستظهر خطوة التسليم عند تجهيز الحساب.':
          status==='ACTIVE'?'أصبح الحساب جاهزًا؛ افتح التفاصيل لمراجعة خطوة الاستلام.':
          status==='DELIVERED'?'تم تسجيل الاستلام؛ افتح التفاصيل لمتابعة التقييم أو التجديد.':
          'افتح تفاصيل الطلب لمراجعة حالته.';
      }
    }
    const currentStep=!profileComplete?1:!latest||['DRAFT','CHANGES_REQUESTED','CANCELLED'].includes(status)?2:
      status==='SUBMITTED'?3:['APPROVED','ACTIVE'].includes(status)?4:null;
    const steps=[
      {label:'إنشاء الحساب',complete:true},
      {label:'ملف المنشأة',complete:profileComplete},
      {label:'إرسال الطلب',complete:sent},
      {label:'مراجعة الفريق',complete:reviewed},
      {label:'استلام العيادة',complete:delivered},
    ];
    return `<section class="customer-journey-card" aria-label="مسار العميل في ثنارة"><div class="customer-journey-intro"><span class="eyebrow">مسار العميل</span><h2>من إنشاء الحساب إلى استلام العيادة</h2><p>${esc(hint)}</p><button id="customer-journey-next" class="btn primary" type="button" data-journey-action="${action}" ${latest&&action==='open-order'?`data-order-id="${esc(latest._id)}"`:''}>${esc(actionLabel)}</button></div><ol class="customer-journey-steps">${steps.map((step,index)=>`<li class="${step.complete?'is-complete':''}" ${currentStep===index?'aria-current="step"':''}><span class="customer-journey-number">${String(index+1).padStart(2,'0')}</span><span>${esc(step.label)}</span><small>${step.complete?'مكتمل':currentStep===index?'الخطوة التالية':'لاحقًا'}</small></li>`).join('')}</ol></section>`;
  }
   function portal(){let a=meData.account,orders=meData.orders||[];app.innerHTML=`${appbar()}<main class="wrap app-main"><div class="page-title"><div><span class="eyebrow">مساحة العميل</span><h1>مرحبًا، ${esc(a.fullName)}</h1><p>تابع بيانات المنشأة والطلبات وسجل المراجعة من هنا.</p></div><button class="btn primary" id="new-order">طلب جديد</button></div>${customerDashboardMarkup(meData)}<div class="grid-main"><div class="stack"><section class="panel"><div class="panel-head"><h2>طلباتك</h2><span class="tag">${orders.length} طلب</span></div><div class="panel-body"><div class="field customer-order-filter"><label for="order-filter">تصفية الطلبات</label><select id="order-filter" class="select"><option value="all">كل الطلبات</option><option value="action">تحتاج إلى إجراء</option><option value="review">قيد المراجعة</option><option value="active">عيادات مفعّلة أو مستلمة</option><option value="closed">مرفوضة أو ملغاة</option></select></div><div id="customer-orders-list">${customerOrderRows(orders)}</div></div></section><section id="order-view"></section></div><aside class="stack"><section class="panel"><div class="panel-head"><h2>ملف المنشأة</h2></div><div class="panel-body">${profileForm(a.profile)}</div></section><section class="panel"><div class="panel-head"><h2>حالة التحقق</h2></div><div class="panel-body"><span class="tag ${a.phoneVerification?.status==='VERIFIED'?'':'warn'}">${a.phoneVerification?.status==='VERIFIED'?'تم التحقق':'غير متحقق'}</span>${a.phoneVerification?.status==='VERIFIED'?'<p class="text-muted">تم التحقق من رقم الجوال الحالي.</p>':`<p class="text-muted">سنرسل رمز تحقق إلى رقم ملف المنشأة. قبول الإرسال لا يؤكد وصول الرسالة.</p><label class="check"><input id="wa-consent" type="checkbox"><span>أوافق على إرسال رسالة WhatsApp واحدة إلى رقم الجوال المسجل لغرض التحقق.</span></label><button class="btn outline small" id="whatsapp" type="button" disabled>إرسال رمز التحقق</button>`}<div id="wa-msg" aria-live="polite"></div></div></section></aside></div></main><dialog id="ai-dialog" class="customer-ai-dialog" aria-labelledby="ai-title"><div class="customer-ai-dialog-head"><h2 id="ai-title">مساعد ثنارة</h2><button class="btn outline small" id="ai-close" type="button">إغلاق</button></div><iframe id="ai-frame" title="مساعد ثنارة الذكي" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups" referrerpolicy="no-referrer"></iframe></dialog>`;
    configurePrimaryOrderButton(orders);
  const pageTitle=app.querySelector('.page-title');
   if(pageTitle)pageTitle.insertAdjacentHTML('afterend',customerJourneyMarkup());
   const customerAside=app.querySelector('.grid-main aside.stack');
   customerAside?.insertAdjacentHTML('beforeend','<section class="panel customer-ai-card"><div class="panel-head"><h2>مساعد ثنارة الذكي</h2></div><div class="panel-body"><p class="text-muted">جلسة المساعد تبدأ بعد التحقق من حسابك. لا تشارك بيانات مرضى أو معلومات صحية حساسة.</p><button class="btn outline small" id="ai-open" type="button">فتح المساعد</button><p id="ai-status" class="text-muted" role="status" aria-live="polite"></p></div></section>');
  document.getElementById('customer-journey-next').onclick=()=>{
    const button=document.getElementById('customer-journey-next');
    if(button.dataset.journeyAction==='profile'){
      const form=document.getElementById('profile-form');
      if(form){
        form.scrollIntoView({block:'center'});
        const firstMissing=Array.from(form.querySelectorAll('[required]')).find(field=>!String(field.value||'').trim());
        (firstMissing||form.querySelector('input'))?.focus({preventScroll:true});
      }
    }else if(button.dataset.journeyAction==='new-order')void newOrder();
    else if(button.dataset.orderId)void openOrder(button.dataset.orderId);
  };
   document.getElementById('logout').onclick=async()=>{await A.logout();auth()};document.getElementById('profile-form').onsubmit=saveProfile;document.getElementById('new-order')?.addEventListener('click',()=>void newOrder());document.getElementById('open-current-order')?.addEventListener('click',event=>void openOrder(event.currentTarget.dataset.orderId));document.getElementById('renew-latest-order')?.addEventListener('click',event=>{const order=orders.find(item=>item._id===event.currentTarget.dataset.orderId);if(order)void newOrder(order.packageCode,order._id)});
  const orderList=document.getElementById('customer-orders-list');
  orderList.onclick=event=>{const button=event.target.closest('[data-open]');if(button)void openOrder(button.dataset.open)};
  document.getElementById('order-filter').onchange=event=>{orderList.innerHTML=customerOrderRows(orders,event.target.value)};
   const waConsent=document.getElementById('wa-consent');
   if(waConsent)waConsent.onchange=()=>{document.getElementById('whatsapp').disabled=!waConsent.checked};
   document.getElementById('whatsapp')?.addEventListener('click',()=>void sendWhatsAppCode());
   document.getElementById('ai-open')?.addEventListener('click',()=>void openAiAssistant());
   document.getElementById('ai-close')?.addEventListener('click',()=>document.getElementById('ai-dialog').close());
   document.getElementById('ai-dialog')?.addEventListener('close',()=>{document.getElementById('ai-frame').src='about:blank'});
 const requested=new URLSearchParams(location.search).get('package');if(requested)newOrder(requested);
 }
  async function saveProfile(e){e.preventDefault();let f=e.currentTarget,b=f.querySelector('button'),profile=Object.fromEntries(new FormData(f));b.disabled=true;try{await operationCall('profile',id=>A.profile({operationId:id,version:meData.account.version,profile}));operation=null;toast('تم حفظ بيانات المنشأة.');await loadPortal()}catch(x){const msg=x.message||'تعذر حفظ البيانات.';f.querySelector('#profile-error').textContent=msg;if(!x.status||x.status>=500){f.querySelectorAll('input').forEach(i=>i.readOnly=true);b.textContent='إعادة المحاولة بالبيانات نفسها';f.querySelector('.retry-ref').textContent='مرجع العملية: '+(operation?.id||'')}else{f.querySelectorAll('input').forEach(i=>i.readOnly=false);b.textContent='حفظ بيانات المنشأة';f.querySelector('.retry-ref').textContent=''}toast(msg,true)}finally{b.disabled=false}}
 async function newOrder(code,parentOrderId){try{if(!catalog)catalog=await A.catalog();let panel=document.getElementById('order-view');if(!panel)return;const issue=catalogOrderIssue(catalog,Boolean(parentOrderId));if(issue){panel.innerHTML=`<section class="panel"><div class="panel-body"><span class="eyebrow">جاهزية الطلب</span><h2>تجهيز الباقات والشروط</h2><p class="text-muted">${esc(issue)}</p><a class="btn outline" href="/welcome/#packages">عرض حالة الباقات</a></div></section>`;return}const pkgs=configuredPackages(catalog);panel.innerHTML=`<section class="panel"><div class="panel-head"><h2>${parentOrderId?'بدء طلب تجديد':'بدء طلب'}</h2><button class="btn outline small" id="close-new">إغلاق</button></div><div class="panel-body"><p class="text-muted">${parentOrderId?'التجديد دورة مراجعة جديدة؛ لا يمدد تلقائيًا مدة مدفوعة.':'اختر الباقة. الطلب يبدأ كمسودة للمراجعة وإرفاق المستندات.'}</p><form id="create-order"><div class="field"><label>الباقة</label><select class="select" name="packageCode" required>${pkgs.map(p=>`<option ${p.code===code?'selected':''} value="${esc(p.code)}">${esc(p.code)}</option>`).join('')}</select></div><div class="actions"><button class="btn primary">إنشاء الطلب</button></div></form></div></section>`;
  document.getElementById('close-new').onclick=()=>panel.innerHTML='';document.getElementById('create-order').onsubmit=async e=>{e.preventDefault();let form=e.currentTarget,b=form.querySelector('button'),picker=form.elements.packageCode,packageCode=picker.value;b.disabled=true;try{let o=await operationCall('create:'+(parentOrderId||'new')+':'+packageCode,id=>A.createOrder({operationId:id,packageCode,...(parentOrderId?{parentOrderId}:{})}));operation=null;toast('تم إنشاء المسودة.');await loadPortal();await openOrder(o._id)}catch(x){if(!x.status||x.status>=500){picker.disabled=true;b.textContent='إعادة المحاولة بالبيانات نفسها'}else{picker.disabled=false;b.textContent='إنشاء الطلب'}toast(x.message||'تعذر إنشاء الطلب.',true)}finally{b.disabled=false}}
 }catch(e){toast(e.message||'تعذر تحميل الباقات.',true)}}
 async function openOrder(id){detailId=id;const area=document.getElementById('order-view');if(!area)return;area.innerHTML='<section class="panel loading"><span class="skeleton"></span></section>';try{detail=await A.order(id);activeOrder=detail.order;area.innerHTML=renderDetail(detail);wireDetail()}catch(e){area.innerHTML=`<section class="panel error">تعذر تحميل تفاصيل الطلب. <button class="btn outline small" id="retry-detail">إعادة المحاولة</button></section>`;document.getElementById('retry-detail').onclick=()=>openOrder(id)}}
  function renderDetail(d){let o=d.order,editable=['DRAFT','CHANGES_REQUESTED'].includes(o.status);return `<section class="panel"><div class="panel-head"><div><h2>تفاصيل الطلب · ${esc(o.packageCode)}</h2><span class="text-muted">${o.purpose==='RENEWAL'?'تجديد · دورة مراجعة جديدة':'طلب جديد'}</span></div><span class="tag">${labels[o.status]||esc(o.status)}</span></div><div class="panel-body stack">${orderProgressMarkup(o)}${o.reason?`<div class="statusline">${esc(o.reason)}</div>`:''}<div class="text-muted">مسؤول الحساب: ${esc(d.accountManager?.name||d.manager?.name||meData?.accountManager?.name||(o.managerId?'تم تعيين مسؤول حساب':'سيظهر عند التعيين'))}</div>${documentRequirementsMarkup(o,d.documents)}${['ACTIVE','DELIVERED'].includes(o.status)?deliveryView(d.delivery):''}${editable?`<section><h3>المستندات المطلوبة</h3><p class="text-muted">PDF أو PNG أو JPEG، بحد أقصى 4 ميغابايت لكل ملف.</p><form id="upload-doc" class="form-grid"><div class="field"><label for="upload-key">نوع المستند</label><select id="upload-key" class="select" name="key" required>${(o.requirements||[]).map(r=>`<option value="${esc(r.key)}">${esc(r.label)}${r.required?' · مطلوب':''}</option>`).join('')}</select></div><div class="field"><label for="upload-receipt">الملف</label><input id="upload-receipt" class="input" type="file" name="receipt" accept="application/pdf,image/png,image/jpeg" required></div><div class="span2"><button class="btn outline">رفع المستند</button></div></form></section>`:''}<section><h3>المستندات</h3>${(d.documents||[]).map(doc=>`<div class="row"><div><b>${esc(doc.fileName)}</b><div class="text-muted">${esc(doc.key)} · ${esc(doc.status)}${doc.reason?' · '+esc(doc.reason):''}</div></div><button class="btn outline small" data-download="${esc(doc._id)}">تنزيل آمن</button></div>`).join('')||'<p class="text-muted">لم ترفع مستندات بعد.</p>'}</section>${o.status==='DRAFT'||o.status==='CHANGES_REQUESTED'?`<section class="panel"><div class="panel-body"><h3>شروط تقديم الطلب</h3><div class="legal">${esc(o.termsText||'لا توجد شروط محفوظة مع هذا الطلب.')}</div><label class="check" style="margin-top:12px"><input type="checkbox" id="terms-check"><span>قرأت الشروط المحفوظة مع هذا الطلب وأوافق عليها عند إرساله.</span></label><button class="btn primary" id="submit-order" style="margin-top:12px" ${!o.termsText?'disabled':''}>إرسال الطلب للمراجعة</button><button class="btn danger small" id="cancel-order">إلغاء المسودة</button></div></section>`:''}
 ${['ACTIVE','DELIVERED'].includes(o.status)?`<section class="panel"><div class="panel-body"><h3>اشتراك العيادة</h3><button class="btn outline small" id="subscription">فتح بوابة الاشتراك</button><div id="sub-data"></div></div></section>`:''}
 ${(d.invoices||[]).length?`<section class="panel"><div class="panel-body"><h3>الفواتير</h3>${d.invoices.map(i=>`<div class="row"><span>فاتورة ${esc(i.number||'مسودة غير صادرة')} · ${esc(({DRAFT:'مسودة غير صادرة',ISSUED:'صادرة',PAID:'مسددة بتحويل معتمد',VOID:'ملغاة'})[i.status]||i.status)} · ${money(i.totalMinor)}</span></div>`).join('')}</div></section>`:''}
 ${o.status==='ACTIVE'?`<section class="panel"><div class="panel-body"><h3>استلام حساب العيادة</h3><p>تم ربط الاشتراك بعد تحقق الفريق من الإعداد. لم يكتمل التسليم حتى الآن.</p>${d.delivery?.available?'<button class="btn primary" id="acknowledge">أؤكد استلام حساب العيادة</button>':'<p class="notice">الحساب غير متاح للاستلام الآن؛ راجع مدير الحساب.</p>'}</div></section>`:''}${o.status==='DELIVERED'?`<section class="panel"><div class="panel-body"><h3>تم تسجيل استلام العيادة</h3>${d.review?'<p class="text-muted">شكرًا لملاحظاتك. تم تسجيل رأيك لهذا الطلب.</p>':`<form id="review-form" class="form-grid" style="margin-top:15px"><div class="field"><label for="feedback-rating">تقييم تجربتك</label><select id="feedback-rating" class="select" name="rating"><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></div><div class="field"><label for="feedback-comment">ملاحظتك (اختياري)</label><input id="feedback-comment" class="input" name="comment"></div><div class="span2"><button class="btn outline">إرسال ملاحظة خاصة</button></div></form>`}</div></section>`:''}
 <section><h3>سجل الإجراءات</h3>${(d.events||[]).slice().reverse().map(ev=>`<div class="event"><time>${new Date(ev.at).toLocaleString('ar-SA')}</time><span>${esc(eventLabel(ev.action))}${ev.reason?' · '+esc(ev.reason):''}</span></div>`).join('')||'<p class="text-muted">لا توجد إجراءات مسجلة بعد.</p>'}</section>
 ${!o.open&&o.status==='DELIVERED'?`<div><button class="btn outline small" id="renew">بدء طلب تجديد</button><span class="text-muted">التجديد دورة مراجعة جديدة وليس تمديدًا تلقائيًا للمدة المدفوعة.</span></div>`:''}</div></div></section>`}
 function wireDetail(){document.querySelectorAll('[data-download]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await A.downloadDocument(b.dataset.download)}catch(e){toast(e.message||'تعذر تنزيل المستند.',true)}finally{b.disabled=false}});
  let upload=document.getElementById('upload-doc');if(upload)upload.onsubmit=async e=>{e.preventDefault();let b=upload.querySelector('button'),file=upload.receipt.files[0],key='upload:'+detailId+':'+upload.key.value;if(operation&&operation.key!==key){toast('هناك عملية سابقة غير مؤكدة. أعد المحاولة بالبيانات نفسها أولًا.',true);return}if(file&&file.size>4194304){toast('حجم الملف يتجاوز 4 ميغابايت.',true);return}if(file&&!['application/pdf','image/png','image/jpeg'].includes(file.type)){toast('الملفات المقبولة PDF أو PNG أو JPEG.',true);return}let fd=new FormData();fd.append('receipt',file);fd.append('key',upload.key.value);fd.append('version',String(activeOrder.version));let id=operation?.id||op();operation={key,id};fd.append('operationId',id);b.disabled=true;try{await A.upload(detailId,fd);operation=null;toast('تم رفع المستند.');await openOrder(detailId)}catch(x){if(x.status&&x.status<500){operation=null;upload.querySelectorAll('input,select').forEach(el=>el.disabled=false);b.textContent='رفع المستند'}else{upload.querySelectorAll('input,select').forEach(el=>el.disabled=true);b.textContent='إعادة المحاولة بالبيانات نفسها'}toast(x.message||'تعذر رفع المستند.',true)}finally{b.disabled=false}};
  const act=async(action,extra={})=>{let b=document.activeElement;if(b)b.disabled=true;try{await operationCall(`action:${detailId}:${action}`,id=>A.customerAction(detailId,{operationId:id,version:activeOrder.version,action,...extra}));operation=null;toast('تم تحديث الطلب.');await openOrder(detailId);await loadMe()}catch(e){if(b)b.textContent=!e.status||e.status>=500?'إعادة المحاولة بالبيانات نفسها':action==='submit'?'إرسال الطلب للمراجعة':action==='acknowledge'?'أؤكد استلام حساب العيادة':'إلغاء المسودة';toast(e.message||'تعذر تحديث الطلب.',true)}finally{if(b)b.disabled=false}};
  document.getElementById('submit-order')?.addEventListener('click',()=>{if(!document.getElementById('terms-check').checked){toast('يجب الموافقة على الشروط قبل الإرسال.',true);return}act('submit',{acceptedTermsVersion:activeOrder.termsVersion})});document.getElementById('cancel-order')?.addEventListener('click',()=>{if(confirm('هل تريد إلغاء هذه المسودة؟'))act('cancel')});document.getElementById('acknowledge')?.addEventListener('click',()=>act('acknowledge'));
 document.getElementById('renew')?.addEventListener('click',()=>newOrder(activeOrder.packageCode,activeOrder._id));
 document.getElementById('subscription')?.addEventListener('click',async e=>{const trigger=e.currentTarget;trigger.disabled=true;try{let data=await A.subscription(activeOrder._id),box=document.getElementById('sub-data');box.innerHTML=`<div class="statusline">بيانات الاشتراك الحالية من بوابة الاشتراك المعتمدة.</div>${objectView(data.subscription,'الاشتراك')}${Array.isArray(data.transfers)?`<h4>التحويلات</h4>${data.transfers.map(t=>objectView(t,'تحويل')).join('')}`:''}${data.bankTransfer?.enabled?`${objectView(data.bankTransfer,'تعليمات التحويل البنكي')}<form id="transfer" style="margin-top:14px"><div class="field"><label for="transfer-receipt">إرفاق مستند تحويل</label><input id="transfer-receipt" class="input" type="file" name="receipt" accept="application/pdf,image/png,image/jpeg" required></div><p class="text-muted">رفع مستند لا يعني اعتماد التحويل أو تسجيل السداد.</p><button class="btn outline">إرسال مستند التحويل</button></form>`:'<p class="notice">التحويل البنكي غير مفعّل حاليًا. لم تُجرَ عملية دفع.</p>'}`;const transferForm=document.getElementById('transfer');if(transferForm)transferForm.onsubmit=async ev=>{ev.preventDefault();let form=ev.currentTarget,fd=new FormData();fd.append('receipt',form.receipt.files[0]);let b=form.querySelector('button');b.disabled=true;try{await operationCall('transfer:'+activeOrder._id,id=>A.uploadTransfer(activeOrder._id,fd,id));operation=null;toast('تم إرسال المستند للمراجعة.')}catch(x){if(!x.status||x.status>=500){form.receipt.disabled=true;b.textContent='إعادة المحاولة بالبيانات نفسها'}else{form.receipt.disabled=false;b.textContent='إرسال مستند التحويل'}toast(x.message||'تعذر إرسال التحويل.',true)}finally{b.disabled=false}}}catch(x){toast(x.message||'تعذر فتح بوابة الاشتراك.',true)}finally{trigger.disabled=false}});
  let rf=document.getElementById('review-form');if(rf)rf.onsubmit=async e=>{e.preventDefault();let v=Object.fromEntries(new FormData(rf)),b=rf.querySelector('button');b.disabled=true;try{await operationCall('review:'+activeOrder._id,id=>A.review(activeOrder._id,{operationId:id,rating:Number(v.rating),comment:v.comment}));operation=null;toast('تم حفظ ملاحظتك الخاصة.');await openOrder(detailId)}catch(x){if(!x.status||x.status>=500){rf.querySelectorAll('input,select').forEach(el=>{el.readOnly=true;el.style.pointerEvents='none';el.tabIndex=-1});b.textContent='إعادة المحاولة بالبيانات نفسها'}else{rf.querySelectorAll('input,select').forEach(el=>{el.readOnly=false;el.style.pointerEvents='';el.tabIndex=0});b.textContent='إرسال ملاحظة خاصة'}toast(x.message||'تعذر إرسال الملاحظة.',true)}finally{b.disabled=false}}
 }
 function objectView(value,title){if(value==null)return'';if(typeof value!=='object')return`<div class="row"><b>${esc(title)}</b><span>${esc(value)}</span></div>`;if(Array.isArray(value))return value.length?`<section><h4>${esc(title)}</h4>${value.map((v,i)=>objectView(v,`${title} ${i+1}`)).join('')}</section>`:`<p class="text-muted">${esc(title)}: لا توجد سجلات.</p>`;return`<section class="panel" style="margin:10px 0"><div class="panel-head"><h4>${esc(title)}</h4></div><div class="panel-body">${Object.entries(value).filter(([k,v])=>!/(token|secret|password)/i.test(k)&&v!=null&&typeof v!=='object').map(([k,v])=>`<div class="row"><span class="text-muted">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}${Object.entries(value).filter(([k,v])=>!/(token|secret|password)/i.test(k)&&v&&typeof v==='object').map(([k,v])=>objectView(v,k)).join('')}</div></section>`}
 function deliveryView(delivery){if(!delivery)return'';if(delivery.available&&delivery.url){let href='';try{const u=new URL(delivery.url,location.origin);if(u.protocol==='https:'||u.origin===location.origin)href=u.href}catch{}return href?`<section class="notice"><b>رابط حساب العيادة متاح:</b> <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">فتح رابط التسليم</a><p style="margin:5px 0 0">احفظ بيانات الدخول بأمان؛ لن نرسل كلمة المرور عبر واتساب.</p></section>`:'<div class="statusline">رابط التسليم الوارد غير صالح للفتح من هذه الصفحة. تواصل مع مسؤول الحساب.</div>'}return'<div class="statusline">رابط حساب العيادة غير متاح حاليًا. لن نعرض التسليم على أنه مكتمل قبل توفره.</div>'}
  async function loadMe(){meData=await A.me()}
  async function loadPortal(){await loadMe();try{catalog=catalog||await A.catalog()}catch{}portal()}
  function sessionRestoreError(error){app.innerHTML=`<main class="auth"><section class="auth-main"><div class="auth-form"><span class="eyebrow">مساحة العميل</span><h2>تعذر التحقق من الجلسة</h2><p class="text-muted">تعذر الاتصال بخدمة الجلسات مؤقتًا. لم يتم إنهاء الجلسة؛ أعد المحاولة.</p>${error?.message?`<div class="statusline" role="alert">${esc(error.message)}</div>`:''}<button class="btn primary" id="retry-session" type="button">إعادة المحاولة</button><p><a class="text-muted" href="/welcome/">العودة للخدمات</a></p></div></section></main>`;document.getElementById('retry-session')?.addEventListener('click',()=>void init())}
  function handlePortalError(error){if(!error?.status||error.status>=500)sessionRestoreError(error);else auth('login',error.message||'انتهت الجلسة. سجّل الدخول مجددًا.')}
  async function init(){let restored=false;try{restored=await A.restoreSession()}catch(error){sessionRestoreError(error);return}if(!restored){auth(new URLSearchParams(location.search).get('mode')==='register'?'register':'login');return}try{await loadPortal()}catch(error){handlePortalError(error)}}
 init();
})();
