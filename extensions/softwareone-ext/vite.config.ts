import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { glob } from 'glob';

// Find all component and page files to be used as entry points
const entries = glob.sync('src/{components,pages}/**/*.{ts,tsx}').reduce((acc, file) => {
  // Create a name for the entry point based on the file path
  // e.g., src/components/NavItem.tsx -> components/NavItem
  const name = file.replace('src/', '').replace(/\.tsx?$/, '');
  acc[name] = path.resolve(__dirname, file);
  return acc;
}, {});

export default defineConfig({
  plugins: [react()],
  build: {
    // Although we have multiple entry points, we use library mode to ensure
    // that Vite generates clean ES modules with correct default exports
    // that are compatible with React.lazy().
    lib: {
     entry: entries,
     formats: ['es'],
     fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // Externalize React to avoid bundling it, as it's provided by the host app.
      external: ['react', 'react-dom'],
      output: {
        // Output each component as a separate ES module file.
        entryFileNames: '[name].js',
        format: 'es',
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
});