#!/usr/bin/env node

/**
 * Verifies locale coverage and placeholder parity for source-of-truth email
 * and internal notification templates.
 */

const fs = require('fs');
const path = require('path');
const {
  findForbiddenTerms,
  forbiddenMatchers,
  parseArgs,
  readJson,
} = require('./lib/translation-utils.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REGISTRY_PATH = path.join(__dirname, 'locales.registry.json');

function usage() {
  return 'Usage: node tools/i18n/check-template-parity.cjs --locale <code>';
}

function placeholderTokens(value) {
  return [...String(value).matchAll(/{{{?\s*[^{}]+?\s*}?}}/g)]
    .map((match) => match[0].replace(/\s+/g, ' '))
    .sort();
}

function diffSorted(left, right) {
  return {
    missing: left.filter((item) => !right.includes(item)),
    extra: right.filter((item) => !left.includes(item)),
  };
}

function equalArrays(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function formatList(values) {
  return values.length > 0 ? values.join(', ') : '(none)';
}

function collectEmailSourceFiles(dir = path.join(REPO_ROOT, 'server/migrations/utils/templates/email')) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectEmailSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.cjs')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function checkTextFields({ templateName, system, en, target, locale, fields, forbidden = [] }) {
  const errors = [];
  if (!target) return [`${system}:${templateName} missing ${locale} translation`];

  for (const field of fields) {
    if (!String(target[field] ?? '').trim()) {
      errors.push(`${system}:${templateName} ${locale} ${field} is empty`);
      continue;
    }

    const enTokens = placeholderTokens(en?.[field]);
    const targetTokens = placeholderTokens(target[field]);
    if (!equalArrays(enTokens, targetTokens)) {
      const { missing, extra } = diffSorted(enTokens, targetTokens);
      errors.push(
        `${system}:${templateName} ${field} placeholders differ; missing=${formatList(missing)} extra=${formatList(extra)}`,
      );
    }

    const violations = findForbiddenTerms(target[field], forbidden, locale, en?.[field]);
    if (violations.length > 0) {
      errors.push(`${system}:${templateName} ${field} contains forbidden terms: ${violations.map((item) => item.term).join(', ')}`);
    }
  }

  return errors;
}

function checkEmailTemplate(template, locale = 'pt', forbidden = []) {
  const en = template.translations.find((translation) => translation.language === 'en');
  const target = template.translations.find((translation) => translation.language === locale);
  if (!en) return [`email:${template.templateName} missing en translation`];
  return checkTextFields({
    templateName: template.templateName,
    system: 'email',
    en,
    target,
    locale,
    fields: ['subject', 'htmlContent', 'textContent'],
    forbidden,
  });
}

function checkInternalTemplate(template, locale = 'pt', forbidden = []) {
  const en = template.translations.en;
  const target = template.translations[locale];
  if (!en) return [`internal:${template.templateName} missing en translation`];
  return checkTextFields({
    templateName: template.templateName,
    system: 'internal',
    en,
    target,
    locale,
    fields: ['title', 'message'],
    forbidden,
  });
}

function compareNameSets(label, expected, actual) {
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  if (equalArrays(expectedSorted, actualSorted)) return [];
  const { missing, extra } = diffSorted(expectedSorted, actualSorted);
  return [`${label} mismatch; missing=${formatList(missing)} extra=${formatList(extra)}`];
}

function loadEmailSourceTemplates() {
  return collectEmailSourceFiles().map((file) => {
    const relativePath = path.relative(REPO_ROOT, file);
    const moduleExports = require(file);
    if (typeof moduleExports.getTemplate !== 'function') {
      throw new Error(`${relativePath} does not export getTemplate()`);
    }
    return moduleExports.getTemplate();
  });
}

function loadInternalSourceTemplates() {
  const devSeed = require(path.join(REPO_ROOT, 'server/seeds/dev/87_internal_notification_templates.cjs'));
  return devSeed.ALL_TEMPLATES;
}

function checkEmailTemplates(locale, forbidden = [], templates = loadEmailSourceTemplates()) {
  return {
    system: 'email',
    count: templates.length,
    localeCount: templates.filter((template) => template.translations.some((item) => item.language === locale)).length,
    errors: templates.flatMap((template) => checkEmailTemplate(template, locale, forbidden)),
  };
}

function checkInternalTemplates(locale, forbidden = [], templates = loadInternalSourceTemplates()) {
  return {
    system: 'internal',
    count: templates.length,
    localeCount: templates.filter((template) => Boolean(template.translations[locale])).length,
    errors: templates.flatMap((template) => checkInternalTemplate(template, locale, forbidden)),
  };
}

function checkAllTemplates({ locale = 'pt', forbidden = [] } = {}) {
  const email = checkEmailTemplates(locale, forbidden);
  const internal = checkInternalTemplates(locale, forbidden);
  const skipped = email.localeCount + internal.localeCount === 0;
  return {
    locale,
    skipped,
    results: [email, internal],
    errors: skipped ? [] : [...email.errors, ...internal.errors],
  };
}

function getLocaleConfig(locale) {
  const registry = readJson(REGISTRY_PATH);
  if (!locale || !registry[locale]) {
    throw new Error(`Unknown or missing --locale. Supported locales: ${Object.keys(registry).join(', ')}`);
  }
  return registry[locale];
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(usage());
    return 0;
  }

  const locale = args.locale;
  const config = getLocaleConfig(locale);
  const glossaryPath = path.resolve(REPO_ROOT, config.dir, config.glossary);
  let forbidden = [];
  if (fs.existsSync(glossaryPath)) {
    forbidden = forbiddenMatchers(readJson(glossaryPath), config.dialect);
  } else {
    console.log(`${locale}: glossary not found at ${glossaryPath}; forbidden-term template checks skipped`);
  }

  const { results, errors, skipped } = checkAllTemplates({ locale, forbidden });
  if (skipped) {
    console.log(`${locale}: no email or internal notification templates found; coverage check skipped`);
    return 0;
  }

  for (const result of results) {
    console.log(`${result.system}: checked ${result.count} templates (${result.localeCount} with ${locale})`);
  }

  if (errors.length > 0) {
    console.error(`${locale} template parity failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }

  console.log(`${locale} template parity passed`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  checkAllTemplates,
  checkEmailTemplate,
  checkInternalTemplate,
  compareNameSets,
  main,
  placeholderTokens,
};
