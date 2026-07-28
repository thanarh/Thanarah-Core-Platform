# Thanarah Backend

ثناره — Enterprise healthcare SaaS platform backend.

## Stack

- **Runtime:** Node.js 22+
- **Framework:** NestJS 11 with Fastify adapter
- **Database:** MongoDB 7 via Mongoose
- **Language:** TypeScript 5 (strict mode)
- **Logging:** Pino via nestjs-pino
- **Validation:** Zod
- **Documentation:** Swagger / OpenAPI 3
- **Testing:** Vitest

## Requirements

- Node.js 22 or later
- npm 10 or later
- MongoDB 7 (or Docker)

## Getting Started

Copy the environment file and fill in the values:

```bash
cp .env.example .env
```

Install dependencies:

```bash
npm install
```

Start in development mode:

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000`.  
Swagger documentation is available at `http://localhost:3000/docs`.

## Running with Docker

```bash
docker-compose up --build
```

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Start the compiled application |
| `npm run start:dev` | Start with file watching |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint and auto-fix |
| `npm run format` | Run Prettier |
| `npm run type-check` | Run TypeScript compiler check |
| `npm run test` | Run all tests |
| `npm run test:coverage` | Run tests with coverage report |

## Environment Variables

See `.env.example` for the full list of required variables.

## License

Copyright © 2026 Thanarah Team. All Rights Reserved.
