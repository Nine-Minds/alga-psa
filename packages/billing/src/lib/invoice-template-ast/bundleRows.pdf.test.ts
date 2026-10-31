/**
 * T013: a long invoice with bundle child rows, printed by real headless Chrome
 * (the same engine `pdfGenerationService` drives), keeps the column header on
 * every page and never strands a bundle row at the foot of a page away from
 * its first component row.
 *
 * Opt-in: needs a local Chrome. Run with `RUN_PDF_TESTS=1` (and optionally
 * `CHROME_PATH`).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateTemplateAst } from './evaluator';
import { renderTemplateAstHtmlDocument } from './server-render';
import { getStandardTemplateAstByCode } from './standardTemplates';

const chromePath = process.env.CHROME_PATH
  ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => fs.existsSync(candidate));
const enabled = process.env.RUN_PDF_TESTS === '1' && Boolean(chromePath);

const bundle = (n: number) => ({
  id: `bundle-${n}`,
  description: `Managed bundle ${n}`,
  subtitle: `Bundle ${n} subtitle`,
  quantity: 1, unitPrice: 100000, total: 100000, hasComponents: true,
  components: [1, 2, 3, 4].map((c) => ({ name: `B${n} service ${c}`, quantity: 10 * c, quantityChange: c % 2 ? c : -c, pricingBasis: 'unit' })),
});

describe.skipIf(!enabled)('bundle child rows across PDF page breaks (T013)', () => {
  it('repeats headers and keeps each bundle row with its first component row', async () => {
    const ast = getStandardTemplateAstByCode('standard-bundle-quantities')!;
    const items = Array.from({ length: 24 }, (_, i) => bundle(i + 1));
    const model = {
      invoiceNumber: 'INV-PDF', issueDate: '2026-10-01', dueDate: '2026-10-31',
      customer: { name: 'Acme', address: '1 Main' }, currencyCode: 'USD',
      subtotal: 2400000, tax: 0, total: 2400000, items,
    };
    const html = await renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, model as unknown as Record<string, unknown>), { locale: 'en-US' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-pdf-'));
    const htmlPath = path.join(dir, 'invoice.html');
    const pdfPath = path.join(dir, 'invoice.pdf');
    fs.writeFileSync(htmlPath, html);
    try {
      execFileSync(chromePath!, ['--headless=new', '--no-sandbox', '--disable-gpu', `--print-to-pdf=${pdfPath}`, '--no-pdf-header-footer', `file://${htmlPath}`], { stdio: 'ignore', timeout: 60_000 });
      const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
      const pages = text.split('\f').filter((page) => page.trim().length > 0);
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages) expect(page).toMatch(/Description/);
      pages.forEach((page, index) => {
        const lines = page.split('\n').map((line) => line.trim()).filter(Boolean);
        const last = lines.filter((line) => /Managed bundle \d+|service \d/.test(line)).pop() ?? '';
        // The last body line on a page is never a bundle parent row stranded from its components.
        expect(last, `page ${index + 1} ends on a stranded bundle row`).not.toMatch(/^Managed bundle \d+\s/);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
