import { UserRole, UserStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt, { SignOptions } from 'jsonwebtoken'
import { env } from '@/config/env'
import { ConflictError, NotFoundError, UnauthorizedError } from '@/shared/errors/AppError'
import { prisma } from '@/shared/infra/prisma'

export interface RegisterDto {
  name:      string
  email:     string
  cpf:       string
  phone?:    string
  password:  string
  role?:     UserRole
}

export interface LoginDto {
  email:    string
  password: string
}

export class UserService {
  async register(data: RegisterDto) {
    const email = data.email.trim().toLowerCase()
    const cpf   = data.cpf.replace(/\D/g, '')

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { cpf }] },
    })
    if (exists) throw new ConflictError('E-mail ou CPF já cadastrado')

    const passwordHash = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS)

    const user = await prisma.user.create({
      data: {
        name:      data.name,
        email,
        cpf,
        phone:     data.phone,
        passwordHash,
        role:      data.role ?? UserRole.BUYER,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })

    const token = this.generateToken(user)
    return { user, token }
  }

  async login(data: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: data.email.trim().toLowerCase() },
    })

    // Return the same error for "not found" and "wrong password" to prevent
    // user enumeration attacks
    if (!user) throw new UnauthorizedError('Credenciais inválidas')

    const valid = await bcrypt.compare(data.password, user.passwordHash)
    if (!valid) throw new UnauthorizedError('Credenciais inválidas')

    // Block access at login — avoids the need for real-time token revocation
    // for the most common case (user tries to log back in after being blocked)
    if (user.status === UserStatus.BLOCKED) {
      throw new UnauthorizedError('Conta bloqueada. Entre em contato com o suporte.')
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedError('Conta suspensa. Entre em contato com o suporte.')
    }

    const token = this.generateToken(user)
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id:               true,
        name:             true,
        email:            true,
        phone:            true,
        role:             true,
        status:           true,
        isVerifiedCreator:true,
        balanceCents:     true,
        pixKey:           true,
        createdAt:        true,
        _count: { select: { raffles: true, tickets: true } },
      },
    })
    if (!user) throw new NotFoundError('Usuário')
    return user
  }

  async updatePixKey(userId: string, pixKey: string) {
    return prisma.user.update({
      where:  { id: userId },
      data:   { pixKey },
      select: { id: true, pixKey: true },
    })
  }

  private generateToken(user: { id: string; email: string; role: UserRole }) {
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] },
    )
  }
}