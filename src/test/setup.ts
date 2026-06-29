import 'dotenv/config'

process.env.NODE_ENV = 'test'
process.env.PAYMENT_PROVIDER ??= 'fake'

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters'
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run integration tests')
}
