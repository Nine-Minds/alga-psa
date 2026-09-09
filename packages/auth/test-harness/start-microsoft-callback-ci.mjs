import { readFileSync } from 'node:fs';
import { runMicrosoftCallback } from './run-microsoft-callback.mjs';

// Explicit test entrypoint, mounted only in the isolated CI callback lane.
if (process.env.CI !== 'true' || process.env.NATIVE_MICROSOFT_OIDC_ISOLATED !== 'true') {
  throw new Error('Microsoft callback entrypoint requires isolated CI');
}
// The runner owns a private filesystem secret root. Export infrastructure
// secrets before leaving the image's mounted secret directory behind.
for (const [key, filename] of [['NEXTAUTH_SECRET', 'nextauth_secret'], ['REDIS_PASSWORD', 'redis_password']]) {
  process.env[key] ||= readFileSync(`/run/secrets/${filename}`, 'utf8').trim();
  if (!process.env[key]) throw new Error(`Missing isolated ${key}`);
}
try {
  const report = await runMicrosoftCallback();
  if (report.status !== 'passed') process.exitCode = report.interruptedSignal === 'SIGINT' ? 130 : report.interruptedSignal === 'SIGTERM' ? 143 : 1;
} catch {
  console.error('Microsoft callback CI configuration failed');
  process.exitCode = 1;
}
