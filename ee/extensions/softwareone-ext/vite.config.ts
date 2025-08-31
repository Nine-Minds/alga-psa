import { defineConfig } from 'vite';
import path from 'path';
import { glob } from 'glob';

// Find component, page, and iframe files to be used as entry points
const entries = glob.sync('src/{components,pages,iframe}/**/*.{ts,tsx}').reduce((acc, file) => {
  const name = file.replace('src/', '').replace(/\.tsx?$/, '');
  acc[name] = path.resolve(__dirname, file);
  return acc;
}, {});

export default defineConfig({
  plugins: [],
  esbuild: {
    jsx: 'automatic',
  },
  build: {
    lib: {
      entry: entries,
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // Silence Radix "use client" module-level directive warnings
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          /node_modules\/@radix-ui\//.test(String((warning as any).id || '')) &&
          String(warning.message || '').includes('"use client"')
        ) {
          return;
        }
        defaultHandler(warning);
      },
      // Leave common libs to the host app to avoid duplicate React instances
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router-dom',
        'formik',
        'yup',
        '@tanstack/react-query',
      ],
      output: {
        format: 'es',
        // Force .js extensions for entries and chunks (avoid .mjs)
        entryFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
        chunkFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
        assetFileNames: (assetInfo) => `${assetInfo.name ?? '[name]'}[extname]`,
        // Don't inline dynamic imports with multiple entries
        inlineDynamicImports: false,
      },
    },
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // Ensure we use the same React instance
      'react': path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
      // Resolve local UI kit source without publishing/installing
      '@alga/ui-kit': path.resolve(__dirname, '..', '..', 'server', 'packages', 'ui-kit', 'src'),
    }
  }
});
