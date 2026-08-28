import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_PREFIX, REQUEST_ID_HEADER, SWAGGER_PATH } from './common/constants/api.constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import type { AppConfiguration } from './config/app.config';
import { serialiseDecimalsAsFixedStrings } from './prisma/decimal-json';

const CORS_MAX_AGE_SECONDS = 86_400;

/**
 * No endpoint accepts file uploads today, so every legitimate request body is
 * a small JSON document (the largest is an order with many line items). 1mb
 * is generous for that and small enough that a client cannot tie up a worker
 * buffering an oversized body - an explicit, reviewed limit rather than
 * whatever `express.json()`'s own default happens to be.
 */
const BODY_SIZE_LIMIT = '1mb';

/**
 * Swagger UI is the only HTML this API serves and it ships an inline
 * bootstrap script, so the docs build relaxes `script-src`. Every other
 * deployment keeps helmet's stricter defaults.
 */
function securityHeaders(swaggerEnabled: boolean): ReturnType<typeof helmet> {
  if (!swaggerEnabled) {
    return helmet();
  }

  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
      },
    },
  });
}

/**
 * Applies every cross-cutting concern to a Nest application instance.
 *
 * Shared by `main.ts` and the end-to-end tests so both exercise an identically
 * configured app - a test must never pass against a different pipeline than
 * the one that runs in production.
 */
export function configureApp(app: INestApplication, config: AppConfiguration): void {
  serialiseDecimalsAsFixedStrings();

  // Replaces Nest's default-configured body parsers with explicitly
  // size-limited ones. `req.rawBody` (needed by the Stripe webhook signature
  // check) keeps populating because `rawBody: true` was passed to
  // `NestFactory.create` - that app-level option is what these parsers honor.
  const expressApp = app as NestExpressApplication;
  expressApp.useBodyParser('json', { limit: BODY_SIZE_LIMIT });
  expressApp.useBodyParser('urlencoded', { limit: BODY_SIZE_LIMIT, extended: true });

  // First in the chain: everything downstream reads req.requestId.
  app.use(requestIdMiddleware);
  app.use(securityHeaders(config.swaggerEnabled));
  // The refresh token travels as an httpOnly cookie, so req.cookies must be
  // populated before any route handler runs.
  app.use(cookieParser());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: CORS_MAX_AGE_SECONDS,
  });

  app.setGlobalPrefix(API_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Conversion stays explicit via @Type(); implicit coercion silently
      // turns malformed input into plausible-looking values.
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(!config.isProduction));
}

/** Mounts Swagger UI and the OpenAPI JSON document at `/api/docs`. */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Stock Pro API')
      .setDescription('Inventory, sales, repair, supplier, customer, return and finance management API.')
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .build(),
  );

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    customSiteTitle: 'Stock Pro API Docs',
    swaggerOptions: { persistAuthorization: true },
  });
}
