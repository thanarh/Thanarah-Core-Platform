import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function harness(): Promise<{
  app: { innerHTML: string };
  api: {
    listPlatformSubscriptions: ReturnType<typeof vi.fn>;
    createPlatformSubscription: ReturnType<typeof vi.fn>;
    changePlatformSubscriptionStatus: ReturnType<typeof vi.fn>;
  };
  submit: () => Promise<void>;
  suspend: () => Promise<void>;
}> {
  const app = { innerHTML: '' };
  const listeners = new Map<string, (event: unknown) => Promise<void>>();
  const api = {
    restoreSession: async (): Promise<boolean> => true,
    listPlatformPlans: vi.fn().mockResolvedValue({ items: [] }),
    listPlatformFeatures: async (): Promise<{ items: unknown[] }> => ({ items: [] }),
    listPlatformSubscriptions: vi.fn().mockResolvedValue({ items: [] }),
    listPlatformTenants: async (): Promise<{ items: unknown[] }> => ({ items: [] }),
    getPlatformSubscriptionPaymentSettings: async (): Promise<null> => null,
    listPlatformSubscriptionTransfers: async (): Promise<{ items: unknown[] }> => ({ items: [] }),
    createPlatformSubscription: vi.fn().mockResolvedValue({ id: 'subscription-test' }),
    changePlatformSubscriptionStatus: vi.fn().mockResolvedValue({ status: 'SUSPENDED' }),
  };
  class Form {
    dataset = { form: 'subscription' };
  }
  class FormData {
    get(key: string): string | undefined {
      return {
        tenantId: 'tenant-test',
        planId: 'plan-test',
        startsAt: '2026-11-01T12:00',
      }[key];
    }
  }
  runInNewContext(readFileSync('public/platform-saas/app.js', 'utf8'), {
    document: {
      getElementById: (): typeof app => app,
      addEventListener: (event: string, listener: (event: unknown) => Promise<void>): void => {
        listeners.set(event, listener);
      },
    },
    window: { ThanarahApi: api, confirm: () => true, addEventListener: (): void => {} },
    HTMLFormElement: Form,
    FormData,
  });
  await vi.waitFor(() => expect(app.innerHTML).toContain('إسناد اشتراك'));
  return {
    app,
    api,
    submit: (): Promise<void> =>
      listeners.get('submit')!({ target: new Form(), preventDefault: () => {} }),
    suspend: (): Promise<void> =>
      listeners.get('click')!({
        target: {
          closest: () => ({
            dataset: { action: 'subscription', id: 'subscription-test', status: 'suspend' },
          }),
        },
      }),
  };
}

describe('Platform subscription mutation completion', () => {
  it('shows assignment success only after the refreshed subscription is rendered', async () => {
    const ui = await harness();
    const refresh = deferred<{ items: unknown[] }>();
    ui.api.listPlatformSubscriptions.mockReturnValueOnce(refresh.promise);
    const submission = ui.submit();
    await vi.waitFor(() => expect(ui.api.listPlatformSubscriptions).toHaveBeenCalledTimes(2));
    expect(ui.app.innerHTML).not.toContain('تم حفظ التغيير.');
    await ui.submit();
    expect(ui.api.createPlatformSubscription).toHaveBeenCalledTimes(1);
    refresh.resolve({
      items: [
        {
          id: 'subscription-test',
          tenantId: 'tenant-test',
          planId: 'plan-test',
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          startsAt: '2026-11-01T12:00:00Z',
        },
      ],
    });
    await submission;
    expect(ui.app.innerHTML).toContain('تم حفظ التغيير.');
    expect(ui.app.innerHTML).toContain('data-status="suspend"');
  });

  it('does not claim assignment success when refreshing the server state fails', async () => {
    const ui = await harness();
    ui.api.listPlatformSubscriptions.mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    await ui.submit();
    expect(ui.app.innerHTML).toContain('Synthetic refresh failure');
    expect(ui.app.innerHTML).not.toContain('تم حفظ التغيير.');
  });

  it('does not show a previous success while the next status change is pending', async () => {
    const ui = await harness();
    await ui.submit();
    const mutation = deferred<{ status: string }>();
    ui.api.changePlatformSubscriptionStatus.mockReturnValueOnce(mutation.promise);
    const suspension = ui.suspend();
    expect(ui.app.innerHTML).not.toContain('تم حفظ التغيير.');
    await ui.suspend();
    expect(ui.api.changePlatformSubscriptionStatus).toHaveBeenCalledTimes(1);
    mutation.resolve({ status: 'SUSPENDED' });
    await suspension;
    expect(ui.app.innerHTML).toContain('تم تحديث الحالة.');
  });

  it('does not claim lifecycle success when refreshing the server state fails', async () => {
    const ui = await harness();
    ui.api.listPlatformSubscriptions.mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    await ui.suspend();
    expect(ui.app.innerHTML).toContain('Synthetic refresh failure');
    expect(ui.app.innerHTML).not.toContain('تم تحديث الحالة.');
  });

  it('clears an old success and allows retry after a rejected lifecycle mutation', async () => {
    const ui = await harness();
    await ui.submit();
    ui.api.changePlatformSubscriptionStatus.mockRejectedValueOnce(
      new Error('Synthetic suspension failure'),
    );
    await ui.suspend();
    expect(ui.app.innerHTML).toContain('Synthetic suspension failure');
    expect(ui.app.innerHTML).not.toContain('تم حفظ التغيير.');
    await ui.suspend();
    expect(ui.app.innerHTML).toContain('تم تحديث الحالة.');
    expect(ui.app.innerHTML).not.toContain('Synthetic suspension failure');
  });
});
