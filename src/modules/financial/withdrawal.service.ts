import { ConflictError, NotFoundError } from '@/shared/errors/AppError'
import { FinancialTransactionService } from '@/modules/financial/services/financial-transaction.service'
import { prisma } from '@/shared/infra/prisma'

const MIN_WITHDRAWAL_CENTS = 1_000  // R$ 10,00
const MAX_WITHDRAWAL_CENTS = 500_000_00 // R$ 500.000,00

const financialTransactionService = new FinancialTransactionService()

export class WithdrawalService {
  /**
   * Creates a withdrawal request for the authenticated user.
   * The admin must approve it before any money moves.
   */
  async requestWithdrawal(userId: string, amountCents: number, pixKey: string) {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, pixKey: true },
    })
    if (!user) throw new NotFoundError('Usuário')

    if (amountCents < MIN_WITHDRAWAL_CENTS) {
      throw new ConflictError(
        `Valor mínimo para saque é R$ ${(MIN_WITHDRAWAL_CENTS / 100).toFixed(2)}`,
      )
    }
    if (amountCents > MAX_WITHDRAWAL_CENTS) {
      throw new ConflictError(
        `Valor máximo para saque é R$ ${(MAX_WITHDRAWAL_CENTS / 100).toFixed(2)}`,
      )
    }

    const availableBalance = await financialTransactionService.getBalance(userId)
    if (availableBalance < amountCents) {
      throw new ConflictError(
        `Saldo insuficiente. Disponível: R$ ${(availableBalance / 100).toFixed(2)}`,
      )
    }

    // Prevent duplicate pending request
    const existing = await prisma.withdrawalRequest.findFirst({
      where: { userId, status: 'PENDING' },
    })
    if (existing) {
      throw new ConflictError(
        'Você já possui uma solicitação de saque pendente. Aguarde a revisão antes de criar outra.',
      )
    }

    return prisma.withdrawalRequest.create({
      data:   { userId, amountCents, pixKey },
      select: { id: true, amountCents: true, pixKey: true, status: true, createdAt: true },
    })
  }

  async listMyWithdrawals(userId: string) {
    return prisma.withdrawalRequest.findMany({
      where:   { userId },
      take:    50,
      orderBy: { createdAt: 'desc' },
      select: {
        id:         true,
        amountCents:true,
        pixKey:     true,
        status:     true,
        reviewedAt: true,
        notes:      true,
        createdAt:  true,
      },
    })
  }
}