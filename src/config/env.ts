import 'dotenv/config'

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  PAYMENT_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  LOTERIA_API_URL: z.string().url().default('https://servicebus2.caixa.gov.br/portaldeloterias/api'),

  BCRYPT_ROUNDS: z.coerce.number().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  PAYMENT_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(5 * 60 * 1000),
  PAYMENT_RATE_LIMIT_MAX: z.coerce.number().default(20),
}).superRefine((data, ctx) => {
  if (data.PAYMENT_PROVIDER !== 'stripe') {
    return
  }

  const requiredStripeKeys = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PUBLISHABLE_KEY',
  ] as const

  for (const key of requiredStripeKeys) {
    if (!data[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} é obrigatório quando PAYMENT_PROVIDER=stripe`,
      })
    }
  }
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Variaveis de ambiente invalidas:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
