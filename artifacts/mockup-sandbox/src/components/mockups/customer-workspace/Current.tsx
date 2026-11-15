import './_group.css';

const steps = [
  ['01', 'إنشاء الحساب', 'مكتمل', true],
  ['02', 'ملف المنشأة', 'مكتمل', true],
  ['03', 'إرسال الطلب', 'مكتمل', true],
  ['04', 'مراجعة الفريق', 'الخطوة الحالية', false],
  ['05', 'استلام العيادة', 'لاحقًا', false],
] as const;

function SharedSiteHeader() {
  return (
    <header className="thanarah-shell thanarah-shell-header" data-thanarah-shell>
      <a className="thanarah-shell-skip" href="#customer-main">
        تجاوز إلى المحتوى
      </a>
      <div className="thanarah-shell-inner">
        <a className="thanarah-shell-brand" href="#" aria-label="ثنارة | الرئيسية">
          <img src="/__mockup/assets/logo-mark.svg" width="39" height="39" alt="" />
          <span>
            ثنارة
            <small>مساحة العميل</small>
          </span>
        </a>
        <nav className="thanarah-shell-nav" aria-label="التنقل الرئيسي">
          <a href="#" aria-current="page">طلباتي</a>
          <a href="#">الباقات</a>
          <a href="#">الدعم والتواصل</a>
          <a href="#">الرئيسية</a>
        </nav>
        <div className="thanarah-shell-actions">
          <button className="thanarah-shell-language" type="button" lang="ar">
            <span className="thanarah-shell-language-label">العربية</span>
            <span aria-hidden="true">⌄</span>
          </button>
          <span className="thanarah-shell-auth-actions">
            <button className="thanarah-shell-action current-nav-login" type="button">دخول</button>
            <button className="thanarah-shell-action thanarah-shell-action-primary" type="button">
              إنشاء حساب
            </button>
          </span>
          <button className="thanarah-shell-menu" type="button" aria-label="فتح القائمة">
            <span className="thanarah-shell-menu-glyph" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

function JourneyCard() {
  return (
    <section className="customer-journey-card current-journey" aria-label="مسار العميل في ثنارة">
      <div className="customer-journey-intro">
        <span className="eyebrow">مسار العميل</span>
        <h2>من إنشاء الحساب إلى استلام العيادة</h2>
        <p>طلبك لدى الفريق للمراجعة؛ يمكنك متابعة حالته من التفاصيل.</p>
        <button className="btn primary" type="button">تابع طلبك</button>
      </div>
      <ol className="customer-journey-steps">
        {steps.map(([number, label, status, complete], index) => (
          <li
            className={complete ? 'is-complete' : ''}
            aria-current={index === 3 ? 'step' : undefined}
            key={number}
          >
            <span className="customer-journey-number">{number}</span>
            <span>{label}</span>
            <small>{status}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CurrentProfile() {
  const fields = [
    ['الاسم القانوني للمنشأة', 'عيادات توازن للرعاية'],
    ['الاسم التجاري', 'عيادات توازن'],
    ['رقم السجل', '1010987654'],
    ['المدينة', 'الرياض'],
    ['العنوان', 'حي النخيل، طريق الملك عبدالعزيز'],
    ['اسم جهة التواصل', 'سارة الحربي'],
    ['رقم الجوال بصيغة دولية (+966…)', '+966 55 000 0012'],
  ];

  return (
    <section className="panel">
      <div className="panel-head"><h2>ملف المنشأة</h2></div>
      <div className="panel-body">
        <form className="form-grid">
          {fields.map(([label, value], index) => (
            <div className={`field ${index === 4 ? 'span2' : ''}`} key={label}>
              <label>{label}</label>
              <input className="input" readOnly value={value} />
            </div>
          ))}
          <div className="span2 actions">
            <button className="btn primary" type="button">حفظ بيانات المنشأة</button>
          </div>
        </form>
      </div>
    </section>
  );
}

export function Current() {
  return (
    <div className="customer-current" dir="rtl" lang="ar">
      <SharedSiteHeader />
      <header className="appbar">
        <div className="wrap appbar-inner">
          <a className="brand" href="#">
            <img src="/__mockup/assets/logo-mark.svg" alt="" />
            <span>ثنارة<small>حساب العيادة</small></span>
          </a>
          <div>
            <a className="btn outline small" href="#">العودة للخدمات</a>{' '}
            <button className="btn outline small" type="button">خروج</button>
          </div>
        </div>
      </header>
      <main className="wrap app-main current-main" id="customer-main">
        <div className="page-title">
          <div>
            <span className="eyebrow">مساحة العميل</span>
            <h1>مرحبًا، سارة الحربي</h1>
            <p>تابعي بيانات المنشأة والطلبات وسجل المراجعة من هنا.</p>
          </div>
          <button className="btn primary" type="button">طلب جديد</button>
        </div>
        <JourneyCard />
        <div className="grid-main">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h2>طلباتك</h2>
                <span className="tag">طلب واحد</span>
              </div>
              <div className="panel-body">
                <div className="row">
                  <div>
                    <div className="row-title">
                      باقة الانطلاقة <span className="tag current-order-state">قيد المراجعة</span>
                    </div>
                    <div className="text-muted">طلب جديد · ١٢ نوفمبر ٢٠٢٦</div>
                  </div>
                  <button className="btn outline small" type="button">التفاصيل</button>
                </div>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>تفاصيل الطلب · باقة الانطلاقة</h2></div>
              <div className="panel-body stack">
                <div className="statusline">طلبك لدى الفريق للمراجعة.</div>
                <div className="text-muted">مسؤول الحساب: يظهر عند التعيين</div>
                <section>
                  <h3>المستندات</h3>
                  <p className="text-muted">لا توجد مستندات مطلوبة في هذه المرحلة.</p>
                </section>
                <section>
                  <h3>سجل الإجراءات</h3>
                  <div className="event">
                    <time>١٢ نوفمبر ٢٠٢٦</time>
                    <span>إرسال الطلب للمراجعة</span>
                  </div>
                  <div className="event">
                    <time>١٠ نوفمبر ٢٠٢٦</time>
                    <span>إنشاء مسودة الطلب</span>
                  </div>
                </section>
              </div>
            </section>
          </div>
          <aside className="stack">
            <CurrentProfile />
            <section className="panel">
              <div className="panel-head"><h2>حالة التحقق</h2></div>
              <div className="panel-body">
                <span className="tag warn">غير متحقق</span>
                <p className="text-muted">
                  لا يمكن إجراء التحقق عبر واتساب حاليًا. لن نعرض تحققًا غير مؤكد.
                </p>
                <button className="btn outline small" type="button">طلب التحقق عبر واتساب</button>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
