import { Injectable } from '@nestjs/common';
import { BUILTIN_ROLES, PERMISSIONS, type Permission } from './operations.model';
import { OperationsStore } from './operations.store';
import { OperationsRecords } from './operations.records';
import { OperationsFinance } from './operations.finance';
import { fail } from './operations.errors';

@Injectable()
export class OperationsService {
  constructor(
    readonly store: OperationsStore,
    readonly records: OperationsRecords,
    readonly finance: OperationsFinance,
  ) {}
  session(userId: string) {
    return this.store.read(userId, undefined, async (w) => ({
      ...w.actor,
      roleCatalog: Object.entries(BUILTIN_ROLES).map(([id, role]) => ({
        id,
        ...role,
        builtin: true,
      })),
      permissionCatalog: PERMISSIONS,
    }));
  }
  audit(userId: string, page: number, limit: number) {
    return this.store.read(userId, 'audit.read', async (w) => {
      const collection = w.db.collection('company_audit');
      const total = await collection.countDocuments({}, { session: w.session });
      const items = await collection
        .find({}, { session: w.session })
        .sort({ at: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();
      return { items, total, page, limit };
    });
  }
  dashboard(userId: string, view: string) {
    if (!['ceo', 'cto', 'director'].includes(view))
      fail('COMPANY_DASHBOARD_INVALID', 'لوحة غير متاحة.', 404);
    return this.store.read(userId, `dashboard.${view}` as Permission, async (w) => {
      const counts: Record<string, number> = {};
      const resources = [
        ['units', 'organization.read'],
        ['employees', 'people.read'],
        ['clients', 'crm.read'],
        ['contracts', 'hr.read'],
        ['policies', 'policies.read'],
        ['journals', 'finance.read'],
      ] as const;
      for (const [kind, permission] of resources) {
        if (w.actor.permissions.includes(permission)) {
          counts[kind] = await this.store
            .collection(w.db)
            .countDocuments({ kind }, { session: w.session });
        }
      }
      const requests = w.actor.permissions.includes('requests.read')
        ? await this.store.all(w, 'requests', this.records.requestFilter(w))
        : [];
      const today = new Date().toISOString().slice(0, 10);
      const open = requests.filter((r) => ['SUBMITTED', 'ESCALATED'].includes(r.data.status));
      return {
        view,
        counts,
        requests: {
          overdue: open.filter((r) => r.data.dueDate < today).length,
          pending: open.length,
          escalated: open.filter((r) => r.data.status === 'ESCALATED').length,
        },
        ...(view === 'ceo' && w.actor.permissions.includes('finance.read')
          ? { finance: await this.finance.reportIn(w, today.slice(0, 7)) }
          : {}),
      };
    });
  }
}
