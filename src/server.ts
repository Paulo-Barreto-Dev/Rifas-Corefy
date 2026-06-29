import { app } from './app'
import { env } from './config/env'
import { prisma } from './shared/infra/prisma'
import { logger } from './shared/utils/logger'

const server = app.listen(env.PORT, () => {
  logger.info(`Rifas API rodando na porta ${env.PORT} [${env.NODE_ENV}]`)
})

const shutdown = (signal: string) => {
  logger.info(`Recebido ${signal}. Encerrando servidor...`)
  server.close(async () => {
    await prisma.$disconnect()
    logger.info('Servidor encerrado.')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', err => {
  logger.error('Exceção não capturada', { err })
  process.exit(1)
})
process.on('unhandledRejection', reason => {
  logger.error('Promise rejeitada sem tratamento', { reason })
  process.exit(1)
})
