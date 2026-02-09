import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ticket origin locale keys', () => {
  it('T050: English common locale includes ticket origin label keys', () => {
    const localePath = path.resolve(
      __dirname,
      '../../../../../server/public/locales/en/common.json'
    );
    const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));

    expect(locale?.tickets?.origin?.internal).toBe('Created Internally');
    expect(locale?.tickets?.origin?.clientPortal).toBe(
      'Created via Client Portal'
    );
    expect(locale?.tickets?.origin?.inboundEmail).toBe(
      'Created via Inbound Email'
    );
  });

  it('T051: English clientPortal locale includes ticket origin label keys', () => {
    const localePath = path.resolve(
      __dirname,
      '../../../../../server/public/locales/en/clientPortal.json'
    );
    const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));

    expect(locale?.tickets?.origin?.internal).toBe('Created Internally');
    expect(locale?.tickets?.origin?.clientPortal).toBe(
      'Created via Client Portal'
    );
    expect(locale?.tickets?.origin?.inboundEmail).toBe(
      'Created via Inbound Email'
    );
  });
});
