import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

// `addJsExtensions` keeps the built dist loadable by native Node ESM (the
// shared workflow runtime imports `@alga-psa/formatting/blocknoteUtils`).
export default defineConfig(makeConfig({ addJsExtensions: true }));
