import puppeteer from 'puppeteer';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import QRCode from 'qrcode';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'letters');
const DEFAULT_LOGO_PATH = join(__dirname, '..', '..', 'public', 'logo', 'logo-kotatomohon.png');

/**
 * PDF Service - Handles PDF generation with QR codes and XMP metadata embedding
 *
 * RESPONSIBILITIES:
 * - Render HTML → PDF via Puppeteer
 * - Generate QR codes for verification URLs
 * - Embed cryptographic signature metadata into PDF XMP
 * - Save signed PDFs to disk
 *
 * This module must NOT:
 * - Perform hashing or signing
 * - Access private keys
 * - Build canonical data
 */
class PdfService {
  constructor() {
    this.browser = null;
  }

  /**
   * Get or create browser instance
   * @returns {Promise<Browser>} Puppeteer browser
   */
  async getBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browser;
  }

  /**
   * Generate QR code as data URL
   * @param {string} data - Data to encode
   * @param {object} options - QR code options
   * @returns {Promise<string>} Data URL
   */
  async generateQRCode(data, options = {}) {
    const qrOptions = {
      type: 'image/png',
      width: options.width || 200,
      margin: options.margin || 2,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#ffffff',
      },
    };

    return QRCode.toDataURL(data, qrOptions);
  }

  /**
   * Load default logo and return as data URL for deterministic PDF rendering.
   * @returns {Promise<string>} Data URL or empty string if logo file is unavailable
   */
  async getDefaultLogoDataUrl() {
    try {
      const logoBuffer = await readFile(DEFAULT_LOGO_PATH);
      return `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  /**
   * Ensure public directory exists
   * @returns {Promise<void>}
   */
  async ensurePublicDir() {
    if (!existsSync(PUBLIC_DIR)) {
      await mkdir(PUBLIC_DIR, { recursive: true });
    }
  }

  /**
   * Render HTML to PDF buffer via Puppeteer
   * @param {string} html - HTML content
   * @param {object} options - PDF options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async renderToPdf(html, options = {}) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: options.marginTop || '0',
          right: options.marginRight || '0',
          bottom: options.marginBottom || '0',
          left: options.marginLeft || '0',
        },
        displayHeaderFooter: false,
      });

      return pdfBuffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Embed cryptographic signature metadata into PDF using pdf-lib.
   * Uses standard PDF Info Dictionary fields + custom named entries for crypto fields.
   *
   * @param {Buffer} pdfBuffer - Raw PDF buffer from Puppeteer
   * @param {object} metadata - Signature metadata to embed
   * @param {string} metadata.signatureAlgorithm - e.g. 'SHA256withRSA'
   * @param {string} metadata.canonicalHash - SHA-256 hex hash of canonical data
   * @param {string} metadata.signatureValue - Base64-encoded RSA signature
   * @param {string} metadata.signatureKeyId - ID of key used to sign
   * @param {string} metadata.verificationCode - Letter verification code
   * @param {string} metadata.publicKeyFingerprint - Colon-separated hex fingerprint
   * @param {string} metadata.canonicalPayload - Base64-encoded canonical JSON
   * @param {string} metadata.letterNumber - Letter number for title
   * @returns {Promise<Uint8Array>} Modified PDF bytes with embedded metadata
   */
  async embedSignatureMetadata(pdfBuffer, metadata) {
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Set standard PDF metadata
    pdfDoc.setTitle(metadata.letterNumber ? `Surat ${metadata.letterNumber}` : 'Surat Elektronik');
    pdfDoc.setSubject('Surat Elektronik Kelurahan Talete Satu');
    pdfDoc.setAuthor('e-Kelurahan Talete Satu');
    pdfDoc.setCreator('e-Kelurahan Digital Signature System');
    pdfDoc.setProducer('e-Kelurahan Talete Satu');
    pdfDoc.setKeywords([metadata.letterNumber || '', metadata.verificationCode || ''].filter(Boolean));

    // Embed cryptographic fields as custom entries in the PDF Info Dictionary
    // pdf-lib uses PDFName for keys and PDFHexString for Unicode-safe string values
    const infoDict = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info);

    const cryptoFields = {
      EKelurahan_SignatureAlgorithm: metadata.signatureAlgorithm || '',
      EKelurahan_CanonicalHash: metadata.canonicalHash || '',
      EKelurahan_SignatureValue: metadata.signatureValue || '',
      EKelurahan_SignatureKeyId: metadata.signatureKeyId || '',
      EKelurahan_VerificationCode: metadata.verificationCode || '',
      EKelurahan_LetterNumber: metadata.letterNumber || '',
      EKelurahan_PublicKeyFingerprint: metadata.publicKeyFingerprint || '',
      EKelurahan_IssuedDate: metadata.issuedDate || new Date().toISOString(),
      EKelurahan_CanonicalPayload: metadata.canonicalPayload || '',
    };

    for (const [key, value] of Object.entries(cryptoFields)) {
      infoDict.set(PDFName.of(key), PDFHexString.fromText(value));
    }

    return await pdfDoc.save();
  }

  /**
   * Parse embedded signature metadata from a PDF buffer.
   * Reads the custom EKelurahan_* entries from the PDF Info Dictionary.
   *
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<object|null>} Parsed metadata or null if not found
   */
  async readSignatureMetadata(pdfBuffer) {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const infoDict = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info);

      if (!infoDict) return null;

      const readField = (name) => {
        const value = infoDict.lookup(PDFName.of(name));
        if (!value) return null;
        // PDFHexString and PDFString both have decodeText()
        return value.decodeText ? value.decodeText() : value.toString();
      };

      const verificationCode = readField('EKelurahan_VerificationCode');
      if (!verificationCode) return null; // No embedded crypto metadata

      return {
        signatureAlgorithm: readField('EKelurahan_SignatureAlgorithm'),
        canonicalHash: readField('EKelurahan_CanonicalHash'),
        signatureValue: readField('EKelurahan_SignatureValue'),
        signatureKeyId: readField('EKelurahan_SignatureKeyId'),
        verificationCode,
        letterNumber: readField('EKelurahan_LetterNumber'),
        publicKeyFingerprint: readField('EKelurahan_PublicKeyFingerprint'),
        issuedDate: readField('EKelurahan_IssuedDate'),
        canonicalPayload: readField('EKelurahan_CanonicalPayload'),
      };
    } catch {
      return null;
    }
  }

  /**
   * Save PDF to public folder
   * @param {Buffer|Uint8Array} pdfBuffer - PDF buffer
   * @param {string} filename - Filename without extension
   * @returns {Promise<object>} File paths (absolute and relative)
   */
  async savePdf(pdfBuffer, filename) {
    await this.ensurePublicDir();

    const absolutePath = join(PUBLIC_DIR, `${filename}.pdf`);
    await writeFile(absolutePath, pdfBuffer);

    // Return relative path for database storage (for public access)
    const relativePath = `/public/letters/${filename}.pdf`;

    return {
      absolutePath,
      relativePath,
    };
  }

  /**
   * Generate complete signed PDF for a letter.
   *
   * Pipeline:
   * 1. Generate QR code data URL
   * 2. Inject QR into HTML template
   * 3. Render HTML → PDF via Puppeteer
   * 4. Embed cryptographic signature metadata via pdf-lib
   * 5. Save signed PDF to disk
   *
   * @param {object} params - PDF generation parameters
   * @returns {Promise<object>} PDF generation result
   */
  async generateLetterPdf({ html, verificationCode, verificationUrl, letterNumber, issuedDate, signatureData }) {
    // Phase 2: Generate QR code and resolve logo as embedded data URLs.
    const [qrCodeData, logoDataUrl] = await Promise.all([this.generateQRCode(verificationUrl), this.getDefaultLogoDataUrl()]);

    // Inject image sources directly into the HTML to avoid path/network loading issues.
    const htmlWithAssets = html.replaceAll('{{QR_CODE_DATA}}', qrCodeData).replaceAll('{{LOGO_URL}}', logoDataUrl).replaceAll('../../../public/logo/logo-kotatomohon.png', logoDataUrl);

    // Phase 3: Render HTML → PDF bytes
    const rawPdfBuffer = await this.renderToPdf(htmlWithAssets);

    // Phase 5: Embed cryptographic signature into PDF XMP metadata
    const signedPdfBytes = await this.embedSignatureMetadata(rawPdfBuffer, {
      signatureAlgorithm: signatureData?.algorithm || 'SHA256withRSA',
      canonicalHash: signatureData?.canonicalHash || '',
      signatureValue: signatureData?.signature || '',
      signatureKeyId: signatureData?.signatureKeyId || '',
      verificationCode,
      publicKeyFingerprint: signatureData?.publicKeyFingerprint || '',
      issuedDate: issuedDate || new Date().toISOString(),
      canonicalPayload: signatureData?.canonicalData ? Buffer.from(signatureData.canonicalData).toString('base64') : '',
      letterNumber,
    });

    // Phase 6: Save signed PDF to disk
    const filename = `letter_${verificationCode}`;
    const { absolutePath, relativePath } = await this.savePdf(signedPdfBytes, filename);

    return {
      absolutePath,
      relativePath, // This is what gets stored in database
      filename: `${filename}.pdf`,
      qrCodeData,
      size: signedPdfBytes.length,
    };
  }

  /**
   * Get PDF file path
   * @param {string} verificationCode - Verification code
   * @returns {string} File path
   */
  getPdfPath(verificationCode) {
    return join(PUBLIC_DIR, `letter_${verificationCode}.pdf`);
  }

  /**
   * Close browser instance
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export default new PdfService();
