#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function extractServerCredentials(logs) {
  let pendingEmail, latest;
  for (const line of logs.split(/\r?\n/)) {
    const email = /User Email is -> \[ ([^\r\n]+?) \]/.exec(line);
    const password = /Password is -> \[ ([^\r\n]+?) \]/.exec(line);
    if (email && password) throw new Error('Ambiguous credential announcement');
    if (email) {
      if (pendingEmail) throw new Error('Ambiguous credential announcement');
      pendingEmail = email[1];
    }
    if (password) {
      if (!pendingEmail) throw new Error('Unpaired credential announcement');
      latest = { email: pendingEmail, password: password[1] };
      pendingEmail = undefined;
    }
  }
  if (pendingEmail || !latest) throw new Error('Incomplete credential announcement');
  return latest;
}

export function captureServerCredentials({ logs, outputPath, mask = value => process.stdout.write(value) }) {
  if (!outputPath) throw new Error('GitHub output path required');
  const credentials = extractServerCredentials(logs);
  // Escape command data before Actions sees it; never emit the input logs.
  const escaped = credentials.password.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  mask(`::add-mask::${escaped}\n`);
  let delimiter;
  do { delimiter = `credentials_${randomUUID()}`; }
  while ([credentials.email, credentials.password].some(value => value.split(/\r?\n/).includes(delimiter)));
  appendFileSync(outputPath, `e2e_user_email<<${delimiter}\n${credentials.email}\n${delimiter}\ne2e_user_password<<${delimiter}\n${credentials.password}\n${delimiter}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { captureServerCredentials({ logs: readFileSync(0, 'utf8'), outputPath: process.env.GITHUB_OUTPUT }); }
  catch { console.error('Cannot capture a complete, unambiguous server credential announcement'); process.exitCode = 1; }
}
