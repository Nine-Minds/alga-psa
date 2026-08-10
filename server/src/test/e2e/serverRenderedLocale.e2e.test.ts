import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ensureApiServerRunning,
  resolveApiBaseUrl,
  stopApiServerIfStarted,
} from './utils/apiServerManager';

/**
 * Translation must survive the trip through server rendering.
 *
 * This can only be asserted against a running server. `getServerLocale()`
 * reaches the locale hierarchy through a resolver registered by the host app,
 * and Next compiles that module into several webpack layers — a module-level
 * singleton set in one is invisible to the others. Vitest has a single module
 * registry, so a unit test would always see the resolver registered and pass
 * while every rendered page fell back to the browser's Accept-Language. That is
 * exactly what shipped: 205 route titles asserted green by a source-grep test
 * while rendering English in every locale.
 *
 * The sign-in page is used because it is public — no session, no fixtures — and
 * it takes its title from the same `metadata` namespace as every other route.
 */

const apiBaseUrl = resolveApiBaseUrl(process.env.TEST_API_BASE_URL);
const ROUTE = '/auth/msp/signin';
const TITLE_KEY = 'auth.msp.signin.title';

const repoRoot = path.resolve(process.cwd(), '..');

function expectedTitle(locale: string): string {
  const pack = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'server/public/locales', locale, 'metadata.json'), 'utf8'),
  );
  const value = TITLE_KEY.split('.').reduce<any>((node, segment) => node?.[segment], pack);

  // Read from the pack rather than hardcoding copy, so retranslating a title
  // does not break this test — it asserts the pipeline, not the wording.
  expect(typeof value, `${locale}/metadata.json is missing ${TITLE_KEY}`).toBe('string');
  return value as string;
}

async function render(headers: Record<string, string>): Promise<string> {
  const response = await fetch(`${apiBaseUrl}${ROUTE}`, { headers, redirect: 'manual' });
  expect(response.status).toBe(200);
  return response.text();
}

const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
const htmlLangOf = (html: string) => /<html[^>]*\slang="([^"]*)"/.exec(html)?.[1] ?? null;

describe('server-rendered locale', () => {
  beforeAll(async () => {
    await ensureApiServerRunning(apiBaseUrl);
  }, 180_000);

  afterAll(async () => {
    await stopApiServerIfStarted();
  });

  it.each(['de', 'fr'])(
    'renders the %s title and lang attribute for a browser asking for it',
    async (locale) => {
      const html = await render({ 'accept-language': `${locale};q=0.9` });

      expect(htmlLangOf(html)).toBe(locale);
      expect(titleOf(html)).toContain(expectedTitle(locale));
    },
  );

  it('does not fall back to the English default when another locale is requested', async () => {
    const [german, english] = await Promise.all([
      render({ 'accept-language': 'de;q=0.9' }),
      render({ 'accept-language': 'en-US,en;q=0.9' }),
    ]);

    expect(titleOf(english)).toContain(expectedTitle('en'));
    expect(titleOf(german)).not.toBe(titleOf(english));
  });

  it('lets an explicitly chosen locale cookie outrank the browser header', async () => {
    const html = await render({ 'accept-language': 'en-US,en;q=0.9', cookie: 'locale=pl' });

    expect(htmlLangOf(html)).toBe('pl');
    expect(titleOf(html)).toContain(expectedTitle('pl'));
  });

  it('never lets the response plant a locale cookie', async () => {
    // Middleware sees only Accept-Language; persisting that guess would outrank
    // the stored preference on every later request. Covered as a unit test too,
    // asserted here because it is the response header that actually reaches the
    // browser.
    const response = await fetch(`${apiBaseUrl}${ROUTE}`, {
      headers: { 'accept-language': 'de;q=0.9' },
      redirect: 'manual',
    });

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toMatch(/(?:^|,\s*)locale=/);
  });
});
