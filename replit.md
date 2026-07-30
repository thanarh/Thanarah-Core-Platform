# Thanarah Backend

Enterprise healthcare SaaS platform backend — **ثناره**.

## Stack

- **Runtime:** Node.js 22+, TypeScript 5 (strict)
- **Framework:** NestJS 11 with Fastify adapter (port **5000**)
- **Database:** MongoDB 7 via Mongoose
- **Validation:** Zod
- **Logging:** Pino via nestjs-pino
- **API docs:** Swagger at `/api/docs`
- **Testing:** Vitest

## Running the app

```bash
npx nest build && node dist/main   # production build
npm run start:dev                   # development with file watching
```

The workflow **"Start application"** runs `npx nest build && node dist/main` and serves on port 5000.

## Environment variables

Set in Replit Secrets / env:

| Key | Required | Notes |
|-----|----------|-------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | ≥ 32 characters |
| `JWT_EXPIRES_IN` | No | Default `7d` |
| `THROTTLE_TTL` | No | Default `60000` ms |
| `THROTTLE_LIMIT` | No | Default `100` req/window |
| `PORT` | No | Default `5000` |

## Front-end entry point

`public/index.html` — Thanarah splash screen (pure HTML/CSS/JS, served as a static file by Fastify). Displays for ~5 seconds then redirects to `/login`.

## Project structure

```
src/
  app.module.ts          — root module
  main.ts                — bootstrap (Fastify, Swagger, static files)
  config/                — Zod env schema + ConfigService
  database/              — Mongoose connection module
  common/                — filters, interceptors, pipes, logger
public/
  index.html             — splash screen
```

## User preferences

- Do not modify backend logic, APIs, or authentication when working on frontend/visual tasks.
- Keep existing project structure intact.
- Use `npx nest build` (not `nest build`) since the CLI is local to node_modules.
