import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '../../../../..');
export const templatesRoot = path.join(repoRoot, 'server/migrations/utils/templates');

export interface SystemTemplateFixture {
  name: string;
  language: string;
  subject: string;
  html: string;
  text: string;
}

function templateModulePaths(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.cjs')) found.push(full);
    }
  };
  walk(path.join(templatesRoot, 'email'));
  return found.sort();
}

/**
 * The real system email templates, built from the migration source modules
 * rather than a hand-written fixture, so the rewrite is exercised against every
 * shape that ships: inline-style layouts and the auth templates' <style> blocks.
 */
export function loadSystemTemplates(language = 'en'): SystemTemplateFixture[] {
  const templates: SystemTemplateFixture[] = [];

  for (const modulePath of templateModulePaths()) {
    const loaded = require(modulePath) as { getTemplate?: () => any };
    if (typeof loaded.getTemplate !== 'function') continue;

    const definition = loaded.getTemplate();
    for (const translation of definition.translations ?? []) {
      if (translation.language !== language) continue;
      templates.push({
        name: definition.templateName,
        language: translation.language,
        subject: translation.subject,
        html: translation.htmlContent,
        text: translation.textContent,
      });
    }
  }

  return templates;
}

export function loadSystemTemplate(name: string, language = 'en'): SystemTemplateFixture {
  const found = loadSystemTemplates(language).find((template) => template.name === name);
  if (!found) throw new Error(`No system template fixture for ${name}/${language}`);
  return found;
}

/** The stock constants as the migrations see them. */
export function loadStockConstants(): Record<string, string> {
  return require(path.join(templatesRoot, '_shared/constants.cjs'));
}
