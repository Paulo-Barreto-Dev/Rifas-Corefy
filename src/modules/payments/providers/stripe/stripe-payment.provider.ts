import { PaymentProvider, ProviderPaymentLookup, ProviderPaymentResult, CreatePaymentInput } from '../payment-provider.interface'
import { StripeService } from './stripe.service'

export class StripePaymentProvider implements PaymentProvider {
  constructor(private readonly stripeService = new StripeService()) {}

  async createPayment(input: CreatePaymentInput): Promise<ProviderPaymentResult> {
    const session = await this.stripeService.createCheckoutSession(input)

    return {
      checkoutSessionId: session.id,
      providerPaymentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
      status: mapStripeCheckoutStatus(session),
      checkoutUrl: session.url ?? undefined,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    }
  }

  async getPaymentStatus(input: ProviderPaymentLookup): Promise<ProviderPaymentResult> {
    const session = await this.stripeService.retrieveCheckoutSession(input.checkoutSessionId)

    return {
      checkoutSessionId: session.id,
      providerPaymentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? input.providerPaymentId ?? null,
      status: mapStripeCheckoutStatus(session),
      checkoutUrl: session.url ?? undefined,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    }
  }

  async confirmPayment(input: ProviderPaymentLookup): Promise<ProviderPaymentResult> {
    const status = await this.getPaymentStatus(input)

    if (status.status === 'approved' || !status.providerPaymentId) {
      return status
    }

    const intent = await this.stripeService.retrievePaymentIntent(status.providerPaymentId)

    return {
      ...status,
      status: mapStripePaymentIntentStatus(intent.status),
    }
  }
}

function mapStripeCheckoutStatus(session: { status: string | null; payment_status: string | null }): ProviderPaymentResult['status'] {
  if (session.payment_status === 'paid') {
    return 'approved'
  }

  if (session.status === 'expired') {
    return 'failed'
  }

  return 'pending'
}

function mapStripePaymentIntentStatus(status: string): ProviderPaymentResult['status'] {
  if (status === 'succeeded') {
    return 'approved'
  }

  if (status === 'canceled' || status === 'requires_payment_method') {
    return 'failed'
  }

  return 'pending'
}