import { env } from '@/config/env'
import { FakePaymentProvider } from './fake-payment.provider'
import { PaymentProvider } from './payment-provider.interface'
import { StripePaymentProvider } from './stripe/stripe-payment.provider'

let fakeProviderInstance: FakePaymentProvider | null = null
let stripeProviderInstance: StripePaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case 'fake':
      if (!fakeProviderInstance) {
        fakeProviderInstance = new FakePaymentProvider()
      }
      return fakeProviderInstance
    case 'stripe':
      if (!stripeProviderInstance) {
        stripeProviderInstance = new StripePaymentProvider()
      }
      return stripeProviderInstance
    default:
      throw new Error(`Provider de pagamento desconhecido: ${env.PAYMENT_PROVIDER}`)
  }
}

export function getFakePaymentProvider(): FakePaymentProvider {
  const provider = getPaymentProvider()
  if (!(provider instanceof FakePaymentProvider)) {
    throw new Error('FakePaymentProvider disponível apenas com PAYMENT_PROVIDER=fake')
  }
  return provider
}

export function resetPaymentProviderForTests(): void {
  fakeProviderInstance = null
  stripeProviderInstance = null
}
