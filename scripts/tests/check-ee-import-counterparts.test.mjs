import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectEeImports,
  discoverSourceFiles,
  resolveCounterpart,
  validateEeSpecifier,
} from "../check-ee-import-counterparts.mjs";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../check-ee-import-counterparts.mjs",
);

function createFixture(t) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "ee-import-counterparts-"),
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  return fixtureRoot;
}

function writeFixtureFile(
  fixtureRoot,
  relativePath,
  contents = "export {};\n",
) {
  const absolutePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function runFixture(fixtureRoot) {
  return spawnSync(process.execPath, [scriptPath, "--repo-root", fixtureRoot], {
    encoding: "utf8",
  });
}

test("collects static, type, side-effect, re-export, and literal dynamic imports with locations", () => {
  const source = [
    "import value from '@ee/exact';",
    "import type { TypeOnly } from '@ee/type-only';",
    "import legacy = require('@ee/import-equals');",
    "type Imported = import('@ee/import-type').Imported;",
    "import '@ee/side-effect';",
    "export { value } from '@ee/re-export';",
    "export * from '@ee/export-all';",
    "const loaded = import('@ee/dynamic');",
    "const literalTemplate = import(`@ee/template`);",
    "const ignoredDynamic = import('@ee/' + value);",
    'const ignoredString = "@ee/not-an-import";',
    "// import '@ee/comment';",
  ].join("\n");

  assert.deepEqual(
    collectEeImports(source, "server/src/example.ts").map(
      ({ kind, line, specifier }) => ({ kind, line, specifier }),
    ),
    [
      { kind: "import", line: 1, specifier: "@ee/exact" },
      { kind: "import", line: 2, specifier: "@ee/type-only" },
      { kind: "import-equals", line: 3, specifier: "@ee/import-equals" },
      { kind: "import-type", line: 4, specifier: "@ee/import-type" },
      { kind: "import", line: 5, specifier: "@ee/side-effect" },
      { kind: "export", line: 6, specifier: "@ee/re-export" },
      { kind: "export", line: 7, specifier: "@ee/export-all" },
      { kind: "dynamic-import", line: 8, specifier: "@ee/dynamic" },
      { kind: "dynamic-import", line: 9, specifier: "@ee/template" },
    ],
  );
});

test("discovers only CE-shipped production source", (t) => {
  const fixtureRoot = createFixture(t);
  writeFixtureFile(fixtureRoot, "server/src/live.ts");
  writeFixtureFile(fixtureRoot, "server/src/app/api/connection/test/route.ts");
  writeFixtureFile(fixtureRoot, "shared/live.tsx");
  writeFixtureFile(fixtureRoot, "packages/example/src/live.js");
  writeFixtureFile(fixtureRoot, "packages/ee/src/ignored.ts");
  writeFixtureFile(fixtureRoot, "packages/example/src/feature/ee/entry.ts");
  writeFixtureFile(fixtureRoot, "packages/product-example/ee/entry.ts");
  writeFixtureFile(fixtureRoot, "server/src/example.test.ts");
  writeFixtureFile(fixtureRoot, "server/src/example.spec.tsx");
  writeFixtureFile(fixtureRoot, "server/src/types.d.ts");
  writeFixtureFile(fixtureRoot, "server/src/__tests__/ignored.ts");
  writeFixtureFile(fixtureRoot, "server/src/lib/testing/ignored.ts");
  writeFixtureFile(fixtureRoot, "server/test-utils/ignored.ts");
  writeFixtureFile(fixtureRoot, "shared/fixtures/ignored.ts");
  writeFixtureFile(fixtureRoot, "packages/example/src/test-utils/ignored.ts");
  writeFixtureFile(fixtureRoot, "packages/example/generated/ignored.ts");
  writeFixtureFile(fixtureRoot, "packages/example/dist/ignored.js");
  writeFixtureFile(fixtureRoot, "packages/example/src/registry.generated.ts");

  assert.deepEqual(discoverSourceFiles(fixtureRoot), [
    "packages/example/src/live.js",
    "server/src/app/api/connection/test/route.ts",
    "server/src/live.ts",
    "shared/live.tsx",
  ]);
});

test("resolves exact files and directory indexes without allowing traversal-like subpaths", (t) => {
  const fixtureRoot = createFixture(t);
  writeFixtureFile(fixtureRoot, "packages/ee/src/exact.ts");
  writeFixtureFile(fixtureRoot, "packages/ee/src/directory/index.tsx");

  assert.equal(resolveCounterpart("@ee/exact", fixtureRoot).found, true);
  assert.equal(resolveCounterpart("@ee/directory", fixtureRoot).found, true);
  assert.equal(validateEeSpecifier("@ee/../outside").valid, false);
  assert.equal(validateEeSpecifier("@ee/nested/../../outside").valid, false);
  assert.equal(validateEeSpecifier("@ee//outside").valid, false);
  assert.deepEqual(
    resolveCounterpart("@ee/../outside", fixtureRoot).candidates,
    [],
  );
});

test("CLI exits zero for a complete production tree", (t) => {
  const fixtureRoot = createFixture(t);
  writeFixtureFile(
    fixtureRoot,
    "server/src/imports.ts",
    [
      "import value from '@ee/exact';",
      "import '@ee/side-effect';",
      "export { value } from '@ee/re-export';",
      "const loaded = import('@ee/dynamic');",
    ].join("\n"),
  );
  writeFixtureFile(fixtureRoot, "packages/ee/src/exact.ts");
  writeFixtureFile(fixtureRoot, "packages/ee/src/side-effect/index.ts");
  writeFixtureFile(fixtureRoot, "packages/ee/src/re-export.tsx");
  writeFixtureFile(fixtureRoot, "packages/ee/src/dynamic.js");

  const result = runFixture(fixtureRoot);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EE import counterpart guard passed/);
});

test("CLI exits nonzero and reports every missing or malformed import deterministically", (t) => {
  const fixtureRoot = createFixture(t);
  writeFixtureFile(
    fixtureRoot,
    "server/src/z-imports.ts",
    [
      "import '@ee/missing-side-effect';",
      "export * from '@ee/missing-export';",
      "const loaded = import('@ee/missing-dynamic');",
      "type Missing = import('@ee/missing-type').Missing;",
      "import value from '@ee/../escape';",
    ].join("\n"),
  );
  writeFixtureFile(
    fixtureRoot,
    "shared/a-import.ts",
    "import value from '@ee/missing-static';\n",
  );

  const result = runFixture(fixtureRoot);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /shared\/a-import\.ts:1 imports "@ee\/missing-static"/,
  );
  assert.match(
    result.stderr,
    /server\/src\/z-imports\.ts:1 imports "@ee\/missing-side-effect"/,
  );
  assert.match(
    result.stderr,
    /server\/src\/z-imports\.ts:2 imports "@ee\/missing-export"/,
  );
  assert.match(
    result.stderr,
    /server\/src\/z-imports\.ts:3 imports "@ee\/missing-dynamic"/,
  );
  assert.match(
    result.stderr,
    /server\/src\/z-imports\.ts:4 imports "@ee\/missing-type"/,
  );
  assert.match(
    result.stderr,
    /server\/src\/z-imports\.ts:5 imports "@ee\/\.\.\/escape"/,
  );
  assert.ok(
    result.stderr.indexOf("server/src/z-imports.ts") <
      result.stderr.indexOf("shared/a-import.ts"),
    result.stderr,
  );
  assert.match(result.stderr, /packages\/ee\/src\/missing-static\.ts/);
  assert.match(result.stderr, /packages\/ee\/src\/<safe-module-subpath>/);
});
