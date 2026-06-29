import { v4 as uuid } from 'uuid'
import { NotFoundError, PaymentError } from '@/shared/errors/AppError'
import {
  CreatePaymentInput,
  PaymentProvider,
  ProviderPaymentResult,
  ProviderPaymentStatus,
} from './payment-provider.interface'

interface FakePaymentRecord {
  providerPaymentId: string
  amountCents: number
  description: string
  payerEmail: string
  externalReference: string
  status: ProviderPaymentStatus
  qrCode: string
  expiresAt: Date
  forceFail: boolean
}

export class FakePaymentProvider implements PaymentProvider {
  private readonly payments = new Map<string, FakePaymentRecord>()

  async createPayment(input: CreatePaymentInput): Promise<ProviderPaymentResult> {
    const providerPaymentId = uuid().replace(/-/g, '').substring(0, 25).toUpperCase()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const record: FakePaymentRecord = {
      providerPaymentId,
      amountCents: input.amountCents,
      description: input.description,
      payerEmail: input.payerEmail,
      externalReference: input.externalReference,
      status: 'pending',
      qrCode: buildFakePixQrCode(providerPaymentId, input.amountCents),
      expiresAt,
      forceFail: false,
    }

    this.payments.set(providerPaymentId, record)

    return this.toResult(record)
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentResult> {
    const record = this.getRecord(providerPaymentId)
    return this.toResult(record)
  }

  async confirmPayment(providerPaymentId: string): Promise<ProviderPaymentResult> {
    const record = this.getRecord(providerPaymentId)

    if (record.status === 'approved') {
      return this.toResult(record)
    }

    if (record.status === 'failed' || record.forceFail) {
      throw new PaymentError('Pagamento simulado com falha')
    }

    if (record.expiresAt < new Date()) {
      record.status = 'failed'
      throw new PaymentError('Pagamento simulado expirado')
    }

    record.status = 'approved'
    return this.toResult(record)
  }

  approveForTest(providerPaymentId: string): ProviderPaymentResult {
    const record = this.getRecord(providerPaymentId)
    record.status = 'approved'
    return this.toResult(record)
  }

  failForTest(providerPaymentId: string): ProviderPaymentResult {
    const record = this.getRecord(providerPaymentId)
    record.status = 'failed'
    record.forceFail = true
    return this.toResult(record)
  }

  clear(): void {
    this.payments.clear()
  }

  private getRecord(providerPaymentId: string): FakePaymentRecord {
    const record = this.payments.get(providerPaymentId)
    if (!record) throw new NotFoundError('Pagamento do provider')
    return record
  }

  private toResult(record: FakePaymentRecord): ProviderPaymentResult {
    return {
      providerPaymentId: record.providerPaymentId,
      status: record.status,
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
