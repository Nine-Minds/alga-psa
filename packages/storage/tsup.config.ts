import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    StorageService: 'src/StorageService.ts',
    StorageProviderFactory: 'src/StorageProviderFactory.ts',
    'types/storage': 'src/types/storage.ts',
    'providers/StorageProvider': 'src/providers/StorageProvider.ts',
    'config/storage': 'src/config/storage.ts',
  },
  format: ['esm'],
  dts: false,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\//,
  ],
});
