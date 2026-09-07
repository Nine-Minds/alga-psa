import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVisualBaseline } from '../../../../test-utils/visualBaseline';

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alga-visual-baseline-'));
  roots.push(root);
  return path.join(root, 'baselines', 'invoice.png');
}
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const oldImage = Buffer.from('synthetic existing image bytes');
const newImage = Buffer.from('synthetic changed image bytes');

it('fails on a missing baseline without writing or creating its directory', async () => {
  const file = await fixture();
  await expect(loadVisualBaseline(file, newImage, { update: false, ci: false })).rejects.toThrow('Missing visual baseline');
  await expect(fs.stat(path.dirname(file))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('uses the existing reviewed bytes and never replaces them in comparison mode', async () => {
  const file = await fixture();
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, oldImage);
  expect(await loadVisualBaseline(file, newImage, { update: false, ci: true })).toEqual({ baseline: oldImage, updated: false });
  expect(await fs.readFile(file)).toEqual(oldImage);
});

it('creates and replaces baselines only with explicit local update mode', async () => {
  const file = await fixture();
  expect(await loadVisualBaseline(file, oldImage, { update: true, ci: false })).toEqual({ baseline: oldImage, updated: true });
  expect(await loadVisualBaseline(file, newImage, { update: true, ci: false })).toEqual({ baseline: newImage, updated: true });
  expect(await fs.readFile(file)).toEqual(newImage);
});

it('rejects CI update mode for missing and existing baselines without changing either', async () => {
  const file = await fixture();
  await expect(loadVisualBaseline(file, newImage, { update: true, ci: true })).rejects.toThrow('forbidden in CI');
  await expect(fs.stat(path.dirname(file))).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, oldImage);
  await expect(loadVisualBaseline(file, newImage, { update: true, ci: true })).rejects.toThrow('forbidden in CI');
  expect(await fs.readFile(file)).toEqual(oldImage);
});
