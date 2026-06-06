import { defineConfig } from 'tsup';

// Bundle the connector for npx distribution: inline the private @alga-psa/*
// workspace deps (agent-tooling) so the published package only needs the
// public MCP SDK at runtime. Shebang is injected here (not in source) so the
// built bin is directly executable.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  bundle: true,
  noExternal: [/^@alga-psa\//],
  external: ['@modelcontextprotocol/sdk'],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: false,
  dts: false,
});
