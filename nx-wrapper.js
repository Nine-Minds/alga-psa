#!/usr/bin/env node

/**
 * Nx Wrapper Script
 *
 * This script provides a workaround for npm workspaces not properly installing
 * root-level dev dependencies. It uses the globally installed Nx CLI to run
 * Nx commands in the monorepo workspace.
 */

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const workspaceRoot = __dirname;

// Run nx command from workspace root
try {
  const command = `nx ${args.join(' ')}`;
  console.log(`Running: ${command}\n`);

  execSync(command, {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: true
  });
} catch (error) {
  process.exit(error.status || 1);
}
