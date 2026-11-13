import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail } from '../internal-operations/operations.errors';
import { canonical } from '../internal-operations/operations.store';
import {
  catalogDataSchema,
  catalogSchema,
  accountSchema,
  adminActionSchema,
  command,
  documentSchema,
  orderSchema,
  orderStatus,
  reason,
  version,
  type Order,
} from './journey.model';
import { JourneyStore, collection, expectVersion, parse, stored } from './journey.store';
import { JourneyOrders } from './journey.orders';
import { JourneyAccess } from './journey.access';
import {
  platformPlanSchema,
  subscriptionSchema,
  tenantSchema,
} from '../platform-mongo/platform-mongo.models';
@Injectable()
export class JourneyAdmin {
  constructor(
    readonly store: JourneyStore,
    readonly orders: JourneyOrders,
    readonly access: JourneyAccess,
  ) {}
  async session(userId: string) {
    return this.store.company.read(userId, 'customers.read', async (w) => {
      const all = w.actor.permissions.includes('customers.manage_all');
      const employees = await this.store.company.all(w, 'employees', { 'data.status': 'ACTIVE' });
      const plans = await collection(w, 'platform_plans')
        .find({ status: 'ACTIVE' }, { session: w.session })
        .limit(500)
        .toArray();
      const tenants = all
        ? await collection(w, 'tenants')
            .find({ status: 'ACTIVE' }, { session: w.session })
            .limit(500)
            .toArray()
        : [];
      const subscriptions = all
        ? await collection(w, 'subscriptions')
            .find({ status: 'ACTIVE' }, { session: w.session })
            .limit(500)
            .toArray()
        : [];
      return {
        ...w.actor,
        employees: employees.map((e) => ({
          _id: e._id,
          data: {
            name: e.data.name,
            roleIds: e.data.roleIds,
            status: e.data.status,
          },
        })),
        plans: plans.map((x) => {
          const p = stored(platformPlanSchema, x);
          return { _id: p._id, key: p.key, name: p.name, status: p.status };
        }),
        tenants: tenants.map((x) => {
          const t = stored(tenantSchema, x);
          return {
            _id: t._id,
            legalName: t.legalName,
            displayName: t.displayName,
            status: t.status,
          };
        }),
        subscriptions: subscriptions.map((x) => stored(subscriptionSchema, x)),
      };
    });
  }
  async catalog(userId: string) {
    return this.store.company.read(userId, 'customers.catalog', (w) => this.store.catalog(w));
  }
  async saveCatalog(userId: string, input: unknown) {
    const data = parse(z.object({ ...command, version, data: catalogDataSchema }).strict(), input);
    return this.store.adminCommand(
      userId,
      data.operationId,
      'customer.catalog.save',
      data,
      'customers.catalog',
      async (w) => {
        const current = await this.store.catalog(w);
        expectVersion(current.version, data.version);
        if (canonical(current.draft.seller) !== canonical(data.data.seller))
          this.store.company.require(w.actor, 'finance.manage');
        for (const p of data.data.packages)
          if (p.planId) {
            const plan = await collection(w, 'platform_plans').findOne(
              { _id: p.planId },
              { session: w.session },
            );
            if (!plan || stored(platformPlanSchema, plan).status !== 'ACTIVE')
              fail('CUSTOMER_PLAN_UNAVAILABLE', 'اختر خطة منصة نشطة لكل باقة مربوطة.');
            await collection(w, 'platform_plans').updateOne(
              { _id: p.planId },
              { $inc: { referenceVersion: 1 } },
              { session: w.session },
            );
          }
        const result = catalogSchema.parse({
          ...current,
          draft: data.data,
          version: current.version + 1,
          updatedBy: userId,
          updatedAt: new Date(),
        });
        await collection(w, 'customer_settings').replaceOne({ _id: 'catalog' }, result, {
          session: w.session,
          upsert: true,
        });
        return {
          result,
          orderId: 'catalog',
          fromVersion: current.version,
          toVersion: result.version,
        };
      },
    );
  }
  async publish(userId: string, input: unknown) {
    const data = parse(z.object({ ...command, version, reason }).strict(), input);
    return this.store.adminCommand(
      userId,
      data.operationId,
      'customer.catalog.publish',
      data,
      'customers.catalog',
      async (w) => {
        const current = await this.store.catalog(w);
        expectVersion(current.version, data.version);
        if (canonical(current.live?.seller ?? null) !== canonical(current.draft.seller))
          this.store.company.require(w.actor, 'finance.post');
        if (!current.updatedBy || current.updatedBy === userId)
          fail(
            'CUSTOMER_INDEPENDENT_REVIEW_REQUIRED',
            'نشر الشروط والباقات يحتاج مراجعًا مختلفًا عن آخر محرر.',
          );
        if (current.draft.termsText.length < 20)
          fail('CUSTOMER_TERMS_UNCONFIGURED', 'أدخل شروط التسجيل والمراجعة قبل النشر.');
        const result = catalogSchema.parse({
          ...current,
          live: current.draft,
          liveVersion: current.version + 1,
          version: current.version + 1,
          publishedBy: userId,
          publishedAt: new Date(),
        });
        await collection(w, 'customer_settings').replaceOne({ _id: 'catalog' }, result, {
          session: w.session,
        });
        return {
          result,
          orderId: 'catalog',
          fromVersion: current.version,
          toVersion: result.version,
        };
      },
    );
  }
  async list(userId: string, input: unknown) {
    const data = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          status: orderStatus.optional(),
        })
        .strict(),
      input,
    );
    return this.store.company.read(userId, 'customers.read', async (w) => {
      const filter = { ...this.store.scope(w), ...(data.status ? { status: data.status } : {}) };
      const total = await collection(w, 'customer_orders').countDocuments(filter, {
        session: w.session,
      });
      const rows = await collection(w, 'customer_orders')
        .find(filter, { session: w.session })
        .sort({ updatedAt: -1, _id: 1 })
        .skip((data.page - 1) * 30)
        .limit(30)
        .toArray();
      return { items: rows.map((x) => stored(orderSchema, x)), total, page: data.page, limit: 30 };
    });
  }
  async get(userId: string, orderId: string) {
    return this.store.company.read(userId, 'customers.read', async (w) => {
      const order = await this.store.adminOrder(w, orderId);
      const account = stored(
        accountSchema,
        await collection(w, 'customer_accounts').findOne(
          { _id: order.customerId },
          { session: w.session },
        ),
      );
      return { ...(await this.orders.detail(w, order)), account };
    });
  }
  async action(userId: string, orderId: string, input: unknown): Promise<Order> {
    const data = parse(adminActionSchema, input);
    const permission =
      data.action === 'activate'
        ? 'customers.activate'
        : ['approve', 'reject', 'request_changes'].includes(data.action)
          ? 'customers.review'
          : 'customers.manage';
    return this.store.adminCommand(
      userId,
      data.operationId,
      `customer.admin.${data.action}`,
      { orderId, ...data },
      permission,
      async (w) => {
        const order = await this.store.adminOrder(w, orderId);
        expectVersion(order.version, data.version);
        const account = stored(
          accountSchema,
          await collection(w, 'customer_accounts').findOne(
            { _id: order.customerId },
            { session: w.session },
          ),
        );
        if (account.userId === userId)
          fail('CUSTOMER_INDEPENDENT_REVIEW_REQUIRED', 'لا يجوز إدارة أو اعتماد طلبك الشخصي.');
        let changes: Partial<Order> = { reason: data.reason };
        if (data.action === 'assign') {
          if (!w.actor.permissions.includes('customers.manage_all'))
            fail(
              'CUSTOMER_ASSIGNMENT_DENIED',
              'توزيع الطلبات يتطلب صلاحية إدارة جميع العملاء.',
              403,
            );
          if (!data.managerId || !order.open)
            fail('CUSTOMER_MANAGER_REQUIRED', 'اختر مدير حساب لطلب مفتوح.');
          const employee = await this.store.company.get(w, 'employees', data.managerId);
          if (employee.data.status !== 'ACTIVE' || !employee.data.userId)
            fail('CUSTOMER_MANAGER_UNAVAILABLE', 'اختر موظفًا نشطًا مرتبطًا بحساب دخول.');
          const manager = await this.store.company.context(w.db, employee.data.userId, w.session);
          if (!manager.permissions.includes('customers.manage'))
            fail('CUSTOMER_MANAGER_UNAVAILABLE', 'الموظف لا يملك صلاحية إدارة طلبات العملاء.');
          let clientId = order.clientId;
          if (!clientId) {
            const client = await this.store.company.insert(w, 'clients', {
              name: order.profile.legalName,
              contact: account.email,
              ownerId: employee._id,
              stage: 'QUALIFIED',
            });
            clientId = client._id;
          } else {
            const client = await this.store.company.get(w, 'clients', clientId);
            await this.store.company.save(w, client, { ...client.data, ownerId: employee._id });
          }
          changes = { ...changes, managerId: employee._id, clientId };
        } else if (data.action === 'request_changes' || data.action === 'reject') {
          if (!['SUBMITTED', 'APPROVED'].includes(order.status))
            fail('CUSTOMER_TRANSITION_INVALID', 'الطلب ليس في حالة تسمح بهذا القرار.');
          changes = {
            ...changes,
            status: data.action === 'reject' ? 'REJECTED' : 'CHANGES_REQUESTED',
            open: data.action !== 'reject',
            approvedBy: null,
          };
        } else if (data.action === 'approve') {
          if (order.status !== 'SUBMITTED' || !order.managerId)
            fail('CUSTOMER_REVIEW_NOT_READY', 'يلزم إرسال الطلب وتعيين مدير حساب أولًا.');
          const docs = await collection(w, 'customer_documents')
            .find({ orderId, superseded: false }, { session: w.session })
            .toArray();
          const checked = docs.map((x) => stored(documentSchema, x));
          if (
            order.requirements.some(
              (r) => r.required && !checked.some((d) => d.key === r.key && d.status === 'APPROVED'),
            ) ||
            checked.some((d) => d.status !== 'APPROVED' || !d.reviewedBy || !d.reviewedAt)
          )
            fail(
              'CUSTOMER_DOCUMENT_REVIEW_REQUIRED',
              'يلزم اعتماد الوثائق الحالية قبل اعتماد الطلب.',
            );
          if (canonical(account.profile) !== canonical(order.profile))
            fail('CUSTOMER_PROFILE_CHANGED', 'تغير ملف المنشأة؛ اطلب التعديل وإعادة الإرسال.');
          changes = { ...changes, status: 'APPROVED', approvedBy: userId };
        } else {
          if (order.status !== 'APPROVED' || !order.approvedBy)
            fail('CUSTOMER_REVIEW_NOT_READY', 'يلزم اعتماد الطلب أولًا.');
          if (
            account.phoneVerification.status !== 'VERIFIED' ||
            account.phoneVerification.phoneE164 !== order.profile.phoneE164 ||
            !account.phoneVerification.verifiedAt
          )
            fail(
              'CUSTOMER_PHONE_NOT_VERIFIED',
              'التفعيل متوقف: لم يكتمل تحقق WhatsApp للرقم الحالي.',
            );
          if (!account.profile || canonical(account.profile) !== canonical(order.profile))
            fail('CUSTOMER_PROFILE_CHANGED', 'تغير ملف المنشأة؛ أعد المراجعة.');
          if (!data.tenantId || !data.subscriptionId)
            fail(
              'CUSTOMER_ACTIVATION_LINKS_REQUIRED',
              'اختر حساب المنشأة والاشتراك المجهزين من المنصة.',
            );
          if (order.purpose === 'RENEWAL' && order.tenantId !== data.tenantId)
            fail('CUSTOMER_RENEWAL_TENANT_MISMATCH', 'التجديد يجب أن يبقى على حساب المنشأة نفسه.');
          const candidate = {
            ...order,
            tenantId: data.tenantId,
            subscriptionId: data.subscriptionId,
          };
          if (!(await this.access.available(w, account, candidate, true)))
            fail(
              'CUSTOMER_TENANT_NOT_READY',
              'تحقق من نشاط المنشأة والاشتراك والخطة وعضوية المالك وتخزينها الأساسي.',
            );
          const used = await collection(w, 'customer_orders').findOne(
            {
              _id: { $ne: orderId },
              subscriptionId: data.subscriptionId,
            },
            { session: w.session },
          );
          if (used)
            fail(
              'CUSTOMER_SUBSCRIPTION_ALREADY_DELIVERED',
              'الاشتراك مرتبط بطلب آخر؛ التجديد يحتاج فترة اشتراك مستقلة.',
            );
          changes = {
            ...changes,
            tenantId: data.tenantId,
            subscriptionId: data.subscriptionId,
            status: 'ACTIVE',
            activatedBy: userId,
          };
          if (order.clientId) {
            const client = await this.store.company.get(w, 'clients', order.clientId);
            await this.store.company.save(w, client, { ...client.data, stage: 'WON' });
          }
        }
        const result = await this.store.save(w, 'customer_orders', order, changes);
        return { result, orderId, fromVersion: order.version, toVersion: result.version };
      },
    );
  }
  async events(userId: string, input: unknown) {
    const data = parse(
      z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict(),
      input,
    );
    return this.store.company.read(userId, 'customers.read', async (w) => {
      const all = w.actor.permissions.includes('customers.manage_all');
      const ids = all
        ? null
        : await collection(w, 'customer_orders')
            .find(this.store.scope(w), { session: w.session, projection: { _id: 1 } })
            .toArray();
      const filter = ids ? { orderId: { $in: ids.map((x) => x._id) } } : {};
      const total = await collection(w, 'customer_events').countDocuments(filter, {
        session: w.session,
      });
      const items = await collection(w, 'customer_events')
        .find(filter, { session: w.session })
        .sort({ at: -1, _id: 1 })
        .skip((data.page - 1) * 50)
        .limit(50)
        .toArray();
      return { items, total, page: data.page, limit: 50 };
    });
  }
}
