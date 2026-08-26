import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

export abstract class PrismaTransaction<TInput, TResult> {
  constructor(protected readonly prisma: PrismaService) {}

  run(input: TInput): Promise<TResult> {
    return this.prisma.$transaction((transaction) => this.execute(input, transaction))
  }

  runWithinTransaction(input: TInput, transaction: Prisma.TransactionClient): Promise<TResult> {
    return this.execute(input, transaction)
  }

  protected abstract execute(input: TInput, transaction: Prisma.TransactionClient): Promise<TResult>
}
