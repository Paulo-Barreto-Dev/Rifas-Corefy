import { UserRole } from '@prisma/client'
import { env } from '@/config/env'
import { NotFoundError, ConflictError, AppError } from '@/shared/errors/AppError'
import { logger } from '@/shared/utils/logger'
import { prisma } from '@/shared/infra/prisma'

export class DrawService {
  async executeDraw(raffleId: string, requesterId: string, requesterRole: UserRole) {
    const raffle = await prisma.raffle.findUnique({
      where: { id: raffleId },
      include: {
        draw: true,
        tickets: { where: { status: 'PAID' }, orderBy: { number: 'asc' } },
      },
    })







// LEMBRA DE ATUALIZAR ESSA PORCARIA QUANDO MEXER NO PRISMA, PQ O PRISMA NÃO ATUALIZA OS TIPOS AUTOMATICAMENTE, VAI DAR ERRO DE COMPILAÇÃO 
// SE ESQUECER DE ATUALIZAR ESSA PORCARIA (Para: Paulo daqui 2 dias que vai esquecer.)







    if (!raffle) throw new NotFoundError('Rifa')
    if (raffle.creatorId !== requesterId && requesterRole !== UserRole.ADMIN) {
      throw new AppError('Somente o criador pode executar o sorteio', 403, 'FORBIDDEN')
    }
    if (!['OPEN', 'SOLD_OUT'].includes(raffle.status)) {
      throw new ConflictError(`Rifa com status "${raffle.status}" não pode ser sorteada`)
    }
    if (raffle.tickets.length === 0) {
      throw new ConflictError('Nenhuma cota paga — sorteio impossível')
    }
    if (raffle.draw) {
      throw new ConflictError('Sorteio já realizado para esta rifa')
    }

    let winnerTicketId: string
    let loteriaExtract: string | undefined

    if (raffle.drawMethod === 'PLATFORM_RANDOM') {
      winnerTicketId = this.drawRandom(raffle.tickets.map(t => t.id))
    } else {
      const result = await this.drawByLoteriaFederal(
        raffle.loteriaNumber,
        raffle.tickets
      )
      winnerTicketId = result.winnerTicketId
      loteriaExtract = result.extract
    }

    const winner = raffle.tickets.find(t => t.id === winnerTicketId)!

    const [draw] = await prisma.$transaction([
      prisma.draw.create({
        data: {
          raffleId,
          method: raffle.drawMethod,
          winnerTicketId,
          loteriaExtract,
          executedAt: new Date(),
        },
      }),
      prisma.raffle.update({
        where: { id: raffleId },
        data: {
          status: 'FINISHED',
          winnerId: winner.buyerId,
          winnerTicketId,
        },
      }),
    ])

    logger.info('Sorteio concluído', { raffleId, winnerTicketId, buyerId: winner.buyerId })
    return draw
  }

  async getDrawResult(raffleId: string) {
    const draw = await prisma.draw.findUnique({
      where: { raffleId },
      include: {
        raffle: {
          include: {
            winner: { select: { id: true, name: true } },
            winnerTicket: { select: { id: true, number: true } },
          },
        },
        winnerTicket: { select: { id: true, number: true } },
      },
    })
    if (!draw) throw new NotFoundError('Resultado do sorteio')
    return draw
  }


  private drawRandom(ticketIds: string[]): string {
    const idx = Math.floor(Math.random() * ticketIds.length)
    return ticketIds[idx]
  }

  private async drawByLoteriaFederal(
    loteriaNumber: string | null,
    tickets: { id: string; number: number }[]
  ): Promise<{ winnerTicketId: string; extract: string }> {
    if (!loteriaNumber) {
      throw new ConflictError('Número do concurso da Loteria Federal não configurado')
    }

    const url = `${env.LOTERIA_API_URL}/federal/latest`
    const resp = await fetch(url)

    if (!resp.ok) {
      throw new AppError('Falha ao consultar API da Loteria Federal', 502, 'LOTERIA_API_ERROR')
    }

    const data = (await resp.json()) as { dezenas?: string[] }

    if (!data.dezenas || data.dezenas.length === 0) {
      throw new AppError('Resultado da Loteria Federal indisponível', 502, 'LOTERIA_NO_RESULT')
    }

    // Usa os últimos 2 dígitos do 1º prêmio como base do sorteio
    const firstPrize = data.dezenas[0]
    const seedNumber = parseInt(firstPrize.slice(-2), 10)
    const totalTickets = tickets.length

    // Mapeia o número sorteado para o índice de cotas disponíveis
    const winnerIndex = seedNumber % totalTickets
    const winnerTicket = tickets[winnerIndex]

    const extract = JSON.stringify({
      concurso: loteriaNumber,
      primeiro_premio: firstPrize,
      seed_usado: seedNumber,
      indice_vencedor: winnerIndex,
      cota_vencedora: winnerTicket.number,
    })

    return { winnerTicketId: winnerTicket.id, extract }
  }
}