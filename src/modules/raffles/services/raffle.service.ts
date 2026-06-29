import { RaffleStatus, DrawMethod, UserRole } from '@prisma/client'
import { NotFoundError, ForbiddenError, ConflictError } from '@/shared/errors/AppError'
import { prisma } from '@/shared/infra/prisma'

export interface CreateRaffleDto {
  title: string
  description: string
  imageUrl?: string
  totalTickets: number
  ticketPriceCents: number
  drawMethod: DrawMethod
  drawDate?: Date
  loteriaNumber?: string   // fixed: was loteriaFederalNumber in old schema
}

export interface UpdateRaffleDto extends Partial<CreateRaffleDto> {
  status?: RaffleStatus
}

interface ListRafflesOptions {
  page: number
  limit: number
}

interface AvailableNumbersOptions {
  offset: number
  limit: number
}

export class RaffleService {
  async create(creatorId: string, data: CreateRaffleDto) {
    if (data.totalTickets < 2 || data.totalTickets > 100_000) {
      throw new ConflictError('Total de cotas deve ser entre 2 e 100.000')
    }
    if (data.ticketPriceCents < 100) {
      throw new ConflictError('Preço mínimo por cota é R$ 1,00')
    }
    if (data.drawMethod === DrawMethod.LOTERIA_FEDERAL && !data.loteriaNumber) {
      throw new ConflictError('Informe o concurso da Loteria Federal para este método de sorteio')
    }

    return prisma.raffle.create({
      data: { ...data, creatorId },
    })
  }

  async findById(id: string) {
    const raffle = await prisma.raffle.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        _count: { select: { tickets: { where: { status: 'PAID' } } } },
      },
    })
    if (!raffle) throw new NotFoundError('Rifa')
    return raffle
  }

  async list(
    filters: { status?: RaffleStatus; creatorId?: string } = {},
    options: ListRafflesOptions
  ) {
    const skip = (options.page - 1) * options.limit

    const [total, data] = await prisma.$transaction([
      prisma.raffle.count({ where: filters }),
      prisma.raffle.findMany({
        where: filters,
        skip,
        take: options.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, name: true } },
          _count: { select: { tickets: { where: { status: 'PAID' } } } },
        },
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

  async update(
    id: string,
    requesterId: string,
    requesterRole: UserRole,
    data: UpdateRaffleDto
  ) {
    const raffle = await this.findById(id)

    if (raffle.creatorId !== requesterId && requesterRole !== UserRole.ADMIN) {
      throw new ForbiddenError('Somente o criador pode editar esta rifa')
    }
    if (raffle.status !== 'DRAFT' && data.status !== 'CANCELLED') {
      throw new ConflictError('Só é possível editar rifas em rascunho')
    }

    return prisma.raffle.update({ where: { id }, data })
  }

  async publish(id: string, requesterId: string, requesterRole: UserRole) {
    const raffle = await this.findById(id)

    if (raffle.creatorId !== requesterId && requesterRole !== UserRole.ADMIN) {
      throw new ForbiddenError('Acesso negado')
    }
    if (raffle.status !== 'DRAFT') throw new ConflictError('Rifa já foi publicada')

    return prisma.raffle.update({
      where: { id },
      data: { status: RaffleStatus.OPEN },
    })
  }

  async getAvailableTicketNumbers(raffleId: string): Promise<number[]> {
    const raffle = await this.findById(raffleId)
    const unavailableNumbers = await this.getUnavailableTicketNumberSet(raffleId)
    const available: number[] = []

    for (let number = 1; number <= raffle.totalTickets; number += 1) {
      if (!unavailableNumbers.has(number)) available.push(number)
    }

    return available
  }

  async getAvailableTicketNumbersPage(
    raffleId: string,
    options: AvailableNumbersOptions
  ) {
    const raffle = await this.findById(raffleId)
    const unavailableNumbers = await this.getUnavailableTicketNumberSet(raffleId)
    const numbers: number[] = []
    let available = 0

    for (let number = 1; number <= raffle.totalTickets; number += 1) {
      if (unavailableNumbers.has(number)) continue

      if (available >= options.offset && numbers.length < options.limit) {
        numbers.push(number)
      }
      available += 1
    }

    return {
      available,
      numbers,
      offset: options.offset,
      limit: options.limit,
      hasMore: options.offset + numbers.length < available,
    }
  }

  private async getUnavailableTicketNumberSet(
    raffleId: string
  ): Promise<Set<number>> {
    const now = new Date()
    const tickets = await prisma.ticket.findMany({
      where: {
        raffleId,
        OR: [
          { status: 'PAID' },
          {
            status: 'RESERVED',
            OR: [{ reservedUntil: null }, { reservedUntil: { gte: now } }],
          },
        ],
      },
      select: { number: true },
    })
    return new Set(tickets.map(t => t.number))
  }
}