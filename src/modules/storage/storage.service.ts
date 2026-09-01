import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common"
import { PutObjectCommand, S3Client, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { FeedbackEntity, PlayerStorageValueType, PlayerStorageVisibility, Prisma, StoredFileStatus, StoredFileVisibility } from "@prisma/client"
import { createHash, randomUUID } from "node:crypto"
import { extname } from "node:path"

import { PrismaService } from "../../prisma.service"
import { CreateFeedbackDto, FeedbackQueryDto, PlayerStorageItemDto, SystemAdminStorageQueryDto, UpdateFeedbackDto, UploadFileDto } from "./dtos/storage.dto"
import type { UploadedImage } from "./types"
import { CreateFeedbackTransaction } from "./transactions/create-feedback-transaction"
import { UpdateFeedbackTransaction } from "./transactions/update-feedback-transaction"
import { UpdatePlayerStorageTransaction } from "./transactions/update-player-storage-transaction"
import { DeletePlayerStorageTransaction } from "./transactions/delete-player-storage-transaction"

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const ALLOWED_STORAGE_KEYS = new Set(["player_country", "profile_url", "profile_file_id", "last_seen"])
const ALLOWED_STAT_SUFFIXES = new Set(["games_played", "accuracy", "wins", "losses", "answering_speed", "total_correct", "total_questions", "total_time_ms"])

@Injectable()
export class StorageService {
  private client?: S3Client

  constructor(private readonly prisma: PrismaService, private readonly updatePlayerStorageTransaction: UpdatePlayerStorageTransaction, private readonly deletePlayerStorageTransaction: DeletePlayerStorageTransaction, private readonly createFeedbackTransaction: CreateFeedbackTransaction, private readonly updateFeedbackTransaction: UpdateFeedbackTransaction) {}

  async upload(file: UploadedImage | undefined, dto: UploadFileDto, userId?: string, actorId?: string) {
    if (!file?.buffer) throw new BadRequestException("A file is required")
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException("File must be 10 MB or smaller")
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) throw new BadRequestException("Only JPEG, PNG, WEBP, and GIF images are supported")

    const bucket = this.required("S3_BUCKET")
    const key = this.buildKey(dto.purpose, userId, file.originalname, file.mimetype)
    const checksum = createHash("sha256").update(file.buffer).digest("hex")
    const visibility = dto.visibility ?? StoredFileVisibility.PRIVATE
    try {
      await this.clientForStorage().send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.size,
        CacheControl: visibility === StoredFileVisibility.PUBLIC ? "public, max-age=31536000, immutable" : "private, no-cache",
        Metadata: { checksum, purpose: dto.purpose },
      }))
      const stored = await this.prisma.storedFile.create({ data: {
        userId,
        objectKey: key,
        originalName: file.originalname.slice(0, 255),
        contentType: file.mimetype,
        byteSize: BigInt(file.size),
        checksum,
        purpose: dto.purpose,
        visibility,
        metadata: actorId ? { actorId } : undefined,
      } })
      return this.serialize({ ...stored, url: visibility === StoredFileVisibility.PUBLIC ? this.publicUrl(key) : await this.downloadUrl(stored.id, userId, true) })
    } catch (error) {
      await this.deleteObject(key).catch(() => undefined)
      throw error
    }
  }

  async downloadUrl(fileId: string, userId?: string, allowAdmin = false) {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, status: StoredFileStatus.ACTIVE } })
    if (!file) throw new NotFoundException("File not found")
    if (!allowAdmin && file.userId !== userId) throw new NotFoundException("File not found")
    if (file.visibility === StoredFileVisibility.PUBLIC) return this.publicUrl(file.objectKey)
    return getSignedUrl(this.clientForStorage(), new GetObjectCommand({ Bucket: this.required("S3_BUCKET"), Key: file.objectKey }), { expiresIn: 900 })
  }

  async delete(fileId: string, userId?: string, allowAdmin = false) {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, status: StoredFileStatus.ACTIVE } })
    if (!file || (!allowAdmin && file.userId !== userId)) throw new NotFoundException("File not found")
    await this.deleteObject(file.objectKey)
    await this.prisma.storedFile.update({ where: { id: file.id }, data: { status: StoredFileStatus.DELETED, deletedAt: new Date() } })
    return { message: "File deleted" }
  }

  async updateStorage(userId: string, payload: PlayerStorageItemDto[]) {
    return this.updatePlayerStorageTransaction.run({ userId, payload }).then((items) => ({ payload: items }))
  }

  deleteStorage(userId: string, key: string) {
    return this.deletePlayerStorageTransaction.run({ userId, key })
  }

  async listAdminStorage(query: SystemAdminStorageQueryDto) {
    const page = query.page || 1
    const limit = query.limit || 50
    const search = query.search?.trim()
    const userWhere: Prisma.UserWhereInput | undefined = search ? { OR: [
      { username: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { profile: { displayName: { contains: search, mode: "insensitive" } } },
    ] } : undefined
    const storageWhere: Prisma.PlayerStorageItemWhereInput = { ...(query.userId ? { userId: query.userId } : {}), ...(userWhere ? { user: userWhere } : {}), ...(search ? { OR: [{ key: { contains: search, mode: "insensitive" } }, { value: { contains: search, mode: "insensitive" } }, ...(userWhere ? [{ user: userWhere }] : [])] } : {}) }
    const fileWhere: Prisma.StoredFileWhereInput = { ...(query.userId ? { userId: query.userId } : {}), ...(userWhere ? { user: userWhere } : {}), ...(search ? { OR: [{ originalName: { contains: search, mode: "insensitive" } }, { purpose: { contains: search, mode: "insensitive" } }, ...(userWhere ? [{ user: userWhere }] : [])] } : {}) }
    const [storageTotal, fileTotal, storageItems, files] = await this.prisma.$transaction([
      this.prisma.playerStorageItem.count({ where: storageWhere }),
      this.prisma.storedFile.count({ where: fileWhere }),
      this.prisma.playerStorageItem.findMany({ where: storageWhere, orderBy: [{ updatedAt: "desc" }, { key: "asc" }], skip: (page - 1) * limit, take: limit, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } } } }),
      this.prisma.storedFile.findMany({ where: fileWhere, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } } } }),
    ])
    return this.serialize({ storageItems, files, pagination: { page, limit, storageTotal, fileTotal, storagePages: Math.ceil(storageTotal / limit), filePages: Math.ceil(fileTotal / limit) } })
  }

  getStorage(userId: string) {
    return this.prisma.playerStorageItem.findMany({ where: { userId }, orderBy: [{ displayOrder: "asc" }, { key: "asc" }], take: 200 }).then((payload) => ({ payload }))
  }

  async lookupPublicStorage(playerIds: string[], keys: string[]) {
    for (const key of keys) this.assertAllowedKey(key)
    const items = await this.prisma.playerStorageItem.findMany({ where: { userId: { in: playerIds }, user: { status: "ACTIVE" }, key: { in: keys }, visibility: PlayerStorageVisibility.PUBLIC }, orderBy: [{ displayOrder: "asc" }, { key: "asc" }], take: Math.min(playerIds.length * keys.length, 1000) })
    return { storages: playerIds.map((playerId) => ({ playerId, payload: items.filter((item) => item.userId === playerId) })) }
  }

  async feedbackCategories(entity?: FeedbackEntity) {
    const normalized = entity ? String(entity).toUpperCase() as FeedbackEntity : undefined
    if (normalized && !Object.values(FeedbackEntity).includes(normalized)) throw new BadRequestException("Unknown feedback entity")
    return this.prisma.feedbackCategory.findMany({ where: { active: true, ...(normalized ? { entity: normalized } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 100 })
  }

  async createFeedback(userId: string, dto: CreateFeedbackDto) {
    return this.createFeedbackTransaction.run({ userId, dto })
  }

  async listFeedback(query: FeedbackQueryDto) {
    const where: Prisma.PlayerFeedbackWhereInput = { ...(query.entity ? { entity: query.entity } : {}), ...(query.status ? { status: query.status } : {}) }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.playerFeedback.count({ where }),
      this.prisma.playerFeedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit, include: { category: true, user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } } } }),
    ])
    return { items, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } }
  }

  async updateFeedback(id: string, dto: UpdateFeedbackDto, adminId: string) {
    return this.updateFeedbackTransaction.run({ id, dto, adminId })
  }

  private assertAllowedKey(key: string) {
    if (ALLOWED_STORAGE_KEYS.has(key)) return
    const suffix = key.split("_").slice(1).join("_")
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || !ALLOWED_STAT_SUFFIXES.has(suffix)) throw new BadRequestException(`Storage key "${key}" is not supported`)
  }

  private order(value: string | undefined, fallback: number) { const parsed = value ? Number(value) : fallback + 1; return Number.isInteger(parsed) && parsed > 0 && parsed <= 10000 ? parsed : fallback + 1 }
  private valueType(key: string) { return key === "profile_url" ? PlayerStorageValueType.URL : key === "last_seen" ? PlayerStorageValueType.DATE : PlayerStorageValueType.STRING }
  private buildKey(purpose: string, userId: string | undefined, originalName: string, contentType: string) { const extension = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "") || ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" } as Record<string, string>)[contentType] || ".bin"; return `${purpose}/${userId ?? "admin"}/${randomUUID()}${extension}` }
  private publicUrl(key: string) { const base = (process.env.S3_PUBLIC_BASE_URL ?? `${this.required("S3_ENDPOINT")}/${this.required("S3_BUCKET")}`).replace(/\/$/, ""); return `${base}/${key.split("/").map(encodeURIComponent).join("/")}` }
  private required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new ServiceUnavailableException(`${name} is not configured`); return value }
  private clientForStorage() { this.client ??= new S3Client({ endpoint: this.required("S3_ENDPOINT"), region: process.env.S3_REGION?.trim() || "auto", forcePathStyle: true, credentials: { accessKeyId: this.required("S3_ACCESS_KEY_ID"), secretAccessKey: this.required("S3_SECRET_ACCESS_KEY") } }); return this.client }
  private async deleteObject(key: string) { await this.clientForStorage().send(new DeleteObjectCommand({ Bucket: this.required("S3_BUCKET"), Key: key })) }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
