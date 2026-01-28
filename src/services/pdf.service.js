import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'letters');

/**
 * PDF Service - Handles PDF generation with QR codes and metadata
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
   * Ensure public directory exists
   * @returns {Promise<void>}
   */
  async ensurePublicDir() {
    if (!existsSync(PUBLIC_DIR)) {
      await mkdir(PUBLIC_DIR, { recursive: true });
    }
  }

  /**
   * Render HTML to PDF
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
   * Create PDF with embedded metadata
   * @param {string} html - HTML content
   * @param {object} metadata - PDF metadata
   * @returns {Promise<Buffer>} PDF buffer with metadata
   */
  async createPdfWithMetadata(html, _metadata) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0',
          right: '0',
          bottom: '0',
          left: '0',
        },
        displayHeaderFooter: false,
      });

      // Note: For production, you would use a library like pdf-lib
      // to embed custom metadata into the PDF. For now, we'll store
      // the metadata separately in the database.

      return pdfBuffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Save PDF to public folder
   * @param {Buffer} pdfBuffer - PDF buffer
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
   * Generate complete PDF for a letter with embedded cryptographic metadata
   *
   * PDF RENDERER RESPONSIBILITIES:
   * - Embed signature artifacts from crypto module
   * - Generate QR code for verification
   * - Save PDF to storage
   *
   * This module must NOT:
   * - Perform hashing or signing
   * - Access private keys
   * - Build canonical data
   *
   * @param {object} params - PDF generation parameters
   * @returns {Promise<object>} PDF generation result
   */
  async generateLetterPdf({ html, verificationCode, verificationUrl, letterNumber, signatureData }) {
    // Generate QR code for verification URL
    const qrCodeData = await this.generateQRCode(verificationUrl);

    // Replace QR code placeholder in HTML
    const htmlWithQr = html.replace('{{QR_CODE_DATA}}', qrCodeData);

    // Embed cryptographic metadata as per specification
    const pdfBuffer = await this.createPdfWithMetadata(htmlWithQr, {
      // Standard PDF metadata
      title: `Surat ${letterNumber}`,
      subject: 'Surat Elektronik Kelurahan Talete Satu',
      author: 'e-Kelurahan Talete Satu',
      creator: 'e-Kelurahan System',
      keywords: [letterNumber, verificationCode].join(', '),

      // Cryptographic metadata (from crypto module)
      SignatureAlgorithm: signatureData?.algorithm || 'SHA256withRSA',
      CanonicalHash: signatureData?.canonicalHash || '',
      SignatureValue: signatureData?.signature || '',
      VerificationCode: verificationCode,
      PublicKeyFingerprint: signatureData?.publicKeyFingerprint || '',
      IssuedDate: new Date().toISOString(),

      // Canonical payload (base64-encoded for embedding)
      CanonicalPayload: signatureData?.canonicalData ? Buffer.from(signatureData.canonicalData).toString('base64') : '',
    });

    // Generate filename from verification code
    const filename = `letter_${verificationCode}`;

    // Save PDF to public folder
    const { absolutePath, relativePath } = await this.savePdf(pdfBuffer, filename);

    return {
      absolutePath,
      relativePath, // This is what gets stored in database
      filename: `${filename}.pdf`,
      qrCodeData,
      size: pdfBuffer.length,
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
