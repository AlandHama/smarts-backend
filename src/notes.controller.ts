import { Body, Controller, Get, Post } from "@nestjs/common"

import { CreateNoteDto } from "./create-note.dto"
import { PrismaService } from "./prisma.service"

@Controller("notes")
export class NotesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.note.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  }

  @Post()
  create(@Body() dto: CreateNoteDto) {
    return this.prisma.note.create({ data: { body: dto.body.trim() } })
  }
}
