import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import YAML from 'yaml';

const repoRoot = path.resolve(__dirname, '../../../../..');
const digest = (content: string) => createHash('sha256').update(content).digest('hex');

it.each(['ce', 'ee'])('reproduces the published %s OpenAPI artifacts', (edition) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-openapi-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'node_modules/vite-node/vite-node.mjs'),
      '--config', 'server/vitest.config.ts',
      'sdk/scripts/generate-openapi.ts', '--',
      '--edition', edition, '--output', outputDir,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 90_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const baseNames = [`alga-openapi.${edition}`];
    if (edition === 'ce') baseNames.push('alga-openapi');
    for (const baseName of baseNames) {
      const generatedJson = fs.readFileSync(path.join(outputDir, `${baseName}.json`), 'utf8');
      const generatedYaml = fs.readFileSync(path.join(outputDir, `${baseName}.yaml`), 'utf8');
      expect(YAML.parse(generatedYaml)).toEqual(JSON.parse(generatedJson));
      for (const [format, generated] of [['json', generatedJson], ['yaml', generatedYaml]]) {
        const filename = `${baseName}.${format}`;
        const published = fs.readFileSync(path.join(repoRoot, 'sdk/docs/openapi', filename), 'utf8');
        // Hash the artifact bytes so a formatting-only drift has a concise failure.
        expect(digest(published), `${filename}: run npm run generate:artifacts and commit the output`)
          .toBe(digest(generated));
      }
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 120_000);

it('reproduces the published CE and EE MCP registries from the OpenAPI artifacts', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-mcp-registry-'));
  const registryPaths = [
    'server/src/lib/mcp/registry.generated.ts',
    'ee/server/src/chat/registry/apiRegistry.generated.ts',
  ];
  try {
    // The CLI resolves its inputs and outputs relative to its own location.
    // Give it an isolated repository layout so this test never rewrites the checkout.
    for (const relativePath of [
      'ee/scripts/generate-chat-registry.mjs',
      'ee/docs/api-registry',
      'sdk/docs/openapi/alga-openapi.ce.json',
      'sdk/docs/openapi/alga-openapi.ee.json',
    ]) {
      const destination = path.join(temporaryRoot, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(path.join(repoRoot, relativePath), destination, { recursive: true });
    }

    const env = { ...process.env };
    delete env.MCP_REGISTRY_EDITION;
    const result = spawnSync(process.execPath, ['ee/scripts/generate-chat-registry.mjs'], {
      cwd: temporaryRoot, env, encoding: 'utf8', timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    for (const relativePath of registryPaths) {
      const generated = fs.readFileSync(path.join(temporaryRoot, relativePath), 'utf8');
      const published = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      expect(digest(published), `${relativePath}: run npm run generate:artifacts and commit the output`)
        .toBe(digest(generated));
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
