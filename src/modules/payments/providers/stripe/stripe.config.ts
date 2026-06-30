import Stripe from 'stripe'
import { env } from '@/config/env'

export const stripeConfig = {
  currency: 'brl',
  publishableKey: env.STRIPE_PUBLISHABLE_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
}

let stripeClient: Stripe | null = null

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY!)
  }

  return stripeClient
}
