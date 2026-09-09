import { defineConfig } from 'vitest/config';
import path from 'path';

// Linked UI-kit dependencies can require React natively. Use the workspace's
// renderer and testing library too, keeping native and transformed imports on
// one React instance. Install both lockfiles before running this suite.
const workspaceModules = path.resolve(__dirname, '../../../../node_modules');

export default defineConfig({
  root: __dirname,
  test: {
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
    server: {
      deps: {
        // The source UI kit is outside this sample's install. Transform its
        // React-using dependencies too so they share the sample's renderer.
        inline: true,
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
      '@alga/ui-kit': path.resolve(__dirname, '../../../../packages/ui-kit/src'),
      react: path.join(workspaceModules, 'react'),
      'react-dom': path.join(workspaceModules, 'react-dom'),
      '@testing-library/react': path.join(workspaceModules, '@testing-library/react'),
      'react/jsx-runtime': path.join(workspaceModules, 'react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(workspaceModules, 'react/jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: true,
  },
});
