import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { corsPolicyFor } from '../src/config/cors.policy';

describe('CORS environment policy', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it.each(['staging', 'production'])(
    'does not reflect arbitrary credentialed origins in %s',
    async (nodeEnv) => {
      const module = await Test.createTestingModule({}).compile();
      app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      app
        .getHttpAdapter()
        .getInstance()
        .get('/not-exposed', async () => ({ ok: true }));
      app.enableCors(corsPolicyFor(nodeEnv));
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const response = await app.inject({
        method: 'GET',
        url: '/not-exposed',
        headers: {
          origin: 'https://untrusted.example',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    },
  );

  it('keeps permissive credentialed CORS limited to local development', () => {
    expect(corsPolicyFor('development')).toMatchObject({
      origin: true,
      credentials: true,
    });
    expect(corsPolicyFor('staging').origin).toBe(false);
    expect(corsPolicyFor('production').origin).toBe(false);
  });
});
