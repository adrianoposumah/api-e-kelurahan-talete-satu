/**
 * Test script for v1.1 body hash implementation.
 *
 * Run with: node tests/body-hash-roundtrip.test.js
 *
 * This script verifies:
 *   1. Round-trip stability: re-saving a PDF does not change content hash
 *   2. Metadata embedding does not affect content hash
 *   3. Tampering with PDF text changes content hash
 */

import crypto from 'crypto';
import puppeteer from 'puppeteer';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Test Surat</title></head>
<body style="font-family: Arial, sans-serif; padding: 40px;">
  <h1>SURAT KETERANGAN DOMISILI</h1>
  <p>Nomor: 001/TEST/2026</p>
  <p>Yang bertanda tangan di bawah ini menerangkan bahwa:</p>
  <table>
    <tr><td>Nama</td><td>: Budi Santoso</td></tr>
    <tr><td>NIK</td><td>: 7173011501900001</td></tr>
    <tr><td>Tempat Lahir</td><td>: Tomohon</td></tr>
    <tr><td>Tanggal Lahir</td><td>: 15 Januari 1990</td></tr>
    <tr><td>Lingkungan</td><td>: III</td></tr>
  </table>
  <p>Demikian surat keterangan ini dibuat untuk dipergunakan sebagaimana mestinya.</p>
</body>
</html>
`;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalize(rawText) {
  return String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractText(pdfBuffer) {
  const parser = new PDFParse({ data: Buffer.from(pdfBuffer) });

  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

async function extractAndHash(pdfBuffer) {
  const rawText = await extractText(pdfBuffer);
  return sha256(normalize(rawText));
}

async function renderHtml(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await page.close();
    await browser.close();
  }
}

async function embedMetadata(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  pdfDoc.setTitle('Surat Test');
  pdfDoc.setAuthor('e-Kelurahan Talete Satu');

  const infoDict = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info);
  infoDict.set(PDFName.of('EKelurahan_VerificationCode'), PDFHexString.fromText('TEST-001'));
  infoDict.set(PDFName.of('EKelurahan_SignedAt'), PDFHexString.fromText(new Date('2026-05-11T00:00:00.000Z').toISOString()));

  return await pdfDoc.save();
}

async function main() {
  console.log('=== Body Hash Round-Trip Test ===\n');

  console.log('[1/4] Rendering test PDF via Puppeteer...');
  const rawPdf = await renderHtml(SAMPLE_HTML);
  const hash1 = await extractAndHash(rawPdf);
  console.log(`     Initial content hash: ${hash1}\n`);

  console.log('[2/4] Round-trip through pdf-lib without changes...');
  const doc1 = await PDFDocument.load(rawPdf);
  const resaved = await doc1.save();
  const hash2 = await extractAndHash(resaved);
  console.log(`     After resave hash:    ${hash2}`);
  const test1 = hash1 === hash2;
  console.log(`     ${test1 ? 'PASS' : 'FAIL'}: hashes match across pdf-lib resave\n`);

  console.log('[3/4] Embed signature metadata...');
  const withMeta = await embedMetadata(rawPdf);
  const hash3 = await extractAndHash(withMeta);
  console.log(`     After metadata hash:  ${hash3}`);
  const test2 = hash1 === hash3;
  console.log(`     ${test2 ? 'PASS' : 'FAIL'}: metadata embedding does not change content hash\n`);

  console.log('[4/4] Tamper with body text (replace "Budi" with "Andi")...');
  const tamperedHtml = SAMPLE_HTML.replace('Budi Santoso', 'Andi Saputra');
  const tamperedPdf = await renderHtml(tamperedHtml);
  const hash4 = await extractAndHash(tamperedPdf);
  console.log(`     Tampered content hash: ${hash4}`);
  const test3 = hash1 !== hash4;
  console.log(`     ${test3 ? 'PASS' : 'FAIL'}: tampering produces different hash\n`);

  console.log('=== Summary ===');
  console.log(`Round-trip stability:      ${test1 ? 'PASS' : 'FAIL'}`);
  console.log(`Metadata-invariant:        ${test2 ? 'PASS' : 'FAIL'}`);
  console.log(`Tamper detection:          ${test3 ? 'PASS' : 'FAIL'}`);

  if (test1 && test2 && test3) {
    console.log('\n✓ ALL TESTS PASS — body_hash architecture is reliable in your environment.');
    process.exit(0);
  }

  console.log('\nSOME TESTS FAILED — body_hash architecture is not reliable in this environment yet.');
  process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(2);
});
