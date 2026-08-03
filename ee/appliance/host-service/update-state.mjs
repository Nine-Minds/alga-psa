import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeSecureJsonFileAtomic(targetFile, value) {
  const dir = path.dirname(targetFile);
  const temporaryFile = path.join(
    dir,
    `.${path.basename(targetFile)}.${process.pid}.${randomUUID()}.tmp`
  );
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600
    });
    fs.renameSync(temporaryFile, targetFile);
    fs.chmodSync(dir, 0o750);
    fs.chmodSync(targetFile, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile);
    } catch { /* best effort cleanup */ }
    throw error;
  }
}

export function appendUpdateHistory(entry, historyFile, now = () => new Date().toISOString()) {
  const existing = readJsonFile(historyFile);
  const history = Array.isArray(existing?.history) ? existing.history : [];
  writeSecureJsonFileAtomic(historyFile, {
    updatedAt: now(),
    history: [entry, ...history].slice(0, 50)
  });
}
