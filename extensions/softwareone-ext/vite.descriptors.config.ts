import { defineConfig } from 'vite';
import path from 'path';
import { glob } from 'glob';
import fs from 'fs';

// Plugin to copy and validate descriptors
function descriptorPlugin() {
  return {
    name: 'descriptor-plugin',
    async buildStart() {
      // Find all descriptor JSON files
      const descriptorFiles = glob.sync('src/descriptors/**/*.json');
      
      for (const file of descriptorFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        try {
          JSON.parse(content); // Validate JSON
          const outputPath = file.replace('src/', '');
          this.emitFile({
            type: 'asset',
            fileName: outputPath,
            source: content
          });
        } catch (error) {
          this.error(`Invalid JSON in ${file}: ${error.message}`);
        }
      }
    }
  };
}

// Find all handler modules
const handlerEntries = glob.sync('src/descriptors/handlers/**/*.ts').reduce((acc, file) => {
  const name = file.replace('src/', '').replace(/\.ts$/, '');
  acc[name] = path.resolve(__dirname, file);
  return acc;
}, {});

export default defineConfig({
  plugins: [descriptorPlugin()],
  build: {
    lib: {
      entry: handlerEntries,
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        // External dependencies that should not be bundled
        '@/lib/extensions/ui/descriptors/types',
        'react',
        'react-dom',
        'next/navigation',
        'next/router'
      ],
      output: {
        format: 'es',
        // Export as ES modules
        exports: 'named',
        // Keep the directory structure
        preserveModules: true,
        preserveModulesRoot: 'src'
      },
    },
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: false, // Don't empty, we're building multiple configs
    minify: false, // Keep readable for debugging
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../server/src')
    }
  }
});