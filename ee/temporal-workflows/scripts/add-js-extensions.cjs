const fs = require("fs");
const path = require("path");

/**
 * Script to add .js extensions to import/export statements in compiled JavaScript files
 * This fixes ES module resolution issues in Node.js
 */

function addJsExtensions(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Regex to match import/export statements without .js extensions
    // Matches: from "./some/path" or from '../some/path' but not from 'external-package'
    const importExportRegex =
      /(import|export)(.*?from\s+['"])(\.\.?\/[^'"]*?)(?<!\.js)(['"])/g;

    const updatedContent = content.replace(importExportRegex, "$1$2$3.js$4");

    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent, "utf8");
      console.log(`Fixed imports in: ${filePath}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return false;
  }
}

function processDirectory(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    let fixedCount = 0;

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        fixedCount += processDirectory(fullPath);
      } else if (file.endsWith(".js") && !file.endsWith(".d.ts")) {
        if (addJsExtensions(fullPath)) {
          fixedCount++;
        }
      }
    }

    return fixedCount;
  } catch (error) {
    console.error(`Error processing directory ${dirPath}:`, error.message);
    return 0;
  }
}

function main() {
  const distDir = path.join(__dirname, "..", "dist");

  if (!fs.existsSync(distDir)) {
    console.error("Dist directory does not exist. Run build first.");
    process.exit(1);
  }

  console.log("Adding .js extensions to compiled imports...");
  const fixedCount = processDirectory(distDir);
  console.log(`Fixed ${fixedCount} files.`);
}

if (require.main === module) {
  main();
}

module.exports = { addJsExtensions, processDirectory };
