import { FinancialTransactionType, Prisma } from '@prisma/client'
import { prisma } from '@/shared/infra/prisma'

const DEFAULT_COMMISSION_KEY = 'raffle_commission'
const DEFAULT_COMMISSION_BPS = 500

export interface SaleBreakdown {
  grossCents: number
  platformFeeCents: number
  creatorEarningCents: number
  commissionBasisPoints: number
}

export class FinancialTransactionService {
  async getBalance(
    userId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const result = await client.financialTransaction.aggregate({
      where: { userId },
      _sum: { amountCents: true },
    })

    return result._sum.amountCents ?? 0
  }

  async calculateSaleBreakdown(
    grossCents: number,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<SaleBreakdown> {
    const fee = await client.platformFee.findFirst({
      where: { key: DEFAULT_COMMISSION_KEY, isActive: true },
    })

    const commissionBasisPoints = fee?.basisPoints ?? DEFAULT_COMMISSION_BPS
    const platformFeeCents = Math.round(grossCents * (commissionBasisPoints / 10_000))
    const creatorEarningCents = grossCents - platformFeeCents

    return {
      grossCents,
      platformFeeCents,
      creatorEarningCents,
      commissionBasisPoints,
    }
  }

  async recordApprovedSale(
    tx: Prisma.TransactionClient,
    params: {
      paymentId: string
      raffleId: string
      creatorId: string
      amountCents: number
    },
  ): Promise<SaleBreakdown> {
    const existing = await tx.financialTransaction.count({
      where: {
        userId: params.creatorId,
        referenceId: params.paymentId,
        type: FinancialTransactionType.PAYMENT_RECEIVED,
      },
    })

    if (existing > 0) {
      return this.calculateSaleBreakdown(params.amountCents, tx)
    }

    const breakdown = await this.calculateSaleBreakdown(params.amountCents, tx)

    await tx.financialTransaction.createMany({
      data: [
        {
          userId: params.creatorId,
          referenceId: params.paymentId,
          paymentId: params.paymentId,
          raffleId: params.raffleId,
          type: FinancialTransactionType.PAYMENT_RECEIVED,
          amountCents: breakdown.grossCents,
          description: 'Venda de cota',
        },
        {
          userId: params.creatorId,
          referenceId: params.paymentId,
          paymentId: params.paymentId,
          raffleId: params.raffleId,
          type: FinancialTransactionType.COMMISSION,
          amountCents: -breakdown.platformFeeCents,
          description: `Taxa da plataforma (${breakdown.commissionBasisPoints / 100}%)`,
        },
      ],
    })

    await this.syncBalanceCache(tx, params.creatorId)

    return breakdown
  }

  async recordRefund(
    tx: Prisma.TransactionClient,
    params: {
      paymentId: string
      raffleId: string
      creatorId: string
      amountCents: number
    },
  ): Promise<SaleBreakdown> {
    const existing = await tx.financialTransaction.count({
      where: {
        userId: params.creatorId,
        referenceId: params.paymentId,
        type: FinancialTransactionType.REFUND,
      },
    })

    if (existing > 0) {
      return this.calculateSaleBreakdown(params.amountCents, tx)
    }

    const breakdown = await this.calculateSaleBreakdown(params.amountCents, tx)

    await tx.financialTransaction.create({
      data: {
        userId: params.creatorId,
        referenceId: params.paymentId,
        paymentId: params.paymentId,
        raffleId: params.raffleId,
        type: FinancialTransactionType.REFUND,
        amountCents: -breakdown.creatorEarningCents,
        description: 'Estorno de cota',
      },
    })

    await this.syncBalanceCache(tx, params.creatorId)

    return breakdown
  }

  async recordWithdrawal(
    tx: Prisma.TransactionClient,
    params: {
      userId: string
      withdrawalId: string
      amountCents: number
    },
  ): Promise<void> {
    const existing = await tx.financialTransaction.count({
      where: {
        userId: params.userId,
        referenceId: params.withdrawalId,
        type: FinancialTransactionType.WITHDRAWAL,
      },
    })

    if (existing > 0) return

    await tx.financialTransaction.create({
      data: {
        userId: params.userId,
        referenceId: params.withdrawalId,
        type: FinancialTransactionType.WITHDRAWAL,
        amountCents: -params.amountCents,
        description: 'Saque aprovado',
      },
    })

    await this.syncBalanceCache(tx, params.userId)
  }

  private async syncBalanceCache(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const balanceCents = await this.getBalance(userId, tx)

    await tx.user.update({
      where: { id: userId },
      data: { balanceCents },
    })
  }
}
