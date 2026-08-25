import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uploadRoute = readFileSync(resolve(__dirname, '../../../app/api/migrations/upload/route.ts'), 'utf8');
const spreadsheetRoute = readFileSync(resolve(__dirname, '../../../app/api/migrations/spreadsheet/route.ts'), 'utf8');

describe('AMP upload route size contract', () => {
  it.each([
    ['package upload', uploadRoute],
    ['spreadsheet upload', spreadsheetRoute],
  ])('%s uses the explicit browser-safe declared-size header', (_name, route) => {
    expect(route).toContain("request.headers.get('x-amp-file-size')");
    expect(route).toContain("!/^\\d+$/.test(declaredSizeHeader)");
    expect(route).toContain('declaredSize <= 0');
    expect(route).toContain('AMP_MAX_PACKAGE_BYTES');
    expect(route).not.toContain("request.headers.get('content-length')");
  });

  it('keeps byte metering and exact-size verification for package uploads', () => {
    expect(uploadRoute).toContain('bytes > AMP_MAX_PACKAGE_BYTES');
    expect(uploadRoute).toContain('bytes !== declaredSize');
  });

  it('keeps byte metering and exact-size verification for spreadsheet uploads', () => {
    expect(spreadsheetRoute).toContain('bytes > AMP_MAX_PACKAGE_BYTES');
    expect(spreadsheetRoute).toContain('bytes !== declaredSize');
  });
});
