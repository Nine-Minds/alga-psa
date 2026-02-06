import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('/msp/email-logs route', () => {
  it('has a page.tsx entrypoint', async () => {
    const filePath = path.resolve(process.cwd(), 'src/app/msp/email-logs/page.tsx');
    const contents = await fs.readFile(filePath, 'utf8');

    expect(contents).toContain('export default');
    expect(contents).toContain('Email Logs');
  });
});
