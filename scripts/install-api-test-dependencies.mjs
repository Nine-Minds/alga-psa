import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function installApiTestDependencies({ run = runNpm, wait = delay, signal, applianceFfmpegDownloadRetry = false } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted();
    const result = await run(['ci', '--prefer-offline'], { signal });
    const npmCodes = [...result.stderr.matchAll(/^npm (?:error|ERR!) code (\S+)\s*$/gm)].map(match => match[1]);
    const reset = npmCodes.length > 0 && npmCodes.every(code => code === 'ECONNRESET');
    // This opt-in recognizes the appliance lane's observed external download
    // failure. Keep other lifecycle errors terminal and preserve all scripts.
    const ffmpegDownload = applianceFfmpegDownloadRetry && result.code === 1
      && npmCodes.length === 1 && npmCodes[0] === '1'
      && /^npm (?:error|ERR!) path [^\r\n]*\/node_modules\/ffmpeg-static\s*$/m.test(result.stderr)
      && /^npm (?:error|ERR!) command sh -c node install\.js\s*$/m.test(result.stderr)
      && /^npm (?:error|ERR!) Error: Failed to download ffmpeg [^\r\n]+\.$/m.test(result.stderr)
      && /^npm (?:error|ERR!) +url: 'https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/download\/[^'\s]+',\s*$/m.test(result.stderr)
      && /^npm (?:error|ERR!) +statusCode: (?:500|502|503|504)\s*$/m.test(result.stderr);
    if (result.signal || result.code === 0 || attempt === 2 || signal?.aborted
      || (!reset && !ffmpegDownload)) return result;
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
  try { result = await installApiTestDependencies({ signal: controller.signal, applianceFfmpegDownloadRetry: process.env.APPLIANCE_FFMPEG_DOWNLOAD_RETRY === 'true' }); }
  catch { result = { code: 1, signal: controller.signal.aborted ? controller.signal.reason : null }; }
  process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt);
  if (controller.signal.aborted) process.kill(process.pid, controller.signal.reason);
  else if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
}
