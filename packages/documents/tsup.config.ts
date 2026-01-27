import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/models/handlers/storage/cache/config code only
    // Actions and components are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    // Lib (avatarUtils and entityImageService are runtime-only, not built here)
    'lib/documentUtils': 'src/lib/documentUtils.ts',
    'lib/documentPermissionUtils': 'src/lib/documentPermissionUtils.ts',
    'lib/documentPreviewGenerator': 'src/lib/documentPreviewGenerator.ts',
    'lib/blocknoteUtils': 'src/lib/blocknoteUtils.ts',
    // Models
    'models/index': 'src/models/index.ts',
    'models/document': 'src/models/document.ts',
    'models/documentAssociation': 'src/models/documentAssociation.ts',
    'models/storage': 'src/models/storage.ts',
    // Handlers
    'handlers/index': 'src/handlers/index.ts',
    'handlers/BaseDocumentHandler': 'src/handlers/BaseDocumentHandler.ts',
    'handlers/BlockNoteDocumentHandler': 'src/handlers/BlockNoteDocumentHandler.ts',
    'handlers/DocumentHandlerRegistry': 'src/handlers/DocumentHandlerRegistry.ts',
    'handlers/DocumentTypeHandler': 'src/handlers/DocumentTypeHandler.ts',
    'handlers/GenericFileDocumentHandler': 'src/handlers/GenericFileDocumentHandler.ts',
    'handlers/ImageDocumentHandler': 'src/handlers/ImageDocumentHandler.ts',
    'handlers/MarkdownDocumentHandler': 'src/handlers/MarkdownDocumentHandler.ts',
    'handlers/OfficeDocumentHandler': 'src/handlers/OfficeDocumentHandler.ts',
    'handlers/PDFDocumentHandler': 'src/handlers/PDFDocumentHandler.ts',
    'handlers/TextDocumentHandler': 'src/handlers/TextDocumentHandler.ts',
    'handlers/VideoDocumentHandler': 'src/handlers/VideoDocumentHandler.ts',
    // Storage
    'storage/StorageProviderFactory': 'src/storage/StorageProviderFactory.ts',
    'storage/StorageService': 'src/storage/StorageService.ts',
    'storage/providers/LocalStorageProvider': 'src/storage/providers/LocalStorageProvider.ts',
    'storage/providers/StorageProvider': 'src/storage/providers/StorageProvider.ts',
    'storage/api/index': 'src/storage/api/index.ts',
    'storage/api/errors': 'src/storage/api/errors.ts',
    'storage/api/service': 'src/storage/api/service.ts',
    'storage/api/types': 'src/storage/api/types.ts',
    // Cache
    'cache/CacheFactory': 'src/cache/CacheFactory.ts',
    'cache/PreviewCacheProvider': 'src/cache/PreviewCacheProvider.ts',
    // Config
    'config/storage': 'src/config/storage.ts',
    // Types
    'types/storage': 'src/types/storage.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    // All @alga-psa packages should be external (resolved at runtime)
    /^@alga-psa\/.*/,
    '@blocknote/core',
    '@blocknote/react',
    'knex',
    'uuid',
    'zod',
    'react',
    'react-dom',
    'sharp',
    'fs',
    'path',
    'crypto',
    'os',
    'pdf-lib',
    'pdf2pic',
    'marked',
    'typescript',
    'source-map',
    'source-map-support',
    // pdf2pic transitive dependencies
    'gm',
    'graphicsmagick-static',
    'bidi-js',
    'tar-fs',
    'yargs',
  ],
});
