import { prisma } from '@/shared/infra/prisma'
import { logger } from '@/shared/utils/logger'

export class ReservationExpirationService {
  /**
   * Cancela reservas expiradas. (Execução via work/job)
   */
  async cancelExpiredReservations(): Promise<number> {
    const now = new Date()

    const expiredTickets = await prisma.ticket.findMany({
      where: {
        status: 'RESERVED',
        reservedUntil: { lt: now },
      },
      select: { id: true, payment: { select: { id: true, status: true } } },
    })

    if (expiredTickets.length === 0) return 0

    const cancelled = await prisma.$transaction(async tx => {
      const ticketIds = expiredTickets.map(ticket => ticket.id)

      await tx.ticket.updateMany({
        where: { id: { in: ticketIds }, status: 'RESERVED' },
        data: { status: 'CANCELLED' },
      })

      const pendingPaymentIds = expiredTickets
        .map(ticket => ticket.payment)
        .filter(payment => payment && payment.status === 'PENDING')
        .map(payment => payment!.id)

      if (pendingPaymentIds.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: pendingPaymentIds }, status: 'PENDING' },
          data: { status: 'FAILED' },
        })
      }

      return ticketIds.length
    })

    logger.info('Reservas expiradas canceladas', { count: cancelled })
    return cancelled
  }
}
