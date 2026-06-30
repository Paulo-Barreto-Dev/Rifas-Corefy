import Stripe from 'stripe'
import { AppError } from '@/shared/errors/AppError'
import { getStripeClient, stripeConfig } from './stripe.config'

export interface StripeCheckoutSessionInput {
  amountCents: number
  description: string
  payerEmail: string
  externalReference: string
  successUrl: string
  cancelUrl: string
}

export class StripeService {
  private readonly stripe = getStripeClient()

  async createCheckoutSession(input: StripeCheckoutSessionInput): Promise<Stripe.Checkout.Session> {
    try {
      return await this.stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.payerEmail,
        billing_address_collection: 'auto',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: stripeConfig.currency,
              unit_amount: input.amountCents,
              product_data: {
                name: input.description,
              },
            },
          },
        ],
        metadata: {
          ticketId: input.externalReference,
        },
        payment_intent_data: {
          metadata: {
            ticketId: input.externalReference,
          },
        },
      })
    } catch (error) {
      throw this.toStripeAppError(error, 'Nao foi possivel criar o checkout Stripe')
    }
  }

  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId)
    } catch (error) {
      throw this.toStripeAppError(error, 'Nao foi possivel consultar o checkout Stripe')
    }
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId)
    } catch (error) {
      throw this.toStripeAppError(error, 'Nao foi possivel consultar o pagamento Stripe')
    }
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, stripeConfig.webhookSecret!)
    } catch {
      throw new AppError('Assinatura do webhook invalida', 400, 'INVALID_WEBHOOK_SIGNATURE')
    }
  }

  private toStripeAppError(error: unknown, fallbackMessage: string): AppError {
    if (error instanceof Stripe.errors.StripeError) {
      return new AppError(error.message || fallbackMessage, error.statusCode ?? 502, 'STRIPE_ERROR')
    }

    return new AppError(fallbackMessage, 502, 'STRIPE_ERROR')
  }
}
