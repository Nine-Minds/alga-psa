// // This is a Node.js loader script that resolves path aliases at runtime

// const { resolve, dirname } = require('path');
// const { fileURLToPath } = require('url');
// const Module = require('module');

// // Store the original require function
// const originalRequire = Module.prototype.require;

// // Create a function to resolve path aliases
// const resolvePathAliases = (path) => {
//   if (path.startsWith('@/')) {
//     return resolve(__dirname, '../../server/src', path.substring(2));
//   }
//   if (path.startsWith('@shared/')) {
//     return resolve(__dirname, '../../shared', path.substring(8));
//   }
//   if (path.startsWith('@server/')) {
//     return resolve(__dirname, '../../server/src', path.substring(8));
//   }
//   if (path.startsWith('@ee/')) {
//     return resolve(__dirname, 'placeholder', path.substring(4));
//   }
//   return path;
// };

// // Override the require function to handle path aliases
// Module.prototype.require = function (path) {
//   return originalRequire.call(this, resolvePathAliases(path));
// };

// console.log('[Loader] Path alias resolution enabled');