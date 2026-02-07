#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const TARGET_PACKAGE_JSONS = [
  'ee/temporal-workflows/package.json',
  'packages/integrations/package.json',
];

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const INTERNAL_PREFIX = '@alga-psa/';
const ALLOWED_INTERNAL_SPEC_PREFIXES = ['file:', 'workspace:', 'link:', 'npm:'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isAllowedInternalSpecifier(spec) {
  return ALLOWED_INTERNAL_SPEC_PREFIXES.some((prefix) => spec.startsWith(prefix));
}

function validatePackage(packageJsonPath) {
  const absPath = path.join(REPO_ROOT, packageJsonPath);
  if (!fs.existsSync(absPath)) {
    return [{ packageJsonPath, section: 'n/a', depName: 'n/a', spec: 'n/a', reason: 'file not found' }];
  }

  const pkg = readJson(absPath);
  const violations = [];

  for (const section of DEP_SECTIONS) {
    const deps = pkg[section] ?? {};
    for (const [depName, spec] of Object.entries(deps)) {
      if (!depName.startsWith(INTERNAL_PREFIX)) continue;
      if (typeof spec !== 'string') continue;

      if (!isAllowedInternalSpecifier(spec)) {
        violations.push({
          packageJsonPath,
          section,
          depName,
          spec,
          reason:
            'internal dependency must use a local/workspace specifier for isolated worker packaging',
        });
      }
    }
  }

  return violations;
}

const allViolations = TARGET_PACKAGE_JSONS.flatMap((pkgPath) => validatePackage(pkgPath));

if (allViolations.length > 0) {
  console.error('\nTemporal worker packaging contract check failed.\n');
  for (const violation of allViolations) {
    console.error(
      `- ${violation.packageJsonPath} [${violation.section}] ${violation.depName} = "${violation.spec}"\n  ${violation.reason}`
    );
  }
  console.error(
    '\nFix: use file:/workspace:/link: specs for internal @alga-psa/* dependencies in worker-isolated packages.\n'
  );
  process.exit(1);
}

console.log('Temporal worker packaging contract check passed.');
