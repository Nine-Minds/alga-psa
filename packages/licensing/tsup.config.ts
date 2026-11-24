import { defineConfig } from 'tsup';
import { makeConfig } from '../build-tools/tsup-preset';

export default defineConfig(makeConfig({
  external: ['knex'],
  addJsExtensions: true,
}));
