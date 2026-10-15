import { afterEach, describe, expect, it } from 'vitest';
import { rewriteEmulatorHost } from '../../lib/threecxCallControlSession';

describe('rewriteEmulatorHost', () => {
  afterEach(() => {
    delete process.env.THREECX_EMULATOR_MODE;
    delete process.env.THREECX_EMULATOR_WORKER_HOST;
  });

  it('leaves the address untouched outside emulator mode', () => {
    expect(rewriteEmulatorHost('http://localhost:4070')).toBe('http://localhost:4070');
  });

  it('points localhost at the Docker host in emulator mode', () => {
    process.env.THREECX_EMULATOR_MODE = 'true';
    expect(rewriteEmulatorHost('http://localhost:4070')).toBe('http://host.docker.internal:4070');
    expect(rewriteEmulatorHost('http://127.0.0.1:4070/')).toBe('http://host.docker.internal:4070/');
    expect(rewriteEmulatorHost('https://pbx.example.com')).toBe('https://pbx.example.com');
  });

  it('honours an explicit worker host override', () => {
    process.env.THREECX_EMULATOR_MODE = '1';
    process.env.THREECX_EMULATOR_WORKER_HOST = '192.168.1.5';
    expect(rewriteEmulatorHost('http://localhost:4070')).toBe('http://192.168.1.5:4070');
  });
});
