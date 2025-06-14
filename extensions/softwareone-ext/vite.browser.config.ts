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
      // Mark React and ReactDOM as external - they'll be provided by the host
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      output: {
        format: 'es',
        // Use import maps to resolve React from the global scope
        paths: {
          'react': 'https://esm.sh/react@18',
          'react-dom': 'https://esm.sh/react-dom@18',
          'react/jsx-runtime': 'https://esm.sh/react@18/jsx-runtime',
          'react/jsx-dev-runtime': 'https://esm.sh/react@18/jsx-dev-runtime'
        }
      },
    },
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
});