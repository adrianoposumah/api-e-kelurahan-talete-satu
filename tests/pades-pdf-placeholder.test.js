import pdfService from '../src/services/pdf.service.js';

const sampleHtml = `
<!doctype html>
<html>
  <body style="font-family: Arial; padding: 40px">
    <h1>Surat Test PAdES</h1>
    <p>Nomor: ABCD1234-001/2009/SKD/V/2026</p>
    <p>Isi surat untuk pengujian ByteRange.</p>
  </body>
</html>
`;

try {
  const rawPdf = await pdfService.renderToPdf(sampleHtml);
  const withPlaceholder = await pdfService.addByteRangePlaceholder(rawPdf);
  const extracted = pdfService.extractByteRange(withPlaceholder);
  const hash1 = pdfService.computeByteRangeHash(withPlaceholder, extracted.byteRange);

  const outsideMutation = Buffer.from(withPlaceholder);
  outsideMutation[20] = outsideMutation[20] === 65 ? 66 : 65;
  const hash2 = pdfService.computeByteRangeHash(outsideMutation, extracted.byteRange);
  if (hash1.equals(hash2)) {
    throw new Error('Mutating bytes outside /Contents did not change ByteRange hash');
  }

  const insideMutation = Buffer.from(withPlaceholder);
  insideMutation[extracted.contentsHexOffset + 10] = insideMutation[extracted.contentsHexOffset + 10] === 48 ? 49 : 48;
  const hash3 = pdfService.computeByteRangeHash(insideMutation, extracted.byteRange);
  if (!hash1.equals(hash3)) {
    throw new Error('Mutating bytes inside /Contents changed ByteRange hash');
  }

  const embedded = pdfService.embedPkcs7Hex(withPlaceholder, 'aabbcc', extracted.contentsHexOffset, extracted.contentsHexLength);
  const embeddedContents = pdfService.extractByteRange(embedded).contentsHex;
  if (!embeddedContents.startsWith('aabbcc')) {
    throw new Error('PKCS#7 hex was not embedded into /Contents');
  }

  console.log('PDF PAdES placeholder test passed');
} finally {
  await pdfService.closeBrowser();
}
