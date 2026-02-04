import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [],
  esbuild: { jsx: 'transform' },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/iframe/main.tsx'),
      formats: ['es'],
      fileName: () => 'main.js',
      name: 'ui-kit-showcase-iframe',
    },
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          /node_modules\/\@radix-ui\//.test(String((warning as any).id || '')) &&
          String(warning.message || '').includes('"use client"')
        ) {
          return;
        }
        defaultHandler(warning);
      },
      external: [],
      output: {
        format: 'es',
        inlineDynamicImports: true,
        entryFileNames: () => 'main.js',
        chunkFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
        assetFileNames: (assetInfo) => `${assetInfo.name ?? '[name]'}[extname]`,
      },
    },
    outDir: 'ui/dist/iframe',
    emptyOutDir: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@alga/ui-kit': path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'ui-kit', 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
