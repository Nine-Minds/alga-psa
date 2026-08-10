#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  collectLeaves,
  csvEscape,
  ensureDir,
  isReviewed,
  listArg,
  loadReviewState,
  markdownEscape,
  namespaceFromFile,
  parseArgs,
  readJson,
  walkJson,
} = require('./lib/translation-utils.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REGISTRY_PATH = path.join(__dirname, 'locales.registry.json');

function usage() {
  return `Usage: node tools/i18n/export-review.cjs --locale <code> [options]

Options:
  --locale <code>           Target locale from locales.registry.json
  --locales-dir <dir>       Locale root containing en/ and <code>/ (default: server/public/locales)
  --en-dir <dir>            Override English locale directory
  --locale-dir <dir>        Override target locale directory (--target-dir/--<code>-dir aliases)
  --pt-dir <dir>            Legacy alias for --locale-dir when --locale pt
  --review-state <file>     Override registry review ledger path
  --namespace <name>        Limit to one namespace; may be repeated or comma-separated
  --format <csv|md|both>    Export format (default: csv)
  --output <file>           Output path for csv or md format
  --output-dir <dir>        Output directory for --format both
`;
}

function repoPath(value) {
  return path.resolve(REPO_ROOT, value);
}

function getConfig(locale) {
  const registry = readJson(REGISTRY_PATH);
  if (!locale || !registry[locale]) {
    throw new Error(`Unknown or missing --locale. Supported locales: ${Object.keys(registry).join(', ')}`);
  }
  return registry[locale];
}

function buildRows({ enDir, localeDir, locale, reviewState, namespaceFilter = new Set() }) {
  const rows = [];
  const files = walkJson(enDir, enDir)
    .filter((file) => namespaceFilter.size === 0 || namespaceFilter.has(namespaceFromFile(file)));

  for (const relativeFile of files) {
    const namespace = namespaceFromFile(relativeFile);
    const enKeys = collectLeaves(readJson(path.join(enDir, relativeFile)));
    const targetKeys = collectLeaves(readJson(path.join(localeDir, relativeFile)));

    for (const [key, enValue] of enKeys) {
      const targetValue = targetKeys.get(key);
      rows.push({
        namespace,
        key,
        en: typeof enValue === 'string' ? enValue : JSON.stringify(enValue),
        [locale]: typeof targetValue === 'string' ? targetValue : JSON.stringify(targetValue),
        reviewStatus: isReviewed(reviewState, namespace, key) ? 'reviewed' : 'unreviewed',
      });
    }
  }

  return rows;
}

function renderCsv(rows, locale = 'pt') {
  const lines = [`namespace,key,en,${locale},reviewStatus`];
  for (const row of rows) {
    lines.push([row.namespace, row.key, row.en, row[locale], row.reviewStatus].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(rows, locale = 'pt', dialect = locale) {
  const languageNames = {
    de: 'German',
    es: 'Spanish',
    fr: 'French',
    it: 'Italian',
    nl: 'Dutch',
    pl: 'Polish',
    pt: 'Portuguese',
  };
  const lines = [
    `# ${dialect} Native Review Export`,
    '',
    `| Namespace | Key | English | ${languageNames[locale] || locale} | Review Status |`,
    '|---|---|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(`| ${markdownEscape(row.namespace)} | \`${markdownEscape(row.key)}\` | ${markdownEscape(row.en)} | ${markdownEscape(row[locale])} | ${markdownEscape(row.reviewStatus)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(usage());
    return 0;
  }

  const locale = args.locale;
  const config = getConfig(locale);
  const reviewDir = repoPath(config.dir);
  const localesDir = repoPath(args['locales-dir'] || 'server/public/locales');
  const enDir = repoPath(args['en-dir'] || path.join(localesDir, 'en'));
  const localeDirOverride = args['locale-dir'] || args['target-dir'] || args[`${locale}-dir`];
  const localeDir = repoPath(localeDirOverride || path.join(localesDir, locale));
  const reviewStatePath = repoPath(args['review-state'] || path.join(reviewDir, config.reviewState));
  const namespaceFilter = new Set(listArg(args.namespace));
  const format = args.format || 'csv';
  const rows = buildRows({
    enDir,
    localeDir,
    locale,
    reviewState: loadReviewState(reviewStatePath, locale),
    namespaceFilter,
  });

  if (!['csv', 'md', 'both'].includes(format)) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  const defaultDir = path.join(reviewDir, 'reports');
  if (format === 'both') {
    const outputDir = repoPath(args['output-dir'] || defaultDir);
    ensureDir(outputDir);
    fs.writeFileSync(path.join(outputDir, `${locale}-review-export.csv`), renderCsv(rows, locale));
    fs.writeFileSync(path.join(outputDir, `${locale}-review-export.md`), renderMarkdown(rows, locale, config.dialect));
    console.log(`Wrote ${rows.length} rows to ${outputDir}`);
    return 0;
  }

  const defaultOutput = path.join(defaultDir, `${locale}-review-export.${format}`);
  const outputPath = repoPath(args.output || defaultOutput);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(
    outputPath,
    format === 'md' ? renderMarkdown(rows, locale, config.dialect) : renderCsv(rows, locale),
  );
  console.log(`Wrote ${rows.length} rows to ${outputPath}`);
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

module.exports = { buildRows, main, renderCsv, renderMarkdown };
