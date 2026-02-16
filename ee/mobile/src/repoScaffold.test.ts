import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string | undefined>;
  dependencies?: Record<string, string | undefined>;
  devDependencies?: Record<string, string | undefined>;
};

function mobileRootDir(): string {
  // `mobile/src/*` -> `mobile/`
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

describe("mobile repo scaffold", () => {
  it("keeps a reproducible Expo dev workflow wired up", async () => {
    const root = mobileRootDir();
    const pkg = await readJsonFile<PackageJson>(path.join(root, "package.json"));

    expect(pkg.name).toBe("mobile");
    expect(pkg.dependencies?.expo).toBeDefined();

    const scripts = pkg.scripts ?? {};
    expect(scripts.start).toBeDefined();
    expect(scripts.ios).toBeDefined();
    expect(scripts.android).toBeDefined();
    expect(scripts.lint).toBeDefined();
    expect(scripts.typecheck).toBeDefined();
    expect(scripts.test).toBeDefined();
  });

  it("declares the deep link scheme used by auth handoff and ticket links", async () => {
    const root = mobileRootDir();
    const appJson = await readJsonFile<any>(path.join(root, "app.json"));
    expect(appJson?.expo?.scheme).toBe("alga");
  });

  it("documents local dev entrypoints", async () => {
    const root = mobileRootDir();
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    expect(readme).toMatch(/npm run start/i);
    expect(readme).toMatch(/eas build/i);
  });
});
