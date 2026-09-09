import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function installApiTestDependencies({ run = runNpm, wait = delay, signal } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted();
    const result = await run(['ci', '--prefer-offline'], { signal });
    const npmCodes = [...result.stderr.matchAll(/^npm (?:error|ERR!) code (\S+)\s*$/gm)].map(match => match[1]);
    if (result.signal || result.code === 0 || attempt === 2 || signal?.aborted
      || npmCodes.length === 0 || npmCodes.some(code => code !== 'ECONNRESET')) return result;
    await wait(2000, undefined, { signal });
  }
}
function runNpm(args, { signal }) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn('npm', args, { detached: grouped, stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    // Preserve npm output while retaining only a bounded diagnostic tail.
    child.stderr.on('data', chunk => { process.stderr.write(chunk); stderr = (stderr + chunk).slice(-65536); });
    let killTimer;
    const kill = childSignal => {
      try { if (grouped && child.pid) process.kill(-child.pid, childSignal); else child.kill(childSignal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const stop = () => {
      kill(signal.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const cleanup = () => { clearTimeout(killTimer); signal?.removeEventListener('abort', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, childSignal) => { cleanup(); resolve({ code, signal: childSignal, stderr }); });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const terminate = signal => controller.abort(signal);
  const onTerm = () => terminate('SIGTERM'), onInt = () => terminate('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  let result;
  try { result = await installApiTestDependencies({ signal: controller.signal }); }
  catch { result = { code: 1, signal: controller.signal.aborted ? controller.signal.reason : null }; }
  process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt);
  if (controller.signal.aborted) process.kill(process.pid, controller.signal.reason);
  else if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
}
