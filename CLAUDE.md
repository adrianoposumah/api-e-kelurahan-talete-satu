# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

REST API for **E-Kelurahan Talete Satu** — a digital village letter issuance system for Indonesian village administration. Handles citizen letter requests (surat keterangan), multi-role approval workflows, digital signatures, and PDF generation.

## Commands

```bash
npm run dev          # Development with nodemon (NODE_ENV=development)
npm start            # Production server (NODE_ENV=production)
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npx prisma migrate dev         # Run DB migrations
npx prisma db seed             # Seed admin user
npx prisma studio              # Browse database
```

No test suite is configured — validation is done manually via the Swagger UI at `/docs`.

## Architecture

**Stack:** Express.js v5 (ES modules, `.js` files use `import`/`export`), PostgreSQL via Prisma ORM with `@prisma/adapter-pg`, JWT auth, RSA-4096 digital signatures, Puppeteer PDF generation.

**Entry:** `src/server.js` → loads env file, seeds DB in production, starts HTTP server. `src/app.js` wires up middleware, CORS, static files, and mounts all routes under `/v1`.

### Layer Structure

```
routes/       → defines endpoints + applies auth/role middleware
controllers/  → handles HTTP request/response, calls services
services/     → all business logic, DB access via Prisma
middleware/   → auth (JWT verify + RBAC), upload (Multer)
config/       → env vars, Prisma client, Firebase Admin
templates/    → per-letter-type folders with HTML template + JSON schema
```

### Letter Workflow

Submissions go through a state machine:
`pending_kepling` → `pending_lurah` → `approved` → `issued`

1. Warga (citizen) creates submission with required documents (Multer uploads)
2. Kepling (neighborhood head) approves/rejects
3. Lurah approves (or rejects back to kepling)
4. Admin issues the letter: generates letter number, creates RSA-signed PDF with embedded QR code, stores verification code in `issued_letters`

### Digital Signature Flow (`src/services/crypto.service.js`, `pdf.service.js`)

- Lurah generates RSA-4096 key pair; private key is AES-256-GCM encrypted (scrypt derivation) and stored in `lurah_keys`
- On letter issuance: canonical letter data is SHA-256 hashed + signed with Lurah's private key
- PDF rendered via Puppeteer, QR code embedded, XMP metadata (signature, verification code) added via pdf-lib
- Public verification at `/v1/verify/:code` checks signature without requiring auth

### Dynamic Letter Templates (`src/templates/`)

Each letter type (e.g., `domisili`, `usaha`, `keramaian`) has its own subdirectory with:
- `schema.json` — defines required upload fields and their MIME type constraints
- `template.html` — Handlebars-like template rendered by Puppeteer

`src/lib/schemaLoader.js` caches loaded schemas. `src/validators/submission.validator.js` validates submission fields against the schema. Adding a new letter type requires a new folder here plus a corresponding `SubmissionType` enum entry in Prisma.

### Authentication & Authorization

- Bearer JWT (access token: 7d, refresh: 30d stored in `user_tokens`)
- `authMiddleware` in `src/middleware/auth.middleware.js` verifies token, attaches `req.user`
- `requireRole(...roles)` guards routes — roles: `warga`, `staff`, `kepling`, `lurah`, `sekertaris`, `admin`

### File Uploads

- Multer (`src/middleware/upload.middleware.js`) validates MIME type (JPEG/PNG/PDF), max 5MB
- Files land in `uploads/<letter_type>/<submission_id>/`
- Generated PDFs served from `public/letters/` as static files

## Database

Prisma schema at `prisma/schema.prisma`. Key models:
- `User`, `DataKependudukan` (population registry, NIK-keyed), `Lingkungan` (neighborhoods)
- `Submission`, `SubmissionApproval` (audit trail), `SubmissionDocument` (uploaded files)
- `LurahKey`, `LurahProfile`, `IssuedLetter`, `LetterCounter` (per-type/year sequence)

After schema changes: `npx prisma migrate dev --name <migration_name>` then regenerate client with `npx prisma generate`.

## Environment

Three env files: `.env`, `.env.development`, `.env.production`. Server loads the appropriate one based on `NODE_ENV`. Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `BASE_URL` — used to build PDF/asset URLs and QR verification links
- `VERIFICATION_URL` — public verification frontend URL (embedded in QR codes)
- `TZ=Asia/Makassar`

Firebase Admin SDK reads from `serviceAccountKey.json` (gitignored) or equivalent env vars.

## API Documentation

OpenAPI spec at `swagger.yaml`, served as Swagger UI at `/docs`. The `AGENTS.md` file contains detailed technical design decisions for the letter workflow and verification system.
