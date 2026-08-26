import "reflect-metadata"

import { ValidationPipe } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"

import { AppModule } from "./app.module"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Smarts NestJs Backend API")
    .setDescription("API documentation for the NestJS Smarts")
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "access-token")
    .build()
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup("docs", app, swaggerDocument, {
    jsonDocumentUrl: "docs-json",
  })

  // whitelist strips properties the DTO does not declare, so a request cannot
  // smuggle extra fields into a create call.
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }))

  // Finish in-flight requests when the container is replaced instead of dropping them.
  app.enableShutdownHooks()

  await app.listen(Number(process.env.PORT ?? 8080), "0.0.0.0")
}

bootstrap()
