import { v4 as uuid } from 'uuid'
import { NotFoundError, PaymentError } from '@/shared/errors/AppError'
import {
  CreatePaymentInput,
  FakeWebhookEventPayload,
  PaymentProvider,
  ProviderPaymentResult,
  ProviderPaymentStatus,
} from './payment-provider.interface'

interface FakePaymentRecord {
  checkoutSessionId: string
  providerPaymentId: string
  amountCents: number
  description: string
  payerEmail: string
  externalReference: string
  status: ProviderPaymentStatus
  qrCode: string
  expiresAt: Date
}

export class FakePaymentProvider implements PaymentProvider {
  private readonly payments = new Map<string, FakePaymentRecord>()

  async createPayment(input: CreatePaymentInput): Promise<ProviderPaymentResult> {
    const checkoutSessionId = uuid().replace(/-/g, '').substring(0, 25).toUpperCase()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const record: FakePaymentRecord = {
      checkoutSessionId,
      providerPaymentId: checkoutSessionId,
      amountCents: input.amountCents,
      description: input.description,
      payerEmail: input.payerEmail,
      externalReference: input.externalReference,
      status: 'pending',
      qrCode: buildFakePixQrCode(checkoutSessionId, input.amountCents),
      expiresAt,
    }

    this.payments.set(checkoutSessionId, record)

    return this.toResult(record)
  }

  async getPaymentStatus({ checkoutSessionId }: { checkoutSessionId: string }): Promise<ProviderPaymentResult> {
    const record = this.getRecord(checkoutSessionId)
    this.syncExpiredStatus(record)
    return this.toResult(record)
  }

  async confirmPayment({ checkoutSessionId }: { checkoutSessionId: string }): Promise<ProviderPaymentResult> {
    const record = this.getRecord(checkoutSessionId)
    this.syncExpiredStatus(record)
    return this.toResult(record)
  }

  simulateApproved(checkoutSessionId: string): FakeWebhookEventPayload {
    const record = this.getRecord(checkoutSessionId)
    if (record.status === 'approved') {
      return this.buildWebhookEvent(record, 'payment.approved')
    }

    if (record.status === 'failed' || record.status === 'cancelled' || record.status === 'expired') {
      throw new PaymentError('Pagamento simulado indisponivel para aprovacao')
    }

    if (record.expiresAt < new Date()) {
      record.status = 'expired'
      throw new PaymentError('Pagamento simulado expirado')
    }

    record.status = 'approved'
    return this.buildWebhookEvent(record, 'payment.approved')
  }

  simulateFailed(checkoutSessionId: string): FakeWebhookEventPayload {
    const record = this.getRecord(checkoutSessionId)
    if (record.status === 'approved' || record.status === 'refunded') {
      throw new PaymentError('Pagamento simulado ja aprovado')
    }

    record.status = 'failed'
    return this.buildWebhookEvent(record, 'payment.failed')
  }

  simulateExpired(checkoutSessionId: string): FakeWebhookEventPayload {
    const record = this.getRecord(checkoutSessionId)
    if (record.status === 'approved' || record.status === 'refunded') {
      throw new PaymentError('Pagamento simulado ja aprovado')
    }

    record.status = 'expired'
    record.expiresAt = new Date(Date.now() - 1_000)
    return this.buildWebhookEvent(record, 'payment.expired')
  }

  simulateCancelled(checkoutSessionId: string): FakeWebhookEventPayload {
    const record = this.getRecord(checkoutSessionId)
    if (record.status === 'approved' || record.status === 'refunded') {
      throw new PaymentError('Pagamento simulado ja aprovado')
    }

    record.status = 'cancelled'
    return this.buildWebhookEvent(record, 'payment.cancelled')
  }

  /** @deprecated Use simulateApproved + PaymentService.handleFakeWebhook */
  approveForTest(checkoutSessionId: string): ProviderPaymentResult {
    this.simulateApproved(checkoutSessionId)
    return this.toResult(this.getRecord(checkoutSessionId))
  }

  /** @deprecated Use simulateFailed + PaymentService.handleFakeWebhook */
  failForTest(checkoutSessionId: string): ProviderPaymentResult {
    this.simulateFailed(checkoutSessionId)
    return this.toResult(this.getRecord(checkoutSessionId))
  }

  clear(): void {
    this.payments.clear()
  }

  private getRecord(checkoutSessionId: string): FakePaymentRecord {
    const record = this.payments.get(checkoutSessionId)
    if (!record) throw new NotFoundError('Pagamento do provider')
    return record
  }

  private syncExpiredStatus(record: FakePaymentRecord): void {
    if (record.status === 'pending' && record.expiresAt < new Date()) {
      record.status = 'expired'
    }
  }

  private buildWebhookEvent(
    record: FakePaymentRecord,
    eventType: FakeWebhookEventPayload['eventType'],
  ): FakeWebhookEventPayload {
    return {
      eventId: `fake_evt_${record.checkoutSessionId}_${eventType.replace('.', '_')}_${Date.now()}`,
      eventType,
      checkoutSessionId: record.checkoutSessionId,
      providerPaymentId: record.providerPaymentId,
    }
  }

  private toResult(record: FakePaymentRecord): ProviderPaymentResult {
    return {
      checkoutSessionId: record.checkoutSessionId,
      providerPaymentId: record.providerPaymentId,
      status: record.status,
      checkoutUrl: `https://checkout.local/fake/${record.checkoutSessionId}`,
      qrCode: record.qrCode,
      expiresAt: record.expiresAt,
    }
  }
}

function buildFakePixQrCode(txId: string, amountCents: number): string {
  const amount = (amountCents / 100).toFixed(2)
  const merchantName = 'RIFAS PLATAFORMA'
  const merchantCity = 'SAO PAULO'

  return [
    '000201',
    '010212',
    `26360014BR.GOV.BCB.PIX0114${txId}`,
    '52040000',
    '5303986',
    `54${String(amount.length).padStart(2, '0')}${amount}`,
    '5802BR',
    `59${String(merchantName.length).padStart(2, '0')}${merchantName}`,
    `60${String(merchantCity.length).padStart(2, '0')}${merchantCity}`,
    '62070503***',
    '6304',
  ].join('')
}
