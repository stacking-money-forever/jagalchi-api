import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseExactOrigins } from './shared/config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const production = config.get<string>('NODE_ENV') === 'production';
  const origins = parseExactOrigins(config.getOrThrow<string>('CORS_ORIGINS'), production);
  const trustProxyHops = Number(config.get<string>('TRUST_PROXY_HOPS', '0'));

  app.set('trust proxy', trustProxyHops);
  app.use(
    '/api/github/webhooks',
    express.raw({
      type: 'application/json',
      limit: '256kb',
      verify: (request, _response, body) => {
        (request as { rawBody?: Buffer }).rawBody = body;
      },
    }),
  );
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '32kb', parameterLimit: 100 });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Jagalchi API')
      .setDescription('Jagalchi modular API contract')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(config.get<number>('PORT', 8080), '0.0.0.0');
}

void bootstrap();
