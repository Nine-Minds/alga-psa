const fs = require('node:fs');

function readCookieFromFile(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim();
}

module.exports = {
  readCookieFromFile
};

