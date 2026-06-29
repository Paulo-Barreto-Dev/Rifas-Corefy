import { AppError, NotFoundError, PaymentError } from '@/shared/errors/AppError'
import { TicketService } from '@/modules/tickets/services/ticket.service'
import { FinancialTransactionService } from '@/modules/financial/services/financial-transaction.service'
import { PaymentAuditService } from '@/modules/payments/services/payment-audit.service'
import { getFakePaymentProvider, getPaymentProvider } from '@/modules/payments/providers/payment-provider.factory'
import { FakePaymentProvider } from '@/modules/payments/providers/fake-payment.provider'
import { PaymentProvider } from '@/modules/payments/providers/payment-provider.interface'
import { logger } from '@/shared/utils/logger'
import { env } from '@/config/env'
import { prisma } from '@/shared/infra/prisma'

const ticketService = new TicketService()
const financialTransactionService = new FinancialTransactionService()
const paymentAuditService = new PaymentAuditService()

export class PaymentService {
  constructor(private readonly provider: PaymentProvider = getPaymentProvider()) {}

  async createPixPayment(ticketId: string, userId: string) {
    const ticket = await ticketService.getTicketById(ticketId)

    if (ticket.buyerId !== userId) {
      throw new AppError('Esta cota não pertence a você', 403, 'FORBIDDEN')
    }
    if (ticket.status !== 'RESERVED') {
      throw new AppError('Cota não está reservada', 409, 'INVALID_STATUS')
    }
    if (ticket.reservedUntil && ticket.reservedUntil < new Date()) {
      throw new AppError('Reserva expirada — selecione novamente', 409, 'RESERVATION_EXPIRED')
    }
    if (ticket.payment) {
      throw new AppError('Pagamento já iniciado para esta cota', 409, 'ALREADY_EXISTS')
    }

    const amountCents = ticket.raffle.ticketPriceCents
    const buyer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    if (!buyer) throw new NotFoundError('Usuário')

    const providerResult = await this.provider.createPayment({
      amountCents,
      description: `Cota #${ticket.number} — ${ticket.raffle.title}`,
      payerEmail: buyer.email,
      externalReference: ticketId,
    })

    const payment = await prisma.payment.create({
      data: {
        ticketId,
        userId,
        amountCents,
        pixTxId: providerResult.providerPaymentId,
        pixQrCode: providerResult.qrCode ?? '',
        pixExpiration: providerResult.expiresAt,
        status: 'PENDING',
      },
    })

    await paymentAuditService.log(prisma, {
      paymentId: payment.id,
      action: 'PAYMENT_CREATED',
      after: { status: payment.status, amountCents, pixTxId: payment.pixTxId },
    })

    logger.info('Pagamento criado', { ticketId, pixTxId: payment.pixTxId, amountCents })

    return {
      payment,
      pixQrCode: providerResult.qrCode,
      txId: providerResult.providerPaymentId,
      expiresAt: providerResult.expiresAt,
    }
  }

  async confirmPayment(pixTxId: string) {
    const payment = await prisma.payment.findUnique({
      where: { pixTxId },
      include: { ticket: { include: { raffle: true } } },
    })

    if (!payment) throw new NotFoundError('Pagamento')
    if (payment.status === 'CONFIRMED') return payment

    if (payment.pixExpiration && payment.pixExpiration < new Date()) {
      await this.failExpiredPayment(payment.id, payment.ticketId)
      throw new PaymentError('PIX expirado — cota liberada para outros compradores')
    }

    const providerResult = await this.provider.confirmPayment(pixTxId)

    if (providerResult.status !== 'approved') {
      throw new PaymentError('Pagamento ainda não aprovado pelo provider')
    }

    return this.finalizeApprovedPayment(payment.id)
  }

  async finalizeApprovedPayment(paymentId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: { include: { raffle: true } } },
    })

    if (!payment) throw new NotFoundError('Pagamento')
    if (payment.status === 'CONFIRMED') return payment

    const confirmedAt = new Date()

    const updatedPayment = await prisma.$transaction(async tx => {
      const current = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { ticket: { include: { raffle: true } } },
      })

      if (!current) throw new NotFoundError('Pagamento')
      if (current.status === 'CONFIRMED') return current

      if (current.ticket.status !== 'RESERVED') {
        throw new AppError('Cota não está reservada', 409, 'INVALID_STATUS')
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'CONFIRMED', confirmedAt },
      })

      await tx.ticket.update({
        where: { id: current.ticketId },
        data: { status: 'PAID' },
      })

      const raffle = await tx.raffle.update({
        where: { id: current.ticket.raffleId },
        data: { soldTicketsCount: { increment: 1 } },
      })

      const breakdown = await financialTransactionService.recordApprovedSale(tx, {
        paymentId: current.id,
        raffleId: current.ticket.raffleId,
        creatorId: current.ticket.raffle.creatorId,
        buyerId: current.userId,
        amountCents: current.amountCents,
      })

      await paymentAuditService.log(tx, {
        paymentId: current.id,
        action: 'PAYMENT_CONFIRMED',
        before: { status: current.status, ticketStatus: current.ticket.status },
        after: { status: 'CONFIRMED', ticketStatus: 'PAID' },
        metadata: {
          breakdown: {
            grossCents: breakdown.grossCents,
            platformFeeCents: breakdown.platformFeeCents,
            creatorEarningCents: breakdown.creatorEarningCents,
            commissionBasisPoints: breakdown.commissionBasisPoints,
          },
          soldTicketsCount: raffle.soldTicketsCount,
        },
      })

      if (raffle.status === 'OPEN' && raffle.soldTicketsCount >= raffle.totalTickets) {
        await tx.raffle.update({
          where: { id: raffle.id },
          data: { status: 'SOLD_OUT' },
        })
        logger.info('Rifa esgotada. Aguardando sorteio', { raffleId: raffle.id })
      }

      return updated
    })

    logger.info('Pagamento confirmado', { paymentId, ticketId: payment.ticketId })
    return updatedPayment
  }

  async approveTestPayment(paymentId: string) {
    if (env.NODE_ENV === 'production') {
      throw new AppError('Endpoint disponível apenas fora de produção', 404, 'NOT_FOUND')
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    if (!payment) throw new NotFoundError('Pagamento')

    const fakeProvider = this.getFakeProvider()
    fakeProvider.approveForTest(payment.pixTxId)

    return this.finalizeApprovedPayment(paymentId)
  }

  async failTestPayment(paymentId: string) {
    if (env.NODE_ENV === 'production') {
      throw new AppError('Endpoint disponível apenas fora de produção', 404, 'NOT_FOUND')
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: true },
    })
    if (!payment) throw new NotFoundError('Pagamento')

    const fakeProvider = this.getFakeProvider()
    fakeProvider.failForTest(payment.pixTxId)

    return prisma.$transaction(async tx => {
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'FAILED' },
      })

      if (payment.ticket.status === 'RESERVED') {
        await tx.ticket.update({
          where: { id: payment.ticketId },
          data: { status: 'CANCELLED' },
        })
      }

      await paymentAuditService.log(tx, {
        paymentId,
        action: 'PAYMENT_FAILED',
        before: { status: payment.status },
        after: { status: 'FAILED' },
        metadata: { source: 'fake_provider_test' },
      })

      return updatedPayment
    })
  }

  async getPaymentStatus(ticketId: string, userId: string) {
    const ticket = await ticketService.getTicketById(ticketId)
    if (ticket.buyerId !== userId) {
      throw new AppError('Acesso negado', 403, 'FORBIDDEN')
    }

    if (!ticket.payment) return null

    const providerStatus = await this.provider.getPaymentStatus(ticket.payment.pixTxId)
    return {
      ...ticket.payment,
      providerStatus: providerStatus.status,
    }
  }

  private async failExpiredPayment(paymentId: string, ticketId: string) {
    await prisma.$transaction(async tx => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'FAILED' },
      })
      await tx.ticket.update({
        where: { id: ticketId },
        data: { status: 'CANCELLED' },
      })
      await paymentAuditService.log(tx, {
        paymentId,
        action: 'PAYMENT_EXPIRED',
        after: { status: 'FAILED', ticketStatus: 'CANCELLED' },
      })
    })
  }

  private getFakeProvider(): FakePaymentProvider {
    if (this.provider instanceof FakePaymentProvider) {
      return this.provider
    }
    return getFakePaymentProvider()
  }
}
