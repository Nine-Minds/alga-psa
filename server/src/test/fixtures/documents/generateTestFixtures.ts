/**
 * Generate test fixtures for document testing
 *
 * This script generates sample PDF and image files for testing
 * Run with: npx ts-node server/src/test/fixtures/documents/generateTestFixtures.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const FIXTURES_DIR = __dirname;

async function generateSamplePDF() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 24;

  page.drawText('Sample PDF Document', {
    x: 50,
    y: 800,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  page.drawText('This is a test document for the document system.', {
    x: 50,
    y: 750,
    size: 12,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText('Test Date: ' + new Date().toISOString(), {
    x: 50,
    y: 720,
    size: 10,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  writeFileSync(join(FIXTURES_DIR, 'sample.pdf'), pdfBytes);
  console.log('Generated sample.pdf');
}

async function generateSamplePNG() {
  const image = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
  .composite([
    {
      input: Buffer.from(
        `<svg width="800" height="600">
          <rect x="0" y="0" width="800" height="600" fill="#f0f0f0"/>
          <text x="400" y="300" text-anchor="middle" font-size="48" fill="#333">
            Sample PNG Image
          </text>
          <text x="400" y="350" text-anchor="middle" font-size="24" fill="#666">
            Test Fixture for Document System
          </text>
        </svg>`
      ),
      top: 0,
      left: 0,
    }
  ])
  .png()
  .toBuffer();

  writeFileSync(join(FIXTURES_DIR, 'sample.png'), image);
  console.log('Generated sample.png');
}

async function generateSampleJPG() {
  const image = await sharp({
    create: {
      width: 1024,
      height: 768,
      channels: 3,
      background: { r: 240, g: 240, b: 240 }
    }
  })
  .composite([
    {
      input: Buffer.from(
        `<svg width="1024" height="768">
          <rect x="0" y="0" width="1024" height="768" fill="#e8f4f8"/>
          <circle cx="512" cy="384" r="200" fill="#4a90e2" opacity="0.3"/>
          <text x="512" y="384" text-anchor="middle" font-size="56" fill="#2c5aa0" font-weight="bold">
            Sample JPEG
          </text>
          <text x="512" y="450" text-anchor="middle" font-size="28" fill="#5a7a9a">
            Document System Test Image
          </text>
        </svg>`
      ),
      top: 0,
      left: 0,
    }
  ])
  .jpeg({ quality: 90 })
  .toBuffer();

  writeFileSync(join(FIXTURES_DIR, 'sample.jpg'), image);
  console.log('Generated sample.jpg');
}

async function generateInvalidFile() {
  // Create a fake executable file for negative testing
  const content = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF\x00\x00'); // PE header
  writeFileSync(join(FIXTURES_DIR, 'invalid-type.exe'), content);
  console.log('Generated invalid-type.exe');
}

async function main() {
  console.log('Generating test fixtures...\n');

  try {
    await generateSamplePDF();
    await generateSamplePNG();
    await generateSampleJPG();
    await generateInvalidFile();

    console.log('\n✅ All test fixtures generated successfully!');
  } catch (error) {
    console.error('Error generating fixtures:', error);
    process.exit(1);
  }
}

main();
