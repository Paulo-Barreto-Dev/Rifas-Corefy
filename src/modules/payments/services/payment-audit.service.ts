import { Prisma } from '@prisma/client'
import { prisma } from '@/shared/infra/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

export class PaymentAuditService {
  async log(
    tx: DbClient,
    data: {
      paymentId: string
      action: string
      before?: Prisma.InputJsonValue
      after?: Prisma.InputJsonValue
      metadata?: Prisma.InputJsonValue
    },
  ) {
    return tx.paymentAuditLog.create({ data })
  }
}
