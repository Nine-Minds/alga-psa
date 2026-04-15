import { spawn } from 'node:child_process';

function splitLines(buffer, onLine) {
  const parts = buffer.split(/\r?\n/);
  const carry = parts.pop() ?? '';
  for (const part of parts) {
    onLine(part);
  }
  return carry;
}

export class ShellRunner {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.env = options.env || process.env;
  }

  runStreaming(command, args, options = {}) {
    const cwd = options.cwd || this.cwd;
    const env = { ...this.env, ...(options.env || {}) };

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let stdoutCarry = '';
      let stderrCarry = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        output += text;
        if (options.onRawChunk) {
          options.onRawChunk(text, 'stdout');
        }
        stdoutCarry = splitLines(stdoutCarry + text, (line) => {
          if (options.onLine) {
            options.onLine(line, 'stdout');
          }
        });
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        output += text;
        if (options.onRawChunk) {
          options.onRawChunk(text, 'stderr');
        }
        stderrCarry = splitLines(stderrCarry + text, (line) => {
          if (options.onLine) {
            options.onLine(line, 'stderr');
          }
        });
      });

      child.on('close', (code) => {
        if (stdoutCarry && options.onLine) {
          options.onLine(stdoutCarry, 'stdout');
        }
        if (stderrCarry && options.onLine) {
          options.onLine(stderrCarry, 'stderr');
        }
        resolve({ code: code ?? 0, output });
      });

      child.on('error', (error) => {
        resolve({ code: 1, output: `${String(error)}` });
      });
    });
  }

  async runCapture(command, args, options = {}) {
    const result = await this.runStreaming(command, args, options);
    return {
      ok: result.code === 0,
      code: result.code,
      output: result.output,
    };
  }
}
