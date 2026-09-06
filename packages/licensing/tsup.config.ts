import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

// Keep runtime licensing and Next.js actions as separate entries.
export default defineConfig(makeConfig({ addJsExtensions: true }));
