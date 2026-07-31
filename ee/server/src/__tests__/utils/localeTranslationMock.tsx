import fs from 'node:fs';
import path from 'node:path';

// Walk up from the vitest cwd (ee/server) so the bundle resolves whether tests run from the
// package or the repo root.
function findRepoRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, 'server/public/locales/en'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Unable to locate server/public/locales/en above ' + process.cwd());
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();

type TranslationOptions = Record<string, unknown> & { defaultValue?: string };

function flatten(source: Record<string, unknown>, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    const qualified = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, nestedValue] of flatten(value as Record<string, unknown>, qualified)) {
        flat.set(nested, nestedValue);
      }
    } else if (typeof value === 'string') {
      flat.set(qualified, value);
    }
  }
  return flat;
}

function loadNamespace(namespace: string): Map<string, string> {
  const bundle = path.join(REPO_ROOT, 'server/public/locales/en', `${namespace}.json`);
  return flatten(JSON.parse(fs.readFileSync(bundle, 'utf8')) as Record<string, unknown>);
}

function interpolate(template: string, options?: TranslationOptions): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = options?.[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolves translation keys against the real `en` bundle rather than echoing the key back.
 *
 * Component tests assert on the English copy an operator actually sees, so a mock that returns
 * the key makes every such assertion fail. Reading the shipped bundle also means a renamed or
 * deleted key surfaces here as a failing test instead of as raw dotted keys in the product.
 */
export function createLocaleTranslationMock(namespace: string) {
  const messages = loadNamespace(namespace);
  // Stable identity: components memoize callbacks on `t`.
  const t = (key: string, options?: TranslationOptions): string => {
    const template = messages.get(key);
    if (template === undefined) {
      return options?.defaultValue ?? key;
    }
    return interpolate(template, options);
  };

  return { useTranslation: () => ({ t }) };
}
