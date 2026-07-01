import { Prisma } from '@prisma/client'
import Stripe from 'stripe'
import { AppError, NotFoundError } from '@/shared/errors/AppError'
import { TicketService } from '@/modules/tickets/services/ticket.service'
import { FinancialTransactionService } from '@/modules/financial/services/financial-transaction.service'
import { PaymentAuditService } from '@/modules/payments/services/payment-audit.service'
import { getFakePaymentProvider, getPaymentProvider } from '@/modules/payments/providers/payment-provider.factory'
import { FakePaymentProvider } from '@/modules/payments/providers/fake-payment.provider'
import {
  FakeWebhookEventPayload,
  PaymentProvider,
} from '@/modules/payments/providers/payment-provider.interface'
import { StripeService } from '@/modules/payments/providers/stripe/stripe.service'
import { logger } from '@/shared/utils/logger'
import { env } from '@/config/env'
import { prisma } from '@/shared/infra/prisma'

const ticketService = new TicketService()
const financialTransactionService = new FinancialTransactionService()
const paymentAuditService = new PaymentAuditService()

type TransactionClient = Prisma.TransactionClient

export class PaymentService {
  private readonly stripeService?: StripeService

  constructor(
    private readonly provider: PaymentProvider = getPaymentProvider(),
    stripeService?: StripeService,
  ) {
    this.stripeService = stripeService
  }

  async createCheckoutSession(ticketId: string, userId: string, baseUrl: string) {
    const ticket = await ticketService.getTicketById(ticketId)

    if (ticket.buyerId !== userId) {
      throw new AppError('Esta cota nao pertence a voce', 403, 'FORBIDDEN')
    }
    if (ticket.status !== 'RESERVED') {
      throw new AppError('Cota nao esta reservada', 409, 'INVALID_STATUS')
    }
    if (ticket.reservedUntil && ticket.reservedUntil < new Date()) {
      throw new AppError('Reserva expirada. Selecione novamente', 409, 'RESERVATION_EXPIRED')
    }
    if (ticket.payment) {
      throw new AppError('Pagamento ja iniciado para esta cota', 409, 'ALREADY_EXISTS')
    }

    const amountCents = ticket.raffle.ticketPriceCents
    const buyer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    if (!buyer) throw new NotFoundError('Usuario')

    const { successUrl, cancelUrl } = this.buildCheckoutUrls(baseUrl, ticketId)
    const providerResult = await this.provider.createPayment({
      amountCents,
      description: `Cota #${ticket.number} - ${ticket.raffle.title}`,
      payerEmail: buyer.email,
      externalReference: ticketId,
      successUrl,
      cancelUrl,
    })

    if (env.PAYMENT_PROVIDER === 'stripe' && !providerResult.checkoutUrl) {
      throw new AppError('O provider nao retornou a URL do checkout', 502, 'PROVIDER_ERROR')
    }

    try {
      const payment = await prisma.$transaction(async tx => {
        const created = await tx.payment.create({
          data: {
            ticketId,
            userId,
            amountCents,
            provider: env.PAYMENT_PROVIDER,
            providerCheckoutSessionId: providerResult.checkoutSessionId,
            providerPaymentId: providerResult.providerPaymentId ?? undefined,
            providerCheckoutUrl: providerResult.checkoutUrl,
            providerExpiresAt: providerResult.expiresAt,
            status: 'PENDING',
          },
        })

        await paymentAuditService.log(tx, {
          paymentId: created.id,
          action: 'PAYMENT_CREATED',
          after: {
            status: created.status,
            amountCents,
            provider: created.provider,
            providerCheckoutSessionId: created.providerCheckoutSessionId,
            providerPaymentId: created.providerPaymentId,
          },
        })

        return created
      })

      logger.info('Sessao de checkout criada', {
        paymentId: payment.id,
        ticketId,
        provider: payment.provider,
        providerCheckoutSessionId: payment.providerCheckoutSessionId,
        amountCents,
      })

      return {
        payment,
        checkoutUrl: providerResult.checkoutUrl,
        qrCode: providerResult.qrCode,
        sessionId: providerResult.checkoutSessionId,
        expiresAt: providerResult.expiresAt,
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('Pagamento ja iniciado para esta cota', 409, 'ALREADY_EXISTS')
      }

      throw error
    }
  }

  async handleWebhook(payload: Buffer, signature?: string) {
    if (env.PAYMENT_PROVIDER === 'fake') {
      const event = this.parseFakeWebhookPayload(payload)
      return this.handleFakeWebhook(event)
    }

    if (!signature) {
      throw new AppError('Assinatura do webhook ausente', 400, 'MISSING_WEBHOOK_SIGNATURE')
    }

    const event = this.getStripeService().constructWebhookEvent(payload, signature)
    return this.processStripeWebhookEvent(event)
  }

  async handleFakeWebhook(event: FakeWebhookEventPayload) {
    if (env.PAYMENT_PROVIDER !== 'fake') {
      throw new AppError('Webhook fake indisponivel com o provider atual', 409, 'INVALID_PROVIDER')
    }

    return this.processFakeWebhookEvent(event)
  }

  async finalizeApprovedPayment(paymentId: string) {
    const updatedPayment = await prisma.$transaction(tx => this.confirmPaymentInTransaction(tx, paymentId))

    logger.info('Pagamento confirmado', { paymentId, ticketId: updatedPayment.ticketId })
    return updatedPayment
  }

  async approveTestPayment(paymentId: string) {
    if (env.NODE_ENV === 'production') {
      throw new AppError('Endpoint disponivel apenas fora de producao', 404, 'NOT_FOUND')
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    if (!payment) throw new NotFoundError('Pagamento')

    const fakeProvider = this.getFakeProvider()
    const event = fakeProvider.simulateApproved(payment.providerCheckoutSessionId)

    await this.processFakeWebhookEvent(event)

    return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  async failTestPayment(paymentId: string) {
    if (env.NODE_ENV === 'production') {
      throw new AppError('Endpoint disponivel apenas fora de producao', 404, 'NOT_FOUND')
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    if (!payment) throw new NotFoundError('Pagamento')

    const fakeProvider = this.getFakeProvider()
    const event = fakeProvider.simulateFailed(payment.providerCheckoutSessionId)

    await this.processFakeWebhookEvent(event)

    return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  async getPaymentStatus(ticketId: string, userId: string) {
    const ticket = await ticketService.getTicketById(ticketId)
    if (ticket.buyerId !== userId) {
      throw new AppError('Acesso negado', 403, 'FORBIDDEN')
    }

    if (!ticket.payment) return null

    const providerStatus = await this.provider.getPaymentStatus({
      checkoutSessionId: ticket.payment.providerCheckoutSessionId,
      providerPaymentId: ticket.payment.providerPaymentId,
    })

    let currentPayment = ticket.payment

    if (providerStatus.status === 'approved' && ticket.payment.status === 'PENDING') {
      currentPayment = await this.finalizeApprovedPayment(ticket.payment.id)
    } else if (
      (providerStatus.status === 'failed' ||
        providerStatus.status === 'expired' ||
        providerStatus.status === 'cancelled') &&
      ticket.payment.status === 'PENDING'
    ) {
      currentPayment = await this.reconcileFailedProviderStatus(ticket.payment.id, providerStatus.status)
    }

    return {
      ...currentPayment,
      providerStatus: providerStatus.status,
    }
  }

  async processFakeWebhookEvent(event: FakeWebhookEventPayload) {
    try {
      return await prisma.$transaction(async tx => {
        const webhookEvent = await tx.paymentWebhookEvent.create({
          data: {
            provider: 'fake',
            providerEventId: event.eventId,
            eventType: event.eventType,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        })

        const payment = await this.findPaymentByCheckoutSession(tx, event.checkoutSessionId)

        if (!payment) {
          logger.warn('Evento fake sem pagamento local correspondente', {
            checkoutSessionId: event.checkoutSessionId,
            eventType: event.eventType,
          })

          return {
            received: true,
            duplicate: false,
            eventId: event.eventId,
            eventType: event.eventType,
            paymentId: null,
          }
        }

        await tx.paymentWebhookEvent.update({
          where: { id: webhookEvent.id },
          data: { paymentId: payment.id },
        })

        switch (event.eventType) {
          case 'payment.approved':
            await this.confirmPaymentInTransaction(tx, payment.id)
            break
          case 'payment.failed':
            await this.markPaymentAsFailedInTransaction(tx, payment.id, 'PAYMENT_FAILED', {
              source: 'fake_webhook',
              eventType: event.eventType,
            })
            break
          case 'payment.expired':
            await this.markPaymentAsExpiredInTransaction(tx, payment.id, {
              source: 'fake_webhook',
              eventType: event.eventType,
            })
            break
          case 'payment.cancelled':
            await this.markPaymentAsCancelledInTransaction(tx, payment.id, {
              source: 'fake_webhook',
              eventType: event.eventType,
            })
            break
        }

        return {
          received: true,
          duplicate: false,
          eventId: event.eventId,
          eventType: event.eventType,
          paymentId: payment.id,
        }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return {
          received: true,
          duplicate: true,
          eventId: event.eventId,
          eventType: event.eventType,
        }
      }

      throw error
    }
  }

  private async processStripeWebhookEvent(event: Stripe.Event) {
    try {
      return await prisma.$transaction(async tx => {
        const webhookEvent = await tx.paymentWebhookEvent.create({
          data: {
            provider: 'stripe',
            providerEventId: event.id,
            eventType: event.type,
            payload: this.toWebhookPayload(event),
          },
        })

        let paymentId: string | null = null

        switch (event.type) {
          case 'checkout.session.completed':
            paymentId = await this.handleCheckoutSessionCompleted(tx, event.data.object)
            break
          case 'checkout.session.expired':
            paymentId = await this.handleCheckoutSessionExpired(tx, event.data.object)
            break
          case 'payment_intent.succeeded':
            paymentId = await this.handlePaymentIntentSucceeded(tx, event.data.object)
            break
          case 'payment_intent.payment_failed':
            paymentId = await this.handlePaymentIntentFailed(tx, event.data.object)
            break
          case 'charge.refunded':
            paymentId = await this.handleChargeRefunded(tx, event.data.object)
            break
          default:
            logger.info('Evento Stripe ignorado', { eventId: event.id, eventType: event.type })
        }

        if (paymentId) {
          await tx.paymentWebhookEvent.update({
            where: { id: webhookEvent.id },
            data: { paymentId },
          })
        }

        return {
          received: true,
          duplicate: false,
          eventId: event.id,
          eventType: event.type,
          paymentId,
        }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return {
          received: true,
          duplicate: true,
          eventId: event.id,
          eventType: event.type,
        }
      }

      throw error
    }
  }

  private getFakeProvider(): FakePaymentProvider {
    if (this.provider instanceof FakePaymentProvider) {
      return this.provider
    }
    return getFakePaymentProvider()
  }

  private getStripeService(): StripeService {
    return this.stripeService ?? new StripeService()
  }

  private parseFakeWebhookPayload(payload: Buffer): FakeWebhookEventPayload {
    try {
      const parsed = JSON.parse(payload.toString()) as FakeWebhookEventPayload

      if (!parsed.eventId || !parsed.eventType || !parsed.checkoutSessionId) {
        throw new AppError('Payload do webhook fake invalido', 400, 'INVALID_WEBHOOK_PAYLOAD')
      }

      return parsed
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('Payload do webhook fake invalido', 400, 'INVALID_WEBHOOK_PAYLOAD')
    }
  }

  private async reconcileFailedProviderStatus(paymentId: string, providerStatus: string) {
    if (providerStatus === 'expired') {
      return this.markPaymentAsExpired(paymentId, { source: 'status_reconciliation', providerStatus })
    }

    if (providerStatus === 'cancelled') {
      return this.markPaymentAsCancelled(paymentId, { source: 'status_reconciliation', providerStatus })
    }

    return this.markPaymentAsFailed(paymentId, 'PAYMENT_FAILED', {
      source: 'status_reconciliation',
      providerStatus,
    })
  }

  private async handleCheckoutSessionCompleted(
    tx: TransactionClient,
    session: unknown,
  ): Promise<string | null> {
    const checkoutSession = session as Stripe.Checkout.Session
    const payment = await this.findPaymentByCheckoutSession(tx, checkoutSession.id, checkoutSession.metadata?.ticketId)

    if (!payment) {
      logger.warn('Checkout Session sem pagamento local correspondente', {
        checkoutSessionId: checkoutSession.id,
      })
      return null
    }

    await this.syncProviderPaymentIdentifiers(tx, payment.id, {
      providerPaymentId: this.extractPaymentIntentId(checkoutSession.payment_intent),
      checkoutUrl: checkoutSession.url ?? undefined,
      expiresAt: checkoutSession.expires_at ? new Date(checkoutSession.expires_at * 1000) : undefined,
    })

    if (checkoutSession.payment_status === 'paid') {
      await this.confirmPaymentInTransaction(tx, payment.id)
    }

    return payment.id
  }

  private async handleCheckoutSessionExpired(
    tx: TransactionClient,
    session: unknown,
  ): Promise<string | null> {
    const checkoutSession = session as Stripe.Checkout.Session
    const payment = await this.findPaymentByCheckoutSession(tx, checkoutSession.id, checkoutSession.metadata?.ticketId)

    if (!payment) {
      logger.warn('Checkout Session expirada sem pagamento local correspondente', {
        checkoutSessionId: checkoutSession.id,
      })
      return null
    }

    await this.syncProviderPaymentIdentifiers(tx, payment.id, {
      providerPaymentId: this.extractPaymentIntentId(checkoutSession.payment_intent),
      checkoutUrl: checkoutSession.url ?? undefined,
      expiresAt: checkoutSession.expires_at ? new Date(checkoutSession.expires_at * 1000) : undefined,
    })

    await this.markPaymentAsExpiredInTransaction(tx, payment.id, {
      source: 'stripe_webhook',
      checkoutSessionId: checkoutSession.id,
    })

    return payment.id
  }

  private async handlePaymentIntentSucceeded(
    tx: TransactionClient,
    paymentIntent: unknown,
  ): Promise<string | null> {
    const intent = paymentIntent as Stripe.PaymentIntent
    const payment = await this.findPaymentByIntent(tx, intent.id, intent.metadata?.ticketId)

    if (!payment) {
      logger.warn('PaymentIntent aprovado sem pagamento local correspondente', {
        providerPaymentId: intent.id,
      })
      return null
    }

    await this.syncProviderPaymentIdentifiers(tx, payment.id, {
      providerPaymentId: intent.id,
    })

    await this.confirmPaymentInTransaction(tx, payment.id)
    return payment.id
  }

  private async handlePaymentIntentFailed(
    tx: TransactionClient,
    paymentIntent: unknown,
  ): Promise<string | null> {
    const intent = paymentIntent as Stripe.PaymentIntent
    const payment = await this.findPaymentByIntent(tx, intent.id, intent.metadata?.ticketId)

    if (!payment) {
      logger.warn('PaymentIntent com falha sem pagamento local correspondente', {
        providerPaymentId: intent.id,
      })
      return null
    }

    await this.syncProviderPaymentIdentifiers(tx, payment.id, {
      providerPaymentId: intent.id,
    })

    await this.markPaymentAsFailedInTransaction(tx, payment.id, 'PAYMENT_FAILED', {
      source: 'stripe_webhook',
      providerPaymentId: intent.id,
    })

    return payment.id
  }

  private async handleChargeRefunded(
    tx: TransactionClient,
    chargePayload: unknown,
  ): Promise<string | null> {
    const charge = chargePayload as Stripe.Charge
    const providerPaymentId = this.extractPaymentIntentId(charge.payment_intent)
    const payment = providerPaymentId
      ? await this.findPaymentByIntent(tx, providerPaymentId, charge.metadata?.ticketId)
      : null

    if (!payment) {
      logger.warn('Charge estornada sem pagamento local correspondente', {
        chargeId: charge.id,
        providerPaymentId,
      })
      return null
    }

    if (providerPaymentId) {
      await this.syncProviderPaymentIdentifiers(tx, payment.id, { providerPaymentId })
    }

    await this.refundPaymentInTransaction(tx, payment.id, {
      source: 'stripe_webhook',
      chargeId: charge.id,
      providerPaymentId,
    })

    return payment.id
  }

  private async findPaymentByCheckoutSession(
    tx: TransactionClient,
    checkoutSessionId: string,
    ticketId?: string,
  ): Promise<{ id: string } | null> {
    const bySession = await tx.payment.findUnique({
      where: { providerCheckoutSessionId: checkoutSessionId },
      select: { id: true },
    })

    if (bySession) return bySession
    if (!ticketId) return null

    return tx.payment.findUnique({
      where: { ticketId },
      select: { id: true },
    })
  }

  private async findPaymentByIntent(
    tx: TransactionClient,
    providerPaymentId: string,
    ticketId?: string,
  ): Promise<{ id: string } | null> {
    const byIntent = await tx.payment.findUnique({
      where: { providerPaymentId },
      select: { id: true },
    })

    if (byIntent) return byIntent
    if (!ticketId) return null

    return tx.payment.findUnique({
      where: { ticketId },
      select: { id: true },
    })
  }

  private async syncProviderPaymentIdentifiers(
    tx: TransactionClient,
    paymentId: string,
    data: {
      providerPaymentId?: string | null
      checkoutUrl?: string
      expiresAt?: Date
    },
  ) {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        providerPaymentId: data.providerPaymentId ?? undefined,
        providerCheckoutUrl: data.checkoutUrl,
        providerExpiresAt: data.expiresAt,
      },
    })
  }

  private async confirmPaymentInTransaction(tx: TransactionClient, paymentId: string) {
    const current = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: { include: { raffle: true } } },
    })

    if (!current) throw new NotFoundError('Pagamento')
    if (current.status === 'APPROVED' || current.status === 'REFUNDED') return current
    if (current.status === 'FAILED' || current.status === 'CANCELLED' || current.status === 'EXPIRED') {
      return current
    }

    if (current.ticket.status !== 'RESERVED') {
      throw new AppError('Cota nao esta reservada', 409, 'INVALID_STATUS')
    }

    const transitioned = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'APPROVED', confirmedAt: new Date() },
    })

    if (transitioned.count === 0) {
      return tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { ticket: { include: { raffle: true } } },
      })
    }

    await tx.ticket.updateMany({
      where: { id: current.ticketId, status: 'RESERVED' },
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
      amountCents: current.amountCents,
    })

    await paymentAuditService.log(tx, {
      paymentId: current.id,
      action: 'PAYMENT_APPROVED',
      before: { status: current.status, ticketStatus: current.ticket.status },
      after: { status: 'APPROVED', ticketStatus: 'PAID' },
      metadata: {
        breakdown: this.toBreakdownJson(breakdown),
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

    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  private async markPaymentAsFailed(
    paymentId: string,
    action: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return prisma.$transaction(tx => this.markPaymentAsFailedInTransaction(tx, paymentId, action, metadata))
  }

  private async markPaymentAsFailedInTransaction(
    tx: TransactionClient,
    paymentId: string,
    action: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const current = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: true },
    })

    if (!current) throw new NotFoundError('Pagamento')
    if (current.status === 'FAILED') return current
    if (current.status === 'APPROVED' || current.status === 'REFUNDED') return current

    const transitioned = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED' },
    })

    if (transitioned.count === 0) {
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    }

    let ticketStatus = current.ticket.status
    if (current.ticket.status === 'RESERVED') {
      await tx.ticket.update({
        where: { id: current.ticketId },
        data: { status: 'CANCELLED' },
      })
      ticketStatus = 'CANCELLED'
    }

    await paymentAuditService.log(tx, {
      paymentId,
      action,
      before: { status: current.status, ticketStatus: current.ticket.status },
      after: { status: 'FAILED', ticketStatus },
      metadata,
    })

    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  private async markPaymentAsExpired(
    paymentId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return prisma.$transaction(tx => this.markPaymentAsExpiredInTransaction(tx, paymentId, metadata))
  }

  private async markPaymentAsExpiredInTransaction(
    tx: TransactionClient,
    paymentId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const current = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: true },
    })

    if (!current) throw new NotFoundError('Pagamento')
    if (current.status === 'EXPIRED') return current
    if (current.status === 'APPROVED' || current.status === 'REFUNDED') return current

    const transitioned = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })

    if (transitioned.count === 0) {
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    }

    let ticketStatus = current.ticket.status
    if (current.ticket.status === 'RESERVED') {
      await tx.ticket.update({
        where: { id: current.ticketId },
        data: { status: 'CANCELLED' },
      })
      ticketStatus = 'CANCELLED'
    }

    await paymentAuditService.log(tx, {
      paymentId,
      action: 'PAYMENT_EXPIRED',
      before: { status: current.status, ticketStatus: current.ticket.status },
      after: { status: 'EXPIRED', ticketStatus },
      metadata,
    })

    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  private async markPaymentAsCancelled(
    paymentId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return prisma.$transaction(tx => this.markPaymentAsCancelledInTransaction(tx, paymentId, metadata))
  }

  private async markPaymentAsCancelledInTransaction(
    tx: TransactionClient,
    paymentId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const current = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: true },
    })

    if (!current) throw new NotFoundError('Pagamento')
    if (current.status === 'CANCELLED') return current
    if (current.status === 'APPROVED' || current.status === 'REFUNDED') return current

    const transitioned = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })

    if (transitioned.count === 0) {
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    }

    let ticketStatus = current.ticket.status
    if (current.ticket.status === 'RESERVED') {
      await tx.ticket.update({
        where: { id: current.ticketId },
        data: { status: 'CANCELLED' },
      })
      ticketStatus = 'CANCELLED'
    }

    await paymentAuditService.log(tx, {
      paymentId,
      action: 'PAYMENT_CANCELLED',
      before: { status: current.status, ticketStatus: current.ticket.status },
      after: { status: 'CANCELLED', ticketStatus },
      metadata,
    })

    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  private async refundPaymentInTransaction(
    tx: TransactionClient,
    paymentId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const current = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { ticket: { include: { raffle: true } } },
    })

    if (!current) throw new NotFoundError('Pagamento')
    if (current.status === 'REFUNDED') return current
    if (current.status !== 'APPROVED') return current

    const transitioned = await tx.payment.updateMany({
      where: { id: paymentId, status: 'APPROVED' },
      data: { status: 'REFUNDED' },
    })

    if (transitioned.count === 0) {
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    }

    let ticketStatus = current.ticket.status
    if (current.ticket.status === 'PAID') {
      await tx.ticket.update({
        where: { id: current.ticketId },
        data: { status: 'REFUNDED' },
      })
      ticketStatus = 'REFUNDED'

      await tx.raffle.update({
        where: { id: current.ticket.raffleId },
        data: { soldTicketsCount: { decrement: 1 } },
      })
    }

    const breakdown = await financialTransactionService.recordRefund(tx, {
      paymentId: current.id,
      raffleId: current.ticket.raffleId,
      creatorId: current.ticket.raffle.creatorId,
      amountCents: current.amountCents,
    })

    await paymentAuditService.log(tx, {
      paymentId,
      action: 'PAYMENT_REFUNDED',
      before: { status: current.status, ticketStatus: current.ticket.status },
      after: { status: 'REFUNDED', ticketStatus },
      metadata: {
        ...(metadata as Record<string, Prisma.InputJsonValue> | undefined),
        breakdown: this.toBreakdownJson(breakdown),
      },
    })

    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  private buildCheckoutUrls(baseUrl: string, ticketId: string) {
    const successUrl = new URL('/', baseUrl)
    successUrl.searchParams.set('checkout', 'success')
    successUrl.searchParams.set('ticketId', ticketId)

    const cancelUrl = new URL('/', baseUrl)
    cancelUrl.searchParams.set('checkout', 'cancelled')
    cancelUrl.searchParams.set('ticketId', ticketId)

    return {
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
    }
  }

  private extractPaymentIntentId(paymentIntent: string | Stripe.PaymentIntent | null): string | null {
    if (!paymentIntent) return null
    return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id
  }

  private toWebhookPayload(event: Stripe.Event): Prisma.InputJsonValue {
    return {
      id: event.id,
      type: event.type,
      data: {
        object: event.data.object as unknown as Prisma.InputJsonValue,
      },
    }
  }

  private toBreakdownJson(breakdown: {
    grossCents: number
    platformFeeCents: number
    creatorEarningCents: number
    commissionBasisPoints: number
  }): Prisma.InputJsonValue {
    return {
      grossCents: breakdown.grossCents,
      platformFeeCents: breakdown.platformFeeCents,
      creatorEarningCents: breakdown.creatorEarningCents,
      commissionBasisPoints: breakdown.commissionBasisPoints,
    }
  }
}
