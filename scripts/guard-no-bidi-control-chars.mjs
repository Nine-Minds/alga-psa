import { execFileSync } from 'node:child_process';

const pattern = '[\\x{202A}-\\x{202E}\\x{2066}-\\x{2069}]';

try {
  execFileSync('rg', ['--pcre2', '--line-number', pattern, '.'], { stdio: 'inherit' });
  console.error('Bidirectional Unicode control characters were found. Remove them or document an explicit exception.');
  process.exit(1);
} catch (error) {
  if (error.status === 1) {
    process.exit(0);
  }

  throw error;
}
