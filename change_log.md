# Change Log

## [2026-01-27] - Electronic Letter Issuance System

### Added

- **LurahKey table (`lurah_keys`)**: RSA key pairs for digital signatures
  - `id` - Auto-increment primary key (BigInt)
  - `lurah_user_id` - Foreign key to users (Lurah)
  - `public_key` - RSA public key (text)
  - `encrypted_private_key` - AES-encrypted RSA private key (text)
  - `salt` - Encryption salt (varchar 64)
  - `iv` - Initialization vector (varchar 32)
  - `is_active` - Key status (boolean)
  - `created_at`, `updated_at` - Timestamps

- **IssuedLetter table (`issued_letters`)**: Issued letter records
  - `id` - Auto-increment primary key (BigInt)
  - `submission_id` - Foreign key to submissions (unique, one-to-one)
  - `letter_number` - Unique letter number
  - `verification_code` - Unique 16-char code for verification
  - `type` - Letter type (varchar 50)
  - `canonical_data` - Canonical data used for signing (text)
  - `canonical_hash` - SHA-256 hash of canonical data
  - `signature` - RSA-SHA256 digital signature (text)
  - `signed_by` - Foreign key to users (Lurah who signed)
  - `pdf_path` - Path to generated PDF file
  - `is_revoked` - Revocation status (boolean)
  - `revoked_at` - Revocation timestamp (nullable)
  - `revoked_reason` - Revocation reason (text, nullable)
  - `issued_at` - Issue timestamp
  - `expires_at` - Expiry date (nullable)
  - `created_at`, `updated_at` - Timestamps

- **Letter Templates (`src/templates/`)**: HTML templates and JSON schemas
  - `domisili/` - Surat Keterangan Domisili (validity: 30 days)
  - `usaha/` - Surat Keterangan Usaha (validity: 90 days)
  - `kematian/` - Surat Keterangan Kematian (no expiry)
  - `kelakuan_baik/` - Surat Keterangan Berkelakuan Baik (validity: 30 days)
  - `keramaian/` - Surat Izin Keramaian (validity: 7 days)

- **Template Service (`src/services/template.service.js`)**:
  - `getAvailableTemplates()` - List all available templates
  - `getSchema(type)` - Get template schema for validation
  - `getTemplate(type)` - Load HTML template
  - `validatePayload(type, payload)` - Validate submission payload
  - `prepareTemplateData(submission, meta)` - Prepare data for rendering
  - `renderTemplate(type, data)` - Render HTML with placeholders

- **Crypto Service (`src/services/crypto.service.js`)**:
  - `generateKeyPair()` - Generate RSA 2048-bit key pair
  - `encryptPrivateKey(privateKey, passphrase)` - AES-256-CBC encryption
  - `decryptPrivateKey(encrypted, passphrase, salt, iv)` - Decrypt private key
  - `setLurahKeyPair(lurahUserId, passphrase)` - Store key pair in database
  - `getActiveLurahKey()` - Retrieve active Lurah key
  - `buildCanonicalData(input)` - Build deterministic data for signing
  - `hashData(data)` - SHA-256 hashing
  - `signData(data, privateKey)` - RSA-SHA256 signing
  - `verifySignature(data, signature, publicKey)` - Verify signature
  - `createLetterSignature(input, lurahUserId, passphrase)` - Complete signing flow
  - `verifyLetterSignature(canonicalData, signature, publicKey)` - Verify letter

- **PDF Service (`src/services/pdf.service.js`)**:
  - `generateQRCode(data, options)` - Generate QR code as data URI
  - `renderToPdf(html)` - Render HTML to PDF using Puppeteer
  - `savePdf(buffer, filename)` - Save PDF to storage
  - `generateLetterPdf(options)` - Complete PDF generation with QR code

- **Letter Service (`src/services/letter.service.js`)**:
  - `generateLetterNumber(type, schema)` - Generate unique letter number
  - `issueLetter(submissionId, passphrase)` - Issue letter from approved submission
  - `getLetterByVerificationCode(code)` - Get letter details
  - `verifyLetter(code)` - Verify letter authenticity
  - `getLettersByUser(userId)` - Get user's issued letters
  - `getAllLetters(options)` - Get all letters (admin)
  - `revokeLetter(code, reason)` - Revoke an issued letter
  - `getLetterPdfPath(code, userId, role)` - Get PDF path with access control

- **Letter Controller (`src/controllers/letter.controller.js`)**

- **Letter Routes (`src/routes/letter.routes.js`)**:
  - `GET /v1/letters/templates` - List available templates (public)
  - `GET /v1/letters/templates/:type` - Get template schema (public)
  - `GET /v1/letters/verify/:code` - Verify letter authenticity (public)
  - `GET /v1/letters` - Get user's issued letters (authenticated)
  - `GET /v1/letters/:code` - Get letter details (authenticated)
  - `GET /v1/letters/download/:code` - Download letter PDF (authenticated)
  - `GET /v1/letters/admin/all` - Get all letters (admin/lurah)
  - `POST /v1/letters/keys/generate` - Generate Lurah key pair (admin)
  - `POST /v1/letters/issue/:submissionId` - Issue letter (admin)
  - `POST /v1/letters/:code/revoke` - Revoke letter (admin)

### Dependencies Added

- `puppeteer` - Headless Chrome for PDF generation
- `qrcode` - QR code generation
- `uuid` - UUID generation for verification codes

### Key Features

- **Digital Signatures**: RSA-SHA256 signatures with passphrase-protected private keys
- **QR Code Verification**: Each letter has a QR code linking to public verification endpoint
- **PDF Generation**: Professional letter PDFs generated with Puppeteer
- **Template System**: Dynamic templates with auto-populated fields from user data
- **Letter Revocation**: Ability to revoke issued letters with reason tracking
- **Expiry Management**: Configurable validity periods per letter type

---

## [2026-01-27] - Submission Workflow System

### Added

- **Submission table (`submissions`)**: Letter request submissions
  - `id` - Auto-increment primary key (BigInt)
  - `user_id` - Foreign key to users (cascade delete)
  - `lingkungan_id` - Foreign key to lingkungan
  - `type` - Submission type (varchar 50)
  - `status` - Workflow status enum
  - `payload` - Additional data (JSON, nullable)
  - `reject_reason` - Rejection reason (text, nullable)
  - `created_at`, `updated_at` - Timestamps

- **SubmissionDocument table (`submission_documents`)**: Supporting documents
  - `id` - Auto-increment primary key (BigInt)
  - `submission_id` - Foreign key to submissions (cascade delete)
  - `file_path` - Document file path
  - `file_type` - Document type (varchar 50, nullable)
  - `description` - Document description (text, nullable)
  - `verified` - Verification status (boolean, default false)
  - `created_at` - Timestamp

- **SubmissionApproval table (`submission_approvals`)**: Approval history
  - `id` - Auto-increment primary key (BigInt)
  - `submission_id` - Foreign key to submissions (cascade delete)
  - `approved_by` - Foreign key to users (approver)
  - `stage` - Approval stage enum (kepling, lurah)
  - `status` - Approval status enum (approved, rejected)
  - `note` - Approval note (text, nullable)
  - `created_at` - Timestamp

- **Submission Service (`src/services/submission.service.js`)**:
  - `createSubmission(data)` - Create new submission (warga)
  - `addDocument(data)` - Add document to submission
  - `getSubmissionsByUser(options)` - Get user's submissions
  - `getSubmissionsForKepling(options)` - Get submissions for kepling's lingkungan
  - `getSubmissionsForLurah(options)` - Get all submissions (lurah)
  - `getSubmissionById(id)` - Get submission details
  - `verifyDocument(data)` - Verify document (kepling)
  - `approveByKepling(data)` - Approve as kepling
  - `rejectByKepling(data)` - Reject as kepling
  - `approveByLurah(data)` - Approve as lurah
  - `rejectByLurah(data)` - Reject as lurah
  - `issueSubmission(data)` - Mark as issued (admin)
  - `deleteSubmission(data)` - Delete submission (owner)

- **Submission Controller (`src/controllers/submission.controller.js`)**

- **Submission Routes (`src/routes/submission.routes.js`)**:
  - **Warga Routes**:
    - `POST /v1/submissions` - Create submission
    - `GET /v1/submissions` - Get own submissions
    - `GET /v1/submissions/:id` - Get submission by ID
    - `POST /v1/submissions/:id/documents` - Add document
    - `DELETE /v1/submissions/:id` - Delete submission
  - **Kepling Routes**:
    - `GET /v1/submissions/kepling/list` - Get lingkungan submissions
    - `PATCH /v1/submissions/:id/documents/:documentId/verify` - Verify document
    - `POST /v1/submissions/:id/kepling/approve` - Approve submission
    - `POST /v1/submissions/:id/kepling/reject` - Reject submission
  - **Lurah Routes**:
    - `GET /v1/submissions/lurah/list` - Get all submissions
    - `POST /v1/submissions/:id/lurah/approve` - Approve submission
    - `POST /v1/submissions/:id/lurah/reject` - Reject submission
  - **Admin Routes**:
    - `POST /v1/submissions/:id/issue` - Issue submission

### Enums Added

- `SubmissionStatus`: pending_kepling, pending_lurah, approved, rejected, issued
- `ApprovalStage`: kepling, lurah
- `ApprovalStatus`: approved, rejected

### Workflow

1. **Warga** creates submission → status: `pending_kepling`
2. **Kepling** verifies documents and approves/rejects → status: `pending_lurah` or `rejected`
3. **Lurah** reviews and approves/rejects → status: `approved` or `rejected`
4. **Admin** issues letter using Letter service → status: `issued`

---

## [2026-01-26] - Lingkungan & Kepling Assignment System

### Added

- **Lingkungan table (`lingkungan`)**: Environment/neighborhood divisions
  - `id` - Auto-increment primary key (BigInt)
  - `nama` - Lingkungan name (varchar 100)
  - `kode` - Unique code (varchar 10, nullable)
  - `created_at`, `updated_at` - Timestamps

- **Lingkungan Kepling table (`lingkungan_kepling`)**: Kepling role assignments
  - `id` - Auto-increment primary key (BigInt)
  - `lingkungan_id` - Foreign key to lingkungan (cascade delete)
  - `user_id` - Foreign key to users (cascade delete)
  - `mulai` - Assignment start date
  - `selesai` - Assignment end date (nullable)
  - `created_at`, `updated_at` - Timestamps

- **Lingkungan Service (`src/services/lingkungan.service.js`)**: Business logic
  - CRUD operations for lingkungan
  - `assignKepling()` - Assigns user to lingkungan, **automatically changes role to kepling**
  - `endKeplingAssignment()` - Ends assignment, **reverts role to warga** if no other active assignments
  - Validation to prevent duplicate active assignments

- **Lingkungan Controller (`src/controllers/lingkungan.controller.js`)**: HTTP handlers

- **Lingkungan Routes (`src/routes/lingkungan.routes.js`)**:
  - `GET /v1/lingkungan` - List all lingkungan (authenticated)
  - `GET /v1/lingkungan/:id` - Get lingkungan by ID (authenticated)
  - `POST /v1/lingkungan` - Create lingkungan (admin only)
  - `PATCH /v1/lingkungan/:id` - Update lingkungan (admin only)
  - `DELETE /v1/lingkungan/:id` - Delete lingkungan (admin only)
  - `GET /v1/lingkungan/kepling` - List kepling assignments (admin/lurah)
  - `POST /v1/lingkungan/kepling` - Assign kepling (admin only)
  - `PATCH /v1/lingkungan/kepling/:id/end` - End kepling assignment (admin only)
  - `GET /v1/lingkungan/kepling/user/:userId` - Get user's kepling history (admin/lurah)

### Updated

- **Data Kependudukan table**: Added `lingkungan_id` column (after `rw`)
  - Optional foreign key to lingkungan table
  - Links residents to their neighborhood/environment

- **User model**: Added relation to `LingkunganKepling`

### Key Features

- When admin assigns a user as kepling via `POST /v1/lingkungan/kepling`, the user's role is automatically updated to `kepling`
- When kepling assignment ends (via `PATCH /v1/lingkungan/kepling/:id/end`), user's role reverts to `warga` if they have no other active assignments
- Each lingkungan can only have one active kepling at a time
- Each user can only be an active kepling in one lingkungan at a time

---

## [2026-01-25] - Admin Routes Refactoring

### Added

- **Admin Routes (`src/routes/admin.routes.js`)**: Centralized admin-only routes
  - All routes protected with `authMiddleware` and `requireRole('admin')`
  - `GET /admin/users` - Get all users with pagination (moved from user.routes.js)
  - `GET /admin/users/:id` - Get user by ID (moved from user.routes.js)
  - `GET /admin/validate-requests` - Get all validation requests with pagination
  - `GET /admin/validate-requests/:id` - Get validation request by ID
  - `PATCH /admin/validate-requests/:id` - Process validation request (approve/reject)

### Changed

- **User Routes (`src/routes/user.routes.js`)**: Now only contains user-facing routes
  - `GET /users/me` - Get current user profile
  - `PATCH /users/me` - Update current user profile (nama, no_hp, password)

- **Validate Routes (`src/routes/validate.routes.js`)**: Now only contains user-facing routes
  - `POST /validate-requests` - Create validation request
  - `GET /validate-requests/me` - Get current user's validation requests

---

## [2026-01-25] - Validation Request System

### Added

- **Validate Request Table (`validate_requests`)**: New table for user validation workflow
  - `id` - Auto-increment primary key (BigInt)
  - `user_id` - Foreign key to users (cascade delete)
  - `nik` - NIK being validated (16 char, references data_kependudukan)
  - `status` - Request status enum (pending, approved, rejected)
  - `admin_notes` - Optional notes from admin (text)
  - `processed_by` - Admin who processed the request (nullable, references users)
  - `processed_at` - When the request was processed (nullable)
  - `created_at`, `updated_at` - Timestamps

- **Validate Request Routes (`src/routes/validate.routes.js`)**: Complete validation workflow
  - `POST /validate-requests` - Create validation request (warga only)
    - Validates NIK format (16 digits)
    - Checks if NIK exists in data_kependudukan
    - Checks if user is already validated
    - Prevents duplicate pending requests
    - Returns 201 with request data and kependudukan info
  - `GET /validate-requests` - Get all validation requests with pagination (admin only)
    - Optional filter by status (pending, approved, rejected)
    - Includes user, kependudukan, and admin data
  - `GET /validate-requests/me` - Get current user's validation requests
  - `GET /validate-requests/:id` - Get validation request by ID (admin only)
  - `PATCH /validate-requests/:id` - Process validation request (admin only)
    - Accept status: "approved" or "rejected"
    - Optional admin_notes
    - If approved: updates user's NIK and is_validate to true
    - Uses transaction for data consistency

### Enums Added

- `ValidateRequestStatus`: pending, approved, rejected

### Relations Added

- `User` → `ValidateRequest` (one-to-many as requester)
- `User` → `ValidateRequest` (one-to-many as admin processor)
- `DataKependudukan` → `ValidateRequest` (one-to-many)

### Updated

- **User Routes (`src/routes/user.routes.js`)**:
  - `PATCH /users/me` now supports updating `nama`, `no_hp`, and `password`
  - Password is automatically hashed with bcrypt

---

## [2026-01-25] - Authentication System Implementation

### Added

- **Auth Routes (`src/routes/auth.routes.js`)**: Complete authentication system
  - `POST /auth/register` - Register new user with NIK, nama, no_hp, password
    - Validates NIK (16 digits), phone format (08xxxxxxxxx), password (min 8 chars)
    - Returns 201 on success, 400 for invalid data, 409 for duplicate no_hp/NIK
  - `POST /auth/login` - Login with no_hp and password
    - Returns access_token, refresh_token, and user data
    - Stores refresh token in database with user_agent and ip_address
    - Checks user status (must be 'active')
  - `POST /auth/refresh` - Refresh access token using refresh token
    - Validates refresh token against database
    - Returns new access_token
  - `POST /auth/logout` - Logout and revoke refresh token (requires auth)
    - Deletes refresh token from database

- **User Routes (`src/routes/user.routes.js`)**: User profile management
  - `GET /users/me` - Get current user profile (requires auth)
  - `PATCH /users/me` - Update current user profile (requires auth)
  - `GET /users` - Get all users with pagination (admin only)
  - `GET /users/:id` - Get user by ID (admin only)

- **Auth Middleware (`src/middleware/auth.middleware.js`)**:
  - `authMiddleware` - JWT verification for protected routes
  - `requireRole(...roles)` - Role-based access control middleware

- **Environment Config (`src/config/env.js`)**:
  - Added `JWT_REFRESH_SECRET` for refresh token signing
  - Added `JWT_REFRESH_EXPIRES_IN` (default: 7d)
  - Changed `JWT_EXPIRES_IN` to 15m (access token short-lived)

### API Response Format

- All responses now use Indonesian messages
- Consistent error format: `{ error: "ErrorType", message: "Description" }`
- User response format follows swagger spec with snake_case fields

### Security Features

- Password hashing with bcrypt (salt rounds: 10)
- Short-lived access tokens (15 minutes)
- Long-lived refresh tokens (7 days) stored in database
- IP address and user agent tracking for tokens
- User status check on login and token refresh

---

## [2026-01-25] - Database Schema Creation

### Added

- **Users table (`users`)**: Main user table with fields:
  - `id` - Auto-increment primary key (BigInt)
  - `nik` - NIK (16 char, unique, nullable)
  - `nama` - Full name (varchar 100)
  - `no_hp` - Phone number (varchar 20, unique)
  - `role` - User role enum (warga, kepling, lurah, admin)
  - `password` - Hashed password (varchar 255)
  - `is_validate` - Validation status (boolean, default false)
  - `status` - Account status enum (active, inactive, banned)
  - `created_at`, `updated_at` - Timestamps

- **User Tokens table (`user_tokens`)**: Refresh token storage with fields:
  - `id` - Auto-increment primary key (BigInt)
  - `user_id` - Foreign key to users (cascade delete)
  - `refresh_token` - Token value (text)
  - `user_agent` - Client user agent (varchar 255, nullable)
  - `ip_address` - Client IP address (varchar 50, nullable)
  - `expired_at` - Token expiration datetime
  - `created_at` - Timestamp

- **Data Kependudukan table (`data_kependudukan`)**: Population data with fields:
  - `nik` - NIK as primary key (16 char)
  - `nama` - Full name (varchar 100)
  - `tempat_lahir` - Birth place (varchar 100)
  - `tanggal_lahir` - Birth date
  - `jenis_kelamin` - Gender enum (L, P)
  - `golongan_darah` - Blood type enum (A, B, AB, O, -, nullable)
  - `alamat` - Full address (text)
  - `rt`, `rw` - RT/RW (3 char each, nullable)
  - `kelurahan`, `kecamatan`, `kabupaten_kota`, `provinsi` - Administrative regions
  - `status_kawin` - Marital status enum
  - `agama` - Religion (varchar 50)
  - `pekerjaan` - Occupation (varchar 100)
  - `kewarganegaraan` - Citizenship (default 'WNI')
  - `created_at`, `updated_at` - Timestamps

### Enums Created

- `UserRole`: warga, kepling, lurah, admin
- `UserStatus`: active, inactive, banned
- `JenisKelamin`: L, P
- `GolonganDarah`: A, B, AB, O, -
- `StatusKawin`: Belum Kawin, Kawin, Cerai Hidup, Cerai Mati

### Relations

- `User` → `UserToken` (one-to-many, cascade delete)
- `User` → `DataKependudukan` (one-to-one via NIK)
