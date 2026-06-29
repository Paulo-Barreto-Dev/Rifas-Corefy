import { Request, Response } from 'express'
import { z } from 'zod'
import { PaymentStatus, RaffleStatus, UserRole, UserStatus, WithdrawalStatus } from '@prisma/client'
import { AdminUserService }      from '@/modules/admin/services/admin-user.service'
import { AdminRaffleService }    from '@/modules/admin/services/admin-raffle.service'
import { AdminFinancialService } from '@/modules/admin/services/admin-financial.service'
import { AuditService }          from '@/modules/admin/services/audit.service'

const adminUserService      = new AdminUserService()
const adminRaffleService    = new AdminRaffleService()
const adminFinancialService = new AdminFinancialService()
const auditService          = new AuditService()

// ── Shared schemas ────────────────────────────────────────────────────────────

const pagination = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const dateRange = z.object({
  from: z.coerce.date().optional(),
  to:   z.coerce.date().optional(),
})

// ── User Controllers ──────────────────────────────────────────────────────────

export const adminUserController = {
  async listUsers(req: Request, res: Response) {
    const query = pagination.extend({
      role:              z.nativeEnum(UserRole).optional(),
      status:            z.nativeEnum(UserStatus).optional(),
      isVerifiedCreator: z.coerce.boolean().optional(),
      search:            z.string().min(1).optional(),
    }).parse(req.query)

    const result = await adminUserService.listUsers(query)
    res.json(result)
  },

  async listCreators(req: Request, res: Response) {
    const query = pagination.extend({
      isVerifiedCreator: z.coerce.boolean().optional(),
    }).parse(req.query)

    const result = await adminUserService.listCreators(query)
    res.json(result)
  },

  async blockUser(req: Request, res: Response) {
    const { reason } = z
      .object({ reason: z.string().min(5, 'Motivo deve ter ao menos 5 caracteres') })
      .parse(req.body)

    const result = await adminUserService.blockUser(
      req.params.userId,
      req.user!.sub,
      reason,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async unblockUser(req: Request, res: Response) {
    const result = await adminUserService.unblockUser(
      req.params.userId,
      req.user!.sub,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async setCreatorVerification(req: Request, res: Response) {
    const { verified } = z.object({ verified: z.boolean() }).parse(req.body)

    const result = await adminUserService.setCreatorVerification(
      req.params.userId,
      req.user!.sub,
      verified,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async getUserHistory(req: Request, res: Response) {
    const result = await adminUserService.getUserHistory(req.params.userId)
    res.json(result)
  },
}

// ── Raffle Controllers ────────────────────────────────────────────────────────

export const adminRaffleController = {
  async listRaffles(req: Request, res: Response) {
    const query = pagination.extend({
      status:    z.nativeEnum(RaffleStatus).optional(),
      creatorId: z.string().uuid().optional(),
      search:    z.string().min(1).optional(),
    }).parse(req.query)

    const result = await adminRaffleService.listRaffles(query)
    res.json(result)
  },

  async approveRaffle(req: Request, res: Response) {
    const result = await adminRaffleService.approveRaffle(
      req.params.raffleId,
      req.user!.sub,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async rejectRaffle(req: Request, res: Response) {
    const { reason } = z
      .object({ reason: z.string().min(10, 'Informe um motivo com ao menos 10 caracteres') })
      .parse(req.body)

    const result = await adminRaffleService.rejectRaffle(
      req.params.raffleId,
      req.user!.sub,
      reason,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async pauseRaffle(req: Request, res: Response) {
    const { reason } = z
      .object({ reason: z.string().min(5, 'Informe um motivo com ao menos 5 caracteres') })
      .parse(req.body)

    const result = await adminRaffleService.pauseRaffle(
      req.params.raffleId,
      req.user!.sub,
      reason,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async resumeRaffle(req: Request, res: Response) {
    const result = await adminRaffleService.resumeRaffle(
      req.params.raffleId,
      req.user!.sub,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async cancelRaffle(req: Request, res: Response) {
    const body = z
      .object({
        reason:       z.string().min(10, 'Informe um motivo com ao menos 10 caracteres'),
        issueRefunds: z.boolean().default(false),
      })
      .parse(req.body)

    const result = await adminRaffleService.cancelRaffle(
      req.params.raffleId,
      req.user!.sub,
      body.reason,
      body.issueRefunds,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },
}

// ── Financial Controllers ─────────────────────────────────────────────────────

export const adminFinancialController = {
  async listPayments(req: Request, res: Response) {
    const query = pagination.merge(dateRange).extend({
      status: z.nativeEnum(PaymentStatus).optional(),
      userId: z.string().uuid().optional(),
    }).parse(req.query)

    const result = await adminFinancialService.listPayments(query)
    res.json(result)
  },

  async listWithdrawals(req: Request, res: Response) {
    const query = pagination.merge(dateRange).extend({
      status: z.nativeEnum(WithdrawalStatus).optional(),
      userId: z.string().uuid().optional(),
    }).parse(req.query)

    const result = await adminFinancialService.listWithdrawals(query)
    res.json(result)
  },

  async reviewWithdrawal(req: Request, res: Response) {
    const body = z
      .object({
        decision: z.enum(['APPROVED', 'REJECTED']),
        notes:    z.string().min(1).optional(),
      })
      .parse(req.body)

    const result = await adminFinancialService.reviewWithdrawal(
      req.params.withdrawalId,
      req.user!.sub,
      body.decision,
      body.notes,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async listFees(req: Request, res: Response) {
    const result = await adminFinancialService.listFees()
    res.json(result)
  },

  async upsertFee(req: Request, res: Response) {
    const body = z
      .object({
        key:         z.string().min(2).max(50).regex(/^[a-z_]+$/, 'Use apenas letras minúsculas e underscore'),
        description: z.string().min(5),
        basisPoints: z.coerce.number().int().min(0).max(10_000),
      })
      .parse(req.body)

    const result = await adminFinancialService.upsertFee(
      body.key,
      body.description,
      body.basisPoints,
      req.user!.sub,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async toggleFee(req: Request, res: Response) {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body)

    const result = await adminFinancialService.toggleFee(
      req.params.key,
      isActive,
      req.user!.sub,
      req.ip,
      req.headers['user-agent'],
    )
    res.json(result)
  },

  async getReport(req: Request, res: Response) {
    const query = z
      .object({
        from: z.coerce.date(),
        to:   z.coerce.date(),
      })
      .refine(d => d.from <= d.to, { message: '"from" deve ser anterior a "to"' })
      .parse(req.query)

    const result = await adminFinancialService.getFinancialReport(query.from, query.to)
    res.json(result)
  },
}

// ── Audit Controllers ─────────────────────────────────────────────────────────

export const adminAuditController = {
  async listLogs(req: Request, res: Response) {
    const query = pagination.merge(dateRange).extend({
      adminId:    z.string().uuid().optional(),
      targetType: z.string().min(1).optional(),
      targetId:   z.string().min(1).optional(),
      action:     z.string().min(1).optional(),
    }).parse(req.query)

    const result = await auditService.findAll(query)
    res.json(result)
  },
}