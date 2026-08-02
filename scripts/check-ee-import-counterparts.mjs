#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const SOURCE_ROOTS = ["server", "shared", "packages"];
export const COUNTERPART_ROOT = "packages/ee/src";
export const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

const SOURCE_EXTENSIONS = new Set(MODULE_EXTENSIONS);
const EXCLUDED_OUTPUT_DIRECTORIES = new Set([
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
]);
const TEST_DIRECTORY_NAMES = new Set([
  "__fixtures__",
  "__test-fixtures__",
  "__tests__",
  "fixtures",
  "test-utils",
  "tests",
  "testing",
]);
const TEST_FILE_PATTERN = /(?:^|\.)(?:test|spec|stories)\.[^.]+$/;
const GENERATED_FILE_PATTERN = /\.generated\.[^.]+$/;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isPathInside(candidatePath, rootPath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function isEnterpriseOnlyPackagePath(segments) {
  return segments[0] === "packages" && segments.slice(1).includes("ee");
}

function isTestOrFixturePath(segments) {
  if (segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  if (segments[0] === "server") {
    return (
      segments[1] === "test-utils" ||
      (segments[1] === "src" && segments[2] === "test")
    );
  }

  return segments[0] === "packages" && segments.includes("test");
}

export function isProductionSourceFile(relativePath) {
  const normalizedPath = toPosixPath(relativePath);
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? "";
  const extension = path.extname(fileName);

  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }

  if (
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".d.mts") ||
    fileName.endsWith(".d.cts")
  ) {
    return false;
  }

  if (
    TEST_FILE_PATTERN.test(fileName) ||
    GENERATED_FILE_PATTERN.test(fileName)
  ) {
    return false;
  }

  if (
    segments.some((segment) => EXCLUDED_OUTPUT_DIRECTORIES.has(segment)) ||
    isTestOrFixturePath(segments)
  ) {
    return false;
  }

  return !isEnterpriseOnlyPackagePath(segments);
}

export function discoverSourceFiles(repositoryRoot = REPOSITORY_ROOT) {
  const sourceFiles = [];

  const walk = (directoryPath) => {
    const entries = fs
      .readdirSync(directoryPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = toPosixPath(
        path.relative(repositoryRoot, absolutePath),
      );

      if (entry.isDirectory()) {
        const segments = relativePath.split("/");
        if (
          EXCLUDED_OUTPUT_DIRECTORIES.has(entry.name) ||
          isTestOrFixturePath(segments) ||
          isEnterpriseOnlyPackagePath(segments)
        ) {
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (entry.isFile() && isProductionSourceFile(relativePath)) {
        sourceFiles.push(relativePath);
      }
    }
  };

  for (const sourceRoot of SOURCE_ROOTS) {
    const absoluteRoot = path.join(repositoryRoot, sourceRoot);
    if (fs.existsSync(absoluteRoot)) {
      walk(absoluteRoot);
    }
  }

  return sourceFiles.sort();
}

function literalModuleSpecifier(node) {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }
  return null;
}

function importTypeModuleSpecifier(node) {
  if (!ts.isLiteralTypeNode(node)) {
    return null;
  }
  return node.literal;
}

export function collectEeImports(sourceText, filePath = "source.ts") {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];

  const recordSpecifier = (moduleSpecifier, kind) => {
    const specifier = literalModuleSpecifier(moduleSpecifier);
    if (specifier === null || !specifier.startsWith("@ee/")) {
      return;
    }

    const location = sourceFile.getLineAndCharacterOfPosition(
      moduleSpecifier.getStart(sourceFile),
    );
    imports.push({
      filePath: toPosixPath(filePath),
      kind,
      line: location.line + 1,
      column: location.character + 1,
      specifier,
    });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      recordSpecifier(node.moduleSpecifier, "import");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      recordSpecifier(node.moduleReference.expression, "import-equals");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      recordSpecifier(node.moduleSpecifier, "export");
    } else if (ts.isImportTypeNode(node)) {
      recordSpecifier(importTypeModuleSpecifier(node.argument), "import-type");
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      recordSpecifier(node.arguments[0], "dynamic-import");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

export function validateEeSpecifier(specifier) {
  if (!specifier.startsWith("@ee/")) {
    return { valid: false, reason: "specifier must start with @ee/" };
  }

  const subpath = specifier.slice("@ee/".length);
  const segments = subpath.split("/");
  if (
    subpath.length === 0 ||
    subpath.includes("\\") ||
    subpath.includes("\0") ||
    subpath.includes("?") ||
    subpath.includes("#") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return {
      valid: false,
      reason:
        "specifier contains an empty, malformed, or traversal-like subpath",
    };
  }

  return { valid: true, subpath };
}

export function counterpartCandidates(
  specifier,
  repositoryRoot = REPOSITORY_ROOT,
) {
  const validation = validateEeSpecifier(specifier);
  if (!validation.valid) {
    return [];
  }

  const counterpartRoot = path.resolve(repositoryRoot, COUNTERPART_ROOT);
  const basePath = path.resolve(
    counterpartRoot,
    ...validation.subpath.split("/"),
  );
  if (!isPathInside(basePath, counterpartRoot)) {
    return [];
  }

  if (MODULE_EXTENSIONS.includes(path.extname(basePath))) {
    return [basePath];
  }

  return [
    ...MODULE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...MODULE_EXTENSIONS.map((extension) =>
      path.join(basePath, `index${extension}`),
    ),
  ];
}

export function resolveCounterpart(
  specifier,
  repositoryRoot = REPOSITORY_ROOT,
) {
  const validation = validateEeSpecifier(specifier);
  if (!validation.valid) {
    return { found: false, reason: validation.reason, candidates: [] };
  }

  const candidates = counterpartCandidates(specifier, repositoryRoot);
  const resolvedPath = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  return {
    found: resolvedPath !== undefined,
    resolvedPath,
    candidates,
    reason:
      resolvedPath === undefined
        ? "counterpart module does not exist"
        : undefined,
  };
}

export function findEeImportCounterpartViolations(
  repositoryRoot = REPOSITORY_ROOT,
) {
  const violations = [];

  for (const relativePath of discoverSourceFiles(repositoryRoot)) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const sourceText = fs.readFileSync(absolutePath, "utf8");

    for (const importedModule of collectEeImports(sourceText, relativePath)) {
      const resolution = resolveCounterpart(
        importedModule.specifier,
        repositoryRoot,
      );
      if (!resolution.found) {
        violations.push({ ...importedModule, ...resolution });
      }
    }
  }

  return violations.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.column - right.column ||
      left.specifier.localeCompare(right.specifier),
  );
}

function displayCandidate(candidate, repositoryRoot) {
  return toPosixPath(path.relative(repositoryRoot, candidate));
}

export function formatViolations(violations, repositoryRoot = REPOSITORY_ROOT) {
  const lines = ["EE import counterpart guard failed:"];

  for (const violation of violations) {
    const expected =
      violation.candidates.length > 0
        ? violation.candidates
            .map((candidate) => displayCandidate(candidate, repositoryRoot))
            .join(", ")
        : `${COUNTERPART_ROOT}/<safe-module-subpath>`;
    lines.push(
      `- ${violation.filePath}:${violation.line} imports "${violation.specifier}"`,
      `  ${violation.reason}; expected one of: ${expected}`,
    );
  }

  return lines.join("\n");
}

function parseCliArguments(argumentsList) {
  if (argumentsList.length === 0) {
    return REPOSITORY_ROOT;
  }

  if (argumentsList.length === 2 && argumentsList[0] === "--repo-root") {
    return path.resolve(argumentsList[1]);
  }

  throw new Error(
    "Usage: node scripts/check-ee-import-counterparts.mjs [--repo-root <path>]",
  );
}

export function runCli(argumentsList = process.argv.slice(2)) {
  const repositoryRoot = parseCliArguments(argumentsList);
  const violations = findEeImportCounterpartViolations(repositoryRoot);

  if (violations.length > 0) {
    console.error(formatViolations(violations, repositoryRoot));
    return 1;
  }

  console.log(
    `EE import counterpart guard passed (${discoverSourceFiles(repositoryRoot).length} production source files checked).`,
  );
  return 0;
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
