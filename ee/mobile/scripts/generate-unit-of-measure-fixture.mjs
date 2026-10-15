/**
 * Regenerates src/features/inventory/unitOfMeasure.fixture.json from the web
 * unit-of-measure vocabulary.
 *
 * The mobile bundle cannot import @alga-psa/core, so
 * ee/mobile/src/features/inventory/unitOfMeasure.ts copies the product units.
 * This script bundles the real module (packages/core/src/lib/unitOfMeasure.ts)
 * and records its count-kind units and product default. The unit test compares
 * the port against those values, so drift on either side fails.
 *
 * Usage: node scripts/generate-unit-of-measure-fixture.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "../..");
const unitOfMeasurePath = path.join(repoRoot, "packages/core/src/lib/unitOfMeasure.ts");
const fixturePath = path.join(projectRoot, "src/features/inventory/unitOfMeasure.fixture.json");

const bundle = await build({
  entryPoints: [unitOfMeasurePath],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: ["node18"],
});

const source = bundle.outputFiles[0]?.text ?? "";
const web = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const fixture = {
  generatedBy: "ee/mobile/scripts/generate-unit-of-measure-fixture.mjs",
  generatedFrom: "packages/core/src/lib/unitOfMeasure.ts",
  productDefault: web.defaultUnitForKind("product"),
  countUnits: web.unitOfMeasureVocabulary
    .filter((unit) => unit.kind === "count")
    .map(({ key, code, label, labelKey }) => ({ key, code, label, labelKey })),
};

await fs.writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${path.relative(repoRoot, fixturePath)}`);
