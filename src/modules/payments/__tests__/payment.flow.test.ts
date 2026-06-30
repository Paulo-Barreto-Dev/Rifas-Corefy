import { beforeEach, describe, expect, it } from 'vitest'
import { PaymentService } from '@/modules/payments/services/payment.service'
import { TicketService } from '@/modules/tickets/services/ticket.service'
import { ReservationExpirationService } from '@/modules/financial/services/reservation-expiration.service'
import { FakePaymentProvider } from '@/modules/payments/providers/fake-payment.provider'
import { AppError } from '@/shared/errors/AppError'
import { env } from '@/config/env'
import { prisma } from '@/shared/infra/prisma'
import {
  createOpenRaffle,
  createTestUser,
  resetDatabase,
  resetProviders,
  seedDefaultPlatformFee,
} from '@/test/helpers'

describe('Payment flow', () => {
  const ticketService = new TicketService()
  let fakeProvider: FakePaymentProvider
  let paymentService: PaymentService

  beforeEach(async () => {
    resetProviders()
    fakeProvider = new FakePaymentProvider()
    paymentService = new PaymentService(fakeProvider)
    await resetDatabase()
  })

  it('cria checkout pendente e mantem ticket reservado', async () => {
    const { created, ticket } = await createPendingPaymentFixture(paymentService, ticketService, 2)

    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })

    expect(created.payment.status).toBe('PENDING')
    expect(paymentAfter?.status).toBe('PENDING')
    expect(ticketAfter?.status).toBe('RESERVED')
    expect(ticketAfter?.reservedUntil).toBeTruthy()
  })

  it('aprova pagamento e marca ticket como PAID', async () => {
    const { created, raffle, ticket } = await createPendingPaymentFixture(paymentService, ticketService, 1)

    await paymentService.approveTestPayment(created.payment.id)

    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })
    const transactions = await prisma.financialTransaction.findMany({
      where: { paymentId: created.payment.id },
    })
    const raffleAfter = await prisma.raffle.findUnique({ where: { id: raffle.id } })

    expect(paymentAfter?.status).toBe('CONFIRMED')
    expect(ticketAfter?.status).toBe('PAID')
    expect(raffleAfter?.soldTicketsCount).toBe(1)
    expect(transactions.map(t => t.type).sort()).toEqual([
      'CREATOR_EARNING',
      'PLATFORM_FEE',
      'SALE',
    ])
  })

  it('processa webhook do Stripe com idempotencia', async () => {
    const { created, raffle, ticket } = await createPendingPaymentFixture(paymentService, ticketService, 5)
    const event = {
      id: 'evt_checkout_session_completed_test',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: created.payment.providerCheckoutSessionId,
          payment_status: 'paid',
          payment_intent: 'pi_test_checkout_completed',
          metadata: { ticketId: ticket.id },
        },
      },
    }

    const firstResult = await (paymentService as any).processStripeWebhookEvent(event)
    const secondResult = await (paymentService as any).processStripeWebhookEvent(event)

    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })
    const raffleAfter = await prisma.raffle.findUnique({ where: { id: raffle.id } })
    const webhookEvents = await prisma.paymentWebhookEvent.findMany({
      where: { providerEventId: event.id },
    })
    const transactions = await prisma.financialTransaction.findMany({
      where: { paymentId: created.payment.id },
    })

    expect(firstResult.duplicate).toBe(false)
    expect(secondResult.duplicate).toBe(true)
    expect(paymentAfter?.status).toBe('CONFIRMED')
    expect(raffleAfter?.soldTicketsCount).toBe(1)
    expect(webhookEvents).toHaveLength(1)
    expect(transactions).toHaveLength(3)
  })

  it('processa webhook valido com assinatura Stripe verificada pelo provider', async () => {
    const originalProvider = env.PAYMENT_PROVIDER
    env.PAYMENT_PROVIDER = 'stripe'

    try {
      const event = {
        id: 'evt_valid_signed_webhook',
        type: 'checkout.session.expired',
        data: { object: { id: 'cs_missing_local_payment' } },
      }
      const stripeService = {
        constructWebhookEvent: () => event,
      }
      const service = new PaymentService(fakeProvider, stripeService as any)

      const result = await service.handleWebhook(Buffer.from('{}'), 'valid-signature')

      expect(result.received).toBe(true)
      expect(result.eventId).toBe(event.id)
    } finally {
      env.PAYMENT_PROVIDER = originalProvider
    }
  })

  it('rejeita webhook Stripe com assinatura invalida', async () => {
    const originalProvider = env.PAYMENT_PROVIDER
    env.PAYMENT_PROVIDER = 'stripe'

    try {
      const stripeService = {
        constructWebhookEvent: () => {
          throw new AppError('Assinatura do webhook invalida', 400, 'INVALID_WEBHOOK_SIGNATURE')
        },
      }
      const service = new PaymentService(fakeProvider, stripeService as any)

      await expect(service.handleWebhook(Buffer.from('{}'), 'invalid-signature')).rejects.toMatchObject({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        statusCode: 400,
      })
    } finally {
      env.PAYMENT_PROVIDER = originalProvider
    }
  })

  it('marca pagamento e ticket como falhados quando checkout expira', async () => {
    const { created, ticket } = await createPendingPaymentFixture(paymentService, ticketService, 3)
    const event = {
      id: 'evt_checkout_expired_test',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: created.payment.providerCheckoutSessionId,
          payment_status: 'unpaid',
          payment_intent: 'pi_expired_test',
          metadata: { ticketId: ticket.id },
        },
      },
    }

    await (paymentService as any).processStripeWebhookEvent(event)

    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })
    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(paymentAfter?.status).toBe('FAILED')
    expect(ticketAfter?.status).toBe('CANCELLED')
  })

  it('marca pagamento e ticket como falhados em payment_intent.payment_failed', async () => {
    const { created, ticket } = await createPendingPaymentFixture(paymentService, ticketService, 4)
    await prisma.payment.update({
      where: { id: created.payment.id },
      data: { providerPaymentId: 'pi_failed_test' },
    })
    const event = {
      id: 'evt_payment_intent_failed_test',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed_test',
          metadata: { ticketId: ticket.id },
        },
      },
    }

    await (paymentService as any).processStripeWebhookEvent(event)

    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })
    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(paymentAfter?.status).toBe('FAILED')
    expect(ticketAfter?.status).toBe('CANCELLED')
  })

  it('estorna pagamento confirmado e reverte saldo do criador', async () => {
    const { created, creator, ticket } = await createPendingPaymentFixture(paymentService, ticketService, 6)
    const succeededEvent = {
      id: 'evt_payment_intent_succeeded_for_refund',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_refund_test',
          metadata: { ticketId: ticket.id },
        },
      },
    }
    await (paymentService as any).processStripeWebhookEvent(succeededEvent)

    const creatorAfterSale = await prisma.user.findUnique({ where: { id: creator.id } })
    expect(creatorAfterSale?.balanceCents).toBe(950)

    const refundEvent = {
      id: 'evt_charge_refunded_test',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refund_test',
          payment_intent: 'pi_refund_test',
          metadata: { ticketId: ticket.id },
        },
      },
    }
    await (paymentService as any).processStripeWebhookEvent(refundEvent)
    await (paymentService as any).processStripeWebhookEvent(refundEvent)

    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })
    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const creatorAfterRefund = await prisma.user.findUnique({ where: { id: creator.id } })
    const transactions = await prisma.financialTransaction.findMany({
      where: { paymentId: created.payment.id },
    })

    expect(paymentAfter?.status).toBe('REFUNDED')
    expect(ticketAfter?.status).toBe('REFUNDED')
    expect(creatorAfterRefund?.balanceCents).toBe(0)
    expect(transactions.map(transaction => transaction.type).sort()).toEqual([
      'CREATOR_EARNING',
      'PLATFORM_FEE',
      'REFUND',
      'SALE',
    ])
  })
})

describe('Ticket concurrency', () => {
  const ticketService = new TicketService()

  beforeEach(async () => {
    await resetDatabase()
  })

  it('permite reservar o mesmo numero para apenas um comprador', async () => {
    const creator = await createTestUser({ role: 'CREATOR' })
    const buyerA = await createTestUser()
    const buyerB = await createTestUser()

    const raffle = await createOpenRaffle(creator.id, { totalTickets: 5 })

    const first = await ticketService.reserve(raffle.id, buyerA.id, 1, [3])
    expect(first.tickets).toHaveLength(1)

    await expect(
      ticketService.reserve(raffle.id, buyerB.id, 1, [3]),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    const tickets = await prisma.ticket.findMany({ where: { raffleId: raffle.id, number: 3 } })
    expect(tickets).toHaveLength(1)
    expect(tickets[0].buyerId).toBe(buyerA.id)
  })
})

describe('Reservation expiration', () => {
  const ticketService = new TicketService()
  const reservationExpirationService = new ReservationExpirationService()

  beforeEach(async () => {
    await resetDatabase()
  })

  it('cancela ticket RESERVED apos expiracao da reserva', async () => {
    const creator = await createTestUser({ role: 'CREATOR' })
    const buyer = await createTestUser()
    const raffle = await createOpenRaffle(creator.id)

    const { tickets } = await ticketService.reserve(raffle.id, buyer.id, 1, [4])
    const ticket = tickets[0]

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    })

    const cancelledCount = await reservationExpirationService.cancelExpiredReservations()
    expect(cancelledCount).toBe(1)

    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(ticketAfter?.status).toBe('CANCELLED')
  })
})

async function createPendingPaymentFixture(
  paymentService: PaymentService,
  ticketService: TicketService,
  number: number,
) {
  const creator = await createTestUser({ role: 'CREATOR' })
  const buyer = await createTestUser()
  await seedDefaultPlatformFee(creator.id)

  const raffle = await createOpenRaffle(creator.id)
  const { tickets } = await ticketService.reserve(raffle.id, buyer.id, 1, [number])
  const ticket = tickets[0]
  const created = await paymentService.createCheckoutSession(ticket.id, buyer.id, 'http://localhost:3000')

  return { buyer, created, creator, raffle, ticket }
}
