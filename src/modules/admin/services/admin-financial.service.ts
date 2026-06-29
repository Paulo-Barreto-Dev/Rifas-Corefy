import { PaymentStatus, WithdrawalStatus } from '@prisma/client'
import { ConflictError, NotFoundError } from '@/shared/errors/AppError'
import { prisma } from '@/shared/infra/prisma'
import { logger } from '@/shared/utils/logger'
import { AuditService } from './audit.service'

const auditService = new AuditService()

export interface ListPaymentsFilters {
  status?:  PaymentStatus
  userId?:  string
  from?:    Date
  to?:      Date
  page:     number
  limit:    number
}

export interface ListWithdrawalsFilters {
  status?:  WithdrawalStatus
  userId?:  string
  from?:    Date
  to?:      Date
  page:     number
  limit:    number
}

export class AdminFinancialService {
  // Pagamentos 

  async listPayments(filters: ListPaymentsFilters) {
    const where = this.buildDateRangeWhere(filters, 'createdAt')

    const skip = (filters.page - 1) * filters.limit

    const [total, data] = await prisma.$transaction([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take:    filters.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          ticket: {
            select: {
              id:     true,
              number: true,
              raffle: { select: { id: true, title: true } },
            },
          },
        },
      }),
    ])

    return {
      data,
      pagination: {
        page:       filters.page,
        limit:      filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    }
  }

  // Saques 

  async listWithdrawals(filters: ListWithdrawalsFilters) {
    const where = this.buildDateRangeWhere(filters, 'createdAt')

    const skip = (filters.page - 1) * filters.limit

    const [total, data] = await prisma.$transaction([
      prisma.withdrawalRequest.count({ where }),
      prisma.withdrawalRequest.findMany({
        where,
        skip,
        take:    filters.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user:     { select: { id: true, name: true, email: true, pixKey: true } },
          reviewer: { select: { id: true, name: true } },
        },
      }),
    ])

    return {
      data,
      pagination: {
        page:       filters.page,
        limit:      filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    }
  }

  /**
   * Approves or rejects a pending withdrawal request.
   *
   * On APPROVED: deducts amountCents from the user's balanceCents.
   * The actual Pix transfer to the user must be triggered via the payment
   * gateway — this method only updates platform state and balance.
   */
  async reviewWithdrawal(
    withdrawalId: string,
    adminId:      string,
    decision:     'APPROVED' | 'REJECTED',
    notes?:       string,
    ipAddress?:   string,
    userAgent?:   string,
  ) {
    const withdrawal = await prisma.withdrawalRequest.findUnique({
      where:   { id: withdrawalId },
      include: { user: { select: { id: true, name: true, balanceCents: true } } },
    })
    if (!withdrawal) throw new NotFoundError('Solicitação de saque')

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new ConflictError(
        `Solicitação já processada com status "${withdrawal.status}"`,
      )
    }

    if (decision === 'APPROVED' && withdrawal.user.balanceCents < withdrawal.amountCents) {
      throw new ConflictError(
        `Saldo insuficiente: usuário tem ${withdrawal.user.balanceCents} centavos, saque requer ${withdrawal.amountCents}`,
      )
    }

    const before  = { status: withdrawal.status }
    const newStatus = decision === 'APPROVED' ? WithdrawalStatus.APPROVED : WithdrawalStatus.REJECTED

    const updated = await prisma.$transaction(async tx => {
      const wr = await tx.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: {
          status:     newStatus,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          notes,
        },
        include: {
          user:     { select: { id: true, name: true, email: true } },
          reviewer: { select: { id: true, name: true } },
        },
      })

      if (decision === 'APPROVED') {
        await tx.user.update({
          where: { id: withdrawal.userId },
          data:  { balanceCents: { decrement: withdrawal.amountCents } },
        })
      }

      return wr
    })

    await auditService.log({
      adminId,
      action:     decision === 'APPROVED' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
      targetType: 'WithdrawalRequest',
      targetId:   withdrawalId,
      before,
      after: { status: updated.status, reviewedAt: updated.reviewedAt, notes },
      metadata: {
        amountCents: withdrawal.amountCents,
        pixKey:      withdrawal.pixKey,
        userId:      withdrawal.userId,
      },
      ipAddress,
      userAgent,
    })

    logger.info('Saque revisado pelo admin', { withdrawalId, adminId, decision })

    if (decision === 'APPROVED') {
      logger.info('Acione o gateway de pagamento para enviar o Pix ao usuário', {
        withdrawalId,
        pixKey:      withdrawal.pixKey,
        amountCents: withdrawal.amountCents,
        userId:      withdrawal.userId,
      })
    }

    return updated
  }

  // Platform Fees 

  async listFees() {
    return prisma.platformFee.findMany({
      orderBy: { key: 'asc' },
      include: { updatedByUser: { select: { id: true, name: true } } },
    })
  }

  /**
   * Cria ou atualiza uma configuração de taxa da plataforma.
   
   * @param basisPoints  Integer in [0, 10000]. 500 = 5.00%.
   */
  async upsertFee(
    key:         string,
    description: string,
    basisPoints: number,
    adminId:     string,
    ipAddress?:  string,
    userAgent?:  string,
  ) {
    if (basisPoints < 0 || basisPoints > 10_000) {
      throw new ConflictError('Taxa deve ser entre 0 e 10.000 basis points (0% a 100%)')
    }

    const existing = await prisma.platformFee.findUnique({ where: { key } })
    const before   = existing
      ? { basisPoints: existing.basisPoints, description: existing.description, isActive: existing.isActive }
      : null

    const fee = await prisma.platformFee.upsert({
      where:  { key },
      create: { key, description, basisPoints, updatedBy: adminId },
      update: { description, basisPoints, updatedBy: adminId },
      include: { updatedByUser: { select: { id: true, name: true } } },
    })

    await auditService.log({
      adminId,
      action:     existing ? 'FEE_UPDATED' : 'FEE_CREATED',
      targetType: 'PlatformFee',
      targetId:   fee.id,
      before:     before ?? undefined,
      after:      { key, basisPoints, description },
      ipAddress,
      userAgent,
    })

    return fee
  }

  async toggleFee(
    key:       string,
    isActive:  boolean,
    adminId:   string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const fee = await prisma.platformFee.findUnique({ where: { key } })
    if (!fee) throw new NotFoundError(`Taxa com chave "${key}"`)

    const before = { isActive: fee.isActive }

    const updated = await prisma.platformFee.update({
      where: { key },
      data:  { isActive, updatedBy: adminId },
    })

    await auditService.log({
      adminId,
      action:     isActive ? 'FEE_ACTIVATED' : 'FEE_DEACTIVATED',
      targetType: 'PlatformFee',
      targetId:   fee.id,
      before,
      after:      { isActive: updated.isActive },
      ipAddress,
      userAgent,
    })

    return updated
  }

  // Relatório Financeiro

  /**
   * Retorna métricas financeiras agregadas para um intervalo de datas.
   * Todos os valores são retornados em centavos.
   */
  async getFinancialReport(from: Date, to: Date) {
    const [
      confirmedPayments,
      refundedPayments,
      pendingPayments,
      approvedWithdrawals,
      paymentsByStatus,
      withdrawalsByStatus,
      topRaffles,
      activeFees,
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: PaymentStatus.CONFIRMED, confirmedAt: { gte: from, lte: to } },
        _sum:   { amountCents: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { status: PaymentStatus.REFUNDED, updatedAt: { gte: from, lte: to } },
        _sum:   { amountCents: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { status: PaymentStatus.PENDING, createdAt: { gte: from, lte: to } },
        _sum:   { amountCents: true },
        _count: true,
      }),
      prisma.withdrawalRequest.aggregate({
        where: { status: WithdrawalStatus.APPROVED, reviewedAt: { gte: from, lte: to } },
        _sum:   { amountCents: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by:    ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
        _sum:  { amountCents: true },
      }),
      prisma.withdrawalRequest.groupBy({
        by:    ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
        _sum:  { amountCents: true },
      }),

      // Top 10 sorteios com mais tickets pagos no período
      prisma.raffle.findMany({
        where: {
          tickets: {
            some: {
              payment: {
                status:      PaymentStatus.CONFIRMED,
                confirmedAt: { gte: from, lte: to },
              },
            },
          },
        },
        take:    10,
        orderBy: { tickets: { _count: 'desc' } },
        include: {
          creator: { select: { id: true, name: true } },
          _count:  { select: { tickets: true } },
        },
      }),

      prisma.platformFee.findMany({ where: { isActive: true } }),
    ])

    const grossCents    = confirmedPayments._sum.amountCents ?? 0
    const refundedCents = refundedPayments._sum.amountCents  ?? 0
    const netCents      = grossCents - refundedCents

    // Derivar comissão da plataforma a partir da configuração de taxa
    const commissionFee  = activeFees.find(f => f.key === 'raffle_commission')
    const commissionRate = commissionFee ? commissionFee.basisPoints / 10_000 : 0
    const platformFeeCents = Math.round(netCents * commissionRate)

    return {
      period: { from, to },

      revenue: {
        grossCents,
        refundedCents,
        netCents,
        platformFeeCents,
        payoutsToCreatorsCents: Math.max(0, netCents - platformFeeCents),
        confirmedCount:         confirmedPayments._count,
        refundedCount:          refundedPayments._count,
        pendingCents:           pendingPayments._sum.amountCents ?? 0,
        pendingCount:           pendingPayments._count,
      },

      withdrawals: {
        approvedCents: approvedWithdrawals._sum.amountCents ?? 0,
        approvedCount: approvedWithdrawals._count,
      },

      // Detalhamento de cada status de pagamento no período
      paymentsByStatus: Object.fromEntries(
        paymentsByStatus.map(row => [
          row.status,
          { count: row._count, amountCents: row._sum.amountCents ?? 0 },
        ]),
      ),

      withdrawalsByStatus: Object.fromEntries(
        withdrawalsByStatus.map(row => [
          row.status,
          { count: row._count, amountCents: row._sum.amountCents ?? 0 },
        ]),
      ),

      topRaffles: topRaffles.map(r => ({
        id:              r.id,
        title:           r.title,
        status:          r.status,
        creator:         r.creator,
        ticketPriceCents:r.ticketPriceCents,
        totalTickets:    r.totalTickets,
        paidTickets:     r._count.tickets,
        estimatedRevenueCents: r._count.tickets * r.ticketPriceCents,
      })),

      appliedFees: activeFees.map(f => ({
        key:         f.key,
        description: f.description,
        basisPoints: f.basisPoints,
        percentage:  `${(f.basisPoints / 100).toFixed(2)}%`,
      })),
    }
  }

  // Ajudantes privados

  private buildDateRangeWhere(
    filters: { status?: string; userId?: string; from?: Date; to?: Date },
    dateField: string,
  ) {
    const where: Record<string, unknown> = {}
    if (filters.status) where.status = filters.status
    if (filters.userId) where.userId = filters.userId
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {}
      if (filters.from) range.gte = filters.from
      if (filters.to)   range.lte = filters.to
      where[dateField] = range
    }
    return where
  }
}