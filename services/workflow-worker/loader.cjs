// /**
//  * This is a Node.js loader for resolving path aliases using CommonJS.
//  */

// const { resolve } = require('path');
// const Module = require('module');

// // Store the original require function
// const originalRequire = Module.prototype.require;

// function resolvePathAliases(modPath) {
//   if (modPath.startsWith('@/')) {
//     return resolve(__dirname, '../../server/src', modPath.substring(2));
//   }
//   if (modPath.startsWith('@shared/')) {
//     return resolve(__dirname, '../../shared', modPath.substring(8));
//   }
//   if (modPath.startsWith('@server/')) {
//     return resolve(__dirname, '../../server/src', modPath.substring(8));
//   }
//   if (modPath.startsWith('@ee/')) {
//     return resolve(__dirname, 'placeholder', modPath.substring(4));
//   }
//   return modPath;
// }

// Module.prototype.require = function(modPath) {
//   return originalRequire.call(this, resolvePathAliases(modPath));
// };

// console.log('[Loader] Path alias resolution enabled');