import { createHash } from "node:crypto"

import { BadRequestException, ConflictException, ExecutionContext, Injectable, NestInterceptor, ForbiddenException, CallHandler } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Observable, of, tap } from "rxjs"

import { PrismaService } from "../../prisma.service"

/**
 * Makes mobile Control Center writes safe to retry without changing the
 * existing browser admin contract. The mobile API client identifies itself
 * with x-client-platform=mobile and supplies Idempotency-Key; browser writes
 * continue to use their existing service-level behavior.
 */
@Injectable()
export class MobileAdminIdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<any>()
    const method = String(request.method ?? "GET").toUpperCase()
    const path = String(request.originalUrl ?? request.url ?? "")
    const isAdminApi = path.startsWith("/system-admin/api/")
    const isMobile = String(request.headers?.["x-client-platform"] ?? "").toLowerCase() === "mobile"
    const isRead = ["GET", "HEAD", "OPTIONS"].includes(method)

    if (!isAdminApi || !isMobile || isRead || path.includes("/auth/")) return next.handle()

    const key = String(request.headers?.["idempotency-key"] ?? "").trim()
    if (key.length < 16 || key.length > 128) {
      throw new BadRequestException("A valid Idempotency-Key is required for mobile administrator writes")
    }
    const actorId = String(request.user?.id ?? "").trim()
    if (!actorId) throw new ForbiddenException("Administrator identity is required")

    const scope = `system-admin-mobile:${actorId}`
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ method, path, body: request.body ?? null }))
      .digest("hex")

    let record = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } })
    if (record) {
      if (record.requestHash !== requestHash) {
        throw new ConflictException("The idempotency key was already used for a different administrator action")
      }
      if (record.status === "COMPLETED") return of(record.responseJson)
      if (record.status === "PROCESSING") throw new ConflictException("This administrator action is already being processed")
      record = await this.prisma.idempotencyKey.update({ where: { id: record.id }, data: { status: "PROCESSING", responseJson: Prisma.JsonNull } })
    } else {
      try {
        record = await this.prisma.idempotencyKey.create({ data: { userId: actorId, scope, key, requestHash, status: "PROCESSING" } })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
        const concurrent = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { scope_key: { scope, key } } })
        if (concurrent.requestHash !== requestHash || concurrent.status === "PROCESSING") throw new ConflictException("This administrator action is already being processed")
        if (concurrent.status === "COMPLETED") return of(concurrent.responseJson)
        record = await this.prisma.idempotencyKey.update({ where: { id: concurrent.id }, data: { status: "PROCESSING", responseJson: Prisma.JsonNull } })
      }
    }

    const idempotencyId = record.id
    return next.handle().pipe(
      tap({
        next: (response) => {
          void this.prisma.idempotencyKey.update({
            where: { id: idempotencyId },
            data: { status: "COMPLETED", responseJson: this.jsonValue(response), completedAt: new Date() },
          })
        },
        error: () => {
          void this.prisma.idempotencyKey.update({ where: { id: idempotencyId }, data: { status: "FAILED", completedAt: null } })
        },
      }),
    )
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    if (value === undefined) return { status: "COMPLETED" }
    try {
      return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue
    } catch {
      return { status: "COMPLETED" }
    }
  }
}
