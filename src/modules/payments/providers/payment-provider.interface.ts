export type ProviderPaymentStatus = 'pending' | 'approved' | 'failed' | 'refunded'

export interface CreatePaymentInput {
  amountCents: number
  description: string
  payerEmail: string
  externalReference: string
}

export interface ProviderPaymentResult {
  providerPaymentId: string
  status: ProviderPaymentStatus
  qrCode?: string
  expiresAt?: Date
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<ProviderPaymentResult>
  getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentResult>
  confirmPayment(providerPaymentId: string): Promise<ProviderPaymentResult>
}
