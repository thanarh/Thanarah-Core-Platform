import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type BackupState = 'complete' | 'partial' | 'failed' | 'verified';

export interface BackupSource {
  kind: 'central-mysql' | 'tenant-mongodb';
  sourceIdentity: string;
  capturedAt: string;
  tenantId?: string;
  targetId?: string;
  connectionReference?: string;
  databaseName?: string;
  targetStatus?: string;
  isPrimary?: boolean;
  result: 'captured' | 'failed';
  failureCode?: string;
  bytes?: number;
  sha256?: string;
}

export interface RecoveryManifest {
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  completedAt: string;
  state: BackupState;
  verification: 'pending' | 'passed' | 'failed';
  consistency: 'cross-store-atomicity-not-guaranteed';
  encryption: 'AES-256-GCM';
  artifact: { filename: string; bytes: number; sha256: string };
  sources: BackupSource[];
  operatorOwner: string;
  verificationEvidence: string[];
  signature: string;
}

export interface CapturedSourceArtifact {
  source: BackupSource;
  payload: Buffer;
}

export interface CreateRecoveryArtifactOptions {
  rootDirectory: string;
  encryptionKey: Buffer;
  manifestSigningKey: Buffer;
  operatorOwner: string;
  central: CapturedSourceArtifact | { source: BackupSource; payload?: undefined };
  tenants: Array<CapturedSourceArtifact | { source: BackupSource; payload?: undefined }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

function assertKey(key: Buffer, name: string): void {
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes`);
}

function assertDisposableRoot(rootDirectory: string): string {
  if (!isAbsolute(rootDirectory)) throw new Error('Artifact root must be absolute');
  const root = resolve(rootDirectory);
  const rel = relative(resolve(tmpdir()), root);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new Error('Disposable artifacts must be stored in a dedicated temporary directory');
  }
  return root;
}

function signManifest(manifest: Omit<RecoveryManifest, 'signature'>, key: Buffer): string {
  return createHmac('sha256', key).update(JSON.stringify(manifest)).digest('hex');
}

function manifestFiles(root: string, id: string): { artifact: string; manifest: string } {
  if (!UUID.test(id)) throw new Error('Invalid backup identity');
  return {
    artifact: resolve(root, `${id}.backup.enc`),
    manifest: resolve(root, `${id}.manifest.json`),
  };
}

function ensureWithinRoot(root: string, filename: string): void {
  const rel = relative(root, filename);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Artifact path escapes its isolated root');
  }
}

export async function createRecoveryArtifact(
  options: CreateRecoveryArtifactOptions,
): Promise<{ backupId: string; manifest: RecoveryManifest }> {
  assertKey(options.encryptionKey, 'Encryption key');
  assertKey(options.manifestSigningKey, 'Manifest signing key');
  if (!options.operatorOwner.trim()) throw new Error('Operator owner is required');
  const root = assertDisposableRoot(options.rootDirectory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const backupId = randomUUID();
  const paths = manifestFiles(root, backupId);
  ensureWithinRoot(root, paths.artifact);
  ensureWithinRoot(root, paths.manifest);
  const sources = [options.central.source, ...options.tenants.map(({ source }) => source)];
  const centralCaptured =
    options.central.payload !== undefined && options.central.source.result === 'captured';
  const state: BackupState = !centralCaptured
    ? 'failed'
    : sources.some((source) => source.result !== 'captured')
      ? 'partial'
      : 'complete';

  const plain = Buffer.from(
    JSON.stringify({
      central: options.central.payload?.toString('base64') ?? null,
      tenants: options.tenants.map(({ source, payload }) => ({
        source,
        payload: payload?.toString('base64') ?? null,
      })),
    }),
  );
  if (plain.byteLength > MAX_ARTIFACT_BYTES)
    throw new Error('Recovery artifact exceeds size limit');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', options.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const encrypted = Buffer.concat([Buffer.from('THR1'), iv, cipher.getAuthTag(), ciphertext]);
  const temporaryArtifact = `${paths.artifact}.tmp`;
  await writeFile(temporaryArtifact, encrypted, { flag: 'wx', mode: 0o600 });
  await rename(temporaryArtifact, paths.artifact);

  const unsigned: Omit<RecoveryManifest, 'signature'> = {
    formatVersion: 1,
    backupId,
    createdAt: sources[0]?.capturedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    state,
    verification: 'pending',
    consistency: 'cross-store-atomicity-not-guaranteed',
    encryption: 'AES-256-GCM',
    artifact: {
      filename: `${backupId}.backup.enc`,
      bytes: encrypted.byteLength,
      sha256: createHash('sha256').update(encrypted).digest('hex'),
    },
    sources,
    operatorOwner: options.operatorOwner.trim(),
    verificationEvidence: [],
  };
  const manifest: RecoveryManifest = {
    ...unsigned,
    signature: signManifest(unsigned, options.manifestSigningKey),
  };
  const temporaryManifest = `${paths.manifest}.tmp`;
  await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temporaryManifest, paths.manifest);
  return { backupId, manifest };
}

export async function readVerifiedRecoveryArtifact(
  rootDirectory: string,
  backupId: string,
  encryptionKey: Buffer,
  manifestSigningKey: Buffer,
): Promise<{
  manifest: RecoveryManifest;
  payload: { central: Buffer; tenants: CapturedSourceArtifact[] };
}> {
  assertKey(encryptionKey, 'Encryption key');
  assertKey(manifestSigningKey, 'Manifest signing key');
  const root = assertDisposableRoot(rootDirectory);
  const paths = manifestFiles(root, backupId);
  ensureWithinRoot(root, paths.artifact);
  ensureWithinRoot(root, paths.manifest);
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8')) as RecoveryManifest;
  const { signature, ...unsigned } = manifest;
  const expectedSignature = signManifest(unsigned, manifestSigningKey);
  const actual = Buffer.from(signature, 'hex');
  const expected = Buffer.from(expectedSignature, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Recovery manifest integrity verification failed');
  }
  if (manifest.backupId !== backupId || !['complete', 'verified'].includes(manifest.state)) {
    throw new Error('Only complete recovery sets can be restored');
  }
  const encrypted = await readFile(paths.artifact);
  if (
    encrypted.byteLength !== manifest.artifact.bytes ||
    createHash('sha256').update(encrypted).digest('hex') !== manifest.artifact.sha256
  ) {
    throw new Error('Recovery artifact integrity verification failed');
  }
  if (encrypted.byteLength < 32 || encrypted.subarray(0, 4).toString() !== 'THR1') {
    throw new Error('Unsupported recovery artifact format');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, encrypted.subarray(4, 16));
  decipher.setAuthTag(encrypted.subarray(16, 32));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(32)), decipher.final()]);
  const decoded = JSON.parse(plain.toString('utf8')) as {
    central: string | null;
    tenants: Array<{ source: BackupSource; payload: string | null }>;
  };
  if (
    !decoded.central ||
    decoded.tenants.some(({ source, payload }) => source.result !== 'captured' || payload === null)
  ) {
    throw new Error('Recovery payload is incomplete');
  }
  return {
    manifest,
    payload: {
      central: Buffer.from(decoded.central, 'base64'),
      tenants: decoded.tenants.map(({ source, payload }) => ({
        source,
        payload: Buffer.from(payload!, 'base64'),
      })),
    },
  };
}

export async function recordRecoveryVerification(
  rootDirectory: string,
  backupId: string,
  manifestSigningKey: Buffer,
  passed: boolean,
  evidence: string[],
): Promise<RecoveryManifest> {
  assertKey(manifestSigningKey, 'Manifest signing key');
  if (evidence.length === 0 || evidence.some((entry) => !entry.trim() || entry.length > 160)) {
    throw new Error('Restoration verification evidence is required');
  }
  const root = assertDisposableRoot(rootDirectory);
  const paths = manifestFiles(root, backupId);
  ensureWithinRoot(root, paths.manifest);
  const existing = JSON.parse(await readFile(paths.manifest, 'utf8')) as RecoveryManifest;
  const { signature, ...unsignedExisting } = existing;
  const actual = Buffer.from(signature, 'hex');
  const expected = Buffer.from(signManifest(unsignedExisting, manifestSigningKey), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Recovery manifest integrity verification failed');
  }
  if (existing.state !== 'complete') throw new Error('Only complete backups can be verified');
  const unsigned: Omit<RecoveryManifest, 'signature'> = {
    ...unsignedExisting,
    state: passed ? 'verified' : 'failed',
    verification: passed ? 'passed' : 'failed',
    verificationEvidence: [...evidence],
    completedAt: new Date().toISOString(),
  };
  const manifest: RecoveryManifest = {
    ...unsigned,
    signature: signManifest(unsigned, manifestSigningKey),
  };
  const temporaryManifest = `${paths.manifest}.verify.tmp`;
  await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temporaryManifest, paths.manifest);
  return manifest;
}
