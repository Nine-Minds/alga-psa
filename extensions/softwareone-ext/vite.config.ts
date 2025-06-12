import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@swone/api': path.resolve(__dirname, './src/api'),
      '@swone/components': path.resolve(__dirname, './src/components'),
      '@swone/handlers': path.resolve(__dirname, './src/handlers'),
      '@swone/hooks': path.resolve(__dirname, './src/hooks'),
      '@swone/pages': path.resolve(__dirname, './src/pages'),
      '@swone/services': path.resolve(__dirname, './src/services'),
      '@swone/types': path.resolve(__dirname, './src/types'),
      '@swone/utils': path.resolve(__dirname, './src/utils'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'SoftwareOneExtension',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'js'}`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-router-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-router-dom': 'ReactRouterDOM',
        },
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
});