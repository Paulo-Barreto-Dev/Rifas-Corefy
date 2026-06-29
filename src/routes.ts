import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize, requireActiveUser } from '@/shared/middlewares/auth.middleware'
import {
  userController,
  raffleController,
  ticketController,
  paymentController,
  drawController,
} from '@/modules/controllers'
import {
  adminUserController,
  adminRaffleController,
  adminFinancialController,
  adminAuditController,
} from '@/modules/admin/controllers/admin.controller'
import { WithdrawalService } from '@/modules/financial/withdrawal.service'
import { env } from '@/config/env'

export const router = Router()

const withdrawalService = new WithdrawalService()

// ─── Auth / Users ─────────────────────────────────────────────────────────────
router.post('/auth/register', userController.register)
router.post('/auth/login',    userController.login)

router.get  ('/users/me',          authenticate, requireActiveUser, userController.profile)
router.patch('/users/me/pix-key',  authenticate, requireActiveUser, userController.updatePixKey)

// ─── Raffles (public) ─────────────────────────────────────────────────────────
router.get('/raffles',                       raffleController.list)
router.get('/raffles/:id',                   raffleController.getById)
router.get('/raffles/:id/tickets',           raffleController.getTickets)
router.get('/raffles/:id/available-numbers', raffleController.getAvailableNumbers)

// ─── Raffles (creator / admin) ────────────────────────────────────────────────
router.post(
  '/raffles',
  authenticate, requireActiveUser, authorize('CREATOR', 'ADMIN'),
  raffleController.create,
)
router.post(
  '/raffles/:id/publish',
  authenticate, requireActiveUser, authorize('CREATOR', 'ADMIN'),
  raffleController.publish,
)

// ─── Tickets ──────────────────────────────────────────────────────────────────
router.get ('/tickets/my',                authenticate, requireActiveUser, ticketController.myTickets)
router.post('/raffles/:raffleId/tickets', authenticate, requireActiveUser, ticketController.reserve)

// ─── Payments ─────────────────────────────────────────────────────────────────
router.post('/payments/tickets/:ticketId/pix',    authenticate, requireActiveUser, paymentController.createPix)
router.get ('/payments/tickets/:ticketId/status', authenticate, requireActiveUser, paymentController.status)
router.post('/payments/webhook', paymentController.webhook) // público — validar HMAC em produção

if (env.NODE_ENV !== 'production') {
  router.post('/payments/:id/approve-test', paymentController.approveTest)
  router.post('/payments/:id/fail-test', paymentController.failTest)
}

// ─── Draws ────────────────────────────────────────────────────────────────────
router.post('/raffles/:raffleId/draw', authenticate, authorize('CREATOR', 'ADMIN'), drawController.execute)
router.get ('/raffles/:raffleId/draw', drawController.result)

// ─── Withdrawals (user-facing) ────────────────────────────────────────────────
router.post('/withdrawals', authenticate, requireActiveUser, async (req, res) => {
  const body = z
    .object({
      amountCents: z.coerce.number().int().min(1),
      pixKey:      z.string().min(3),
    })
    .parse(req.body)

  const result = await withdrawalService.requestWithdrawal(req.user!.sub, body.amountCents, body.pixKey)
  res.status(201).json(result)
})

router.get('/withdrawals/my', authenticate, requireActiveUser, async (req, res) => {
  const result = await withdrawalService.listMyWithdrawals(req.user!.sub)
  res.json(result)
})

// ─── Admin — Users ────────────────────────────────────────────────────────────
const admin = authorize('ADMIN')

router.get  ('/admin/users',                             authenticate, admin, adminUserController.listUsers)
router.get  ('/admin/users/creators',                    authenticate, admin, adminUserController.listCreators)
router.get  ('/admin/users/:userId/history',             authenticate, admin, adminUserController.getUserHistory)
router.patch('/admin/users/:userId/block',               authenticate, admin, adminUserController.blockUser)
router.patch('/admin/users/:userId/unblock',             authenticate, admin, adminUserController.unblockUser)
router.patch('/admin/users/:userId/creator-verification',authenticate, admin, adminUserController.setCreatorVerification)

// ─── Admin — Raffles ──────────────────────────────────────────────────────────
router.get  ('/admin/raffles',                  authenticate, admin, adminRaffleController.listRaffles)
router.patch('/admin/raffles/:raffleId/approve',authenticate, admin, adminRaffleController.approveRaffle)
router.patch('/admin/raffles/:raffleId/reject', authenticate, admin, adminRaffleController.rejectRaffle)
router.patch('/admin/raffles/:raffleId/pause',  authenticate, admin, adminRaffleController.pauseRaffle)
router.patch('/admin/raffles/:raffleId/resume', authenticate, admin, adminRaffleController.resumeRaffle)
router.patch('/admin/raffles/:raffleId/cancel', authenticate, admin, adminRaffleController.cancelRaffle)

// ─── Admin — Financial ────────────────────────────────────────────────────────
router.get  ('/admin/payments',                              authenticate, admin, adminFinancialController.listPayments)
router.get  ('/admin/withdrawals',                           authenticate, admin, adminFinancialController.listWithdrawals)
router.patch('/admin/withdrawals/:withdrawalId/review',      authenticate, admin, adminFinancialController.reviewWithdrawal)
router.get  ('/admin/fees',                                  authenticate, admin, adminFinancialController.listFees)
router.put  ('/admin/fees',                                  authenticate, admin, adminFinancialController.upsertFee)
router.patch('/admin/fees/:key/toggle',                      authenticate, admin, adminFinancialController.toggleFee)
router.get  ('/admin/reports/financial',                     authenticate, admin, adminFinancialController.getReport)

// ─── Admin — Audit Logs ───────────────────────────────────────────────────────
router.get('/admin/audit-logs', authenticate, admin, adminAuditController.listLogs)