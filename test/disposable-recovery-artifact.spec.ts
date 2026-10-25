import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRecoveryArtifact,
  readVerifiedRecoveryArtifact,
  recordRecoveryVerification,
  type BackupSource,
} from '../src/recovery/disposable-recovery-artifact';

const roots: string[] = [];
const centralSource: BackupSource = {
  kind: 'central-mysql',
  sourceIdentity: 'mysql:disposable-platform',
  capturedAt: '2026-10-25T00:00:00.000Z',
  result: 'captured',
};
const tenantSource: BackupSource = {
  kind: 'tenant-mongodb',
  sourceIdentity: 'mongodb:disposable-tenant',
  capturedAt: '2026-10-25T00:00:01.000Z',
  tenantId: 'tenant-fixture',
  targetId: 'target-fixture',
  connectionReference: 'primary',
  databaseName: 'tenant_fixture',
  targetStatus: 'ACTIVE',
  isPrimary: true,
  result: 'captured',
};

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'thanarah-recovery-unit-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('disposable recovery artifacts', () => {
  it('encrypts the payload, signs the manifest, and records verified restore evidence', async () => {
    const rootDirectory = await createRoot();
    const encryptionKey = randomBytes(32);
    const manifestSigningKey = randomBytes(32);
    const clinicalMarker = Buffer.from('synthetic-clinical-payload');
    const created = await createRecoveryArtifact({
      rootDirectory,
      encryptionKey,
      manifestSigningKey,
      operatorOwner: 'unit-test-operator',
      central: { source: centralSource, payload: Buffer.from('mysql backup') },
      tenants: [{ source: tenantSource, payload: clinicalMarker }],
    });
    const manifestJson = await readFile(
      join(rootDirectory, `${created.backupId}.manifest.json`),
      'utf8',
    );
    const encryptedBytes = await readFile(join(rootDirectory, `${created.backupId}.backup.enc`));

    expect(created.manifest.state).toBe('complete');
    expect(manifestJson).not.toContain(clinicalMarker.toString());
    expect(encryptedBytes.includes(clinicalMarker)).toBe(false);
    await expect(
      readVerifiedRecoveryArtifact(
        rootDirectory,
        created.backupId,
        encryptionKey,
        manifestSigningKey,
      ),
    ).resolves.toMatchObject({
      payload: { central: Buffer.from('mysql backup'), tenants: [{ payload: clinicalMarker }] },
    });

    const verified = await recordRecoveryVerification(
      rootDirectory,
      created.backupId,
      manifestSigningKey,
      true,
      ['restored records and indexes match'],
    );
    expect(verified.state).toBe('verified');
    expect(verified.verification).toBe('passed');
  });

  it('marks incomplete source coverage partial and refuses to restore it', async () => {
    const rootDirectory = await createRoot();
    const encryptionKey = randomBytes(32);
    const manifestSigningKey = randomBytes(32);
    const created = await createRecoveryArtifact({
      rootDirectory,
      encryptionKey,
      manifestSigningKey,
      operatorOwner: 'unit-test-operator',
      central: { source: centralSource, payload: Buffer.from('central') },
      tenants: [
        { source: tenantSource, payload: Buffer.from('tenant') },
        {
          source: {
            ...tenantSource,
            targetId: 'failed-target',
            result: 'failed',
            failureCode: 'SOURCE_UNAVAILABLE',
          },
        },
      ],
    });

    expect(created.manifest.state).toBe('partial');
    await expect(
      readVerifiedRecoveryArtifact(
        rootDirectory,
        created.backupId,
        encryptionKey,
        manifestSigningKey,
      ),
    ).rejects.toThrow('Only complete recovery sets can be restored');
  });

  it('records failed restore verification as failed rather than verified', async () => {
    const rootDirectory = await createRoot();
    const manifestSigningKey = randomBytes(32);
    const created = await createRecoveryArtifact({
      rootDirectory,
      encryptionKey: randomBytes(32),
      manifestSigningKey,
      operatorOwner: 'unit-test-operator',
      central: { source: centralSource, payload: Buffer.from('central') },
      tenants: [{ source: tenantSource, payload: Buffer.from('tenant') }],
    });
    const result = await recordRecoveryVerification(
      rootDirectory,
      created.backupId,
      manifestSigningKey,
      false,
      ['restored index verification failed'],
    );

    expect(result.state).toBe('failed');
    expect(result.verification).toBe('failed');
  });

  it('rejects path traversal identities and artifact roots outside the disposable temp area', async () => {
    const rootDirectory = await createRoot();
    await expect(
      readVerifiedRecoveryArtifact(rootDirectory, '../outside', randomBytes(32), randomBytes(32)),
    ).rejects.toThrow('Invalid backup identity');
    await expect(
      createRecoveryArtifact({
        rootDirectory: process.cwd(),
        encryptionKey: randomBytes(32),
        manifestSigningKey: randomBytes(32),
        operatorOwner: 'unit-test-operator',
        central: { source: centralSource, payload: Buffer.from('central') },
        tenants: [],
      }),
    ).rejects.toThrow('Disposable artifacts must be stored in a dedicated temporary directory');
  });
});
