import "reflect-metadata"

import { ValidationPipe } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"

import { AppModule } from "./app.module"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // whitelist strips properties the DTO does not declare, so a request cannot
  // smuggle extra fields into a create call.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  // Finish in-flight requests when the container is replaced instead of dropping them.
  app.enableShutdownHooks()

  await app.listen(Number(process.env.PORT ?? 8080), "0.0.0.0")
}

bootstrap()
