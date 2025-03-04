// /**
//  * Bootstrap Script for Workflow Worker
//  * 
//  * This script sets up module resolution and then runs the main worker script.
//  */

// import { createRequire } from 'module';
// import { fileURLToPath } from 'url';
// import { dirname, resolve } from 'path';
// import { spawn } from 'child_process';

// // Set up __dirname equivalent for ES modules
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// // Create a require function
// const require = createRequire(import.meta.url);

// // Load module-alias
// const moduleAlias = require('module-alias');

// // Register module aliases
// moduleAlias.addAliases({
//   '@': resolve(__dirname, '../server/src'),
//   '@shared': resolve(__dirname, '../shared'),
//   '@server': resolve(__dirname, '../server/src'),
//   '@ee': resolve(__dirname, './src/placeholder')
// });

// console.log('[Bootstrap] Module aliases registered');
// console.log('[Bootstrap] Starting workflow worker...');

// // Run the main script
// const mainScript = resolve(__dirname, './dist/index.js');
// const child = spawn('node', [mainScript], { 
//   stdio: 'inherit',
//   env: process.env
// });

// // Forward signals to the child process
// process.on('SIGINT', () => child.kill('SIGINT'));
// process.on('SIGTERM', () => child.kill('SIGTERM'));

// // Handle child process exit
// child.on('exit', (code) => {
//   console.log(`[Bootstrap] Worker exited with code ${code}`);
//   process.exit(code);
// });