import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { CreateFeedbackDto, PublicStorageLookupDto, UpdatePlayerStorageDto, UploadFileDto } from "./dtos/storage.dto"
import { StorageService } from "./storage.service"
import type { UploadedImage } from "./types"

@ApiTags("Storage and feedback")
@ApiBearerAuth("access-token")
@Controller()
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get("players/me/storage")
  getStorage(@CurrentUser() user: UserResponseDto) { return this.storage.getStorage(user.id) }

  @Post("players/me/storage")
  updateStorage(@CurrentUser() user: UserResponseDto, @Body() dto: UpdatePlayerStorageDto) { return this.storage.updateStorage(user.id, dto.payload) }

  @Post("players/storage/lookup")
  lookupPublicStorage(@Body() dto: PublicStorageLookupDto) { return this.storage.lookupPublicStorage(dto.playerIds, dto.keys) }

  @Post("storage/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" }, purpose: { type: "string" }, visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"] } }, required: ["file", "purpose"] } })
  upload(@UploadedFile() file: UploadedImage, @Body() dto: UploadFileDto, @CurrentUser() user: UserResponseDto) { return this.storage.upload(file, dto, user.id) }

  @Post("players/me/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" }, purpose: { type: "string" }, visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"] } }, required: ["file", "purpose"] } })
  uploadPlayerFile(@UploadedFile() file: UploadedImage, @Body() dto: UploadFileDto, @CurrentUser() user: UserResponseDto) { return this.storage.upload(file, dto, user.id) }

  @Get("storage/files/:fileId")
  getFileUrl(@Param("fileId", ParseUUIDPipe) fileId: string, @CurrentUser() user: UserResponseDto) { return this.storage.downloadUrl(fileId, user.id) .then((url) => ({ url })) }

  @Delete("storage/files/:fileId")
  deleteFile(@Param("fileId", ParseUUIDPipe) fileId: string, @CurrentUser() user: UserResponseDto) { return this.storage.delete(fileId, user.id) }

  @Delete("players/me/files/:fileId")
  deletePlayerFile(@Param("fileId", ParseUUIDPipe) fileId: string, @CurrentUser() user: UserResponseDto) { return this.storage.delete(fileId, user.id) }

  @Get("feedback/categories")
  categories(@Query("entity") entity?: string) { return this.storage.feedbackCategories(entity as any) }

  @Get("feedback/categories/:entity")
  categoriesForEntity(@Param("entity") entity: string) { return this.storage.feedbackCategories(entity as any) }

  @Post("feedback")
  createFeedback(@CurrentUser() user: UserResponseDto, @Body() dto: CreateFeedbackDto) { return this.storage.createFeedback(user.id, dto) }
}
