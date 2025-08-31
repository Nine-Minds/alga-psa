import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [],
  esbuild: { jsx: 'automatic' },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/iframe/main.tsx'),
      formats: ['es'],
      fileName: () => 'main.js',
      name: 'softwareone-iframe-app',
    },
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          /node_modules\/@radix-ui\//.test(String((warning as any).id || '')) &&
          String(warning.message || '').includes('"use client"')
        ) {
          return;
        }
        defaultHandler(warning);
      },
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router-dom',
      ],
      output: {
        format: 'es',
        entryFileNames: () => 'main.js',
        chunkFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
        assetFileNames: (assetInfo) => `${assetInfo.name ?? '[name]'}[extname]`,
      },
    },
    outDir: 'ui',
    emptyOutDir: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      'react': path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
      '@alga/ui-kit': path.resolve(__dirname, '..', '..', 'server', 'packages', 'ui-kit', 'src'),
    },
  },
});
