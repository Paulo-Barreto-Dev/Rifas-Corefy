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
  async calculateSaleBreakdown(grossCents: number): Promise<SaleBreakdown> {
    const fee = await prisma.platformFee.findFirst({
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
      buyerId: string
      amountCents: number
    },
  ): Promise<SaleBreakdown> {
    const breakdown = await this.calculateSaleBreakdown(params.amountCents)

    await tx.financialTransaction.createMany({
      data: [
        {
          paymentId: params.paymentId,
          raffleId: params.raffleId,
          creatorId: params.creatorId,
          buyerId: params.buyerId,
          type: FinancialTransactionType.SALE,
          amountCents: breakdown.grossCents,
          description: 'Venda de cota',
        },
        {
          paymentId: params.paymentId,
          raffleId: params.raffleId,
          creatorId: params.creatorId,
          buyerId: params.buyerId,
          type: FinancialTransactionType.PLATFORM_FEE,
          amountCents: breakdown.platformFeeCents,
          description: `Taxa da plataforma (${breakdown.commissionBasisPoints / 100}%)`,
        },
        {
          paymentId: params.paymentId,
          raffleId: params.raffleId,
          creatorId: params.creatorId,
          buyerId: params.buyerId,
          type: FinancialTransactionType.CREATOR_EARNING,
          amountCents: breakdown.creatorEarningCents,
          description: 'Receita líquida do criador',
        },
      ],
    })

    await tx.user.update({
      where: { id: params.creatorId },
      data: { balanceCents: { increment: breakdown.creatorEarningCents } },
    })

    return breakdown
  }
}
