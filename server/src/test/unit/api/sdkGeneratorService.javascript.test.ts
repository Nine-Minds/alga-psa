import { beforeAll, describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import {
  SdkGeneratorService,
  type GeneratedSdk,
  type SdkGenerationConfig,
} from '../../../lib/api/services/SdkGeneratorService';

const config: SdkGenerationConfig = {
  language: 'javascript',
  packageName: 'alga-psa-sdk',
  version: '1.0.0',
  outputFormat: 'zip',
  includeExamples: true,
};

describe('SdkGeneratorService JavaScript SDK', () => {
  let sdk: GeneratedSdk;

  beforeAll(async () => {
    sdk = await SdkGeneratorService.generateJavaScriptSdk(config);
  });

  it('emits JavaScript files that parse as CommonJS', () => {
    const jsFiles = Object.entries(sdk.files).filter(([filePath]) => filePath.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const [filePath, content] of jsFiles) {
      expect(() => new Script(content, { filename: filePath }), `${filePath} must compile`).not.toThrow();
      expect(content, `${filePath} must not keep ESM exports`).not.toMatch(/^export /m);
    }
  });

  it('keeps runtime values the old regex conversion destroyed', () => {
    const client = sdk.files['src/client.js'];
    expect(client).toContain("config.baseUrl || 'https://algapsa.com'");
    expect(client).toContain('exports.AlgaPSAClient = AlgaPSAClient');
    // Multi-line object type annotations used to survive as `: {` fragments.
    expect(client).not.toContain(': {');
    expect(sdk.files['src/resources/teams.js']).not.toContain('private http');
  });

  it('declares CommonJS and ships the entry points its manifest promises', () => {
    const pkg = JSON.parse(sdk.files['package.json']);
    expect(pkg.type).toBe('commonjs');
    expect(sdk.files[pkg.main]).toBeTypeOf('string');
    expect(sdk.files[pkg.types]).toBeTypeOf('string');
    expect(sdk.files['src/index.d.ts']).toContain("export { AlgaPSAClient } from './client'");
    expect(sdk.files['src/client.d.ts']).toContain('export declare class AlgaPSAClient');
    expect(sdk.files['src/types/index.d.ts']).toContain('export interface Team');
  });

  it('leaves the TypeScript SDK sources untouched', async () => {
    const tsSdk = await SdkGeneratorService.generateTypeScriptSdk({ ...config, language: 'typescript' });

    expect(tsSdk.files['src/client.ts']).toContain('export interface AlgaPSAClientConfig');
    expect(tsSdk.files['src/client.ts']).toContain('private httpClient: HttpClient;');
    expect(tsSdk.files['src/index.ts']).toContain("export * from './types';");
    expect(JSON.parse(tsSdk.files['package.json'])).toMatchObject({
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
    });
    expect(JSON.parse(tsSdk.files['package.json']).type).toBeUndefined();
  });
});
