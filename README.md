# Rifas API

API backend para gerenciamento de rifas online, incluindo usuários, criação de rifas, compra de números e integração com pagamentos.

## Tecnologias

- Node.js
- TypeScript
- Express
- Prisma ORM
- PostgreSQL
- Docker
- Stripe (pagamentos)

## Funcionalidades

- Cadastro e autenticação de usuários
- Gerenciamento de rifas
- Reserva e compra de números
- Controle de pagamentos
- Integração com gateway de pagamento
- Registro de transações financeiras

## Instalação

Clone o projeto:

```bash
git clone <repository-url>
cd rifas-api
```

Instale as dependências:

```bash
npm install
```

Configure as variáveis de ambiente:

```bash
cp .env.example .env
```

Execute as migrations:

```bash
npx prisma migrate dev
```

Inicie o projeto:

```bash
npm run dev
```

## Docker

Para executar com Docker:

```bash
docker compose up -d
```

## Variáveis importantes

Exemplo:

```env
DATABASE_URL=
JWT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

## Estrutura

```
src
├── modules
│   ├── users
│   ├── raffles
│   ├── tickets
│   ├── payments
│   └── financial
│
├── shared
└── config
```

## Testes

Executar testes:

```bash
npm test
```

## Status do projeto

Em desenvolvimento.

Próximas etapas:

- Melhorias de segurança
- Validação completa de pagamentos
- Testes de integração
- Deploy em produção
```