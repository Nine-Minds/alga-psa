import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/inboundRequesterReply.ts'], format: ['esm'], dts: false, clean: true });
