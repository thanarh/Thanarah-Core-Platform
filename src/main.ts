import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { Logger } from 'nestjs-pino';
import { join } from 'path';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { APP_CONSTANTS } from './common/constants/app.constants';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ logger: false });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);

  app.setGlobalPrefix(APP_CONSTANTS.apiPrefix, {
    exclude: ['health'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/',
    decorateReply: false,
  });

  app.enableCors({
    origin: config.isProduction ? false : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', APP_CONSTANTS.headers.requestId],
    exposedHeaders: [APP_CONSTANTS.headers.requestId],
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle(APP_CONSTANTS.swagger.title)
    .setDescription(APP_CONSTANTS.swagger.description)
    .setVersion(APP_CONSTANTS.swagger.version)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(APP_CONSTANTS.swagger.path, app, document);

  app.enableShutdownHooks();

  const port = config.port;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on port ${port} [${config.nodeEnv}]`);
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal: application failed to start', error);
  process.exit(1);
});
