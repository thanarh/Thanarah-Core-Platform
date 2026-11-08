import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type UiEvent = {
  target: {
    closest: (selector: string) => { dataset: Record<string, string> } | null;
  };
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type UiHarness = {
  app: { innerHTML: string };
  click: (action: string, index?: number) => unknown;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createUiHarness(file: string, api: Record<string, unknown>): UiHarness {
  const app = { innerHTML: '' };
  const toastRegion = { appendChild: (): void => undefined };
  const listeners = new Map<string, (event: UiEvent) => unknown>();
  const document = {
    addEventListener: (type: string, listener: (event: UiEvent) => unknown): void => {
      listeners.set(type, listener);
    },
    getElementById: (id: string): unknown => (id === 'toast-region' ? toastRegion : app),
  };
  const window = {
    ThanarahApi: api,
    confirm: (): boolean => true,
    setTimeout: (): number => 0,
  };
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  runInNewContext(source, {
    document,
    window,
    console,
    FormData: class FormData {},
    HTMLFormElement: class HTMLFormElement {},
    confirm: () => true,
  });

  return {
    app,
    click: (action: string, index?: number): unknown => {
      const listener = listeners.get('click');
      if (!listener) throw new Error(`The ${file} page did not register a click handler.`);
      const button = {
        dataset: { action, ...(index === undefined ? {} : { index: String(index) }) },
      };
      return listener({ target: { closest: () => button } });
    },
  };
}

async function waitForText(app: { innerHTML: string }, text: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (app.innerHTML.includes(text)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
  throw new Error(`Timed out waiting for UI text: ${text}`);
}

const workspaces = [
  {
    tenantId: 'tenant-a',
    slug: 'workspace-a',
    displayName: 'Workspace A',
    permissionCodes: [] as string[],
  },
  {
    tenantId: 'tenant-b',
    slug: 'workspace-b',
    displayName: 'Workspace B',
    permissionCodes: [] as string[],
  },
];

async function expectLateTenantResponseIsIgnored(input: {
  file: string;
  switchAction: string;
  chooseAction: string;
  refreshAction: string;
  permission: string;
  listMethod: string;
  itemA: Record<string, unknown>;
  itemB: Record<string, unknown>;
  renderedA: string;
  renderedB: string;
  extraApi?: Record<string, unknown>;
}): Promise<void> {
  workspaces[0].permissionCodes = [input.permission];
  workspaces[1].permissionCodes = [input.permission];
  const refreshStarted = deferred<void>();
  const requestBStarted = deferred<void>();
  const responseA = deferred<{ items: Record<string, unknown>[] }>();
  const responseB = deferred<{ items: Record<string, unknown>[] }>();
  let callsToTenantA = 0;
  const api: Record<string, unknown> = {
    restoreSession: async () => true,
    listWorkspaces: async () => ({ items: workspaces }),
    [input.listMethod]: (tenantId: string) => {
      if (tenantId === 'tenant-a') {
        callsToTenantA += 1;
        if (callsToTenantA === 1) return Promise.resolve({ items: [input.itemA] });
        refreshStarted.resolve();
        return responseA.promise;
      }
      requestBStarted.resolve();
      return responseB.promise;
    },
    ...input.extraApi,
  };

  const { app, click } = createUiHarness(input.file, api);
  await waitForText(app, 'Workspace A');
  await click(input.chooseAction, 0);
  await waitForText(app, input.renderedA);
  const pendingWorkspaceA = click(input.refreshAction);
  await refreshStarted.promise;

  await click(input.switchAction);
  await waitForText(app, 'Workspace B');
  const pendingWorkspaceB = click(input.chooseAction, 1);
  await requestBStarted.promise;
  expect(app.innerHTML).toContain('Workspace B');
  expect(app.innerHTML).not.toContain(input.renderedA);

  responseA.resolve({ items: [input.itemA] });
  await pendingWorkspaceA;
  await new Promise((resolveWait) => setTimeout(resolveWait, 0));

  expect(app.innerHTML).toContain('Workspace B');
  expect(app.innerHTML).not.toContain(input.renderedA);
  responseB.resolve({ items: [input.itemB] });
  await pendingWorkspaceB;
  await waitForText(app, input.renderedB);

  expect(app.innerHTML).toContain('Workspace B');
  expect(app.innerHTML).toContain(input.renderedB);
  expect(app.innerHTML).not.toContain(input.renderedA);
}

describe('tenant setup workspace switching', () => {
  it('ignores an older team-directory response after switching workspaces', async () => {
    await expectLateTenantResponseIsIgnored({
      file: 'public/team-setup/app.js',
      switchAction: 'switch',
      chooseAction: 'choose',
      refreshAction: 'retry-directory',
      permission: 'tenant.members.read',
      listMethod: 'listTenantMemberships',
      itemA: {
        id: 'member-a',
        memberName: 'Member A',
        platformUserId: 'user-a',
        status: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
      itemB: {
        id: 'member-b',
        memberName: 'Member B',
        platformUserId: 'user-b',
        status: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
      renderedA: 'Member A',
      renderedB: 'Member B',
      extraApi: { listTenantMembershipRoles: async () => [] },
    });
  });

  it('ignores an older facility response after switching workspaces', async () => {
    await expectLateTenantResponseIsIgnored({
      file: 'public/clinic-setup/app.js',
      switchAction: 'switch-workspace',
      chooseAction: 'choose-workspace',
      refreshAction: 'retry-facility',
      permission: 'tenant.facilities.read',
      listMethod: 'listFacilities',
      itemA: { id: 'facility-a', name: 'Facility A', status: 'ACTIVE', createdAt: '2026-01-01' },
      itemB: { id: 'facility-b', name: 'Facility B', status: 'ACTIVE', createdAt: '2026-01-01' },
      renderedA: 'Facility A',
      renderedB: 'Facility B',
      extraApi: { listSetupBranches: async () => ({ items: [] }) },
    });
  });

  it('ignores an older catalog response after switching workspaces', async () => {
    await expectLateTenantResponseIsIgnored({
      file: 'public/catalog-setup/app.js',
      switchAction: 'switch',
      chooseAction: 'choose',
      refreshAction: 'retry',
      permission: 'tenant.departments.read',
      listMethod: 'listDepartments',
      itemA: { id: 'department-a', name: 'Department A', status: 'ACTIVE' },
      itemB: { id: 'department-b', name: 'Department B', status: 'ACTIVE' },
      renderedA: 'Department A',
      renderedB: 'Department B',
    });
  });

  it('ignores an older doctor response after switching workspaces', async () => {
    await expectLateTenantResponseIsIgnored({
      file: 'public/doctor-setup/app.js',
      switchAction: 'switch',
      chooseAction: 'choose',
      refreshAction: 'retry',
      permission: 'tenant.doctors.read',
      listMethod: 'listSetupDoctors',
      itemA: {
        id: 'doctor-a',
        professionalDisplayName: 'Doctor A',
        status: 'ACTIVE',
        departments: [],
        specialties: [],
      },
      itemB: {
        id: 'doctor-b',
        professionalDisplayName: 'Doctor B',
        status: 'ACTIVE',
        departments: [],
        specialties: [],
      },
      renderedA: 'Doctor A',
      renderedB: 'Doctor B',
    });
  });
});
