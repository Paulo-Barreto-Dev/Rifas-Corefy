import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'
import { env } from '@/config/env'

const commonResponses = {
  BadRequest: {
    description: 'Dados invalidos',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dados invalidos',
          },
        },
      },
    },
  },
  Unauthorized: {
    description: 'Usuario nao autenticado',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Token ausente ou invalido',
          },
        },
      },
    },
  },
  Forbidden: {
    description: 'Usuario sem permissao para executar a operacao',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'FORBIDDEN',
            message: 'Acesso negado',
          },
        },
      },
    },
  },
  NotFound: {
    description: 'Recurso nao encontrado',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'NOT_FOUND',
            message: 'Recurso nao encontrado',
          },
        },
      },
    },
  },
  Conflict: {
    description: 'Conflito de regra de negocio',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'CONFLICT',
            message: 'Operacao nao permitida para o estado atual',
          },
        },
      },
    },
  },
  TooManyRequests: {
    description: 'Limite de requisicoes excedido',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Muitas requisicoes. Tente novamente em alguns minutos',
          },
        },
      },
    },
  },
  InternalServerError: {
    description: 'Erro interno',
    content: {
      'application/json': {
        example: {
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Erro interno',
          },
        },
      },
    },
  },
}

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Rifas API',
      description:
        'Documentacao dos principais endpoints da API de rifas digitais, incluindo autenticacao, usuarios, rifas, tickets, pagamentos e financeiro.',
      version: '1.0.0',
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}/api/v1`,
        description: 'Servidor local de desenvolvimento',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Autenticacao e criacao de conta' },
      { name: 'Users', description: 'Perfil do usuario autenticado' },
      { name: 'Raffles', description: 'Consulta e gestao de rifas' },
      { name: 'Tickets', description: 'Reserva e consulta de cotas' },
      { name: 'Payments', description: 'Checkout, status e webhooks de pagamento' },
      { name: 'Financial', description: 'Saques e endpoints financeiros administrativos' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Informe o token JWT no formato: Bearer <token>',
        },
      },
      parameters: {
        PageParam: {
          in: 'query',
          name: 'page',
          schema: { type: 'integer', minimum: 1, default: 1 },
          description: 'Pagina da listagem',
        },
        LimitParam: {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, default: 20 },
          description: 'Quantidade de itens por pagina',
        },
      },
      responses: commonResponses,
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Dados invalidos' },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 12 },
            total: { type: 'integer', example: 42 },
            totalPages: { type: 'integer', example: 4 },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: '7f1f31d8-7c0e-4a22-a7c3-8e6e6bbd0f7a' },
            name: { type: 'string', example: 'Maria Silva' },
            email: { type: 'string', format: 'email', example: 'maria@example.com' },
            createdAt: { type: 'string', format: 'date-time', example: '2026-06-29T14:00:00.000Z' },
          },
        },
        UserProfile: {
          allOf: [
            { $ref: '#/components/schemas/User' },
            {
              type: 'object',
              properties: {
                phone: { type: 'string', nullable: true, example: '+5511999999999' },
                role: { type: 'string', enum: ['BUYER', 'CREATOR', 'ADMIN'], example: 'BUYER' },
                status: { type: 'string', enum: ['ACTIVE', 'BLOCKED', 'SUSPENDED'], example: 'ACTIVE' },
                isVerifiedCreator: { type: 'boolean', example: false },
                balanceCents: { type: 'integer', example: 15000 },
                pixKey: { type: 'string', nullable: true, example: 'maria@example.com' },
                _count: {
                  type: 'object',
                  properties: {
                    raffles: { type: 'integer', example: 2 },
                    tickets: { type: 'integer', example: 5 },
                  },
                },
              },
            },
          ],
        },
        AuthResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            user: {
              allOf: [
                { $ref: '#/components/schemas/User' },
                {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['BUYER', 'CREATOR', 'ADMIN'], example: 'BUYER' },
                  },
                },
              ],
            },
          },
        },
        Raffle: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: '0a20eb7f-5487-4b5f-9e60-33f4ddc8d27b' },
            title: { type: 'string', example: 'Rifa iPhone 15' },
            description: { type: 'string', example: 'Rifa beneficente com sorteio pela plataforma.' },
            price: {
              type: 'integer',
              deprecated: true,
              description: 'Alias documentacional para ticketPriceCents quando consumidores legados usam price.',
              example: 1000,
            },
            ticketPriceCents: { type: 'integer', example: 1000 },
            totalTickets: { type: 'integer', example: 1000 },
            soldTicketsCount: { type: 'integer', example: 120 },
            drawMethod: { type: 'string', enum: ['PLATFORM_RANDOM', 'LOTERIA_FEDERAL'], example: 'PLATFORM_RANDOM' },
            drawDate: { type: 'string', format: 'date-time', nullable: true, example: '2026-07-30T20:00:00.000Z' },
            status: {
              type: 'string',
              enum: ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'PAUSED', 'SOLD_OUT', 'DRAWING', 'FINISHED', 'CANCELLED', 'REJECTED'],
              example: 'OPEN',
            },
            createdAt: { type: 'string', format: 'date-time', example: '2026-06-29T14:00:00.000Z' },
          },
        },
        Ticket: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: '7e9a8d9e-63a2-4e7b-95c1-5537ca75da73' },
            number: { type: 'integer', example: 10 },
            status: { type: 'string', enum: ['RESERVED', 'PAID', 'CANCELLED', 'REFUNDED'], example: 'RESERVED' },
            raffleId: { type: 'string', format: 'uuid', example: '0a20eb7f-5487-4b5f-9e60-33f4ddc8d27b' },
            userId: {
              type: 'string',
              format: 'uuid',
              description: 'Identificador do comprador. No banco o campo se chama buyerId.',
              example: '7f1f31d8-7c0e-4a22-a7c3-8e6e6bbd0f7a',
            },
            buyerId: { type: 'string', format: 'uuid', example: '7f1f31d8-7c0e-4a22-a7c3-8e6e6bbd0f7a' },
            reservedUntil: { type: 'string', format: 'date-time', nullable: true, example: '2026-06-29T14:15:00.000Z' },
          },
        },
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'f60e2d36-a0dc-48c8-b4f7-efac74526981' },
            amount: {
              type: 'integer',
              deprecated: true,
              description: 'Alias documentacional para amountCents quando consumidores legados usam amount.',
              example: 1000,
            },
            amountCents: { type: 'integer', example: 1000 },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'], example: 'PENDING' },
            provider: { type: 'string', example: 'fake' },
            ticketId: { type: 'string', format: 'uuid', example: '7e9a8d9e-63a2-4e7b-95c1-5537ca75da73' },
            createdAt: { type: 'string', format: 'date-time', example: '2026-06-29T14:01:00.000Z' },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: '164f206a-b1d3-42d3-8941-9d48626f47e9' },
            amount: {
              type: 'integer',
              deprecated: true,
              description: 'Alias documentacional para amountCents quando consumidores legados usam amount.',
              example: 850,
            },
            amountCents: { type: 'integer', example: 850 },
            type: { type: 'string', enum: ['PAYMENT_RECEIVED', 'COMMISSION', 'PRIZE', 'WITHDRAWAL', 'REFUND'], example: 'PAYMENT_RECEIVED' },
            status: {
              type: 'string',
              description: 'Transacoes financeiras nao possuem status proprio no schema atual; este campo pode ser derivado do contexto financeiro quando exibido.',
              example: 'COMPLETED',
            },
            createdAt: { type: 'string', format: 'date-time', example: '2026-06-29T14:01:00.000Z' },
          },
        },
        Withdrawal: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: '3c9dbd70-28f1-4ad8-a0de-24870f1988c2' },
            amountCents: { type: 'integer', example: 5000 },
            pixKey: { type: 'string', example: 'maria@example.com' },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED'], example: 'PENDING' },
            reviewedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
            notes: { type: 'string', nullable: true, example: null },
            createdAt: { type: 'string', format: 'date-time', example: '2026-06-29T14:01:00.000Z' },
          },
        },
      },
    },
    paths: {
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Criar usuario',
          description: 'Cria uma conta de comprador ou criador e retorna o token JWT.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'cpf', 'password'],
                  properties: {
                    name: { type: 'string', minLength: 2 },
                    email: { type: 'string', format: 'email' },
                    cpf: { type: 'string' },
                    phone: { type: 'string' },
                    password: { type: 'string', minLength: 8 },
                    role: { type: 'string', enum: ['BUYER', 'CREATOR'] },
                  },
                },
                example: {
                  name: 'Maria Silva',
                  email: 'maria@example.com',
                  cpf: '12345678901',
                  phone: '+5511999999999',
                  password: 'senha1234',
                  role: 'BUYER',
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Usuario criado com sucesso',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuthResponse' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            409: { $ref: '#/components/responses/Conflict' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Autenticar usuario',
          description: 'Valida credenciais e retorna um token JWT.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' },
                  },
                },
                example: {
                  email: 'maria@example.com',
                  password: 'senha1234',
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Login realizado com sucesso',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuthResponse' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/users/me': {
        get: {
          tags: ['Users'],
          summary: 'Buscar perfil autenticado',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Usuario autenticado',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserProfile' },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/raffles': {
        get: {
          tags: ['Raffles'],
          summary: 'Listar rifas',
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimitParam' },
            {
              in: 'query',
              name: 'status',
              schema: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'PAUSED', 'SOLD_OUT', 'DRAWING', 'FINISHED', 'CANCELLED', 'REJECTED'] },
            },
            {
              in: 'query',
              name: 'creatorId',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Raffle' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
        post: {
          tags: ['Raffles'],
          summary: 'Criar rifa',
          description: 'Endpoint autenticado para usuarios CREATOR ou ADMIN.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'description', 'totalTickets', 'ticketPriceCents', 'drawMethod'],
                  properties: {
                    title: { type: 'string', minLength: 3, maxLength: 100 },
                    description: { type: 'string', minLength: 10, maxLength: 2000 },
                    imageUrl: { type: 'string', format: 'uri' },
                    totalTickets: { type: 'integer', minimum: 2, maximum: 100000 },
                    ticketPriceCents: { type: 'integer', minimum: 100 },
                    drawMethod: { type: 'string', enum: ['PLATFORM_RANDOM', 'LOTERIA_FEDERAL'] },
                    drawDate: { type: 'string', format: 'date-time' },
                    loteriaNumber: { type: 'string' },
                  },
                },
                example: {
                  title: 'Rifa iPhone 15',
                  description: 'Rifa beneficente com sorteio pela plataforma.',
                  totalTickets: 1000,
                  ticketPriceCents: 1000,
                  drawMethod: 'PLATFORM_RANDOM',
                  drawDate: '2026-07-30T20:00:00.000Z',
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Rifa criada com sucesso',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Raffle' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            409: { $ref: '#/components/responses/Conflict' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/raffles/{id}': {
        get: {
          tags: ['Raffles'],
          summary: 'Buscar rifa por ID',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Raffle' },
                },
              },
            },
            404: { $ref: '#/components/responses/NotFound' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/raffles/{id}/tickets': {
        get: {
          tags: ['Tickets'],
          summary: 'Listar cotas de uma rifa',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            { $ref: '#/components/parameters/PageParam' },
            {
              in: 'query',
              name: 'limit',
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
            404: { $ref: '#/components/responses/NotFound' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/raffles/{id}/available-numbers': {
        get: {
          tags: ['Raffles'],
          summary: 'Listar numeros disponiveis de uma rifa',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              in: 'query',
              name: 'offset',
              schema: { type: 'integer', minimum: 0, default: 0 },
            },
            {
              in: 'query',
              name: 'limit',
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
            },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  example: {
                    available: 880,
                    numbers: [10, 11, 12],
                    offset: 0,
                    limit: 200,
                    hasMore: true,
                  },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            404: { $ref: '#/components/responses/NotFound' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/raffles/{raffleId}/tickets': {
        post: {
          tags: ['Tickets'],
          summary: 'Reservar cotas',
          description:
            'Reserva cotas para o usuario autenticado. A reserva expira em aproximadamente 15 minutos se o pagamento nao for iniciado/concluido.',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'raffleId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    quantity: { type: 'integer', minimum: 1, maximum: 100 },
                    numbers: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 100,
                      items: { type: 'integer', minimum: 1 },
                    },
                  },
                },
                examples: {
                  random: {
                    summary: 'Reserva aleatoria',
                    value: { quantity: 3 },
                  },
                  chosenNumbers: {
                    summary: 'Reserva numeros especificos',
                    value: { numbers: [10, 11, 12] },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Cotas reservadas com sucesso',
              content: {
                'application/json': {
                  example: {
                    tickets: [
                      {
                        id: '7e9a8d9e-63a2-4e7b-95c1-5537ca75da73',
                        raffleId: '0a20eb7f-5487-4b5f-9e60-33f4ddc8d27b',
                        buyerId: '7f1f31d8-7c0e-4a22-a7c3-8e6e6bbd0f7a',
                        number: 10,
                        status: 'RESERVED',
                        reservedUntil: '2026-06-29T14:15:00.000Z',
                      },
                    ],
                    totalCents: 3000,
                  },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            409: { $ref: '#/components/responses/Conflict' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/tickets/my': {
        get: {
          tags: ['Tickets'],
          summary: 'Listar minhas cotas',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Ticket' },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/payments/tickets/{ticketId}/checkout-session': {
        post: {
          tags: ['Payments'],
          summary: 'Criar sessao de checkout para uma cota',
          description:
            'Endpoint real equivalente ao fluxo de criacao de pagamento. A API atual cria pagamento a partir de uma cota reservada, nao a partir de raffleId + lista de tickets.',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'ticketId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            201: {
              description: 'Pagamento criado com status pendente',
              content: {
                'application/json': {
                  example: {
                    payment: {
                      id: 'f60e2d36-a0dc-48c8-b4f7-efac74526981',
                      ticketId: '7e9a8d9e-63a2-4e7b-95c1-5537ca75da73',
                      userId: '7f1f31d8-7c0e-4a22-a7c3-8e6e6bbd0f7a',
                      amountCents: 1000,
                      provider: 'fake',
                      status: 'PENDING',
                    },
                    checkoutUrl: 'http://localhost:3333/?checkout=success&ticketId=7e9a8d9e-63a2-4e7b-95c1-5537ca75da73',
                    qrCode: null,
                    sessionId: 'fake_session_id',
                    expiresAt: '2026-06-29T14:15:00.000Z',
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
            409: { $ref: '#/components/responses/Conflict' },
            429: { $ref: '#/components/responses/TooManyRequests' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/payments/tickets/{ticketId}/status': {
        get: {
          tags: ['Payments'],
          summary: 'Consultar status do pagamento de uma cota',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'ticketId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            200: {
              description: 'Status atual do pagamento ou null caso nao exista pagamento para a cota',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { allOf: [{ $ref: '#/components/schemas/Payment' }, { type: 'object', properties: { providerStatus: { type: 'string', example: 'pending' } } }] },
                      { nullable: true },
                    ],
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/payments/webhook': {
        post: {
          tags: ['Payments'],
          summary: 'Receber webhook do provider de pagamento',
          description:
            'Recebe eventos do provider configurado, registra o evento e atualiza o status do pagamento e da cota quando aplicavel. Com Stripe, enviar o header stripe-signature.',
          parameters: [
            {
              in: 'header',
              name: 'stripe-signature',
              required: false,
              schema: { type: 'string' },
              description: 'Assinatura exigida quando PAYMENT_PROVIDER=stripe',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                example: {
                  eventId: 'evt_fake_123',
                  eventType: 'payment.approved',
                  checkoutSessionId: 'fake_session_id',
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Evento recebido e processado',
              content: {
                'application/json': {
                  example: {
                    received: true,
                    duplicate: false,
                    eventId: 'evt_fake_123',
                    eventType: 'payment.approved',
                    paymentId: 'f60e2d36-a0dc-48c8-b4f7-efac74526981',
                  },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            409: { $ref: '#/components/responses/Conflict' },
            429: { $ref: '#/components/responses/TooManyRequests' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/withdrawals': {
        post: {
          tags: ['Financial'],
          summary: 'Solicitar saque',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amountCents', 'pixKey'],
                  properties: {
                    amountCents: { type: 'integer', minimum: 1 },
                    pixKey: { type: 'string', minLength: 3 },
                  },
                },
                example: {
                  amountCents: 5000,
                  pixKey: 'maria@example.com',
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Solicitacao de saque criada',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Withdrawal' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            409: { $ref: '#/components/responses/Conflict' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/withdrawals/my': {
        get: {
          tags: ['Financial'],
          summary: 'Listar minhas solicitacoes de saque',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Withdrawal' },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/admin/payments': {
        get: {
          tags: ['Financial'],
          summary: 'Listar pagamentos (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimitParam' },
            {
              in: 'query',
              name: 'status',
              schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'] },
            },
            { in: 'query', name: 'userId', schema: { type: 'string', format: 'uuid' } },
            { in: 'query', name: 'from', schema: { type: 'string', format: 'date-time' } },
            { in: 'query', name: 'to', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  example: {
                    data: [
                      {
                        id: 'f60e2d36-a0dc-48c8-b4f7-efac74526981',
                        amountCents: 1000,
                        status: 'PENDING',
                        provider: 'fake',
                        createdAt: '2026-06-29T14:01:00.000Z',
                      },
                    ],
                    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/admin/withdrawals': {
        get: {
          tags: ['Financial'],
          summary: 'Listar saques (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimitParam' },
            {
              in: 'query',
              name: 'status',
              schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED'] },
            },
            { in: 'query', name: 'userId', schema: { type: 'string', format: 'uuid' } },
            { in: 'query', name: 'from', schema: { type: 'string', format: 'date-time' } },
            { in: 'query', name: 'to', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Withdrawal' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/admin/withdrawals/{withdrawalId}/review': {
        patch: {
          tags: ['Financial'],
          summary: 'Revisar solicitacao de saque (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'withdrawalId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['decision'],
                  properties: {
                    decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
                    notes: { type: 'string' },
                  },
                },
                example: {
                  decision: 'APPROVED',
                  notes: 'Dados conferidos.',
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Saque revisado com sucesso',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Withdrawal' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
            409: { $ref: '#/components/responses/Conflict' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/admin/fees': {
        get: {
          tags: ['Financial'],
          summary: 'Listar taxas da plataforma (admin)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  example: [
                    {
                      id: '1d5f70b3-a8d5-4073-96e3-8dd501c694da',
                      key: 'platform_commission',
                      description: 'Comissao da plataforma',
                      basisPoints: 1500,
                      isActive: true,
                    },
                  ],
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
        put: {
          tags: ['Financial'],
          summary: 'Criar ou atualizar taxa da plataforma (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                example: {
                  key: 'platform_commission',
                  description: 'Comissao da plataforma',
                  basisPoints: 1500,
                },
              },
            },
          },
          responses: {
            200: { description: 'Taxa criada ou atualizada com sucesso' },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/admin/fees/{key}/toggle': {
        patch: {
          tags: ['Financial'],
          summary: 'Ativar ou desativar taxa da plataforma (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'key',
              required: true,
              schema: { type: 'string', example: 'platform_commission' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                example: {
                  isActive: true,
                },
              },
            },
          },
          responses: {
            200: { description: 'Taxa atualizada com sucesso' },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
      '/admin/reports/financial': {
        get: {
          tags: ['Financial'],
          summary: 'Relatorio financeiro (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date-time' } },
            { in: 'query', name: 'to', required: true, schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: {
              description: 'Operacao realizada com sucesso',
              content: {
                'application/json': {
                  example: {
                    grossRevenueCents: 100000,
                    platformFeesCents: 15000,
                    creatorEarningsCents: 85000,
                    withdrawalsCents: 25000,
                  },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            500: { $ref: '#/components/responses/InternalServerError' },
          },
        },
      },
    },
  },
  apis: [],
})

export const swaggerUiServe = swaggerUi.serve
export const swaggerUiSetup = swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'Rifas API Docs',
})
