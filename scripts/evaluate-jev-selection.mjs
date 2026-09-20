#!/usr/bin/env node
// Score a shadow selection against the run that actually happened. Inputs are
// the downloaded shard and browser artifacts (any results.json beneath the
// input directory) plus jev-selection.json. Never gates the workflow.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSelection, renderEvaluationMarkdown } from './lib/jev-selection-evaluation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const selectionPath = path.resolve(root, args.selection ?? 'test-results/selection-input/jev-selection/jev-selection.json');
const inputs = path.resolve(root, args.inputs ?? 'test-results/selection-input');
const output = path.resolve(root, args.out ?? 'test-results/selection');
mkdirSync(output, { recursive: true });

function walk(directory) {
  let files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else if (entry.name === 'results.json') files.push(full);
  }
  return files;
}

const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const selection = read(selectionPath);
const reports = walk(inputs).map(file => ({ file, report: read(file) })).filter(entry => entry.report);
const integrationReports = reports.filter(({ report }) => Array.isArray(report.testResults)).map(({ report }) => report);
const browserReports = reports.filter(({ report }) => Array.isArray(report.suites) && report.config).map(({ report }) => report);
const evaluation = evaluateSelection({ selection, integrationReports, browserReports });
evaluation.inputs = { selection: path.relative(root, selectionPath), integration_reports: integrationReports.length, browser_reports: browserReports.length };
writeFileSync(path.join(output, 'jev-evaluation.json'), JSON.stringify(evaluation, null, 2) + '\n');
const markdown = renderEvaluationMarkdown(evaluation);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
