import crypto from 'crypto';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import jsQR from 'jsqr';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'letters');
const DEFAULT_LOGO_PATH = join(__dirname, '..', '..', 'public', 'logo', 'logo-kotatomohon.png');
const PADES_PLACEHOLDER_BYTES = 8192;

/**
 * PDF Service - Handles PDF generation with QR codes and PAdES placeholders.
 *
 * RESPONSIBILITIES:
 * - Render HTML → PDF via Puppeteer
 * - Generate QR codes for verification URLs
 * - Insert PAdES /ByteRange + /Contents placeholders
 * - Compute /ByteRange hashes and embed PKCS#7 CMS signatures
 * - Save signed PDFs to disk
 *
 * This module must NOT:
 * - Perform cryptographic signing
 * - Access private keys
 * - Build CMS/PKCS#7 data
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
   * Rasterize each page of a PDF and attempt to decode an embedded QR code.
   * Returns the decoded payload (typically a verification URL) or null when
   * no QR can be read. Used as the primary fallback channel for hybrid
   * verification when the PKCS#7 signature is missing or malformed.
   *
   * @param {Buffer|Uint8Array} pdfBuffer - PDF bytes
   * @param {object} [options]
   * @param {number} [options.scale=2] - Render scale; higher = more reliable decode but slower
   * @param {number} [options.maxPages=3] - Hard cap on pages scanned
   * @returns {Promise<string|null>} Decoded QR payload, or null
   */
  async extractQRCodeFromPdf(pdfBuffer, { scale = 2, maxPages = 3 } = {}) {
    try {
      const { pdf } = await import('pdf-to-img');
      const document = await pdf(Buffer.from(pdfBuffer), { scale });

      let pagesScanned = 0;
      for await (const pageImage of document) {
        if (pagesScanned >= maxPages) break;
        pagesScanned += 1;

        const { data, info } = await sharp(pageImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
        if (decoded?.data) {
          return decoded.data;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Add a PAdES signature dictionary and fixed-size /Contents placeholder.
   * The ByteRange placeholder is immediately resolved so callers can hash the
   * exact bytes that mobile must sign.
   *
   * Uses @signpdf/placeholder-pdf-lib (parse-and-serialize via pdf-lib) instead
   * of placeholder-plain. The plain helper is documented as "very fragile" and
   * "supports only PDF versions <=1.3" — Skia/headless Chrome emits 1.4, and
   * the resulting incremental-update PDFs are silently rejected by Adobe
   * Acrobat. The pdf-lib backend produces a cleanly re-serialized single-rev
   * PDF that Acrobat accepts.
   *
   * @param {Buffer|Uint8Array} pdfBuffer
   * @returns {Promise<Buffer>}
   */
  async addByteRangePlaceholder(pdfBuffer) {
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBuffer), { updateMetadata: false });

    pdflibAddPlaceholder({
      pdfDoc,
      reason: 'Persetujuan Surat Elektronik Kelurahan Talete Satu',
      contactInfo: 'Kelurahan Talete Satu',
      name: 'Lurah Talete Satu',
      location: 'Tomohon, Sulawesi Utara',
      signatureLength: PADES_PLACEHOLDER_BYTES,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      widgetRect: [50, 50, 51, 51],
      appName: 'e-Kelurahan Talete Satu',
    });

    this.ensureTrailerId(pdfDoc);

    const savedBytes = await pdfDoc.save({ useObjectStreams: false });
    const withPlaceholder = Buffer.from(savedBytes);
    const contents = this.findContentsHexRange(withPlaceholder);
    const contentsStart = contents.contentsHexOffset - 1;
    const contentsEnd = contents.contentsHexOffset + contents.contentsHexLength + 1;
    const byteRange = [0, contentsStart, contentsEnd, withPlaceholder.length - contentsEnd];
    const placeholderRegex = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/;
    const match = placeholderRegex.exec(withPlaceholder.toString('latin1'));
    if (!match) {
      throw new Error('PAdES ByteRange placeholder tidak ditemukan');
    }

    const replacement = `/ByteRange [${byteRange.join(' ')}]`;
    if (replacement.length > match[0].length) {
      throw new Error('ByteRange replacement lebih panjang dari placeholder');
    }

    const output = Buffer.from(withPlaceholder);
    output.write(replacement.padEnd(match[0].length, ' '), match.index, 'latin1');
    return output;
  }

  /**
   * Ensure the document trailer has an /ID entry. PDF 1.4+ requires /ID for
   * signed documents (PDF 32000-1 7.5.5). Adobe Acrobat is known to ignore or
   * mishandle the signature panel for trailers missing /ID. pdf-lib does not
   * auto-populate this, so we set both array entries to the same fresh random
   * hex string before save().
   *
   * @param {import('pdf-lib').PDFDocument} pdfDoc
   */
  ensureTrailerId(pdfDoc) {
    if (pdfDoc.context.trailerInfo?.ID) return;
    const id = PDFHexString.of(crypto.randomBytes(16).toString('hex'));
    pdfDoc.context.trailerInfo = {
      ...pdfDoc.context.trailerInfo,
      ID: pdfDoc.context.obj([id, id]),
    };
  }

  /**
   * Bump the PDF version header from %PDF-1.X to %PDF-1.7 in place.
   * PAdES Baseline B-B (SubFilter ETSI.CAdES.detached) is defined under
   * PDF 1.7 / ISO 32000-1. Skia/headless Chrome emits %PDF-1.4, so Adobe
   * Acrobat may treat the signature as belonging to an unknown subfilter
   * and silently hide the signature panel. The header is exactly 8 bytes
   * ('%PDF-X.Y') so we can patch in place without shifting any offsets.
   *
   * @param {Buffer} pdfBuffer
   * @returns {Buffer}
   */
  bumpPdfVersionForPades(pdfBuffer) {
    const buf = Buffer.from(pdfBuffer);
    const head = buf.subarray(0, 8).toString('latin1');
    if (!/^%PDF-\d\.\d$/.test(head)) return buf;
    if (head === '%PDF-1.7') return buf;
    buf.write('%PDF-1.7', 0, 'latin1');
    return buf;
  }

  /**
   * Patch off-by-one in startxref produced by @signpdf/placeholder-plain v3.3.x.
   * The library appends a stray '\n' between the last endobj and the xref keyword
   * but writes startxref = pdfLengthBeforeTrailer, so the value points to that
   * '\n' instead of 'x'. Acrobat (strict) treats the incremental update as
   * unreadable and silently falls back to the unsigned base PDF, hiding the
   * signature panel. pdf.js and most online tools are more lenient.
   * Issue tracked at https://github.com/vbuch/node-signpdf/issues
   *
   * Strategy: locate the actual byte offset of the final 'xref' keyword and
   * rewrite the startxref value to match. Length-preserving when possible.
   *
   * @param {Buffer} pdfBuffer
   * @returns {Buffer}
   */
  fixSignpdfStartxrefOffByOne(pdfBuffer) {
    const buf = Buffer.from(pdfBuffer);
    const text = buf.toString('latin1');
    const tailMatch = text.match(/startxref\s*\n(\d+)\s*\n%%EOF\s*$/);
    if (!tailMatch) return buf;

    let actualXrefPos = -1;
    let cursor = text.lastIndexOf('xref');
    while (cursor !== -1) {
      const isStartxref = cursor >= 5 && text.slice(cursor - 5, cursor) === 'start';
      if (!isStartxref) {
        actualXrefPos = cursor;
        break;
      }
      cursor = text.lastIndexOf('xref', cursor - 1);
    }

    const declared = parseInt(tailMatch[1], 10);
    if (actualXrefPos === -1 || actualXrefPos === declared) return buf;

    const newValue = String(actualXrefPos);
    const valueStart = tailMatch.index + tailMatch[0].indexOf(tailMatch[1]);

    if (newValue.length === tailMatch[1].length) {
      buf.write(newValue, valueStart, 'latin1');
      return buf;
    }

    const head = buf.subarray(0, tailMatch.index);
    const newTail = Buffer.from(`startxref\n${newValue}\n%%EOF\n`, 'latin1');
    return Buffer.concat([head, newTail]);
  }

  findContentsHexRange(pdfBuffer) {
    const pdfText = Buffer.from(pdfBuffer).toString('latin1');
    const byteRangeIndex = pdfText.indexOf('/ByteRange');
    const contentsIndex = byteRangeIndex === -1 ? pdfText.lastIndexOf('/Contents') : pdfText.indexOf('/Contents', byteRangeIndex);
    if (contentsIndex === -1) {
      throw new Error('/Contents signature placeholder tidak ditemukan');
    }

    const lt = pdfText.indexOf('<', contentsIndex);
    const gt = pdfText.indexOf('>', lt);
    if (lt === -1 || gt === -1 || gt <= lt) {
      throw new Error('/Contents signature placeholder malformed');
    }

    return {
      contentsHexOffset: lt + 1,
      contentsHexLength: gt - lt - 1,
      contentsHex: pdfText.slice(lt + 1, gt),
    };
  }

  /**
   * Extract PAdES ByteRange and /Contents positions from a PDF.
   * @param {Buffer|Uint8Array} pdfBuffer
   * @returns {{byteRange: number[], contentsHexOffset: number, contentsHexLength: number, contentsHex: string}}
   */
  extractByteRange(pdfBuffer) {
    const buffer = Buffer.from(pdfBuffer);
    const pdfText = buffer.toString('latin1');
    const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(pdfText);
    if (!match) {
      throw new Error('/ByteRange tidak ditemukan atau belum terselesaikan');
    }

    const contents = this.findContentsHexRange(buffer);
    return {
      byteRange: match.slice(1).map(Number),
      ...contents,
    };
  }

  computeByteRangeHash(pdfBuffer, byteRange) {
    const buffer = Buffer.from(pdfBuffer);
    if (!Array.isArray(byteRange) || byteRange.length !== 4) {
      throw new Error('byteRange harus array 4 angka');
    }

    const [start1, len1, start2, len2] = byteRange;
    return crypto
      .createHash('sha256')
      .update(buffer.subarray(start1, start1 + len1))
      .update(buffer.subarray(start2, start2 + len2))
      .digest();
  }

  embedPkcs7Hex(pdfBuffer, pkcs7Hex, contentsHexOffset, contentsHexLength) {
    const cleanHex = String(pkcs7Hex || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (cleanHex.length > contentsHexLength) {
      throw new Error(`PKCS#7 signature (${cleanHex.length} hex chars) melebihi placeholder (${contentsHexLength})`);
    }
    if (cleanHex.length % 2 !== 0) {
      throw new Error('PKCS#7 hex length harus genap');
    }

    const output = Buffer.from(pdfBuffer);
    output.write(cleanHex.padEnd(contentsHexLength, '0'), contentsHexOffset, contentsHexLength, 'latin1');
    return output;
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
   * Render HTML to a raw PDF after injecting QR code and logo assets.
   * @param {object} params - Render parameters
   * @param {string} params.html - HTML template content
   * @param {string} params.verificationUrl - URL encoded into QR code
   * @returns {Promise<{ pdfBuffer: Buffer, qrCodeData: string }>} Raw PDF and QR data URL
   */
  async renderHtmlToPdf({ html, verificationUrl }) {
    const [qrCodeData, logoDataUrl] = await Promise.all([this.generateQRCode(verificationUrl), this.getDefaultLogoDataUrl()]);

    const htmlWithAssets = html.replaceAll('{{QR_CODE_DATA}}', qrCodeData).replaceAll('{{LOGO_URL}}', logoDataUrl).replaceAll('../../../public/logo/logo-kotatomohon.png', logoDataUrl);
    const pdfBuffer = await this.renderToPdf(htmlWithAssets);

    return { pdfBuffer, qrCodeData };
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
