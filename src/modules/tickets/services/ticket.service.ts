import { Prisma, Ticket } from '@prisma/client'
import { NotFoundError, ConflictError } from '@/shared/errors/AppError'
import { RaffleService } from '@/modules/raffles/services/raffle.service'
import { ReservationExpirationService } from '@/modules/financial/services/reservation-expiration.service'
import { prisma } from '@/shared/infra/prisma'
const raffleService = new RaffleService()
const reservationExpirationService = new ReservationExpirationService()

const RESERVATION_TTL_MS = 15 * 60 * 1000

interface ListTicketsOptions {
  page: number
  limit: number
}

export class TicketService {
  async reserve(
    raffleId: string,
    buyerId: string,
    quantity: number,
    requestedNumbers?: number[]
  ) {
    if (quantity < 1 || quantity > 100) {
      throw new ConflictError('Quantidade deve ser entre 1 e 100 cotas por compra')
    }

    const raffle = await raffleService.findById(raffleId)

    if (raffle.status !== 'OPEN') {
      throw new ConflictError('Esta rifa nao esta aberta para vendas')
    }

    const available = await raffleService.getAvailableTicketNumbers(raffleId)

    if (available.length < quantity) {
      throw new ConflictError(`Apenas ${available.length} cota(s) disponivel(is) nesta rifa`)
    }

    let chosen: number[]

    if (requestedNumbers?.length) {
      if (requestedNumbers.length !== quantity) {
        throw new ConflictError('Quantidade nao corresponde aos numeros informados')
      }

      const availableSet = new Set(available)
      const unique = new Set(requestedNumbers)

      if (unique.size !== requestedNumbers.length) {
        throw new ConflictError('Informe numeros diferentes para cada cota')
      }

      for (const number of requestedNumbers) {
        if (number < 1 || number > raffle.totalTickets) {
          throw new ConflictError(`Numero ${number} invalido para esta rifa`)
        }
        if (!availableSet.has(number)) {
          throw new ConflictError(`Numero ${number} nao esta disponivel`)
        }
      }

      chosen = requestedNumbers
    } else {
      chosen = pickRandomNumbers(available, quantity)
    }

    const reservedUntil = new Date(Date.now() + RESERVATION_TTL_MS)

    let tickets: Ticket[]
    try {
      tickets = await prisma.$transaction(
        chosen.map(number =>
          prisma.ticket.create({
            data: { raffleId, buyerId, number, status: 'RESERVED', reservedUntil },
          })
        )
      )
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Algumas cotas acabaram de ser reservadas. Tente novamente.')
      }
      throw error
    }

    return { tickets, totalCents: raffle.ticketPriceCents * quantity }
  }

  async findByRaffle(raffleId: string, options: ListTicketsOptions) {
    await raffleService.findById(raffleId)
    const skip = (options.page - 1) * options.limit

    const [total, data] = await prisma.$transaction([
      prisma.ticket.count({ where: { raffleId } }),
      prisma.ticket.findMany({
        where: { raffleId },
        skip,
        take: options.limit,
        include: { buyer: { select: { id: true, name: true } } },
        orderBy: { number: 'asc' },
      }),
    ])

    return {
      data,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    }
  }

  async findByUser(userId: string) {
    return prisma.ticket.findMany({
      where: { buyerId: userId },
      take: 100,
      include: {
        raffle: { select: { id: true, title: true, status: true, drawDate: true } },
        payment: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async cancelExpiredReservations() {
    return reservationExpirationService.cancelExpiredReservations()
  }

  async getTicketById(id: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { raffle: true, payment: true },
    })
    if (!ticket) throw new NotFoundError('Cota')
    return ticket
  }
}

function pickRandomNumbers(arr: number[], quantity: number): number[] {
  const copy = [...arr]

  for (let i = 0; i < quantity; i += 1) {
    const randomIndex = i + Math.floor(Math.random() * (copy.length - i))
    ;[copy[i], copy[randomIndex]] = [copy[randomIndex], copy[i]]
  }

  return copy.slice(0, quantity)
}