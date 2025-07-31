import { minify } from 'terser';
import fs from 'fs';
import path from 'path';

async function buildMinified() {
  console.log('Building minified version with source map...');
  
  // Read the original source
  const originalCode = fs.readFileSync('test-debug-simple.js', 'utf8');
  
  // Minify with source map
  const result = await minify(originalCode, {
    sourceMap: {
      filename: 'test-debug-minified.js',
      url: 'test-debug-minified.js.map'
    },
    compress: {
      drop_console: false, // Keep console logs for debugging
      drop_debugger: false
    },
    mangle: {
      toplevel: true,
      reserved: ['testFunction'] // Keep function name for testing
    },
    format: {
      comments: false
    }
  });
  
  if (result.error) {
    console.error('Minification error:', result.error);
    process.exit(1);
  }
  
  // Write minified code
  fs.writeFileSync('test-debug-minified.js', result.code);
  console.log('Written: test-debug-minified.js');
  
  // Write source map
  if (result.map) {
    const sourceMap = JSON.parse(result.map);
    sourceMap.sources = ['test-debug-simple.js'];
    sourceMap.sourcesContent = [originalCode];
    fs.writeFileSync('test-debug-minified.js.map', JSON.stringify(sourceMap));
    console.log('Written: test-debug-minified.js.map');
  }
  
  console.log('Build complete!');
}

buildMinified().catch(console.error);