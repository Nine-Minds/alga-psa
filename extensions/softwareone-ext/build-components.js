import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { glob } from 'glob';
import fs from 'fs/promises';

// Custom plugin to wrap components for the extension system
const wrapComponentPlugin = () => {
  return {
    name: 'wrap-component',
    generateBundle(options, bundle) {
      Object.keys(bundle).forEach(fileName => {
        if (fileName.endsWith('.js') && bundle[fileName].type === 'chunk') {
          const chunk = bundle[fileName];
          
          // Wrap the component to work with the extension system
          chunk.code = `
// Extension-compatible wrapper
const Component = (() => {
  ${chunk.code}
  
  // Return the default export
  return NavItem || default;
})();

// Export as default for ES module compatibility
export default Component;
`;
        }
      });
    }
  };
};

// Find all component files
const componentFiles = glob.sync('src/components/**/*.tsx');

// Build each component separately
for (const file of componentFiles) {
  const name = path.basename(file, '.tsx');
  const outputPath = file.replace('src/', '').replace('.tsx', '.js');
  
  console.log(`Building ${name}...`);
  
  await build({
    plugins: [react(), wrapComponentPlugin()],
    build: {
      lib: {
        entry: path.resolve(file),
        formats: ['es'],
        fileName: () => name + '.js',
      },
      rollupOptions: {
        external: [],
        output: {
          inlineDynamicImports: true,
        }
      },
      outDir: path.dirname(`dist/${outputPath}`),
      emptyOutDir: false,
      minify: false,
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });
}

console.log('Build complete!');