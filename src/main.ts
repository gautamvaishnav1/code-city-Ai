import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
   app.useGlobalPipes(new ValidationPipe({
    whitelist: true,          // Automatically strips out properties that are NOT in the DTO
    forbidNonWhitelisted: true, // Throws an error if the user sends extra fields
    transform: true,          // Automatically transforms payloads to DTO objects
  }));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
