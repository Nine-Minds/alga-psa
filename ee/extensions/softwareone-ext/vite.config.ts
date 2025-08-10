import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { glob } from 'glob';

// Find all component and page files to be used as entry points
const entries = glob.sync('src/{components,pages}/**/*.{ts,tsx}').reduce((acc, file) => {
  const name = file.replace('src/', '').replace(/\.tsx?$/, '');
  acc[name] = path.resolve(__dirname, file);
  return acc;
}, {});

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: entries,
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [],  // Bundle everything including React JSX runtime
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
    }
  }
});