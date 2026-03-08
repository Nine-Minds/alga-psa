import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AlgaPsaApi } from '../credentials/AlgaPsaApi.credentials';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');

describe('Package metadata and credential', () => {
  it('T001: package metadata follows n8n naming and built entry conventions', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const n8n = packageJson.n8n as Record<string, unknown>;

    expect(String(packageJson.name)).toMatch(/^n8n-nodes-/);
    expect(Array.isArray(n8n.nodes)).toBe(true);
    expect(Array.isArray(n8n.credentials)).toBe(true);
    expect((n8n.nodes as string[])[0]).toBe('dist/nodes/AlgaPsa/AlgaPsa.node.js');
    expect((n8n.credentials as string[])[0]).toBe('dist/credentials/AlgaPsaApi.credentials.js');
  });

  it('T002: build emits compiled node and credential artifacts without TS compile errors', () => {
    execSync('npm run build', {
      cwd: packageRoot,
      stdio: 'pipe',
    });

    expect(existsSync(path.join(packageRoot, 'dist/nodes/AlgaPsa/AlgaPsa.node.js'))).toBe(true);
    expect(existsSync(path.join(packageRoot, 'dist/nodes/AlgaPsa/avatar-purple.png'))).toBe(true);
    expect(existsSync(path.join(packageRoot, 'dist/credentials/AlgaPsaApi.credentials.js'))).toBe(true);
  });

  it('T003: credential definition exposes exactly baseUrl and secret apiKey fields', () => {
    const credential = new AlgaPsaApi();
    const fields = credential.properties.map((field) => field.name);

    expect(fields).toEqual(['baseUrl', 'apiKey']);
    expect(credential.properties[1]?.typeOptions).toMatchObject({ password: true });
  });
});
