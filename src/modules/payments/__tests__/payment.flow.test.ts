import { beforeEach, describe, expect, it } from 'vitest'
import { PaymentService } from '@/modules/payments/services/payment.service'
import { TicketService } from '@/modules/tickets/services/ticket.service'
import { ReservationExpirationService } from '@/modules/financial/services/reservation-expiration.service'
import { FakePaymentProvider } from '@/modules/payments/providers/fake-payment.provider'
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

  it('aprova pagamento e marca ticket como PAID', async () => {
    const creator = await createTestUser({ role: 'CREATOR' })
    const buyer = await createTestUser()
    await seedDefaultPlatformFee(creator.id)

    const raffle = await createOpenRaffle(creator.id)
    const { tickets } = await ticketService.reserve(raffle.id, buyer.id, 1, [1])
    const ticket = tickets[0]

    const created = await paymentService.createPixPayment(ticket.id, buyer.id)
    expect(created.payment.status).toBe('PENDING')

    const ticketBefore = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    expect(ticketBefore?.status).toBe('RESERVED')

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
    expect(transactions).toHaveLength(3)
    expect(transactions.map(t => t.type).sort()).toEqual([
      'CREATOR_EARNING',
      'PLATFORM_FEE',
      'SALE',
    ])
  })

  it('mantém ticket RESERVED enquanto pagamento está pendente', async () => {
    const creator = await createTestUser({ role: 'CREATOR' })
    const buyer = await createTestUser()
    await seedDefaultPlatformFee(creator.id)

    const raffle = await createOpenRaffle(creator.id)
    const { tickets } = await ticketService.reserve(raffle.id, buyer.id, 1, [2])
    const ticket = tickets[0]

    const created = await paymentService.createPixPayment(ticket.id, buyer.id)

    const ticketAfter = await prisma.ticket.findUnique({ where: { id: ticket.id } })
    const paymentAfter = await prisma.payment.findUnique({ where: { id: created.payment.id } })

    expect(paymentAfter?.status).toBe('PENDING')
    expect(ticketAfter?.status).toBe('RESERVED')
    expect(ticketAfter?.reservedUntil).toBeTruthy()
  })
})

describe('Ticket concurrency', () => {
  const ticketService = new TicketService()

  beforeEach(async () => {
    await resetDatabase()
  })

  it('permite reservar o mesmo número para apenas um comprador', async () => {
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

  it('cancela ticket RESERVED após expiração da reserva', async () => {
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
