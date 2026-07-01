import { RaffleStatus, TicketStatus, PaymentStatus } from '@prisma/client'
import { ConflictError, NotFoundError } from '@/shared/errors/AppError'
import { prisma } from '@/shared/infra/prisma'
import { logger } from '@/shared/utils/logger'
import { AuditService } from './audit.service'

const auditService = new AuditService()

const CANCELLABLE_STATUSES: RaffleStatus[] = [
  RaffleStatus.PENDING_APPROVAL,
  RaffleStatus.OPEN,
  RaffleStatus.PAUSED,
  RaffleStatus.SOLD_OUT,
  RaffleStatus.DRAWING,
  RaffleStatus.DRAFT,
]

export interface AdminListRafflesFilters {
  status?: RaffleStatus
  creatorId?: string
  search?: string
  page: number
  limit: number
}

export class AdminRaffleService {
  // Listing 

  async listRaffles(filters: AdminListRafflesFilters) {
    const where: Record<string, unknown> = {}

    if (filters.status)    where.status    = filters.status
    if (filters.creatorId) where.creatorId = filters.creatorId
    if (filters.search) {
      where.OR = [
        { title:       { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ]
    }

    const skip = (filters.page - 1) * filters.limit

    const [total, data] = await prisma.$transaction([
      prisma.raffle.count({ where }),
      prisma.raffle.findMany({
        where,
        skip,
        take:    filters.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            select: { id: true, name: true, email: true, isVerifiedCreator: true },
          },
          _count: {
            select: {
              tickets: true,
              // tickets with status PAID counted separately below would require raw SQL;
              // use _count on all tickets — filtered count comes via the include pattern
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

  // Approval flow 

  async approveRaffle(raffleId: string, adminId: string, ipAddress?: string, userAgent?: string) {
    const raffle = await this.findRaffleOrThrow(raffleId)

    if (raffle.status !== RaffleStatus.PENDING_APPROVAL) {
      throw new ConflictError(
        `Apenas rifas com status PENDING_APPROVAL podem ser aprovadas. Status atual: "${raffle.status}"`,
      )
    }

    const before = { status: raffle.status }

    const updated = await prisma.raffle.update({
      where: { id: raffleId },
      data:  { status: RaffleStatus.OPEN, rejectionReason: null },
    })

    await auditService.log({
      adminId,
      action:     'RAFFLE_APPROVED',
      targetType: 'Raffle',
      targetId:   raffleId,
      before,
      after:      { status: updated.status },
      ipAddress,
      userAgent,
    })

    logger.info('Rifa aprovada pelo admin', { raffleId, adminId })
    return updated
  }

  async rejectRaffle(
    raffleId:  string,
    adminId:   string,
    reason:    string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const raffle = await this.findRaffleOrThrow(raffleId)

    const rejectableStatuses: RaffleStatus[] = [
      RaffleStatus.PENDING_APPROVAL,
      RaffleStatus.DRAFT,
    ]
    if (!rejectableStatuses.includes(raffle.status)) {
      throw new ConflictError(
        `Rifas com status "${raffle.status}" não podem ser rejeitadas`,
      )
    }

    const before = { status: raffle.status, rejectionReason: raffle.rejectionReason }

    const updated = await prisma.raffle.update({
      where: { id: raffleId },
      data:  { status: RaffleStatus.REJECTED, rejectionReason: reason },
    })

    await auditService.log({
      adminId,
      action:     'RAFFLE_REJECTED',
      targetType: 'Raffle',
      targetId:   raffleId,
      before,
      after:      { status: updated.status, rejectionReason: updated.rejectionReason },
      metadata:   { reason },
      ipAddress,
      userAgent,
    })

    logger.info('Rifa rejeitada pelo admin', { raffleId, adminId, reason })
    return updated
  }

  // Intervention on live raffles 

  async pauseRaffle(
    raffleId:  string,
    adminId:   string,
    reason:    string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const raffle = await this.findRaffleOrThrow(raffleId)

    const pausableStatuses: RaffleStatus[] = [RaffleStatus.OPEN, RaffleStatus.SOLD_OUT]
    if (!pausableStatuses.includes(raffle.status)) {
      throw new ConflictError(
        `Apenas rifas com status OPEN ou SOLD_OUT podem ser pausadas. Status atual: "${raffle.status}"`,
      )
    }

    const before = { status: raffle.status, pauseReason: raffle.pauseReason }

    const updated = await prisma.raffle.update({
      where: { id: raffleId },
      data:  { status: RaffleStatus.PAUSED, pauseReason: reason },
    })

    await auditService.log({
      adminId,
      action:     'RAFFLE_PAUSED',
      targetType: 'Raffle',
      targetId:   raffleId,
      before,
      after:      { status: updated.status, pauseReason: reason },
      metadata:   { reason },
      ipAddress,
      userAgent,
    })

    logger.info('Rifa pausada pelo admin', { raffleId, adminId, reason })
    return updated
  }

  async resumeRaffle(
    raffleId:  string,
    adminId:   string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const raffle = await this.findRaffleOrThrow(raffleId)

    if (raffle.status !== RaffleStatus.PAUSED) {
      throw new ConflictError(`Apenas rifas PAUSED podem ser reativadas. Status atual: "${raffle.status}"`)
    }

    const before = { status: raffle.status }

    const updated = await prisma.raffle.update({
      where: { id: raffleId },
      data:  { status: RaffleStatus.OPEN, pauseReason: null },
    })

    await auditService.log({
      adminId,
      action:     'RAFFLE_RESUMED',
      targetType: 'Raffle',
      targetId:   raffleId,
      before,
      after:      { status: updated.status },
      ipAddress,
      userAgent,
    })

    logger.info('Rifa reativada pelo admin', { raffleId, adminId })
    return updated
  }

  /**
   * Cancels a raffle and optionally issues refunds for all PAID tickets.
   *
   * Refund logic here marks Payment records as REFUNDED and Ticket records as
   * CANCELLED. The actual money transfer back to buyers must be triggered via
   * the payment gateway (Stripe) in a follow-up step or
   * webhook — this method only updates platform state.
   */
  async cancelRaffle(
    raffleId:    string,
    adminId:     string,
    reason:      string,
    issueRefunds: boolean,
    ipAddress?:  string,
    userAgent?:  string,
  ) {
    const raffle = await prisma.raffle.findUnique({
      where:   { id: raffleId },
      include: {
        tickets: {
          where:   { status: TicketStatus.PAID },
          include: { payment: { select: { id: true, status: true } } },
        },
      },
    })
    if (!raffle) throw new NotFoundError('Rifa')

    if (!CANCELLABLE_STATUSES.includes(raffle.status)) {
      throw new ConflictError(
        `Rifa com status "${raffle.status}" não pode ser cancelada`,
      )
    }

    const paidTickets   = raffle.tickets
    const paymentIds    = paidTickets
      .map(t => t.payment?.id)
      .filter((id): id is string => Boolean(id))

    const before = { status: raffle.status }

    await prisma.$transaction(async tx => {
      // Cancel all non-finished tickets (RESERVED and PAID)
      await tx.ticket.updateMany({
        where: { raffleId, status: { in: [TicketStatus.RESERVED, TicketStatus.PAID] } },
        data:  { status: TicketStatus.CANCELLED },
      })

      // Mark payments as REFUNDED when requested
      if (issueRefunds && paymentIds.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: paymentIds }, status: PaymentStatus.APPROVED },
          data:  { status: PaymentStatus.REFUNDED },
        })
      }

      await tx.raffle.update({
        where: { id: raffleId },
        data:  { status: RaffleStatus.CANCELLED },
      })
    })

    await auditService.log({
      adminId,
      action:     'RAFFLE_CANCELLED',
      targetType: 'Raffle',
      targetId:   raffleId,
      before,
      after:      { status: RaffleStatus.CANCELLED },
      metadata: {
        reason,
        issueRefunds,
        paidTicketsCancelled: paidTickets.length,
        paymentsMarkedRefunded: issueRefunds ? paymentIds.length : 0,
      },
      ipAddress,
      userAgent,
    })

    logger.info('Rifa cancelada pelo admin', {
      raffleId,
      adminId,
      reason,
      refunds: issueRefunds ? paymentIds.length : 0,
    })

    return {
      message:               'Rifa cancelada com sucesso',
      paidTicketsCancelled:  paidTickets.length,
      paymentsMarkedRefunded: issueRefunds ? paymentIds.length : 0,
      note: issueRefunds
        ? 'Pagamentos marcados como REFUNDED. Acione o gateway de pagamento para efetivar os estornos.'
        : 'Nenhum estorno foi solicitado.',
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async findRaffleOrThrow(raffleId: string) {
    const raffle = await prisma.raffle.findUnique({ where: { id: raffleId } })
    if (!raffle) throw new NotFoundError('Rifa')
    return raffle
  }
}
