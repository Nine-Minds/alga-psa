import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: __dirname,
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
    server: {
      deps: {
        inline: ['@alga/ui-kit'],
      },
    },
    deps: {
      optimizer: {
        web: {
          enabled: false,
        },
      },
    },
  },
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: true,
  },
});
