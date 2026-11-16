(function (root) {
  'use strict';

  const orderStatuses = Object.freeze({
    DRAFT: 'مسودة',
    SUBMITTED: 'قيد المراجعة',
    CHANGES_REQUESTED: 'مطلوب استكمال',
    REJECTED: 'مرفوض',
    APPROVED: 'مقبول',
    ACTIVE: 'مفعّل',
    DELIVERED: 'تم التسليم',
    CANCELLED: 'ملغي',
  });
  const documentStatuses = Object.freeze({
    PENDING: 'بانتظار المراجعة',
    APPROVED: 'مقبول',
    REJECTED: 'مطلوب استكمال',
  });
  const invoiceStatuses = Object.freeze({
    DRAFT: 'مسودة غير صادرة',
    ISSUED: 'صادرة',
    PAID: 'مسددة بتحويل معتمد',
    VOID: 'ملغاة',
  });
  const eventActions = Object.freeze({
    'customer.register': 'إنشاء حساب عميل',
    'customer.profile': 'تحديث ملف المنشأة',
    'customer.order.create': 'إنشاء طلب',
    'customer.order.submit': 'إرسال الطلب للمراجعة',
    'customer.order.cancel': 'إلغاء الطلب',
    'customer.order.acknowledge': 'إقرار استلام العيادة',
    'customer.document.upload': 'رفع مستند',
    'customer.document.review': 'مراجعة مستند',
    'customer.admin.assign': 'تعيين مسؤول الحساب',
    'customer.admin.request_changes': 'طلب استكمال',
    'customer.admin.reject': 'رفض الطلب',
    'customer.admin.approve': 'اعتماد الطلب',
    'customer.admin.activate': 'تفعيل الحساب',
    'customer.catalog.save': 'حفظ مسودة الكتالوج',
    'customer.catalog.publish': 'نشر الكتالوج',
    'customer.invoice.create': 'إنشاء مسودة فاتورة',
    'customer.invoice.issue': 'إصدار الفاتورة',
    'customer.invoice.void': 'إبطال الفاتورة',
    'customer.invoice.link_payment': 'ربط تحويل معتمد',
    'customer.feedback': 'إرسال تقييم العميل',
  });

  function labelFor(labels, value) {
    const key = String(value ?? '');
    return labels[key] ?? (key || '—');
  }

  function money(minorUnits) {
    if (minorUnits == null || minorUnits === '') return '—';
    try {
      const amount = BigInt(String(minorUnits));
      const negative = amount < 0n;
      const absolute = negative ? -amount : amount;
      const whole = new Intl.NumberFormat('ar-SA', {
        useGrouping: true,
        maximumFractionDigits: 0,
      }).format(absolute / 100n);
      const fraction = new Intl.NumberFormat('ar-SA', {
        useGrouping: false,
        minimumIntegerDigits: 2,
        maximumFractionDigits: 0,
      }).format(absolute % 100n);
      return root.ThanarahCurrency.valueMarkup(`${negative ? '−' : ''}${whole}٫${fraction}`, 'SAR');
    } catch {
      return '—';
    }
  }

  root.JourneyFormat = Object.freeze({
    orderStatus: (value) => labelFor(orderStatuses, value),
    documentStatus: (value) => labelFor(documentStatuses, value),
    invoiceStatus: (value) => labelFor(invoiceStatuses, value),
    eventAction: (value) => labelFor(eventActions, value),
    money,
  });
})(window);
