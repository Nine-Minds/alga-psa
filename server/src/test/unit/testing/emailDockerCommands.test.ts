import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('child_process', () => ({
  execFile: Object.assign(() => undefined, { [Symbol.for('nodejs.util.promisify.custom')]: execute }),
  exec: Object.assign(() => undefined, { [Symbol.for('nodejs.util.promisify.custom')]: execute }),
}));
import { DockerServiceManager } from '../../e2e/utils/docker-service-manager';
afterEach(() => vi.clearAllMocks());

it('runs start, stop and diagnostics in this checkout with separate command arguments', async () => {
  execute.mockResolvedValue({ stdout: 'running', stderr: '' });
  const manager = new DockerServiceManager();
  await manager.startE2EServices();
  await manager.stopE2EServices();
  expect(await manager.getContainerLogs('mailhog', 12)).toBe('running');
  await manager.restartService('mailhog');
  expect(await manager.isServiceRunning('mailhog')).toBe(true);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const operations = [['up', '-d'], ['down'], ['logs', '--tail=12', 'mailhog'], ['restart', 'mailhog'], ['ps', 'mailhog']];
  expect(execute).toHaveBeenCalledTimes(operations.length);
  operations.forEach((args, index) => expect(execute).toHaveBeenNthCalledWith(index + 1,
    'docker', ['compose', '-f', 'docker-compose.e2e-local.yaml', ...args], expect.objectContaining({ cwd: root })));
});
