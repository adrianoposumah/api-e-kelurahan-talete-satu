# Claude Code Agent Instruction — e-Kelurahan v2.0 MOBILE (Android Kotlin)

## ROLE

You are implementing the **Android mobile app** of e-Kelurahan v2.0. Migration from v1.1 (server-stored RSA keys, Lurah typed passphrase to authorize signing) to v2.0 (**Android Keystore for hardware-backed key storage**, biometric authentication, X.509 certificate enrollment).

**Your scope:** Android app only. The server is being migrated in a parallel effort by another agent in a separate repository. You and that agent communicate through the REST API contract specified below — implement to this contract exactly, and the integration will work.

From the mobile perspective, this migration is conceptually simpler than the server side. You don't need to know about PAdES, PKCS#7, ASN.1, or /ByteRange. **All complexity is server-side.** You just need to:

1. Generate a keypair in Android Keystore
2. Create a Certificate Signing Request (CSR) and send to server
3. Store the certificate the server returns
4. When signing a letter: receive bytes from server, sign them with the Keystore key (biometric-gated), send signature back

This is 1-2 weeks of focused work. Work phase-by-phase, surface blockers immediately.

---

## CONTEXT YOU MUST READ FIRST

Before writing any code, read these files in this order:

1. **`mobile-key-implementation/MOBILE_KEY_IMPLEMENTATION_PLAN.md`** — overall migration plan. Read sections 1–5 fully. Server-side sections (CA bootstrap, PAdES) can be skimmed.
2. **`mobile-key-implementation/API_CONTRACTS.md`** — REST endpoints. Note that v2.0 PAdES differs slightly from this reference — the API CONTRACT section below in this prompt overrides any conflicting fields.
3. **`mobile-key-implementation/android/crypto/KeyManager.kt`** — Keystore wrapper. Reusable as-is.
4. **`mobile-key-implementation/android/crypto/CsrGenerator.kt`** — CSR generation. Reusable as-is.
5. **`mobile-key-implementation/android/crypto/SigningCoordinator.kt`** — biometric-gated signing. Reusable as-is.
6. **`mobile-key-implementation/android/crypto/CertificateStorage.kt`** — local cert storage. Reusable as-is.
7. **`mobile-key-implementation/android/data/Models.kt`** — data classes. Needs minor changes for v2.0 (see "MODEL CHANGES" below).
8. **`mobile-key-implementation/android/data/LurahApiService.kt`** — Retrofit interface. Reusable as-is.
9. **`mobile-key-implementation/android/data/EnrollmentRepository.kt`** — Reusable as-is.
10. **`mobile-key-implementation/android/data/SigningRepository.kt`** — needs minor changes (drop body_hash verification).
11. **`mobile-key-implementation/android/ui/*.kt`** — ViewModels. Reusable as-is.
12. **`mobile-key-implementation/android/crypto/ByteRangeHasher.kt`** — **DELETE this**. Not needed in v2.0.
13. **Existing v1.1 Android codebase in your workspace** — understand current screens, ViewModels, DI setup, package structure, navigation. Don't break what works.

Do not start coding until you have read all of the above. Confirm to the user when reading phase is complete, then proceed to Phase 0.

---

## ARCHITECTURE OVERVIEW (Mobile Perspective)

```
ENROLLMENT FLOW (one-time per device, run after Lurah first login):
  1. Lurah logs in via existing v1.1 auth flow → JWT token stored
  2. App checks: does Lurah have a cert stored locally? (CertificateStorage)
     - If yes, valid, not expired: skip enrollment, go straight to letters list
     - If no, or expired/invalidated: show enrollment screen
  3. Lurah taps "Daftarkan Perangkat" → enrollment flow begins:
     a. POST /api/lurah/keys/enrollment-token → receive token + subject template
     b. KeyManager.generateLurahKeyPair() → creates RSA-2048 keypair in Android Keystore,
        hardware-backed if available, biometric-required for use
     c. CsrGenerator.generateCsr(keyPair, subject) → builds PKCS#10 CSR
        ⚠️ This signs the CSR with the private key → triggers biometric prompt
     d. POST /api/lurah/keys/csr with csrPem + enrollmentToken
        → receive X.509 certificate
     e. CertificateStorage.saveCertificate(cert) → store in EncryptedSharedPreferences
  4. Success screen → navigate to letters list

PER-LETTER SIGNING FLOW (repeated for each surat):
  1. Lurah opens letters list → GET /api/letters/pending → display
  2. Lurah taps a letter → GET /api/letters/{id} → show detail review
  3. Lurah reviews warga data, taps "Tanda Tangan"
  4. App calls POST /api/letters/{id}/prepare-signing
     → receives { sessionId, pdfBase64, bytesToSignBase64, expiresAt, letterPreview }
  5. App decodes pdfBase64 → shows PDF preview
  6. Lurah reviews PDF preview, taps "Konfirmasi Tanda Tangan"
  7. App decodes bytesToSignBase64 → byteArray
  8. SigningCoordinator.signData(activity, bytesToSign, ...) →
     a. Loads private key handle from Keystore
     b. Initializes Signature object with "SHA256withRSA"
     c. Wraps in BiometricPrompt.CryptoObject
     d. Shows biometric prompt to Lurah
     e. On authentication success → signature.sign(bytesToSign) → signatureBytes
  9. App calls POST /api/letters/{id}/submit-signature with { sessionId, signatureBase64 }
     → receives { issuedLetterId, downloadUrl, verificationUrl }
  10. Success screen with verification code & QR

WHAT YOU DON'T NEED TO KNOW:
  - What bytesToSign actually contains (it's PKCS#7 signedAttributes from server, but
    from your perspective it's just opaque bytes to sign)
  - How server assembles final PKCS#7
  - How server embeds signature into PDF
  - PAdES, PKCS#7, /ByteRange — server-side concerns only
```

---

## API CONTRACT (What You'll Call)

You'll make these requests. Server side implements to this exact spec.

### Authentication

All endpoints require JWT Bearer token in `Authorization` header (from existing v1.1 login flow). Reuse existing OkHttp interceptor that injects the token.

### Endpoints

#### POST `/api/lurah/keys/enrollment-token`

**Request body:** Empty (POST with no body)
**Response 200:**

```json
{
  "enrollmentToken": "string (random, TTL 10 min)",
  "expiresAt": "ISO 8601 string",
  "subjectTemplate": {
    "commonName": "string",
    "organization": "string",
    "organizationalUnit": "string",
    "country": "string"
  }
}
```

**Possible errors:**

- 409 `ALREADY_ENROLLED` if Lurah already has active cert. App should fetch active cert via GET /certificate and skip to letters list.

#### POST `/api/lurah/keys/csr`

**Request body:**

```json
{
  "enrollmentToken": "string from previous endpoint",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...",
  "deviceLabel": "string (optional, e.g. 'HP Dinas Lurah')"
}
```

**Response 200:**

```json
{
  "certificateId": "string (cuid)",
  "certificatePem": "-----BEGIN CERTIFICATE-----\n...",
  "rootCaCertificatePem": "-----BEGIN CERTIFICATE-----\n...",
  "serialNumber": "string",
  "fingerprint": "string (SHA-256 hex)",
  "issuedAt": "ISO 8601",
  "expiresAt": "ISO 8601"
}
```

**Possible errors:**

- 400 `INVALID_CSR` — CSR malformed (bug in app)
- 400 `SUBJECT_MISMATCH` — subject in CSR doesn't match template (bug: app didn't use subjectTemplate from previous response)
- 410 `ENROLLMENT_TOKEN_EXPIRED` — took too long, restart enrollment

#### GET `/api/lurah/keys/certificate`

**Response 200:**

```json
{
  "certificateId": "string",
  "certificatePem": "...",
  "serialNumber": "...",
  "fingerprint": "...",
  "deviceLabel": "string or null",
  "issuedAt": "ISO 8601",
  "expiresAt": "ISO 8601",
  "status": "ACTIVE"
}
```

**Possible errors:**

- 404 `NO_ACTIVE_CERTIFICATE` — Lurah not enrolled yet

#### GET `/api/letters/pending`

**Query params:** `limit` (1-50, default 20), `cursor` (optional pagination)
**Response 200:**

```json
{
  "items": [
    {
      "submissionId": "string",
      "letterType": "string",
      "warga": { "nik": "string", "nama": "string" },
      "keperluan": "string",
      "kepalaLingkunganApprovedAt": "ISO 8601",
      "kepalaLingkunganName": "string",
      "createdAt": "ISO 8601"
    }
  ],
  "nextCursor": "string or null"
}
```

#### GET `/api/letters/:submissionId`

**Response 200:**

```json
{
  "submissionId": "string",
  "letterType": "string",
  "warga": {
    "nik": "string",
    "nama": "string",
    "alamat": "string",
    "tanggalLahir": "string",
    "tempatLahir": "string",
    "pekerjaan": "string",
    "jenisKelamin": "string",
    "agama": "string",
    "kewarganegaraan": "string"
  },
  "lingkungan": "string",
  "keperluan": "string",
  "approvalHistory": [
    {
      "role": "KEPALA_LINGKUNGAN",
      "name": "string",
      "approvedAt": "ISO 8601",
      "notes": "string or null"
    }
  ],
  "status": "PENDING_LURAH",
  "createdAt": "ISO 8601"
}
```

#### POST `/api/letters/:submissionId/prepare-signing`

**Request body:** Empty
**Response 200:**

```json
{
  "sessionId": "string",
  "expiresAt": "ISO 8601 (preparedAt + 5 min)",
  "pdfBase64": "base64-encoded PDF bytes",
  "bytesToSignBase64": "base64-encoded bytes you must sign with SHA256withRSA",
  "letterPreview": {
    "letterNumber": "string",
    "verificationCode": "string",
    "issuedDate": "YYYY-MM-DD",
    "expiryDate": "YYYY-MM-DD"
  }
}
```

**Important:** `bytesToSignBase64` is opaque from your perspective. Decode from base64, pass byte array to `SigningCoordinator.signData()`. Do NOT hash it manually — Android's "SHA256withRSA" algorithm handles SHA-256 internally before RSA-signing.

**Possible errors:**

- 412 `ENROLLMENT_REQUIRED` — Lurah not enrolled. Navigate to enrollment.
- 409 `INVALID_STATE` — submission not PENDING_LURAH (someone else acted on it)

#### POST `/api/letters/:submissionId/submit-signature`

**Request body:**

```json
{
  "sessionId": "string from prepare-signing",
  "signatureBase64": "base64-encoded signature bytes from SigningCoordinator"
}
```

**Response 200:**

```json
{
  "issuedLetterId": "string",
  "letterNumber": "string",
  "verificationCode": "string",
  "signedAt": "ISO 8601",
  "downloadUrl": "/api/letters/{id}/download (relative URL)",
  "verificationUrl": "https://... (full URL to public verifier page)"
}
```

**Possible errors:**

- 410 `SESSION_EXPIRED` — past 5 min TTL. Show error, restart from prepare-signing.
- 409 `SESSION_ALREADY_COMPLETED` — duplicate submit. Treat as success if previous succeeded.
- 400 `SIGNATURE_INVALID` — signature didn't verify. Likely cert mismatch (different device) or bug.

#### POST `/api/letters/:submissionId/reject`

**Request body:** `{ "reason": "string (required, non-empty)" }`
**Response 200:** `{ "submissionId": "...", "status": "REJECTED_BY_LURAH", "rejectedAt": "ISO 8601" }`

#### Error response format

All errors:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable",
    "details": { "...": "..." }
  }
}
```

---

## MODEL CHANGES FROM REFERENCE FILES

The reference `Models.kt` and `SigningRepository.kt` were written for an earlier design. Adjust:

### `data/Models.kt`

Change `PrepareSigningResponse`:

```kotlin
@JsonClass(generateAdapter = true)
data class PrepareSigningResponse(
    val sessionId: String,
    val expiresAt: String,
    val pdfBase64: String,
    val bytesToSignBase64: String,   // ← was 'dataToSign' (String) in reference
    // bodyHash field REMOVED entirely
    val letterPreview: LetterPreview
)
```

All other model classes unchanged from reference.

### `data/SigningRepository.kt`

In `preparePdfForSigning()`:

- Remove all body_hash verification (no `hasher.verifyContentHash()` call, no `BodyHashMismatchException` throwing).
- Decode `bytesToSignBase64` from base64 to ByteArray.
- Build `PreparedSigningSession` with `bytesToSign: ByteArray` field instead of `dataToSign: String`.

In `signAndSubmit()`:

- Pass `session.bytesToSign` directly to `coordinator.signData()` (no UTF-8 conversion — already bytes).

Update `PreparedSigningSession` data class:

```kotlin
data class PreparedSigningSession(
    val sessionId: String,
    val expiresAtEpoch: Long,
    val pdfBytes: ByteArray,
    val bytesToSign: ByteArray,    // ← was 'dataToSign: String' + 'bodyHash: String'
    val letterPreview: LetterPreview
) {
    fun millisUntilExpiry(): Long = expiresAtEpoch - System.currentTimeMillis()
    fun isExpired(): Boolean = millisUntilExpiry() <= 0

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PreparedSigningSession) return false
        return sessionId == other.sessionId
    }
    override fun hashCode(): Int = sessionId.hashCode()
}
```

Remove `BodyHashMismatchException` class (no longer thrown).

### Delete `crypto/ByteRangeHasher.kt`

Not needed in v2.0. Server-side PAdES /ByteRange handles content integrity. Delete the file and remove any imports.

---

## CRITICAL TECHNICAL DETAILS

### Android Keystore Patterns

The Keystore API has several gotchas. Read these before writing crypto code:

**1. Private key never leaves Keystore as bytes.**

- `keyStore.getKey(alias, null)` returns a `PrivateKey` **handle**, not bytes.
- This handle can be passed to `Signature.initSign()`. The actual signing happens inside Keystore.
- You cannot export, serialize, or backup the private key. If user loses device, the key is gone.

**2. `setUserAuthenticationRequired(true)` + `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` means per-operation auth.**

- Every single signing operation requires a fresh biometric authentication.
- There's no "valid for N seconds after auth" window. Each `Signature.sign()` call must be wrapped in `BiometricPrompt.CryptoObject`.

**3. `setInvalidatedByBiometricEnrollment(true)` invalidates the key if biometric enrollment changes.**

- If user adds a new fingerprint, removes existing one, or factory-resets biometric, the key is permanently invalidated.
- Catch `KeyPermanentlyInvalidatedException` and prompt user to re-enroll the device.
- This is a security feature: prevents attackers who steal an unlocked phone from registering their own biometric.

**4. CryptoObject binding is mandatory.**

- `BiometricPrompt.authenticate(promptInfo, cryptoObject)` — without the cryptoObject parameter, the biometric prompt will show but Keystore won't authorize key use.
- The `Signature` object must be initialized BEFORE wrapping in CryptoObject. Initialize with `initSign(privateKeyHandle)`, then `BiometricPrompt.CryptoObject(signature)`.

**5. After biometric success, sign IMMEDIATELY.**

- The `result.cryptoObject?.signature` in `onAuthenticationSucceeded` is the authorized Signature object.
- Call `.update(bytesToSign)` then `.sign()` to produce signature bytes.
- Do NOT pass this Signature object outside the callback — its authorization is scoped to this single operation.

**6. CSR generation requires biometric too.**

- `JcaContentSignerBuilder("SHA256withRSA").build(privateKey)` calls `Signature.initSign()` internally, which then needs biometric auth when `.sign()` is invoked.
- The reference `CsrGenerator.kt` uses a straightforward BouncyCastle pattern. If you encounter `UserNotAuthenticatedException` during CSR build, you need to refactor to either:
  (a) Wrap `csr.build(contentSigner)` in a biometric prompt callback, OR
  (b) Use a `ContentSigner` implementation that doesn't sign synchronously, then sign separately via SigningCoordinator and inject the signature into the CSR structure manually.
- Option (a) is simpler but requires care because BouncyCastle's `build()` is synchronous.

### BouncyCastle Setup

Android has a stripped-down BouncyCastle provider built in. You need the full BouncyCastle:

```kotlin
// In Application.onCreate()
Security.removeProvider("BC")
Security.insertProviderAt(BouncyCastleProvider(), 1)
```

Without this, CSR generation may fail with cryptic errors about missing algorithms.

### Biometric Availability Checks

Before showing biometric prompt, check device capability:

```kotlin
val biometricManager = BiometricManager.from(context)
when (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
    BiometricManager.BIOMETRIC_SUCCESS -> /* OK */
    BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> {
        // Tell user to enroll fingerprint in Settings → Security
    }
    BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> {
        // Device has no biometric hardware. Cannot use this app.
    }
    BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> {
        // Tell user to update Android security patches
    }
    // ...
}
```

Reference `SigningCoordinator.checkBiometricAvailability()` already does this.

---

## EXECUTION PLAN

### PHASE 0: Workspace Preparation

1. Verify access to v1.1 Android codebase and `mobile-key-implementation/` reference folder.
2. Read all files listed in "CONTEXT YOU MUST READ FIRST".
3. Tag current v1.1 in git: `git tag v1.1-stable-mobile`. Create migration branch `git checkout -b v2.0-keystore-migration`.
4. Identify existing package structure (e.g., `com.example.ekelurahan.lurah`). All reference files use `com.ekelurahan.lurah` — adjust imports accordingly when copying.
5. Identify existing DI framework (Hilt, Koin, manual). All wiring will follow that pattern.
6. Identify existing UI framework (Jetpack Compose, XML+Fragment, ViewBinding). The reference ViewModels are framework-agnostic but Compose recommended.

**Acceptance:**

- [ ] All reference files read
- [ ] Existing package structure, DI framework, UI framework identified and reported to user
- [ ] Awaiting user confirmation before Phase 1

### PHASE 1: Dependencies & Setup

1. Add to `app/build.gradle.kts`:

   ```kotlin
   dependencies {
       // BouncyCastle for CSR generation
       implementation("org.bouncycastle:bcpkix-jdk15on:1.70")
       implementation("org.bouncycastle:bcprov-jdk15on:1.70")

       // Biometric authentication
       implementation("androidx.biometric:biometric:1.2.0-alpha05")

       // Encrypted SharedPreferences for cert storage
       implementation("androidx.security:security-crypto:1.1.0-alpha06")

       // Coroutines (likely already present, ensure version)
       implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

       // Lifecycle ViewModel KTX
       implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")

       // (Retrofit, Moshi, OkHttp likely already present from v1.1)
   }
   ```

2. Add to `AndroidManifest.xml`:

   ```xml
   <uses-permission android:name="android.permission.USE_BIOMETRIC" />
   ```

3. Register BouncyCastle in `Application.onCreate()`:

   ```kotlin
   override fun onCreate() {
       super.onCreate()
       Security.removeProvider("BC")
       Security.insertProviderAt(BouncyCastleProvider(), 1)
       // ... other init
   }
   ```

4. Build and run on emulator. App should still work as v1.1 — no functional changes yet.

**Acceptance:**

- [ ] App compiles with new dependencies
- [ ] App runs on emulator with biometric capability
- [ ] No crashes related to BouncyCastle registration

### PHASE 2: Crypto Layer

Copy the following files from `mobile-key-implementation/android/crypto/` into your project (adjust package name in each file):

1. `KeyManager.kt` → `<your.package>/crypto/KeyManager.kt`
2. `CsrGenerator.kt` → `<your.package>/crypto/CsrGenerator.kt`
3. `SigningCoordinator.kt` → `<your.package>/crypto/SigningCoordinator.kt`
4. `CertificateStorage.kt` → `<your.package>/crypto/CertificateStorage.kt`

**Do NOT copy** `ByteRangeHasher.kt` — not needed in v2.0.

Write instrumented tests in `androidTest/`:

```kotlin
@RunWith(AndroidJUnit4::class)
class KeyManagerInstrumentedTest {

    private lateinit var keyManager: KeyManager

    @Before
    fun setup() {
        keyManager = KeyManager()
        // Clean state
        keyManager.deleteKey()
    }

    @Test
    fun generateKeyPair_createsKeyInKeystore() {
        val keyPair = keyManager.generateLurahKeyPair()
        assertNotNull(keyPair)
        assertTrue(keyManager.keyExists())
    }

    @Test
    fun getPublicKey_returnsValidRsaKey() {
        keyManager.generateLurahKeyPair()
        val pubKey = keyManager.getPublicKey()
        assertEquals("RSA", pubKey.algorithm)
    }

    @Test
    fun isKeyValid_returnsTrueAfterGeneration() {
        keyManager.generateLurahKeyPair()
        assertTrue(keyManager.isKeyValid())
    }

    @Test
    fun deleteKey_removesFromKeystore() {
        keyManager.generateLurahKeyPair()
        keyManager.deleteKey()
        assertFalse(keyManager.keyExists())
    }
}
```

**Note:** Tests requiring biometric (CsrGenerator, SigningCoordinator) need either an emulator with biometric mocked (Android Studio Extended Controls → Fingerprint) or a connected device.

**Acceptance:**

- [ ] All 4 crypto files compile in your project
- [ ] KeyManager instrumented tests pass on emulator
- [ ] CSR can be generated end-to-end (might need manual emulator biometric input)
- [ ] CertificateStorage round-trip works (save → load → compare equal)

### PHASE 3: Data Layer

Copy from `mobile-key-implementation/android/data/`:

1. `Models.kt` → adjust package, **apply MODEL CHANGES section above** before copying
2. `LurahApiService.kt` → adjust package, copy as-is
3. `EnrollmentRepository.kt` → adjust package, copy as-is
4. `SigningRepository.kt` → adjust package, **apply MODEL CHANGES section** before copying

Set up Retrofit client (likely already exists from v1.1):

```kotlin
val moshi = Moshi.Builder()
    .add(KotlinJsonAdapterFactory())
    .build()

val okHttpClient = OkHttpClient.Builder()
    .addInterceptor(authInterceptor)  // existing JWT interceptor
    .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
    .build()

val retrofit = Retrofit.Builder()
    .baseUrl(BuildConfig.API_BASE_URL)
    .client(okHttpClient)
    .addConverterFactory(MoshiConverterFactory.create(moshi))
    .build()

val lurahApi: LurahApiService = retrofit.create(LurahApiService::class.java)
```

Wire repositories in DI (Hilt example):

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object CryptoModule {
    @Provides @Singleton fun provideKeyManager(): KeyManager = KeyManager()
    @Provides @Singleton fun provideCsrGenerator(): CsrGenerator = CsrGenerator()
    @Provides @Singleton fun provideSigningCoordinator(km: KeyManager): SigningCoordinator = SigningCoordinator(km)
    @Provides @Singleton fun provideCertificateStorage(@ApplicationContext ctx: Context): CertificateStorage = CertificateStorage(ctx)

    @Provides @Singleton fun provideEnrollmentRepository(
        api: LurahApiService,
        km: KeyManager,
        csr: CsrGenerator,
        coordinator: SigningCoordinator,
        storage: CertificateStorage
    ): EnrollmentRepository = EnrollmentRepository(api, km, csr, coordinator, storage)

    @Provides @Singleton fun provideSigningRepository(
        api: LurahApiService,
        coordinator: SigningCoordinator,
        storage: CertificateStorage
    ): SigningRepository = SigningRepository(api, coordinator, storage)
}
```

Test API calls manually with a mock server first (Postman or curl against staging) before mobile-server integration.

**Acceptance:**

- [ ] All data layer files compile
- [ ] Retrofit calls succeed against staging server (manual curl test first to verify API contract)
- [ ] EnrollmentRepository.checkEnrollmentStatus() works without errors
- [ ] DI wiring complete, no missing bindings

### PHASE 4: UI Integration

Copy ViewModels from `mobile-key-implementation/android/ui/`:

1. `EnrollmentViewModel.kt` → adjust package, copy as-is
2. `SigningViewModel.kt` → adjust package, copy as-is

Build screens to match. Choose based on existing v1.1 UI framework:

**If Jetpack Compose:**

Create `EnrollmentScreen.kt`:

```kotlin
@Composable
fun EnrollmentScreen(
    viewModel: EnrollmentViewModel = hiltViewModel(),
    onEnrollmentComplete: () -> Unit
) {
    val activity = LocalContext.current as FragmentActivity
    val state by viewModel.state.collectAsState()

    LaunchedEffect(Unit) { viewModel.checkStatus() }

    when (val s = state) {
        is EnrollmentUiState.Initial,
        is EnrollmentUiState.CheckingStatus -> CenteredLoading("Memeriksa status...")

        is EnrollmentUiState.NotEnrolled -> EnrollmentPrompt(
            onEnroll = { viewModel.enroll(activity) }
        )

        is EnrollmentUiState.Enrolling -> CenteredLoading(s.message)

        is EnrollmentUiState.AlreadyEnrolled,
        is EnrollmentUiState.Success -> LaunchedEffect(Unit) { onEnrollmentComplete() }

        is EnrollmentUiState.KeyInvalidated -> KeyInvalidatedScreen(
            onReEnroll = {
                viewModel.clearLocal()
                viewModel.enroll(activity)
            }
        )

        is EnrollmentUiState.BiometricUnavailable -> BiometricUnavailableScreen(s.status)

        is EnrollmentUiState.Cancelled -> EnrollmentPrompt(
            onEnroll = { viewModel.enroll(activity) },
            message = s.message
        )

        is EnrollmentUiState.Error -> ErrorScreen(s.throwable, canRetry = s.canRetry, onRetry = { viewModel.enroll(activity) })
    }
}
```

Create `SigningListScreen.kt`, `SigningDetailScreen.kt`, `SigningPreviewScreen.kt` (PDF preview), `SigningSuccessScreen.kt` following same pattern.

**If XML + Fragments:** observe StateFlow in Fragment, use sealed class state in `when` block to switch visibility of views.

**Critical UX details:**

- **Hosting Activity must be `FragmentActivity`** for `BiometricPrompt` to work. Check `MainActivity` extends `FragmentActivity` (or `ComponentActivity` works in Compose since it extends FragmentActivity).
- **Pass Activity to ViewModel methods that trigger biometric.** Don't store Activity reference in ViewModel — pass on each call.
- **Session expiry countdown.** When `state is Reviewing`, show countdown timer based on `session.millisUntilExpiry()`. When expires, transition back to detail screen.
- **PDF preview.** Use any PDF rendering library (PdfRenderer from API 21+, or `pdf-viewer` libraries). Convert `pdfBytes` to ParcelFileDescriptor for PdfRenderer:
  ```kotlin
  val tempFile = File(context.cacheDir, "preview-${System.currentTimeMillis()}.pdf").apply {
      writeBytes(pdfBytes)
  }
  val pfd = ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY)
  val renderer = PdfRenderer(pfd)
  // ... render pages
  ```
  Delete temp file after preview screen exits.

**Acceptance:**

- [ ] Enrollment flow runnable end-to-end on emulator
- [ ] List → Detail → Preview → Biometric → Success flow runnable
- [ ] All error states display appropriately
- [ ] PDF preview renders correctly

### PHASE 5: End-to-End Integration Testing

Coordinate with backend agent / dev to test full integration:

| ID     | Scenario         | Steps                                                                 | Expected                                                                |
| ------ | ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| E2E-01 | Enrollment       | Fresh install → login → enroll → verify cert saved                    | EncryptedSharedPreferences has cert, server DB has LurahCertificate row |
| E2E-02 | Sign one letter  | Login enrolled → tap pending → review → preview → biometric → success | IssuedLetter created, downloadable PDF                                  |
| E2E-03 | Biometric denied | Sign flow → cancel biometric prompt                                   | Session stays PENDING, return to detail screen                          |
| E2E-04 | Session expired  | Sign flow → wait 6 min → confirm                                      | Show error "Session expired, ulangi"                                    |
| E2E-05 | Wrong device     | Generate key on Device A, try to use cert on Device B                 | Server rejects (SIGNATURE_INVALID)                                      |
| E2E-06 | No enrollment    | Login fresh user → try to sign                                        | Redirected to enrollment screen (412 from server)                       |
| E2E-07 | Key invalidated  | After enrollment, change device biometric → try to sign               | KeyPermanentlyInvalidatedException caught, prompt re-enrollment         |
| E2E-08 | Network failure  | Sign flow → disable wifi during biometric                             | Show error, allow retry                                                 |
| E2E-09 | Concurrent sign  | Two devices login same Lurah → both prepare-signing → first submits   | Second submit gets SESSION_EXPIRED or SIGNATURE_INVALID                 |
| E2E-10 | Reject           | Detail screen → tap Tolak → fill reason → submit                      | Submission status REJECTED_BY_LURAH                                     |

### PHASE 6: Cleanup & Polish

- Add proper error messages in Indonesian for all error codes from API
- Add loading indicators for all network calls (with timeouts)
- Add offline detection (NetworkCallback) and offline state UI
- Add analytics/logging for security events (enrollment, signing, key invalidation) — but do NOT log signature bytes or private key references
- Test on real device (not just emulator) for biometric quirks
- Test on Android 8 (API 26), Android 10 (API 29), Android 13 (API 33), Android 14 (API 34) minimum

---

## CONSTRAINTS

### DO NOT modify or remove:

- Existing authentication flow (login screen, JWT handling)
- Existing v1.1 screens for warga or KL (only Lurah screens change)
- Existing navigation graph (extend, don't replace)
- Existing networking infrastructure (Retrofit setup, interceptors)

### DO NOT:

- Skip phases — Phase 2 needs Phase 1, Phase 3 needs Phase 2, etc.
- Store private key anywhere outside Android Keystore
- Log signature bytes, private key references, or biometric data
- Log passphrases or auth tokens at INFO level (DEBUG with strict filter only)
- Hardcode API base URL — use BuildConfig
- Use deprecated APIs (`FingerprintManager` → use `BiometricPrompt` instead)
- Implement custom crypto — use Keystore + standard JCE APIs only

### DO:

- Commit after each acceptance criteria passes
- Run ktlint or detekt after each file change
- Write tests BEFORE integrating (TDD especially for crypto layer)
- Surface ambiguity to user — don't guess on UX decisions
- Use `FragmentActivity` or extend it for activities hosting biometric prompts
- Handle `KeyPermanentlyInvalidatedException` gracefully — never crash the app

---

## TECHNICAL ESCALATION TRIGGERS

Stop and ask user when:

1. **CSR generation fails with `UserNotAuthenticatedException`.** This means BouncyCastle's synchronous `csr.build()` is calling `Signature.sign()` outside biometric callback. Need to refactor — propose solution to user.

2. **`KeyPermanentlyInvalidatedException` on first usage.** Should not happen for freshly generated key. May indicate Keystore corruption or device security update mid-flow. Need user input.

3. **Biometric prompt does not appear** but `BiometricPrompt.authenticate()` returns immediately. May be device-specific issue or missing CryptoObject. Need device logs.

4. **Signature verification fails on server** for freshly signed data. Indicates mismatch in how mobile sends bytes vs how server verifies. Need to compare hex dump of bytesToSign on both sides.

5. **PDF preview crashes** with OutOfMemoryError for normal-size PDFs (>10MB). May need to render page-by-page with caching. Get user direction on UX.

6. **API contract drift**: server agent has changed a field name or response shape without notifying. Compare actual server response with documented contract. Surface immediately — don't try to adapt silently.

For each: pause, document the blocker, propose 2-3 options with trade-offs, wait for user direction.

---

## DELIVERABLES CHECKLIST

When all phases complete:

- [ ] Mobile app has working enrollment flow (one-time per device)
- [ ] Mobile app has working signing flow with biometric authentication
- [ ] All error states have appropriate user-facing messages in Indonesian
- [ ] Key never leaves Android Keystore (verified by code review)
- [ ] All 10 E2E scenarios pass in integration with backend
- [ ] App tested on at least 2 different Android versions
- [ ] v1.1 screens (warga, KL) untouched and still functional
- [ ] Production build (signed release APK) installable and functional

Begin with Phase 0. Confirm context-reading complete and existing project structure understood before proceeding to Phase 1.
use, document the blocker, propose 2-3 options with trade-offs, wait for user direction.

---

## DELIVERABLES CHECKLIST

When all phases complete:

- [ ] Mobile app has working enrollment flow (one-time per device)
- [ ] Mobile app has working signing flow with biometric authentication
- [ ] All error states have appropriate user-facing messages in Indonesian
- [ ] Key never leaves Android Keystore (verified by code review)
- [ ] All 10 E2E scenarios pass in integration with backend
- [ ] App tested on at least 2 different Android versions
- [ ] v1.1 screens (warga, KL) untouched and still functional
- [ ] Production build (signed release APK) installable and functional

Begin with Phase 0. Confirm context-reading complete and existing project structure understood before proceeding to Phase 1.
use, document the blocker, propose 2-3 options with trade-offs, wait for user direction.

---

## DELIVERABLES CHECKLIST

When all phases complete:

- [ ] Mobile app has working enrollment flow (one-time per device)
- [ ] Mobile app has working signing flow with biometric authentication
- [ ] All error states have appropriate user-facing messages in Indonesian
- [ ] Key never leaves Android Keystore (verified by code review)
- [ ] All 10 E2E scenarios pass in integration with backend
- [ ] App tested on at least 2 different Android versions
- [ ] v1.1 screens (warga, KL) untouched and still functional
- [ ] Production build (signed release APK) installable and functional

Begin with Phase 0. Confirm context-reading complete and existing project structure understood before proceeding to Phase 1.
