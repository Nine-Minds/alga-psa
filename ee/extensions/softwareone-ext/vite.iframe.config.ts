import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [],
  esbuild: { jsx: 'transform' },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}'
  },
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
      // Bundle React and router into the iframe to avoid host-provided externals
      external: [],
      output: {
        format: 'es',
        // Force a truly single-file bundle
        inlineDynamicImports: true,
        entryFileNames: () => 'main.js',
        chunkFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
        assetFileNames: (assetInfo) => `${assetInfo.name ?? '[name]'}[extname]`,
      },
    },
    // Emit to ui/dist/iframe/main.js so index.html can import "./dist/iframe/main.js"
    outDir: 'ui/dist/iframe',
    emptyOutDir: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      // Force a single React and ReactDOM instance across app and UI kit
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@alga/ui-kit': path.resolve(__dirname, '..', '..', 'server', 'packages', 'ui-kit', 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
