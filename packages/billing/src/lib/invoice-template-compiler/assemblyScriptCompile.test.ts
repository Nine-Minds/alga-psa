import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSEMBLYSCRIPT_SHARED_COMPILE_FLAGS,
  buildAssemblyScriptCompileCommand,
  resolveAssemblyScriptProjectDir,
} from './assemblyScriptCompile';

describe('assemblyScriptCompile helpers', () => {
  it('builds compile command with shared AssemblyScript flags', () => {
    const command = buildAssemblyScriptCompileCommand({
      workingDirectory: '/tmp/work',
      sourceFilePath: '/tmp/work/source.ts',
      outFilePath: '/tmp/work/out.wasm',
      baseDir: '/tmp/work',
    });

    ASSEMBLYSCRIPT_SHARED_COMPILE_FLAGS.forEach((flag) => {
      expect(command).toContain(flag);
    });
    expect(command).toContain('--outFile');
    expect(command).toContain('--baseDir');
  });

  it('resolves server assemblyscript path when present in current workspace', () => {
    const resolved = resolveAssemblyScriptProjectDir();
    expect(resolved).toContain(
      path.join('server', 'src', 'invoice-templates', 'assemblyscript')
    );
  });
});
