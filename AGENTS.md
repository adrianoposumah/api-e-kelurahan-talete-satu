# Letter Application with Hybrid Verification

## Stack

- **Runtime:** Express.js
- **Database:** PostgreSQL via Prisma ORM
- **File uploads:** Multer
- **Letter templates & schemas:** `src/templates/` folder

---

## Task

- [x] **Dynamic Submissions**
- [ ] **Letter Business Flow**
- [ ] **Lurah Key Generation and Revoked**
- [ ] **Cryptography Digital Signature**
- [ ] **Hybrid Verification for the Letter**

---

## Project Structure

```
project-root/
├── uploads/                              # Multer upload destination (gitignore this)
│   └── <letter_type>/
│       └── <submission_id>/
├── prisma/
│   └── schema.prisma
└── src/
    ├── templates/                        # One folder per letter type
    │   ├── domisili/
    │   │   ├── template.html
    │   │   └── schema.json
    │   └── keramaian/
    │       ├── template.html
    │       └── schema.json
    ├── lib/
    │   ├── schemaLoader.js               # Reads schema.json from templates/
    │   └── crypto.js                     # RSA keygen, sign, AES encrypt/decrypt helpers
    ├── middleware/
    │   ├── upload.middleware.js          # Dynamic multer setup
    │   └── auth.middleware.js            # JWT verification + role guard
    ├── validators/
    │   └── submission.validator.js       # Schema-driven field + file validation
    ├── services/
    │   ├── submission.service.js         # Create submission, query submissions
    │   ├── approval.service.js           # Kepling/lurah review and status transitions
    │   └── key.service.js                # Key generation, revocation, lookup
    ├── controllers/
    │   ├── submission.controller.js
    │   ├── approval.controller.js
    │   └── key.controller.js
    └── routes/
        ├── submission.routes.js
        ├── approval.routes.js
        └── key.routes.js
```

---

# Dynamic Submissions

## Step 1 — schema.json Structure

Each letter type's schema lives at `src/templates/<letter_type>/schema.json`.
This file defines what fields and files the submission form requires.

**Shape:**

```json
{
  "label": "Human-readable letter name",
  "fields": [{ "name": "field_key", "required": true }],
  "files": [{ "name": "file_key", "required": true, "maxCount": 1 }]
}
```

**`src/templates/domisili/schema.json`:**

```json
{
  "label": "Surat Keterangan Domisili",
  "fields": [
    { "name": "nama_lengkap", "required": true },
    { "name": "jenis_kelamin", "required": true },
    { "name": "tempat_lahir", "required": true },
    { "name": "tanggal_lahir", "required": true },
    { "name": "nik", "required": true },
    { "name": "pekerjaan", "required": true },
    { "name": "agama", "required": true },
    { "name": "kewarganegaraan", "required": true },
    { "name": "tujuan", "required": true }
  ],
  "files": [
    { "name": "ktp", "required": true, "maxCount": 1 },
    { "name": "kartu_keluarga", "required": true, "maxCount": 1 },
    { "name": "surat_lainnya", "required": false, "maxCount": 1 }
  ]
}
```

**`src/templates/keramaian/schema.json`:**

```json
{
  "label": "Surat Izin Keramaian",
  "fields": [
    { "name": "nama", "required": true },
    { "name": "alamat", "required": true },
    { "name": "nama_acara", "required": true },
    { "name": "jenis_acara", "required": true },
    { "name": "tanggal_acara", "required": true },
    { "name": "waktu", "required": true },
    { "name": "tempat_acara", "required": true }
  ],
  "files": [
    { "name": "ktp", "required": true, "maxCount": 1 },
    { "name": "surat_lainnya", "required": false, "maxCount": 1 }
  ]
}
```

> `template.html` is NOT used during submission. It is used later when the lurah approves
> the submission and the system generates the final letter document.

---

## Step 2 — Schema Loader Utility

**File:** `src/lib/schemaLoader.js`

**Responsibilities:**

1. Accept a `letter_type` string (e.g. `"domisili"`).
2. Build path: `path.join(__dirname, '../templates', letter_type, 'schema.json')`.
3. If file does not exist, return `null` (caller treats this as unknown letter type).
4. Parse and return the JSON.
5. Cache result in a module-level `Map` — subsequent requests skip the filesystem read.

---

## Step 3 — Dynamic Multer Middleware

**File:** `src/middleware/upload.middleware.js`

Multer needs the file field names upfront, but `letter_type` is inside the multipart body.

**Solution: two-pass parsing**

```
1. Generate a uuid → attach to req.submissionId
2. Run multer().none() → reads req.body.letter_type (text fields only, no files yet)
3. Load schema via schemaLoader(letter_type)
   → if null: return 400 "Unknown letter type: '<value>'"
4. Build fileFields: schema.files.map(f => ({ name: f.name, maxCount: f.maxCount }))
5. Configure multer diskStorage:
   destination → uploads/<letter_type>/<req.submissionId>/
   filename    → <fieldname>-<Date.now()><ext>
6. File filter: accept image/jpeg, image/png, application/pdf only
7. Limits: fileSize 5MB
8. Run upload.fields(fileFields)(req, res, next)
```

---

## Step 4 — Schema-Driven Validator

**File:** `src/validators/submission.validator.js`

```js
validateSubmission(body, files, schema) => { valid: Boolean, errors: String[] }
```

- For each required field in `schema.fields`: error if missing or empty string.
- For each required file in `schema.files`: error if not present in `req.files`.

Keep pure — no DB calls, no file I/O.

---

## Step 5 — Submission Controller

**File:** `src/controllers/submission.controller.js`

```
async create(req, res):
1. Load schema via schemaLoader(req.body.letter_type)
2. validateSubmission(req.body, req.files, schema) → 400 if invalid
3. Whitelist formData using schema.fields keys only
4. Build files map: { fieldName: req.files[fieldName][0].path }
5. prisma.submission.create({ id: req.submissionId, wargaId: req.user.id, ... })
6. Return 201 with { id, letterType, status, submittedAt }
```

**Route:** `POST /submissions → auth (WARGA only) → uploadMiddleware → create`

---

## Response Shapes

**Validation error (400):**

```json
{ "success": false, "message": "Validation failed", "errors": ["Field 'nik' is required"] }
```

**Success (201):**

```json
{ "success": true, "data": { "id": "uuid", "letterType": "domisili", "status": "PENDING_KEPLING", "submittedAt": "..." } }
```

---

## Adding a New Letter Type (Future)

1. Create `src/templates/<letter_type>/`
2. Add `schema.json` and `template.html`
3. Done — no code changes needed

---

---

# Letter Business Flow

## Roles

| Role      | Responsibility                                              |
| --------- | ----------------------------------------------------------- |
| `WARGA`   | Submits letter applications                                 |
| `KEPLING` | First-level reviewer — approves or rejects warga submission |
| `LURAH`   | Final approver — reviews, signs, and triggers letter output |
| `ADMIN`   | System management — manages users, roles, and lurah keys    |

---

## Submission Status Flow

```
[WARGA submits]
       │
       ▼
 PENDING_KEPLING  ──(kepling rejects)──► REJECTED
       │
  (kepling approves)
       │
       ▼
 PENDING_LURAH   ──(lurah rejects)───► REJECTED
       │
  (lurah approves + signs)
       │
       ▼
   APPROVED
  (letter generated + digitally signed)
```

**Status enum values:** `PENDING_KEPLING` | `PENDING_LURAH` | `APPROVED` | `REJECTED`

---

## Business Rules

- Only the **active kepling** can act on `PENDING_KEPLING` submissions.
- Only the **active lurah** can act on `PENDING_LURAH` submissions.
- A `REJECTED` submission is terminal — warga must create a new submission.
- When rejecting, a `rejectionReason` must be provided.
- `rejectedBy` records which role (`KEPLING` or `LURAH`) rejected the submission.
- Warga can only see their own submissions.
- Kepling sees all `PENDING_KEPLING` submissions.
- Lurah sees all `PENDING_LURAH` submissions.
- Admin sees all submissions regardless of status.

---

## Prisma Schema (Full)

**File:** `prisma/schema.prisma`

```prisma
enum Role {
  ADMIN
  LURAH
  KEPLING
  WARGA
}

enum SubmissionStatus {
  PENDING_KEPLING
  PENDING_LURAH
  APPROVED
  REJECTED
}

enum KeyStatus {
  ACTIVE
  REVOKED
  INACTIVE
}

model User {
  id        String   @id @default(uuid())
  name      String
  email     String   @unique
  password  String   // bcrypt hashed
  role      Role     @default(WARGA)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  submissions    Submission[] @relation("WargaSubmissions")
  keplingReviews Submission[] @relation("KeplingReviews")
  lurahSigns     Submission[] @relation("LurahSigns")
  lurahKeys      LurahKey[]

  @@index([role])
}

model Submission {
  id         String           @id @default(uuid())
  letterType String
  status     SubmissionStatus @default(PENDING_KEPLING)
  formData   Json
  files      Json

  // Relations
  warga   User   @relation("WargaSubmissions", fields: [wargaId], references: [id])
  wargaId String

  kepling           User?     @relation("KeplingReviews", fields: [keplingId], references: [id])
  keplingId         String?
  keplingNote       String?
  keplingReviewedAt DateTime?

  lurah         User?     @relation("LurahSigns", fields: [lurahId], references: [id])
  lurahId       String?
  lurahNote     String?
  lurahSignedAt DateTime?

  // Rejection
  rejectedBy      Role?
  rejectionReason String?

  submittedAt DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status])
  @@index([letterType])
  @@index([wargaId])
}

model LurahKey {
  id                  String    @id @default(uuid())
  publicKey           String    @db.Text    // stored plaintext — used for verification
  encryptedPrivateKey String    @db.Text    // AES-256-GCM encrypted with passphrase
  status              KeyStatus @default(ACTIVE)

  lurahUser   User   @relation(fields: [lurahUserId], references: [id])
  lurahUserId String

  createdAt       DateTime  @default(now())
  deactivatedAt   DateTime?
  deactivatedById String?   // admin or system user id
  deactivateReason String?

  @@index([status])
  @@index([lurahUserId])
}
```

Run migration:

```bash
npx prisma migrate dev --name add_business_flow
```

---

## Approval Service

**File:** `src/services/approval.service.js`

**`keplingReview(submissionId, keplingUserId, action, note)`**

```
1. Fetch submission — 404 if not found
2. Guard: status must be PENDING_KEPLING — 400 if not
3. If action = "approve":
   → update status to PENDING_LURAH, set keplingId, keplingNote, keplingReviewedAt
4. If action = "reject":
   → note is required — 400 if missing
   → update status to REJECTED, set keplingId, keplingNote, keplingReviewedAt,
     rejectedBy = KEPLING, rejectionReason = note
5. Return updated submission
```

**`lurahReview(submissionId, lurahUserId, action, note)`**

```
1. Fetch submission — 404 if not found
2. Guard: status must be PENDING_LURAH — 400 if not
3. Guard: lurah must have an ACTIVE key — 400 if not (cannot sign without a key)
4. If action = "approve":
   → (digital signing handled separately — see Cryptography section)
   → update status to APPROVED, set lurahId, lurahNote, lurahSignedAt
5. If action = "reject":
   → note is required — 400 if missing
   → update status to REJECTED, set lurahId, lurahNote, lurahSignedAt,
     rejectedBy = LURAH, rejectionReason = note
6. Return updated submission
```

---

## Approval Controller & Routes

**File:** `src/controllers/approval.controller.js`

```
PATCH /submissions/:id/review
  → auth middleware (role: KEPLING or LURAH)
  → body: { action: "approve" | "reject", note?: string }
  → if req.user.role === KEPLING: call keplingReview(...)
  → if req.user.role === LURAH:   call lurahReview(...)
  → return updated submission status
```

**File:** `src/routes/approval.routes.js`

```
PATCH /submissions/:id/review  → auth(KEPLING | LURAH) → approvalController.review
GET   /submissions             → auth(any)             → submissionController.list
GET   /submissions/:id         → auth(any)             → submissionController.detail
```

**`GET /submissions` filtering by role:**

```
WARGA   → where wargaId = req.user.id
KEPLING → where status  = PENDING_KEPLING
LURAH   → where status  = PENDING_LURAH
ADMIN   → no filter (all submissions)
```

---

## Auth Middleware

**File:** `src/middleware/auth.middleware.js`

Two reusable middlewares:

**`authenticate`** — Verifies JWT from `Authorization: Bearer <token>`.
Attaches decoded user (`{ id, role }`) to `req.user`. Returns 401 if missing or invalid.

**`authorize(...roles)`** — Checks `req.user.role` is in the allowed roles list.
Returns 403 if not. Used as: `authorize('KEPLING', 'LURAH')`.

---

---

# Lurah Key Generation and Revoked

## Key Design Rules

- There is only **one ACTIVE lurah** at any time.
- There is only **one ACTIVE key** at any time.
- The private key is **never stored in plaintext** and never returned via any API response.
- The private key is encrypted with AES-256-GCM using a passphrase provided by the lurah.
- The passphrase is **never stored** — only the encrypted blob is kept in the DB.
- If the passphrase is forgotten, the key cannot be recovered. A revoke + regenerate cycle is required.
- Algorithm: **RSA-4096 with SHA-256** (via Node.js built-in `crypto` module).
- All historical public keys are retained in the DB to allow verification of past signed letters.

---

## Key Lifecycle

```
[Lurah provides passphrase]
          │
          ▼
    Key Generated
  (RSA-4096 key pair)
          │
   ┌──────┴──────────────────────┐
   ▼                             ▼
Public Key                 Private Key
stored plaintext         encrypted (AES-256-GCM)
  in DB                  with passphrase → stored in DB
                         plaintext immediately discarded
          │
          ▼
       ACTIVE
          │
    ┌─────┴──────────┐
    ▼                ▼
Admin revokes    Lurah demoted
    │                │
    ▼                ▼
 REVOKED          INACTIVE
    │
Lurah generates new key with new passphrase
```

---

## Key Status Transitions

| Event                              | Triggered by | Old key status | New key status |
| ---------------------------------- | ------------ | -------------- | -------------- |
| Lurah generates first key          | LURAH        | —              | ACTIVE         |
| Admin revokes key (leak suspected) | ADMIN        | ACTIVE         | REVOKED        |
| Admin demotes lurah                | ADMIN        | ACTIVE         | INACTIVE       |
| New lurah generates key            | LURAH        | —              | ACTIVE         |

---

## Crypto Helper

**File:** `src/lib/crypto.js`

Expose these four functions:

**`generateKeyPair()`**

- Generate RSA-4096 key pair using `crypto.generateKeyPairSync('rsa', { modulusLength: 4096 })`.
- Return `{ publicKeyPem, privateKeyPem }` as PEM strings.
- Caller is responsible for encrypting `privateKeyPem` immediately.

**`encryptPrivateKey(privateKeyPem, passphrase)`**

- Derive a 256-bit AES key from passphrase using `crypto.scryptSync(passphrase, salt, 32)`.
- Encrypt using AES-256-GCM.
- Return a single string encoding: `base64(salt):base64(iv):base64(authTag):base64(ciphertext)`.
- This string is what gets stored in `LurahKey.encryptedPrivateKey`.

**`decryptPrivateKey(encryptedBlob, passphrase)`**

- Parse the four components from the stored string.
- Derive the same AES key using `scryptSync` with the stored salt.
- Decrypt and return the PEM string.
- Throw a descriptive error if decryption fails (wrong passphrase).

**`signData(data, privateKeyPem)`**

- Sign `data` (string or Buffer) using `crypto.createSign('SHA256')`.
- Return the signature as a base64 string.

---

## Key Service

**File:** `src/services/key.service.js`

**`generateLurahKey(lurahUserId, passphrase)`**

```
1. Guard: caller's role must be LURAH — 403 if not
2. Guard: no other ACTIVE key must exist — 400 if one exists
   (lurah must revoke or have admin deactivate first)
3. Call crypto.generateKeyPair() → { publicKeyPem, privateKeyPem }
4. Call crypto.encryptPrivateKey(privateKeyPem, passphrase) → encryptedBlob
5. Immediately discard privateKeyPem from memory (set to null)
6. prisma.lurahKey.create({
     publicKey: publicKeyPem,
     encryptedPrivateKey: encryptedBlob,
     status: ACTIVE,
     lurahUserId
   })
7. Return { id, publicKey, status, createdAt }
   — NEVER return encryptedPrivateKey or any key material
```

**`revokeKey(keyId, adminUserId, reason)`**

```
1. Guard: caller's role must be ADMIN — 403 if not
2. Fetch key by id — 404 if not found
3. Guard: key status must be ACTIVE — 400 if already REVOKED or INACTIVE
4. prisma.lurahKey.update({
     status: REVOKED,
     deactivatedAt: now(),
     deactivatedById: adminUserId,
     deactivateReason: reason
   })
5. Return updated key record (without encryptedPrivateKey)
```

**`deactivateKeysForUser(lurahUserId, adminUserId)`** _(called internally when lurah is demoted)_

```
1. Find all ACTIVE keys for lurahUserId
2. Set each to INACTIVE, record deactivatedAt and deactivatedById
3. Does not return anything — internal only
```

**`getActivePublicKey()`**

```
1. prisma.lurahKey.findFirst({ where: { status: ACTIVE } })
2. Return { id, publicKey } or null if none exists
```

**`getAllPublicKeys()`** _(for verification of historical letters)_

```
1. prisma.lurahKey.findMany({ select: { id, publicKey, status, createdAt } })
2. Return all keys — active, revoked, and inactive
3. Never include encryptedPrivateKey in the result
```

---

## Key Controller & Routes

**File:** `src/controllers/key.controller.js`

| Action            | Handler                  | Description                                |
| ----------------- | ------------------------ | ------------------------------------------ |
| Generate key pair | `keyController.generate` | Lurah provides passphrase, gets new key    |
| Revoke key        | `keyController.revoke`   | Admin marks a key as REVOKED               |
| List all keys     | `keyController.list`     | Admin sees all key records                 |
| Get active key    | `keyController.active`   | Public — returns current active public key |

**File:** `src/routes/key.routes.js`

```
POST /keys/generate          → auth(LURAH)   → keyController.generate
POST /keys/:id/revoke        → auth(ADMIN)   → keyController.revoke
GET  /keys                   → auth(ADMIN)   → keyController.list
GET  /keys/active            → public        → keyController.active
```

---

## Role Demotion Flow (Admin replaces Lurah)

When admin demotes the current lurah and promotes a new one:

```
1. PATCH /users/:id/role  { role: "WARGA" }  (demote old lurah)
   → auth(ADMIN)
   → userService.changeRole(userId, newRole)
     a. Update User.role to WARGA
     b. Call key.service.deactivateKeysForUser(userId, adminId)
        → all ACTIVE keys for this user become INACTIVE

2. PATCH /users/:id/role  { role: "LURAH" }  (promote new lurah)
   → auth(ADMIN)
   → Guard: no other user currently has role LURAH — 400 if one exists
   → Update User.role to LURAH

3. New lurah must now POST /keys/generate with their passphrase
   before they can sign any letters
```

**Important:** Only one user can hold `LURAH` role at a time. Enforce this constraint
in `userService.changeRole` before the promote step.

---

## Key Request & Response Shapes

**`POST /keys/generate`**

Request body:

```json
{ "passphrase": "strong-passphrase-here" }
```

Success (201):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
    "status": "ACTIVE",
    "createdAt": "2025-04-25T08:00:00.000Z"
  }
}
```

**`POST /keys/:id/revoke`**

Request body:

```json
{ "reason": "Private key potentially leaked" }
```

Success (200):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "REVOKED",
    "deactivatedAt": "2025-04-25T09:00:00.000Z",
    "deactivateReason": "Private key potentially leaked"
  }
}
```

**`GET /keys/active`**

Success (200):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
    "createdAt": "2025-04-25T08:00:00.000Z"
  }
}
```

No active key (200):

```json
{ "success": true, "data": null }
```

---

## Security Rules (enforce in every key-related handler)

- `encryptedPrivateKey` must **never** appear in any API response — use `select` or `omit` in every Prisma query on `LurahKey`.
- Passphrase must **never** be logged — do not log `req.body` on key generation endpoints.
- After decrypting the private key for signing, the plaintext PEM must not be attached to `req` or stored in any variable that outlives the signing operation.
- Minimum passphrase length: 8 characters — validate before calling `generateLurahKey`.

---

# Cryptography Digital Signature

> _(To be documented — awaiting feature explanation)_

---

# Hybrid Verification for the Letter

> _(To be documented — awaiting feature explanation)_
