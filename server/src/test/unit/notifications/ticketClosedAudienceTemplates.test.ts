import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

interface AudienceTranslation {
  language: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}

interface AudienceTemplate {
  templateName: string;
  translations: AudienceTranslation[];
}

const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'sv'];

const localeRoot = path.resolve(__dirname, '../../../../public/locales');

function readLocaleCopy(language: string): Record<string, string> {
  const file = path.join(localeRoot, language, 'email.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { ticketClosed?: Record<string, string> };
  return parsed.ticketClosed ?? {};
}

const clientModule = require('../../../../migrations/utils/templates/_shared/ticketClosedAudience.cjs') as {
  getClientTemplate: () => AudienceTemplate;
  getInternalTemplate: () => AudienceTemplate;
};

// The migration/seed builders embed their translated copy instead of reading
// server/public/locales at migration time, because the setup image ships
// server/migrations without server/public. These tests keep the embedded copy
// pinned to the shipped locale files.
describe('ticketClosedAudience embedded copy', () => {
  const templates = [
    { label: 'client', getTemplate: clientModule.getClientTemplate },
    { label: 'internal', getTemplate: clientModule.getInternalTemplate },
  ];

  it('covers every supported language', () => {
    for (const { label, getTemplate } of templates) {
      const template = getTemplate();
      expect(template.translations.map((t) => t.language), label).toEqual(SUPPORTED_LANGUAGES);
    }
  });

  it('matches the shipped locale files for both audiences', () => {
    const renderedByLanguage = new Map<string, string>();
    for (const { getTemplate } of templates) {
      for (const translation of getTemplate().translations) {
        const previous = renderedByLanguage.get(translation.language) ?? '';
        renderedByLanguage.set(
          translation.language,
          `${previous}${translation.htmlContent}${translation.textContent}`,
        );
      }
    }
    for (const { getTemplate } of templates) {
      for (const translation of getTemplate().translations) {
        const copy = readLocaleCopy(translation.language);
        expect(Object.keys(copy).length, `no ticketClosed copy for ${translation.language}`).toBeGreaterThan(0);
        expect(translation.subject, `subject drift for ${translation.language}`).toBe(copy.subject);
        const rendered = renderedByLanguage.get(translation.language) ?? '';
        for (const [key, value] of Object.entries(copy)) {
          if (key === 'subject' || typeof value !== 'string' || !value.trim()) continue;
          expect(
            rendered.includes(value),
            `email.ticketClosed.${key} for ${translation.language} missing from rendered templates`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps internal-only blocks out of the client template', () => {
    const client = clientModule.getClientTemplate();
    const internal = clientModule.getInternalTemplate();
    const enClient = client.translations.find((t) => t.language === 'en');
    const enInternal = internal.translations.find((t) => t.language === 'en');
    expect(enClient?.htmlContent).not.toContain('{{{ticket.timeHtml}}}');
    expect(enClient?.htmlContent).not.toContain('{{{ticket.materialsHtml}}}');
    expect(enInternal?.htmlContent).toContain('{{{ticket.timeHtml}}}');
    expect(enInternal?.htmlContent).toContain('{{{ticket.materialsHtml}}}');
    for (const translation of [...client.translations, ...internal.translations]) {
      expect(translation.htmlContent).toContain('{{ticket.categoryDetails}}');
      expect(translation.textContent).toContain('{{ticket.categoryDetails}}');
    }
  });
});

describe('migration image self-containment', () => {
  it('setup image copies migrations without server/public, so builders must not require locale JSON', () => {
    const setupDockerfile = path.resolve(__dirname, '../../../../../setup/Dockerfile.ubuntu');
    expect(existsSync(setupDockerfile)).toBe(true);
    const contents = readFileSync(setupDockerfile, 'utf8');
    expect(contents).toContain('COPY server/migrations ./server/migrations');
    expect(contents).not.toMatch(/COPY\s+server\/public/);

    const templatesRoot = path.resolve(__dirname, '../../../../migrations/utils/templates');
    const offenders = listCjsFiles(templatesRoot)
      .filter((file) => /public[\\/]locales/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(templatesRoot, file));
    expect(offenders).toEqual([]);
  });
});

function listCjsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCjsFiles(full));
    else if (entry.name.endsWith('.cjs')) out.push(full);
  }
  return out;
}
