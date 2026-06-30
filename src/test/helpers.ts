import bcrypt from 'bcryptjs'
import { DrawMethod, UserRole } from '@prisma/client'
import { prisma } from '@/shared/infra/prisma'
import { resetPaymentProviderForTests } from '@/modules/payments/providers/payment-provider.factory'

export async function resetDatabase() {
  await prisma.paymentWebhookEvent.deleteMany()
  await prisma.paymentAuditLog.deleteMany()
  await prisma.financialTransaction.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.ticket.deleteMany()
  await prisma.draw.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.withdrawalRequest.deleteMany()
  await prisma.platformFee.deleteMany()
  await prisma.raffle.deleteMany()
  await prisma.user.deleteMany()
}

export async function createTestUser(params?: {
  role?: UserRole
  email?: string
  cpf?: string
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return prisma.user.create({
    data: {
      name: 'Test User',
      email: params?.email ?? `user-${suffix}@test.com`,
      cpf: params?.cpf ?? `${suffix.replace(/\D/g, '').slice(0, 11).padEnd(11, '0')}`,
      passwordHash: await bcrypt.hash('password123', 4),
      role: params?.role ?? 'BUYER',
    },
  })
}

export async function createOpenRaffle(creatorId: string, overrides?: {
  totalTickets?: number
  ticketPriceCents?: number
}) {
  const raffle = await prisma.raffle.create({
    data: {
      creatorId,
      title: 'Rifa de Teste',
      description: 'Descrição suficiente para validação de teste automatizado.',
      totalTickets: overrides?.totalTickets ?? 10,
      ticketPriceCents: overrides?.ticketPriceCents ?? 1000,
      drawMethod: DrawMethod.PLATFORM_RANDOM,
      status: 'OPEN',
    },
  })

  return raffle
}

export async function seedDefaultPlatformFee(adminId: string) {
  return prisma.platformFee.upsert({
    where: { key: 'raffle_commission' },
    create: {
      key: 'raffle_commission',
      description: 'Comissão padrão da plataforma',
      basisPoints: 500,
      updatedBy: adminId,
    },
    update: {
      basisPoints: 500,
      isActive: true,
    },
  })
}

export function resetProviders() {
  resetPaymentProviderForTests()
}
