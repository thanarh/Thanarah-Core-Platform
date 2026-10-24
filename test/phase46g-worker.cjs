const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { EncounterService } = require('../dist/tenant/encounter.service');
const { PlatformAuditService } = require('../dist/platform-security/platform-audit.service');

async function main() {
  const boundary = process.env.PHASE46G_BOUNDARY;
  const action = process.env.PHASE46G_ACTION || 'mutate';
  const encounterId = process.env.PHASE46G_ENCOUNTER_ID;
  const context = JSON.parse(process.env.PHASE46G_CONTEXT);
  const actor = JSON.parse(process.env.PHASE46G_ACTOR);
  const idempotencyKey = process.env.PHASE46G_IDEMPOTENCY_KEY;
  const input = JSON.parse(process.env.PHASE46G_INPUT);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const service = app.get(EncounterService);
  if (action === 'recover') {
    const result = await service.reconcileAudit(context, 25);
    if (process.send) process.send({ type: 'phase46g-recovery-result', result });
    await app.close();
    return;
  }

  if (action === 'ack-loss') {
    const prepareOperation = service.prepareOperation.bind(service);
    service.prepareOperation = async (...args) => {
      await prepareOperation(...args);
      if (process.send) process.send({ type: 'phase46g-marker-persisted' });
      await new Promise((resolve) => {
        process.once('message', (message) => {
          if (message && message.type === 'phase46g-continue-mutation') resolve();
        });
      });
    };
    try {
      const result = await service.updateClinical(context, encounterId, input, actor, {
        idempotencyKey,
      });
      if (process.send) process.send({ type: 'phase46g-mutation-result', result });
    } catch (error) {
      if (process.send) {
        process.send({
          type: 'phase46g-mutation-error',
          name: error && error.constructor ? error.constructor.name : 'Error',
          message: String(error && error.message ? error.message : error),
        });
      }
    } finally {
      await app.close();
    }
    return;
  }

  const blockAtBoundary = async () =>
    new Promise(() => {
      if (process.send) process.send({ type: 'phase46g-boundary-reached', boundary });
    });

  if (boundary === 'after-marker') {
    const prepareOperation = service.prepareOperation.bind(service);
    service.prepareOperation = async (...args) => {
      await prepareOperation(...args);
      await blockAtBoundary();
    };
  } else if (boundary === 'after-mongo') {
    const update = service.encounters.update.bind(service.encounters);
    service.encounters.update = async (...args) => {
      const result = await update(...args);
      await blockAtBoundary();
      return result;
    };
  } else if (boundary === 'after-audit') {
    const audit = app.get(PlatformAuditService);
    const recordAudit = audit.recordAudit.bind(audit);
    audit.recordAudit = async (...args) => {
      const result = await recordAudit(...args);
      await blockAtBoundary();
      return result;
    };
  } else {
    throw new Error(`Unknown Phase 46G boundary: ${boundary}`);
  }

  await service.updateClinical(context, encounterId, input, actor, { idempotencyKey });
  throw new Error('Worker mutation completed without reaching the configured crash boundary');
}

main().catch((error) => {
  if (process.send) process.send({ type: 'phase46g-worker-error', message: String(error) });
  process.exit(1);
});
