import { Request, Response } from 'express'
import { z } from 'zod'
import { DrawMethod, RaffleStatus } from '@prisma/client'
import { UserService } from '@/modules/users/services/user.service'
import { RaffleService } from '@/modules/raffles/services/raffle.service'
import { TicketService } from '@/modules/tickets/services/ticket.service'
import { PaymentService } from '@/modules/payments/services/payment.service'
import { DrawService } from '@/modules/draws/services/draw.service'

const userService = new UserService()
const raffleService = new RaffleService()
const ticketService = new TicketService()
const paymentService = new PaymentService()
const drawService = new DrawService()

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().transform(email => email.trim().toLowerCase()),
  cpf: z.string().regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, 'CPF invalido'),
  phone: z.string().optional(),
  password: z.string().min(8),
  role: z.enum(['BUYER', 'CREATOR']).optional(),
})

const loginSchema = z.object({
  email: z.string().email().transform(email => email.trim().toLowerCase()),
  password: z.string(),
})

const createRaffleSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().min(10).max(2000),
  imageUrl: z.string().url().optional(),
  totalTickets: z.coerce.number().int().min(2).max(100_000),
  ticketPriceCents: z.coerce.number().int().min(100),
  drawMethod: z.nativeEnum(DrawMethod),
  drawDate: z.coerce.date().optional(),
  loteriaNumber: z.string().optional(),
})

const raffleFiltersSchema = z.object({
  status: z.nativeEnum(RaffleStatus).optional(),
  creatorId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
})

const availableNumbersSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

const ticketListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const userController = {
  async register(req: Request, res: Response) {
    const data = registerSchema.parse(req.body)
    const result = await userService.register(data)
    res.status(201).json(result)
  },

  async login(req: Request, res: Response) {
    const data = loginSchema.parse(req.body)
    const result = await userService.login(data)
    res.json(result)
  },

  async profile(req: Request, res: Response) {
    const user = await userService.getProfile(req.user!.sub)
    res.json(user)
  },

  async updatePixKey(req: Request, res: Response) {
    const { pixKey } = z.object({ pixKey: z.string().min(3) }).parse(req.body)
    const result = await userService.updatePixKey(req.user!.sub, pixKey)
    res.json(result)
  },
}

export const raffleController = {
  async create(req: Request, res: Response) {
    const data = createRaffleSchema.parse(req.body)
    const raffle = await raffleService.create(req.user!.sub, data)
    res.status(201).json(raffle)
  },

  async list(req: Request, res: Response) {
    const { page, limit, ...filters } = raffleFiltersSchema.parse(req.query)
    const raffles = await raffleService.list(filters, { page, limit })
    res.json(raffles)
  },

  async getById(req: Request, res: Response) {
    const raffle = await raffleService.findById(req.params.id)
    res.json(raffle)
  },

  async publish(req: Request, res: Response) {
    const raffle = await raffleService.publish(req.params.id, req.user!.sub, req.user!.role)
    res.json(raffle)
  },

  async getTickets(req: Request, res: Response) {
    const query = ticketListSchema.parse(req.query)
    const tickets = await ticketService.findByRaffle(req.params.id, query)
    res.json(tickets)
  },

  async getAvailableNumbers(req: Request, res: Response) {
    const query = availableNumbersSchema.parse(req.query)
    const result = await raffleService.getAvailableTicketNumbersPage(req.params.id, query)
    res.json(result)
  },
}

export const ticketController = {
  async reserve(req: Request, res: Response) {
    const body = z
      .object({
        quantity: z.coerce.number().int().min(1).max(100).optional(),
        numbers: z.array(z.coerce.number().int().min(1)).min(1).max(100).optional(),
      })
      .refine(data => data.quantity || data.numbers?.length, {
        message: 'Informe quantity ou numbers',
      })
      .parse(req.body)

    const numbers = body.numbers
    const quantity = numbers?.length ?? body.quantity!
    const result = await ticketService.reserve(
      req.params.raffleId,
      req.user!.sub,
      quantity,
      numbers
    )
    res.status(201).json(result)
  },

  async myTickets(req: Request, res: Response) {
    const tickets = await ticketService.findByUser(req.user!.sub)
    res.json(tickets)
  },
}

export const paymentController = {
  async createPix(req: Request, res: Response) {
    const result = await paymentService.createPixPayment(req.params.ticketId, req.user!.sub)
    res.status(201).json(result)
  },

  async status(req: Request, res: Response) {
    const payment = await paymentService.getPaymentStatus(req.params.ticketId, req.user!.sub)
    res.json(payment)
  },

  async webhook(req: Request, res: Response) {
    const { pixTxId } = z.object({ pixTxId: z.string().min(1) }).parse(req.body)
    const result = await paymentService.confirmPayment(pixTxId)
    res.json(result)
  },

  async approveTest(req: Request, res: Response) {
    const result = await paymentService.approveTestPayment(req.params.id)
    res.json(result)
  },

  async failTest(req: Request, res: Response) {
    const result = await paymentService.failTestPayment(req.params.id)
    res.json(result)
  },
}

export const drawController = {
  async execute(req: Request, res: Response) {
    const draw = await drawService.executeDraw(req.params.raffleId, req.user!.sub, req.user!.role)
    res.json(draw)
  },

  async result(req: Request, res: Response) {
    const result = await drawService.getDrawResult(req.params.raffleId)
    res.json(result)
  },
}