import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeServerCredentials } from './capture-server-credentials.mjs';

// Only operate on the fresh-install workflow's owned Compose server.
try {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub output path required');
  const compose = ['-p', 'alga-e2e-test'];
  const server = execFileSync('docker-compose', [...compose, 'ps', '-q', 'server'], { encoding: 'utf8' }).trim();
  if (!server || server.includes('\n')) throw new Error('Missing server');
  const labels = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', server], { encoding: 'utf8' }));
  if (labels['com.docker.compose.project'] !== 'alga-e2e-test' || labels['com.docker.compose.service'] !== 'server') throw new Error('Unexpected server');
  const password = randomBytes(32).toString('base64url');
  execFileSync('docker', ['cp', 'e2e-tests/harness/provision-browser-credential.mjs', `${server}:/app/provision-browser-credential.mjs`], { stdio: 'pipe' });
  execFileSync('docker', ['exec', '-i', '-e', 'E2E_DATABASE_ISOLATED=true', server, 'node', '/app/provision-browser-credential.mjs'], { input: password, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  writeServerCredentials({ credentials: { email: 'glinda@emeraldcity.oz', password }, outputPath: process.env.GITHUB_OUTPUT });
} catch {
  console.error('Could not provision the owned browser fixture credential');
  process.exitCode = 1;
}
