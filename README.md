# 🎟️ Rifas API

Backend da plataforma **Rifas**, desenvolvido para gerenciar todo o ciclo de vida de rifas digitais, desde o cadastro de usuários até a definição do vencedor e controle financeiro da plataforma.

A aplicação foi construída utilizando uma arquitetura modular, priorizando escalabilidade, organização e segurança, permitindo fácil manutenção e evolução do sistema.

---

# 📑 Sumário

- Sobre 📖
- Tecnologias 🚀
- Arquitetura 🏛
- Estrutura do Projeto 📂
- Funcionalidades ⚙
- Requisitos 📦
- Instalação 🔧
- Configuração ⚙
- Banco de Dados 🗄
- Executando o Projeto ▶
- Scripts 📜
- Fluxo da Aplicação 🔄
- Segurança 🔒
- Testes 🧪
- Melhorias Futuras 🚀
- Licença 📄

---

# 📖 Sobre

A Rifas API é responsável por toda a regra de negócio da plataforma de rifas online.

Entre suas responsabilidades estão:

- Gerenciamento de usuários
- Autenticação
- Controle de permissões
- Criação de rifas
- Compra de números
- Processamento de pagamentos
- Controle financeiro
- Sorteios
- Auditoria das operações

Toda a API foi desenvolvida utilizando TypeScript e Express, com persistência em PostgreSQL através do Prisma ORM.

---

# 🚀 Tecnologias

## Backend

- Node.js
- TypeScript
- Express

## Banco de Dados

- PostgreSQL
- Prisma ORM

## Autenticação

- JWT (JSON Web Token)
- Bcrypt

## Validação

- Zod

## Segurança

- Helmet
- CORS
- Rate Limit

## Logs

- Winston

## Testes

- Vitest

## Outras bibliotecas

- dotenv
- compression
- express-async-errors

---

# 🏛 Arquitetura

O projeto segue uma arquitetura modular, separando cada domínio de negócio em módulos independentes.

Cada módulo possui suas próprias responsabilidades, facilitando manutenção e evolução da aplicação.

Exemplo:

```
Usuários
│
├── Controller
├── Service
├── Repository
├── DTO
├── Validation
└── Routes
```

Esse padrão reduz acoplamento e facilita reutilização de código.

---

# 📂 Estrutura do Projeto

```
src
│
├── config
│
├── database
│
├── middlewares
│
├── modules
│   │
│   ├── auth
│   ├── users
│   ├── raffles
│   ├── tickets
│   ├── payments
│   ├── withdrawals
│   ├── transactions
│   ├── audit
│   └── ...
│
├── routes
│
├── shared
│
├── utils
│
└── server.ts
```

---

# ⚙ Funcionalidades

## Usuários

- Cadastro
- Login
- Atualização de perfil
- Alteração de senha
- Bloqueio de usuários
- Controle de permissões
- Verificação de criadores

---

## Rifas

- Criar rifa
- Editar rifa
- Publicar
- Pausar
- Encerrar
- Cancelar
- Consultar rifas
- Filtrar rifas

---

## Bilhetes

- Reserva de números
- Compra de bilhetes
- Cancelamento
- Disponibilidade de números

---

## Pagamentos

- Integração via PIX
- Confirmação automática
- Controle de pagamentos
- Histórico

---

## Sorteios

- Definição do vencedor
- Encerramento automático
- Registro dos resultados

---

## Financeiro

- Controle de saldo
- Taxa da plataforma
- Solicitação de saque
- Histórico financeiro

---

## Auditoria

Registro das principais ações realizadas pelos usuários e administradores.

---

# 📦 Requisitos

- Node.js 20+
- PostgreSQL 16+
- npm
- Git

---

# 🔧 Instalação

Clone o projeto

```bash
git clone https://github.com/SEU-USUARIO/rifas-api.git
```

Entre na pasta

```bash
cd rifas-api
```

Instale as dependências

```bash
npm install
```

---

# ⚙ Configuração

Crie o arquivo

```
.env
```

Baseado no arquivo

```
.env.example
```

Exemplo:

```env
PORT=3000

DATABASE_URL=""

JWT_SECRET=""

JWT_EXPIRES_IN=7d

NODE_ENV=development
```

---

# 🗄 Banco de Dados

Gerar o Prisma Client

```bash
npx prisma generate
```

Executar migrations

```bash
npx prisma migrate dev
```

Abrir Prisma Studio

```bash
npx prisma studio
```

---

# ▶ Executando

Modo desenvolvimento

```bash
npm run dev
```

Build

```bash
npm run build
```

Produção

```bash
npm start
```

---

# 📜 Scripts

| Script | Descrição |
|---------|-----------|
| npm run dev | Inicia em desenvolvimento |
| npm run build | Compila TypeScript |
| npm start | Executa produção |
| npm run test | Executa testes |
| npm run lint | Executa lint |
| prisma generate | Gera Prisma Client |
| prisma migrate dev | Executa migrations |
| prisma studio | Interface gráfica do banco |

---

# 🔄 Fluxo Principal

```
Usuário

↓

Cadastro

↓

Login

↓

Criar Rifa

↓

Publicação

↓

Compra de Bilhetes

↓

Pagamento PIX

↓

Confirmação

↓

Sorteio

↓

Definição do Vencedor

↓

Transferência Financeira

↓

Solicitação de Saque
```

---

# 🔒 Segurança

A API implementa diversas medidas de segurança:

- JWT Authentication
- Senhas criptografadas com Bcrypt
- Helmet
- CORS
- Rate Limiter
- Validação de dados com Zod
- Variáveis de ambiente
- Tratamento global de erros

---

# 🧪 Testes

Executar testes

```bash
npm test
```

Modo watch

```bash
npm run test:watch
```

---

# 📈 Escalabilidade

O projeto foi estruturado para facilitar futuras implementações como:

- Integração com Mercado Pago
- Integração com Stripe
- Webhooks
- Notificações
- Filas (BullMQ)
- Redis
- Cache
- Microsserviços
- Docker
- Kubernetes

---

# 🤝 Contribuição

1. Faça um Fork
2. Crie uma branch

```
feature/minha-feature
```

3. Commit

```
git commit -m "feat: minha feature"
```

4. Push

```
git push origin feature/minha-feature
```

5. Abra um Pull Request

---

# 📄 Licença

Este projeto é privado e destinado ao uso interno da plataforma SmartRifas.

---

# 👨‍💻 Desenvolvedor

Desenvolvido utilizando boas práticas de desenvolvimento backend, arquitetura modular e princípios de código limpo.
Dev: Paulo Barreto

---
