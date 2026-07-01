import { UserRole, UserStatus } from '@prisma/client'
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/errors/AppError'
import { prisma } from '@/shared/infra/prisma'
import { AuditService } from './audit.service'

const auditService = new AuditService()

export interface ListUsersFilters {
  role?: UserRole
  status?: UserStatus
  isVerifiedCreator?: boolean
  search?: string
  page: number
  limit: number
}

export class AdminUserService {
  // Listing 

  async listUsers(filters: ListUsersFilters) {
    const where: Record<string, unknown> = {}

    if (filters.role)   where.role   = filters.role
    if (filters.status) where.status = filters.status
    if (filters.isVerifiedCreator !== undefined) {
      where.isVerifiedCreator = filters.isVerifiedCreator
    }
    if (filters.search) {
      where.OR = [
        { name:  { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { cpf:   { contains: filters.search } },
      ]
    }

    const skip = (filters.page - 1) * filters.limit

    const [total, data] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: filters.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:               true,
          name:             true,
          email:            true,
          cpf:              true,
          phone:            true,
          role:             true,
          status:           true,
          isVerifiedCreator:true,
          balanceCents:     true,
          createdAt:        true,
          blockedAt:        true,
          blockReason:      true,
          _count: { select: { raffles: true, tickets: true } },
        },
      }),
    ])

    return {
      data,
      pagination: {
        page:       filters.page,
        limit:      filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    }
  }

  async listCreators(filters: { isVerifiedCreator?: boolean; page: number; limit: number }) {
    return this.listUsers({ role: UserRole.CREATOR, ...filters })
  }

  //  Block / Unblock 

  async blockUser(
    targetUserId: string,
    adminId:      string,
    reason:       string,
    ipAddress?:   string,
    userAgent?:   string,
  ) {
    const user = await this.findUserOrThrow(targetUserId)

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenError('Não é possível bloquear outro administrador')
    }
    if (user.status === UserStatus.BLOCKED) {
      throw new ConflictError('Usuário já está bloqueado')
    }

    const before = {
      status:      user.status,
      blockedAt:   user.blockedAt,
      blockReason: user.blockReason,
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        status:      UserStatus.BLOCKED,
        blockedAt:   new Date(),
        blockedBy:   adminId,
        blockReason: reason,
      },
      select: { id: true, name: true, email: true, status: true, blockedAt: true, blockReason: true },
    })

    await auditService.log({
      adminId,
      action:     'USER_BLOCKED',
      targetType: 'User',
      targetId:   targetUserId,
      before,
      after: { status: updated.status, blockedAt: updated.blockedAt, blockReason: updated.blockReason },
      metadata:   { reason },
      ipAddress,
      userAgent,
    })

    return updated
  }

  async unblockUser(
    targetUserId: string,
    adminId:      string,
    ipAddress?:   string,
    userAgent?:   string,
  ) {
    const user = await this.findUserOrThrow(targetUserId)

    if (user.status !== UserStatus.BLOCKED) {
      throw new ConflictError('Usuário não está bloqueado')
    }

    const before = { status: user.status, blockReason: user.blockReason }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        status:      UserStatus.ACTIVE,
        blockedAt:   null,
        blockedBy:   null,
        blockReason: null,
      },
      select: { id: true, name: true, email: true, status: true },
    })

    await auditService.log({
      adminId,
      action:     'USER_UNBLOCKED',
      targetType: 'User',
      targetId:   targetUserId,
      before,
      after:      { status: updated.status },
      ipAddress,
      userAgent,
    })

    return updated
  }

  // Creator Verification 

  async setCreatorVerification(
    targetUserId: string,
    adminId:      string,
    verified:     boolean,
    ipAddress?:   string,
    userAgent?:   string,
  ) {
    const user = await this.findUserOrThrow(targetUserId)

    if (user.role !== UserRole.CREATOR) {
      throw new ConflictError('Verificação de criador só pode ser aplicada a usuários com role CREATOR')
    }
    if (user.isVerifiedCreator === verified) {
      throw new ConflictError(
        verified
          ? 'Criador já está verificado'
          : 'Criador já está não-verificado',
      )
    }

    const before = { isVerifiedCreator: user.isVerifiedCreator }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data:  { isVerifiedCreator: verified },
      select: { id: true, name: true, email: true, role: true, isVerifiedCreator: true },
    })

    await auditService.log({
      adminId,
      action:     verified ? 'CREATOR_VERIFIED' : 'CREATOR_UNVERIFIED',
      targetType: 'User',
      targetId:   targetUserId,
      before,
      after:      { isVerifiedCreator: updated.isVerifiedCreator },
      ipAddress,
      userAgent,
    })

    return updated
  }

  // Historico de uso

  async getUserHistory(targetUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id:               true,
        name:             true,
        email:            true,
        role:             true,
        status:           true,
        isVerifiedCreator:true,
        balanceCents:     true,
        createdAt:        true,
        blockedAt:        true,
        blockReason:      true,

        // Ultimos 20 sorteios criados
        raffles: {
          take:      20,
          orderBy:   { createdAt: 'desc' },
          select: {
            id:              true,
            title:           true,
            status:          true,
            totalTickets:    true,
            ticketPriceCents:true,
            createdAt:       true,
            _count: { select: { tickets: { where: { status: 'PAID' } } } },
          },
        },

        // Ultimos 50 tickets comprados
        tickets: {
          take:    50,
          orderBy: { createdAt: 'desc' },
          select: {
            id:        true,
            number:    true,
            status:    true,
            createdAt: true,
            raffle:    { select: { id: true, title: true, status: true } },
            payment:   { select: { status: true, amountCents: true, confirmedAt: true } },
          },
        },

        _count: { select: { raffles: true, tickets: true, payments: true } },
      },
    })

    if (!user) throw new NotFoundError('Usuário')

    // Total gasto (Apenas pagamentos confirmados)
    const totalSpent = await prisma.payment.aggregate({
      where: { userId: targetUserId, status: 'APPROVED' },
      _sum:  { amountCents: true },
    })

    return {
      ...user,
      totalSpentCents: totalSpent._sum.amountCents ?? 0,
    }
  }

  // Private helpers 

  private async findUserOrThrow(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('Usuário')
    return user
  }
}