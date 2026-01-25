# Change Log

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
