import { defineConfig } from 'vite';
import path from 'path';
import { glob } from 'glob';

// Find component and page files to be used as entry points
const entries = glob.sync('src/{components,pages}/**/*.{ts,tsx}').reduce((acc, file) => {
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
