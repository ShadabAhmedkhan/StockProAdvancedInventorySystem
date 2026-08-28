import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { API_PREFIX, SWAGGER_PATH } from './common/constants/api.constants';
import { JsonLogger } from './common/logging/json-logger.service';
import { appConfig, type AppConfiguration } from './config/app.config';

async function bootstrap(): Promise<void> {
  // Logs are buffered until the validated configuration tells us which levels
  // to keep, then replayed by useLogger().
  // `rawBody: true` keeps the exact bytes of every request body on
  // `req.rawBody` alongside Nest's normal parsed `req.body` - the billing
  // webhook needs the untouched bytes to verify Stripe's signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get<AppConfiguration>(appConfig.KEY);

  // Structured (one JSON object per line) in production, so a log
  // aggregator can parse fields directly; Nest's own colourised console
  // format stays in development/test, where a human is reading it live.
  app.useLogger(config.isProduction ? new JsonLogger(config.logLevels) : config.logLevels);
  configureApp(app, config);

  if (config.swaggerEnabled) {
    setupSwagger(app);
  }

  app.enableShutdownHooks();
  await app.listen(config.port);

  const logger = new Logger('Bootstrap');
  logger.log(`Stock Pro API (${config.nodeEnv}) listening on http://localhost:${String(config.port)}/${API_PREFIX}`);
  if (config.swaggerEnabled) {
    logger.log(`Swagger UI available at http://localhost:${String(config.port)}/${SWAGGER_PATH}`);
  }
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error('Failed to start the Stock Pro API', error instanceof Error ? error.stack : undefined);
  process.exit(1);
});
