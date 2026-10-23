import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as lib from './index';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('ee-threecx package scaffold', () => {
  it('T025: lib exports the provider-state functions and route constants', () => {
    expect(typeof lib.getThreecxProviderState).toBe('function');
    expect(typeof lib.activateThreecxProvider).toBe('function');
    expect(typeof lib.deactivateThreecxProvider).toBe('function');
    expect(typeof lib.rotateThreecxApiKey).toBe('function');
    expect(typeof lib.setThreecxAutoCreateTickets).toBe('function');
    expect(lib.THREECX_ROUTE_SEGMENTS).toBeDefined();
    expect(lib.THREECX_QUERY_PARAMS).toBeDefined();
  });

  it('T026: next.config aliases @alga-psa/ee-threecx to the package on EE and the stub on CE', () => {
    const nextConfig = fs.readFileSync(path.join(repoRoot, 'server/next.config.mjs'), 'utf8');
    expect(nextConfig).toContain("'@alga-psa/ee-threecx': isEE ? '../ee/packages/threecx/src/index.ts' : '../packages/ee/src/index.ts'");
    expect(nextConfig).toContain("../ee/packages/threecx/src");
    expect(nextConfig).toContain("path.join(__dirname, '../packages/ee/src')");
  });

  it('T027: tsconfig paths carry @alga-psa/ee-threecx and @alga-psa/ee-threecx/*', () => {
    const tsconfig = fs.readFileSync(path.join(repoRoot, 'server/tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('"@alga-psa/ee-threecx"');
    expect(tsconfig).toContain('"@alga-psa/ee-threecx/*"');
    expect(tsconfig).toContain('../ee/packages/threecx/src/index.ts');
  });
});
