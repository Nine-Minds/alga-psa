#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  allowlistMatchers,
  collectLeaves,
  ensureDir,
  findForbiddenTerms,
  forbiddenMatchers,
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
  return `Usage: node tools/i18n/audit.cjs --locale <code> [options]

Options:
  --locale <code>           Target locale from locales.registry.json
  --locales-dir <dir>       Locale root containing en/ and <code>/ (default: server/public/locales)
  --en-dir <dir>            Override English locale directory
  --locale-dir <dir>        Override target locale directory (--target-dir/--<code>-dir aliases)
  --pt-dir <dir>            Legacy alias for --locale-dir when --locale pt
  --glossary <file>         Override registry glossary path
  --review-state <file>     Override registry review ledger path
  --report-dir <dir>        Override registry reports directory
  --namespace <name>        Limit to one namespace; may be repeated or comma-separated
  --json                    Print the JSON report to stdout
  --no-write-report         Do not write audit.json and audit.md
  --baseline                Fail only when tracked counts exceed baseline.json
  --write-baseline          Write current tracked counts to baseline.json
`;
}

function repoPath(value) {
  return path.resolve(REPO_ROOT, value);
}

function loadRegistry() {
  return readJson(REGISTRY_PATH);
}

function localeConfig(locale, registry = loadRegistry()) {
  if (!locale || !registry[locale]) {
    const supported = Object.keys(registry).join(', ');
    throw new Error(`Unknown or missing --locale. Supported locales: ${supported}`);
  }
  return registry[locale];
}

function resolveRunOptions(options) {
  const registry = options.registry || loadRegistry();
  const config = localeConfig(options.locale, registry);
  const reviewDir = repoPath(config.dir);
  const localesDir = repoPath(options.localesDir || 'server/public/locales');
  return {
    locale: options.locale,
    dialect: config.dialect,
    config,
    reviewDir,
    enDir: repoPath(options.enDir || path.join(localesDir, 'en')),
    localeDir: repoPath(options.localeDir || path.join(localesDir, options.locale)),
    glossaryPath: repoPath(options.glossaryPath || path.join(reviewDir, config.glossary)),
    reviewStatePath: repoPath(options.reviewStatePath || path.join(reviewDir, config.reviewState)),
    reportDir: repoPath(options.reportDir || path.join(reviewDir, 'reports')),
    baselinePath: repoPath(options.baselinePath || path.join(reviewDir, 'baseline.json')),
    namespaceFilter: options.namespaceFilter || new Set(),
    writeReport: options.writeReport !== false,
  };
}

function runAudit(options) {
  const resolved = resolveRunOptions(options);
  if (!fs.existsSync(resolved.glossaryPath)) {
    return {
      skipped: true,
      message: `${resolved.locale}: glossary not found at ${resolved.glossaryPath}; audit skipped`,
      ...resolved,
    };
  }

  const glossary = readJson(resolved.glossaryPath);
  const reviewState = loadReviewState(resolved.reviewStatePath, resolved.locale);
  const report = buildReport({
    enDir: resolved.enDir,
    localeDir: resolved.localeDir,
    locale: resolved.locale,
    dialect: resolved.dialect,
    namespaceFilter: resolved.namespaceFilter,
    reviewState,
    allowlist: allowlistMatchers(glossary, resolved.dialect),
    forbidden: forbiddenMatchers(glossary, resolved.dialect),
    reviewStatePath: resolved.reviewStatePath,
  });

  if (resolved.writeReport) {
    ensureDir(resolved.reportDir);
    fs.writeFileSync(path.join(resolved.reportDir, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(resolved.reportDir, 'audit.md'), renderMarkdown(report));
  }

  return { skipped: false, report, ...resolved };
}

function buildReport({
  enDir,
  localeDir,
  locale = 'pt',
  dialect = locale,
  namespaceFilter = new Set(),
  reviewState,
  allowlist,
  forbidden,
  reviewStatePath,
}) {
  const files = walkJson(enDir, enDir)
    .filter((file) => namespaceFilter.size === 0 || namespaceFilter.has(namespaceFromFile(file)));

  const namespaces = [];
  const summary = {
    generatedAt: new Date().toISOString(),
    locale,
    dialect,
    reviewStatePath,
    namespaceCount: 0,
    keyCount: 0,
    reviewedCount: 0,
    unreviewedCount: 0,
    untranslatedCount: 0,
    forbiddenViolationCount: 0,
    missingFileCount: 0,
    parseErrorCount: 0,
    errorCount: 0,
  };

  for (const relativeFile of files) {
    const namespace = namespaceFromFile(relativeFile);
    const enPath = path.join(enDir, relativeFile);
    const targetPath = path.join(localeDir, relativeFile);
    const namespaceReport = {
      namespace,
      file: relativeFile.split(path.sep).join('/'),
      keyCount: 0,
      reviewedCount: 0,
      unreviewedCount: 0,
      untranslated: [],
      forbiddenViolations: [],
      structuralErrors: [],
    };

    if (!fs.existsSync(targetPath)) {
      namespaceReport.structuralErrors.push({ type: 'missing-file', file: namespaceReport.file });
      summary.missingFileCount++;
      namespaces.push(namespaceReport);
      continue;
    }

    let enData;
    let targetData;
    try {
      enData = readJson(enPath);
      targetData = readJson(targetPath);
    } catch (error) {
      namespaceReport.structuralErrors.push({ type: 'parse-error', message: error.message });
      summary.parseErrorCount++;
      namespaces.push(namespaceReport);
      continue;
    }

    const enKeys = collectLeaves(enData);
    const targetKeys = collectLeaves(targetData);
    namespaceReport.keyCount = enKeys.size;

    for (const [key, enValue] of enKeys) {
      const targetValue = targetKeys.get(key);
      if (isReviewed(reviewState, namespace, key)) {
        namespaceReport.reviewedCount++;
      } else {
        namespaceReport.unreviewedCount++;
      }

      if (typeof enValue === 'string' && typeof targetValue === 'string') {
        if (enValue.trim() === targetValue.trim() && !allowlist.isAllowed(targetValue)) {
          namespaceReport.untranslated.push({ key, en: enValue, [locale]: targetValue });
        }

        for (const hit of findForbiddenTerms(targetValue, forbidden, dialect, enValue, `${namespace}:${key}`)) {
          namespaceReport.forbiddenViolations.push({ key, value: targetValue, ...hit });
        }
      }
    }

    namespaces.push(namespaceReport);
  }

  for (const namespaceReport of namespaces) {
    summary.namespaceCount++;
    summary.keyCount += namespaceReport.keyCount;
    summary.reviewedCount += namespaceReport.reviewedCount;
    summary.unreviewedCount += namespaceReport.unreviewedCount;
    summary.untranslatedCount += namespaceReport.untranslated.length;
    summary.forbiddenViolationCount += namespaceReport.forbiddenViolations.length;
    summary.errorCount += namespaceReport.untranslated.length;
    summary.errorCount += namespaceReport.forbiddenViolations.length;
    summary.errorCount += namespaceReport.structuralErrors.length;
  }

  return { summary, namespaces };
}

function countsFromReport(report) {
  return {
    untranslated: report.summary.untranslatedCount,
    forbidden: report.summary.forbiddenViolationCount,
    unreviewed: report.summary.unreviewedCount,
    structural: report.namespaces.reduce((count, item) => count + item.structuralErrors.length, 0),
  };
}

function writeBaseline(filePath, report) {
  const baseline = {
    version: 1,
    locale: report.summary.locale,
    dialect: report.summary.dialect,
    generatedAt: new Date().toISOString(),
    counts: countsFromReport(report),
  };
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

function baselineCounts(baseline) {
  const source = baseline.counts || baseline.summary || baseline;
  const structuralFallback = Number(source.missingFileCount || 0) + Number(source.parseErrorCount || 0);
  const values = {
    untranslated: source.untranslated ?? source.untranslatedCount,
    forbidden: source.forbidden ?? source.forbiddenViolationCount,
    unreviewed: source.unreviewed ?? source.unreviewedCount,
    structural: source.structural ?? source.structuralErrorCount ?? structuralFallback,
  };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid baseline count for ${name}`);
    }
  }
  return values;
}

function compareBaseline(report, baseline) {
  const current = countsFromReport(report);
  const expected = baselineCounts(baseline);
  const deltas = {};
  let regressed = false;
  for (const name of Object.keys(current)) {
    const delta = current[name] - expected[name];
    deltas[name] = { baseline: expected[name], current: current[name], delta };
    if (delta > 0) regressed = true;
  }
  return { regressed, deltas };
}

function renderBaselineDelta(comparison) {
  const lines = [`baseline: ${comparison.regressed ? 'REGRESSION' : 'no regression'}`];
  for (const [name, values] of Object.entries(comparison.deltas)) {
    const sign = values.delta > 0 ? '+' : '';
    lines.push(`- ${name}: baseline=${values.baseline} current=${values.current} delta=${sign}${values.delta}`);
  }
  return lines.join('\n');
}

function renderConsole(report) {
  const lines = [
    `${report.summary.dialect} audit: ${report.summary.namespaceCount} namespaces, ${report.summary.keyCount} keys`,
    `untranslated=${report.summary.untranslatedCount} forbidden=${report.summary.forbiddenViolationCount} unreviewed=${report.summary.unreviewedCount}`,
  ];

  for (const item of report.namespaces) {
    if (item.untranslated.length || item.forbiddenViolations.length || item.structuralErrors.length) {
      lines.push(`- ${item.namespace}: untranslated=${item.untranslated.length}, forbidden=${item.forbiddenViolations.length}, structural=${item.structuralErrors.length}`);
    }
  }
  return lines.join('\n');
}

function renderMarkdown(report) {
  const lines = [
    `# ${report.summary.dialect} Translation Audit`,
    '',
    `Generated: ${report.summary.generatedAt}`,
    '',
    '| Namespace | Keys | Reviewed | Unreviewed | Untranslated | Forbidden | Structural |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];

  for (const item of report.namespaces) {
    lines.push(`| ${markdownEscape(item.namespace)} | ${item.keyCount} | ${item.reviewedCount} | ${item.unreviewedCount} | ${item.untranslated.length} | ${item.forbiddenViolations.length} | ${item.structuralErrors.length} |`);
  }

  for (const item of report.namespaces) {
    if (!item.untranslated.length && !item.forbiddenViolations.length && !item.structuralErrors.length) continue;
    lines.push('', `## ${item.namespace}`, '');

    if (item.structuralErrors.length) {
      lines.push('### Structural Errors', '');
      for (const error of item.structuralErrors) {
        lines.push(`- ${markdownEscape(error.type)}: ${markdownEscape(error.message || error.file || '')}`);
      }
      lines.push('');
    }

    if (item.untranslated.length) {
      lines.push('### Identical To English', '');
      for (const row of item.untranslated) {
        lines.push(`- \`${markdownEscape(row.key)}\`: ${markdownEscape(row.en)}`);
      }
      lines.push('');
    }

    if (item.forbiddenViolations.length) {
      lines.push('### Forbidden Terms', '');
      for (const row of item.forbiddenViolations) {
        lines.push(`- \`${markdownEscape(row.key)}\`: found "${markdownEscape(row.term)}"; prefer "${markdownEscape(row.preferred)}"`);
      }
      lines.push('');
    }
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
  const localeDir = args['locale-dir'] || args['target-dir'] || args[`${locale}-dir`];
  const result = runAudit({
    locale,
    localesDir: args['locales-dir'],
    enDir: args['en-dir'],
    localeDir,
    glossaryPath: args.glossary,
    reviewStatePath: args['review-state'],
    reportDir: args['report-dir'],
    namespaceFilter: new Set(listArg(args.namespace)),
    writeReport: args['no-write-report'] !== true,
  });

  if (result.skipped) {
    console.log(result.message);
    return 0;
  }

  if (args['write-baseline']) {
    writeBaseline(result.baselinePath, result.report);
    console.error(`Wrote baseline to ${result.baselinePath}`);
  }

  if (args.json) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(renderConsole(result.report));
  }

  if (args.baseline) {
    if (!fs.existsSync(result.baselinePath)) {
      console.error(`${locale}: baseline not found at ${result.baselinePath}; comparison skipped`);
      return 0;
    }
    const comparison = compareBaseline(result.report, readJson(result.baselinePath));
    console.error(renderBaselineDelta(comparison));
    return comparison.regressed ? 1 : 0;
  }

  return result.report.summary.errorCount === 0 ? 0 : 1;
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
  baselineCounts,
  buildReport,
  compareBaseline,
  countsFromReport,
  main,
  renderBaselineDelta,
  renderMarkdown,
  resolveRunOptions,
  runAudit,
  writeBaseline,
};
