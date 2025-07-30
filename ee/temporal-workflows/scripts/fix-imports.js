#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function processFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  
  // Calculate the relative path based on file location
  // dist/db/user-operations.js -> ../../shared/dist/
  const depth = filePath.split('/dist/')[1].split('/').length - 1;
  const relativePath = '../'.repeat(depth + 3); // +3 to go from ee/temporal-workflows/dist to root
  
  // Replace @shared imports with relative paths
  const updatedContent = content
    .replace(/@shared\/([^'"\s]+)/g, `${relativePath}shared/dist/$1`);
  
  if (content !== updatedContent) {
    await writeFile(filePath, updatedContent, 'utf-8');
    console.log(`Updated imports in ${filePath}`);
  }
}

async function processDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await processDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      await processFile(fullPath);
    }
  }
}

const distDir = join(process.cwd(), 'dist');
processDirectory(distDir).catch(console.error);