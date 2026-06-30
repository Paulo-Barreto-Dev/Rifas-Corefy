export type ProviderPaymentStatus = 'pending' | 'approved' | 'failed' | 'refunded'

export interface CreatePaymentInput {
  amountCents: number
  description: string
  payerEmail: string
  externalReference: string
  successUrl: string
  cancelUrl: string
}

export interface ProviderPaymentLookup {
  checkoutSessionId: string
  providerPaymentId?: string | null
}

export interface ProviderPaymentResult {
  checkoutSessionId: string
  providerPaymentId?: string | null
  status: ProviderPaymentStatus
  checkoutUrl?: string
  expiresAt?: Date
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<ProviderPaymentResult>
  getPaymentStatus(input: ProviderPaymentLookup): Promise<ProviderPaymentResult>
  confirmPayment(input: ProviderPaymentLookup): Promise<ProviderPaymentResult>
}
