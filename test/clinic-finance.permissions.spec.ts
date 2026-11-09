import { describe, expect, it } from 'vitest';
import { TenantClinicFinanceController } from '../src/tenant/tenant-clinic-finance.controller';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_CODES,
} from '../src/tenant/tenant-authorization.constants';
import { TENANT_REQUIRED_PERMISSIONS } from '../src/tenant/tenant-require-permissions.decorator';

describe('clinic finance permissions', () => {
  it('registers separate finance, invoice, transfer, and settings permissions', () => {
    const required = [
      'tenant.finance.read',
      'tenant.finance.manage',
      'tenant.finance.settings.manage',
      'tenant.finance.review',
      'tenant.finance.issue',
      'tenant.finance.payments.read',
      'tenant.finance.payments.submit',
      'tenant.finance.payments.review',
      'tenant.finance.payments.settings.manage',
    ];
    for (const code of required) expect(TENANT_PERMISSION_CODES).toContain(code);

    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    for (const code of required) {
      expect(owner?.permissionCodes).toContain(code);
      expect(admin?.permissionCodes).toContain(code);
    }
    expect(member?.permissionCodes).not.toContain('tenant.finance.read');
  });

  it('protects each controller operation with its narrowest finance permission', () => {
    const controller = TenantClinicFinanceController.prototype;
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.getSettings)).toEqual([
      'tenant.finance.read',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.saveSettings)).toEqual([
      'tenant.finance.read',
      'tenant.finance.settings.manage',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.createInvoice)).toEqual([
      'tenant.finance.manage',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.reviewInvoice)).toEqual([
      'tenant.finance.read',
      'tenant.finance.review',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.issueInvoice)).toEqual([
      'tenant.finance.read',
      'tenant.finance.issue',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.updateInvoice)).toEqual([
      'tenant.finance.read',
      'tenant.finance.manage',
    ]);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.submitInvoiceTransfer),
    ).toEqual(['tenant.finance.payments.read', 'tenant.finance.payments.submit']);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.listInvoiceTransfers),
    ).toEqual(['tenant.finance.payments.read']);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.listTransfers)).toEqual([
      'tenant.finance.payments.read',
    ]);
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.downloadTransferReceipt),
    ).toEqual(['tenant.finance.payments.read']);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.approveTransfer)).toEqual([
      'tenant.finance.payments.read',
      'tenant.finance.payments.review',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.rejectTransfer)).toEqual([
      'tenant.finance.payments.read',
      'tenant.finance.payments.review',
    ]);
    expect(Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.getPaymentSettings)).toEqual(
      ['tenant.finance.payments.read'],
    );
    expect(
      Reflect.getMetadata(TENANT_REQUIRED_PERMISSIONS, controller.updatePaymentSettings),
    ).toEqual(['tenant.finance.payments.settings.manage']);
  });
});
