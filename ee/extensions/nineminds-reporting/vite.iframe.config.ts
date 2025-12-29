import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/iframe/main.tsx'),
      formats: ['es'],
      fileName: () => 'main.js',
      name: 'nineminds-reporting-iframe',
    },
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // Suppress "use client" warnings from dependencies
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          String(warning.message || '').includes('"use client"')
        ) {
          return;
        }
        defaultHandler(warning);
      },
      // Bundle everything into a single file
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
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
