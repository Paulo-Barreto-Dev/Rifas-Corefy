# Rifas API

Backend da plataforma de rifas digitais com arquitetura modular em TypeScript, Express, Prisma e PostgreSQL.

## Visão Geral
- Gerencia usuários, autenticação, rifas, cotas, pagamentos, financeiro, saques e sorteios.
- Mantém a regra de negócio principal desacoplada da infraestrutura de pagamento.
- Usa Stripe Checkout como fluxo principal de pagamento.
- Confirma pagamentos exclusivamente por webhook assinado.

## Stack
- Node.js 20+
- TypeScript
- Express
- Prisma ORM
- PostgreSQL
- Vitest
- Docker / Docker Compose
- Stripe SDK oficial

## Estrutura
```text
src/
  config/
  modules/
    admin/
    draws/
    financial/
    payments/
    raffles/
    tickets/
    users/
  shared/
  app.ts
  routes.ts
  server.ts
prisma/
  migrations/
  schema.prisma
public/
```

## Arquitetura de Pagamentos
- `PaymentService` orquestra o fluxo de negócio do pagamento.
- `PaymentProvider` define a interface comum para providers.
- `StripePaymentProvider` adapta o Stripe ao contrato atual da aplicação.
- `StripeService` encapsula chamadas da SDK oficial.
- `stripe.config.ts` centraliza chaves e configuração do Stripe.

## Fluxo Atual de Pagamento
1. O comprador reserva uma cota em `POST /api/v1/raffles/:raffleId/tickets`.
2. O backend cria uma Checkout Session em `POST /api/v1/payments/tickets/:ticketId/checkout-session`.
3. A API retorna a URL hospedada do Stripe Checkout.
4. O frontend redireciona o usuário para o Stripe Checkout.
5. O Stripe envia o evento para `POST /api/v1/payments/webhook`.
6. O backend valida a assinatura com `STRIPE_WEBHOOK_SECRET`.
7. Apenas após o webhook:
   - o pagamento é marcado como `CONFIRMED`;
   - a cota é marcada como `PAID`;
   - a rifa tem `soldTicketsCount` incrementado;
   - as transações financeiras são registradas;
   - o saldo do criador é atualizado.

## Eventos Tratados
- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

## Idempotência de Webhook
- Cada evento recebido do Stripe é persistido em `PaymentWebhookEvent`.
- Eventos duplicados são ignorados sem reprocessar o pagamento.
- A finalização do pagamento também é idempotente no nível do domínio.

## Variáveis de Ambiente
Use o arquivo `.env.example` como base.

```env
# Banco
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rifas"

# Auth
JWT_SECRET="uma_chave_com_pelo_menos_32_caracteres"
JWT_EXPIRES_IN="7d"

# Servidor
PORT=3000
NODE_ENV=development

# Segurança
BCRYPT_ROUNDS=10
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# Pagamentos
PAYMENT_PROVIDER="stripe"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PUBLISHABLE_KEY="pk_test_..."

# Opcional
REDIS_URL=""
LOTERIA_API_URL="https://servicebus2.caixa.gov.br/portaldeloterias/api"
```

## Instalação Local
```bash
npm install
npx prisma generate
```

## Banco de Dados
```bash
npx prisma migrate dev --schema prisma/schema.prisma
npx prisma studio --schema prisma/schema.prisma
```

## Executando Sem Docker
```bash
npm run dev
```

Build de produção:

```bash
npm run build
npm start
```

## Executando Com Docker
1. Crie o arquivo `.env` com as variáveis obrigatórias.
2. Suba os serviços:

```bash
docker compose up --build
```

Observações:
- O `Dockerfile` continua compatível com a instalação padrão por `npm install`.
- O `docker-compose.yml` continua usando `npm run dev`.
- Nenhuma configuração manual extra é necessária além do `.env`.

## Rotas de Pagamento
- `POST /api/v1/payments/tickets/:ticketId/checkout-session`
- `GET /api/v1/payments/tickets/:ticketId/status`
- `POST /api/v1/payments/webhook`

## Configurando Webhooks do Stripe

### Dashboard Stripe
Cadastre um endpoint apontando para:

```text
http://localhost:3000/api/v1/payments/webhook
```

Em ambiente remoto, troque `localhost` pela URL pública da API.

### Eventos obrigatórios
Selecione:
- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

### Chave do webhook
Copie o segredo do endpoint gerado pelo Stripe e preencha:

```env
STRIPE_WEBHOOK_SECRET="whsec_..."
```

## Testando Localmente
1. Inicie a aplicação.
2. Faça login.
3. Reserve uma cota.
4. Crie a Checkout Session pela API ou pela interface demo.
5. Acesse a URL retornada pelo Stripe.
6. Finalize o pagamento com cartão de teste.
7. Confirme no banco que:
   - `Payment.status = CONFIRMED`
   - `Ticket.status = PAID`
   - `Raffle.soldTicketsCount` foi incrementado
   - foram criadas 3 linhas em `FinancialTransaction`

Cartão de teste para sucesso:

```text
4242 4242 4242 4242
```

Cartão de teste para falha:

```text
4000 0000 0000 0002
```

## Testando Com Stripe CLI
1. Instale a Stripe CLI.
2. Faça login:

```bash
stripe login
```

3. Encaminhe os webhooks para a API local:

```bash
stripe listen --forward-to localhost:3000/api/v1/payments/webhook
```

4. Copie o `Signing secret` exibido pela CLI e atualize:

```env
STRIPE_WEBHOOK_SECRET="whsec_..."
```

5. Gere uma compra real em modo teste pela aplicação e finalize o checkout.

Observação:
- Para validar a integração completa do projeto, o melhor caminho é criar a Checkout Session pela própria API e concluir o checkout hospedado.
- `stripe trigger` é útil para testes isolados de assinatura e entrega do webhook, mas não substitui o fluxo completo com sessão criada pelo sistema.

## Scripts
| Script | Descrição |
| --- | --- |
| `npm run dev` | Inicia a API em desenvolvimento |
| `npm run build` | Compila TypeScript e ajusta aliases |
| `npm start` | Executa a build gerada |
| `npm test` | Executa os testes |
| `npm run test:watch` | Executa testes em watch mode |
| `npm run db:migrate` | Executa migrations do Prisma |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:studio` | Abre o Prisma Studio |

## Segurança
- JWT para autenticação
- Bcrypt para hashing de senha
- Zod para validação
- Helmet, CORS e rate limiting
- Webhook com verificação de assinatura
- Erros padronizados e logs estruturados

## Observações Importantes
- A confirmação do pagamento não depende do retorno do frontend.
- O webhook é a única fonte de verdade para aprovação e falha.
- O modelo de pagamento foi tornado genérico para suportar Stripe sem manter campos acoplados a PIX/Mercado Pago.
- O fluxo de saque continua separado do gateway de cobrança e permanece manual no backoffice.

## Licença
Projeto privado para uso interno.
