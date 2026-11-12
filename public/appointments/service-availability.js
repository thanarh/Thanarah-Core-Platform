(function registerAppointmentServiceAvailability(root) {
  'use strict';

  function view(input) {
    const doctorId = String(input.doctorId || '');
    const facilityId = String(input.facilityId || '');
    const branchId = String(input.branchId || '');

    if (!input.authorized) {
      return {
        status: 'unauthorized',
        services: [],
        message: 'لا تملك صلاحية قراءة تعيينات خدمات الطبيب والموقع.',
      };
    }
    if (!doctorId || !facilityId) {
      return {
        status: 'selection-required',
        services: [],
        message: 'اختر الطبيب والمنشأة لعرض الخدمات المتاحة.',
      };
    }
    if (input.loading) {
      return {
        status: 'loading',
        services: [],
        message: 'جارٍ تحميل الخدمات المعينة لهذا الطبيب والموقع…',
      };
    }
    if (input.forbidden) {
      return {
        status: 'unauthorized',
        services: [],
        message: 'لا تملك صلاحية قراءة تعيينات خدمات الطبيب والموقع.',
      };
    }
    if (input.errorMessage) {
      return {
        status: 'error',
        services: [],
        message: 'تعذّر تحميل خدمات الطبيب. أعد المحاولة.',
      };
    }

    const servicesById = new Map();
    for (const assignment of Array.isArray(input.assignments) ? input.assignments : []) {
      const assignedDoctorId = String(assignment.doctorId || '');
      const serviceId = String(assignment.serviceId || '');
      const assignedFacilityId = String(assignment.facilityId || '');
      const assignedBranchId = String(assignment.branchId || '');
      if (
        assignedDoctorId !== doctorId ||
        !serviceId ||
        assignedFacilityId !== facilityId ||
        assignment.serviceStatus !== 'ACTIVE' ||
        (assignedBranchId && (!branchId || assignedBranchId !== branchId))
      ) {
        continue;
      }
      if (!servicesById.has(serviceId)) {
        servicesById.set(serviceId, {
          id: serviceId,
          name: String(assignment.serviceName || serviceId),
        });
      }
    }

    const services = [...servicesById.values()];
    if (!services.length) {
      return {
        status: 'empty',
        services,
        message: 'لا توجد خدمات معينة لهذا الطبيب في هذا الموقع. يمكنك إنشاء الموعد دون خدمة.',
      };
    }
    return {
      status: 'ready',
      services,
      message: 'اختر خدمة أو اترك الحقل دون تحديد.',
    };
  }

  function apply(select, statusNode, retryButton, currentView, escapeHtml) {
    const escape = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value);
    const placeholder =
      currentView.status === 'ready' ? 'بدون تحديد' : 'الخدمات غير متاحة حاليًا';
    const options = currentView.services
      .map(
        (service) =>
          `<option value="${escape(service.id)}">${escape(service.name)}</option>`,
      )
      .join('');
    select.innerHTML = `<option value="">${escape(placeholder)}</option>${options}`;
    select.disabled = currentView.status !== 'ready';
    select.value = '';
    statusNode.textContent = currentView.message;
    if (retryButton) retryButton.hidden = currentView.status !== 'error';
  }

  function createRequestGuard() {
    let current = 0;
    return Object.freeze({
      next() {
        current += 1;
        return current;
      },
      invalidate() {
        current += 1;
      },
      isCurrent(requestId) {
        return requestId === current;
      },
    });
  }

  root.ThanarahAppointmentServiceAvailability = Object.freeze({
    view,
    apply,
    createRequestGuard,
  });
})(window);
