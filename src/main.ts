import "reflect-metadata"
import { join } from "node:path"

import { ValidationPipe } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { WsAdapter } from "@nestjs/platform-ws"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import express from "express"

import { AppModule } from "./app.module"

async function bootstrap() {
  // Keep the default JSON limit for the API, but allow the system-admin
  // question importer to receive a reasonably sized questions file. The
  // importer sends the parsed JSON array in one request, so the limit must be
  // applied before Nest's route handlers run.
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.useWebSocketAdapter(new WsAdapter(app))
  app.use("/system-admin/api/game-content/import", express.json({ limit: "2mb" }))
  app.use(express.json())

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

  // The system-admin-web project is exported during the application build and
  // served by the same Railway process under the stable /system-admin path.
  const adminWebRoot = join(process.cwd(), "system-admin-web", "out")
  app.use("/system-admin", express.static(adminWebRoot, { extensions: ["html"] }))
  // The admin console is a static export, but its client-side pages still use
  // real browser paths. Serve the shell for those paths so refresh/deep links
  // such as /system-admin/matches/<uuid>/ continue to work on Railway.
  app.getHttpAdapter().getInstance().get(/^\/system-admin\/(?!api(?:\/|$)).*/, (_request: unknown, response: any) => {
    response.sendFile(join(adminWebRoot, "index.html"))
  })

  await app.listen(Number(process.env.PORT ?? 8080), "0.0.0.0")
}

bootstrap()
