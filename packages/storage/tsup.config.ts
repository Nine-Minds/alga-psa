import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    StorageService: 'src/StorageService.ts',
    fileUploadTransaction: 'src/fileUploadTransaction.ts',
    StorageProviderFactory: 'src/StorageProviderFactory.ts',
    'models/storage': 'src/models/storage.ts',
    'types/storage': 'src/types/storage.ts',
    'providers/StorageProvider': 'src/providers/StorageProvider.ts',
    'providers/S3StorageProvider': 'src/providers/S3StorageProvider.ts',
    'config/storage': 'src/config/storage.ts',
    'ingest/bufferedCap': 'src/ingest/bufferedCap.ts',
    'ingest/errors': 'src/ingest/errors.ts',
    'ingest/pipeline': 'src/ingest/pipeline.ts',
    'ingest/mime': 'src/ingest/mime.ts',
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
