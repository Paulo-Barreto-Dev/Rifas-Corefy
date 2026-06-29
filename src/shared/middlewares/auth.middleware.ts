import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UserRole, UserStatus } from '@prisma/client'
import { env } from '@/config/env'
import { ForbiddenError, UnauthorizedError } from '@/shared/errors/AppError'
import { prisma } from '@/shared/infra/prisma'

export interface JwtPayload {
  sub:   string
  email: string
  role:  UserRole
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token não fornecido')
  }

  const [, token] = authHeader.split(' ')
  if (!token) {
    throw new UnauthorizedError('Token não fornecido')
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload
    req.user = payload
    next()
  } catch {
    throw new UnauthorizedError('Token inválido ou expirado')
  }
}


export async function requireActiveUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new UnauthorizedError('Token não fornecido')

  const user = await prisma.user.findUnique({
    where:  { id: req.user.sub },
    select: { status: true },
  })

  if (!user || user.status === UserStatus.BLOCKED) {
    throw new UnauthorizedError('Conta bloqueada. Entre em contato com o suporte.')
  }

  if (user.status === UserStatus.SUSPENDED) {
    throw new UnauthorizedError('Conta suspensa. Entre em contato com o suporte.')
  }

  next()
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError()
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError('Seu perfil não tem permissão para acessar este recurso')
    }
    next()
  }
}