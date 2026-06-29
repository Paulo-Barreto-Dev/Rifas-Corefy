import { Prisma } from '@prisma/client'
import { prisma } from '@/shared/infra/prisma'

export interface AuditLogData {
  adminId: string
  action: string
  targetType: string
  targetId: string
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
  metadata?: Prisma.InputJsonValue
  ipAddress?: string
  userAgent?: string
}

export interface AuditListFilters {
  adminId?: string
  targetType?: string
  targetId?: string
  action?: string
  from?: Date
  to?: Date
  page: number
  limit: number
}

export class AuditService {

  async log(data: AuditLogData) {
    return prisma.auditLog.create({ data })
  }

  async findAll(filters: AuditListFilters) {
    const where: Record<string, unknown> = {}

    if (filters.adminId)    where.adminId    = filters.adminId
    if (filters.targetType) where.targetType = filters.targetType
    if (filters.targetId)   where.targetId   = filters.targetId
    if (filters.action)     where.action     = filters.action

    if (filters.from || filters.to) {
      const range: Record<string, Date> = {}
      if (filters.from) range.gte = filters.from
      if (filters.to)   range.lte = filters.to
      where.createdAt = range
    }

    const skip = (filters.page - 1) * filters.limit

    const [total, data] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: filters.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, name: true, email: true } },
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
}