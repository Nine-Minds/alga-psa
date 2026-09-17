/**
 * Regenerates src/ui/themeMath.fixture.json from the web theme implementation.
 *
 * The mobile bundle cannot import @alga-psa/tenancy, so ee/mobile/src/ui/themeMath.ts
 * is a copy of the ramp maths. This script bundles the real web module
 * (packages/tenancy/src/lib/customTheme.ts), asks it for the CSS it generates
 * for every preset in both modes, and records the ramps it emitted. The unit
 * test replays the port against those numbers, so drift on either side fails.
 *
 * Usage: node scripts/generate-theme-fixture.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "../..");
const customThemePath = path.join(repoRoot, "packages/tenancy/src/lib/customTheme.ts");
const fixturePath = path.join(projectRoot, "src/ui/themeMath.fixture.json");

const bundle = await build({
  entryPoints: [customThemePath],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: ["node18"],
});

const source = bundle.outputFiles[0]?.text ?? "";
const webTheme = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { CUSTOM_THEME_PRESETS, generateCustomThemeStyles } = webTheme;

const RAMPS = ["border", "primary", "secondary", "accent"];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const tripleToHex = (triple) =>
  `#${triple
    .trim()
    .split(/\s+/)
    .map((value) => Number(value).toString(16).padStart(2, "0"))
    .join("")}`;

/** Pull `--color-<name>-<shade>` out of one `html.<mode>[…] { … }` block. */
function readRamps(css, mode) {
  const blockMatch = new RegExp(`html\\.${mode}\\[data-theme-pair="custom"\\] \\{([\\s\\S]*?)\\n    \\}`).exec(css);
  if (!blockMatch) throw new Error(`No ${mode} block in generated CSS`);
  const block = blockMatch[1];

  const ramps = {};
  for (const name of RAMPS) {
    ramps[name === "border" ? "neutral" : name] = SHADES.map((shade) => {
      const match = new RegExp(`--color-${name}-${shade}:\\s*([^;]+);`).exec(block);
      if (!match) throw new Error(`Missing --color-${name}-${shade} in ${mode} block`);
      return tripleToHex(match[1]);
    });
  }
  return ramps;
}

const presets = {};
for (const [pairId, pair] of Object.entries(CUSTOM_THEME_PRESETS)) {
  // generateCustomThemeStyles runs both modes through the same modeBlock the
  // predefined pairs are generated with, so feeding it a preset yields that
  // preset's ramps.
  const css = generateCustomThemeStyles(pair);
  presets[pairId] = {
    // Seed tokens live here rather than in a .ts file so the app binary keeps
    // shipping the Alga palette only; the tests read the other eight from here.
    tokens: { light: pair.light, dark: pair.dark },
    light: readRamps(css, "light"),
    dark: readRamps(css, "dark"),
  };
}

const fixture = {
  generatedBy: "ee/mobile/scripts/generate-theme-fixture.mjs",
  generatedFrom: "packages/tenancy/src/lib/customTheme.ts",
  shades: SHADES,
  presets,
};

await fs.writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(projectRoot, fixturePath)} for ${Object.keys(presets).length} presets`);
