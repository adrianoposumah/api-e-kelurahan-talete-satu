import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORAGE_DIR = join(__dirname, '..', '..', 'storage', 'letters');

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
   * Ensure storage directory exists
   * @returns {Promise<void>}
   */
  async ensureStorageDir() {
    if (!existsSync(STORAGE_DIR)) {
      await mkdir(STORAGE_DIR, { recursive: true });
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
   * Save PDF to storage
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} filename - Filename without extension
   * @returns {Promise<string>} File path
   */
  async savePdf(pdfBuffer, filename) {
    await this.ensureStorageDir();

    const filePath = join(STORAGE_DIR, `${filename}.pdf`);
    await writeFile(filePath, pdfBuffer);

    return filePath;
  }

  /**
   * Generate complete PDF for a letter
   * @param {object} params - PDF generation parameters
   * @returns {Promise<object>} PDF generation result
   */
  async generateLetterPdf({ html, verificationCode, verificationUrl, letterNumber, signatureData }) {
    // Generate QR code for verification URL
    const qrCodeData = await this.generateQRCode(verificationUrl);

    // Replace QR code placeholder in HTML
    const htmlWithQr = html.replace('{{QR_CODE_DATA}}', qrCodeData);

    // Generate PDF
    const pdfBuffer = await this.createPdfWithMetadata(htmlWithQr, {
      title: `Surat ${letterNumber}`,
      subject: 'Surat Elektronik Kelurahan Talete Satu',
      author: 'e-Kelurahan Talete Satu',
      creator: 'e-Kelurahan System',
      keywords: [letterNumber, verificationCode].join(', '),
      // Custom metadata for signature
      signatureAlgorithm: signatureData?.algorithm || 'SHA256WithRSA',
      signatureValue: signatureData?.signature || '',
      canonicalHash: signatureData?.canonicalHash || '',
    });

    // Generate filename from verification code
    const filename = `letter_${verificationCode}`;

    // Save PDF
    const filePath = await this.savePdf(pdfBuffer, filename);

    return {
      filePath,
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
    return join(STORAGE_DIR, `letter_${verificationCode}.pdf`);
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
