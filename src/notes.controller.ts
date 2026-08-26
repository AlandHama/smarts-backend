import { Body, Controller, Get, Post } from "@nestjs/common"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"

import { CreateNoteDto } from "./create-note.dto"
import { PrismaService } from "./prisma.service"

@Controller("notes")
@ApiTags("notes")
export class NotesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "List recent notes" })
  @ApiResponse({ status: 200, description: "Returns up to 100 notes, newest first." })
  list() {
    return this.prisma.note.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  }

  @Post()
  @ApiOperation({ summary: "Create a note" })
  @ApiResponse({ status: 201, description: "The created note." })
  create(@Body() dto: CreateNoteDto) {
    return this.prisma.note.create({ data: { body: dto.body.trim() } })
  }
}
