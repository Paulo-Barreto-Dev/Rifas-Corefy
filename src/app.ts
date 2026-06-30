import 'express-async-errors'

import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { env } from '@/config/env'
import { router } from '@/routes'

import { errorMiddleware } from '@/shared/middlewares/error.middleware'

export const app = express()
const publicPath = path.join(__dirname, '..', 'public')

// Seguranca
app.use(helmet())
app.use(cors({ origin: env.NODE_ENV === 'production' ? /\.seudominio\.com\.br$/ : '*' }))
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Muitas requisicoes. Tente novamente em alguns minutos' } },
  })
)

// Parsing e arquivos publicos
app.use(compression())
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
app.use(express.json({ limit: '1mb' }))
app.use(
  express.static(publicPath, {
    etag: true,
    index: false,
    maxAge: env.NODE_ENV === 'production' ? '7d' : 0,
  })
)

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))
app.get('/', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')))

// Rotas
app.use('/api/v1', router)

// Erro global
app.use(errorMiddleware)
