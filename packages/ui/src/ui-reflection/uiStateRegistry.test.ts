// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createUIStateRegistry } from './uiStateRegistry';
import type { PageState, UIComponent } from './types';

const btn = (id: string, parentId?: string, extra: Partial<UIComponent> = {}) =>
  ({ id, type: 'button', label: id, parentId, ...extra }) as UIComponent;

function make() {
  const publish = vi.fn((s: PageState) => {
    (window as any).__UI_STATE__ = s;
  });
  const reg = createUIStateRegistry({ onPublish: publish });
  return { reg, publish };
}

/** Register n components: 1 root parent per 100 children-ish mix, time register+flush. */
function registerMix(reg: ReturnType<typeof make>['reg'], n: number) {
  const parents = Math.max(1, Math.floor(n / 100));
  const t0 = performance.now();
  for (let i = 0; i < parents; i++) reg.register(btn(`p${i}`));
  for (let i = 0; i < n - parents; i++) {
    reg.register(btn(`c${i}`, i % 5 === 0 ? undefined : `p${i % parents}`));
  }
  reg.flush();
  return performance.now() - t0;
}

function unregisterAll(reg: ReturnType<typeof make>['reg'], n: number) {
  const parents = Math.max(1, Math.floor(n / 100));
  const t0 = performance.now();
  // children first, then parents, then flush once
  for (let i = 0; i < n - parents; i++) reg.unregister(`c${i}`);
  for (let i = 0; i < parents; i++) reg.unregister(`p${i}`);
  reg.flush();
  return performance.now() - t0;
}

describe('uiStateRegistry', () => {
  it('builds a correct tree for 5000 components and empties on unregister, within budget', () => {
    const { reg } = make();
    const N = 5000;
    const regMs = registerMix(reg, N);
    const state = reg.getPublishedState()!;
    expect(reg.size).toBe(N);
    expect((window as any).__UI_STATE__).toBe(state);

    const parents = 50;
    const rootChildren = Array.from({ length: N - parents }, (_, i) => i).filter((i) => i % 5 === 0).length;
    expect(state.components.length).toBe(parents + rootChildren);
    // roots sorted by ordinal
    const ords = state.components.map((c) => c.ordinal!);
    expect([...ords].sort((a, b) => a - b)).toEqual(ords);
    let childCount = 0;
    for (const root of state.components) {
      let prev = -1;
      for (const ch of root.children ?? []) {
        expect(ch.parentId).toBe(root.id);
        expect(ch.ordinal!).toBeGreaterThan(prev);
        prev = ch.ordinal!;
        childCount++;
      }
    }
    expect(childCount).toBe(N - parents - rootChildren);

    const unregMs = unregisterAll(reg, N);
    expect(reg.size).toBe(0);
    expect(reg.getPublishedState()!.components).toEqual([]);
    expect((window as any).__UI_STATE__.components).toEqual([]);

    expect(regMs).toBeLessThan(100);
    expect(unregMs).toBeLessThan(100);
  });

  it('scales roughly linearly (1k / 2k / 5k)', () => {
    const results: Record<number, { reg: number; unreg: number }> = {};
    // warm up the JIT so the 1k sample isn't artificially slow
    { const { reg } = make(); registerMix(reg, 2000); unregisterAll(reg, 2000); }
    for (const n of [1000, 2000, 5000]) {
      const { reg } = make();
      const r = registerMix(reg, n);
      const u = unregisterAll(reg, n);
      results[n] = { reg: r, unreg: u };
    }
    // eslint-disable-next-line no-console
    console.info('registry bench (ms)', JSON.stringify(results));
    // Perfectly linear = 5x; quadratic = 25x. Allow generous noise margin.
    const floor = (x: number) => Math.max(x, 1);
    expect(results[5000].reg / floor(results[1000].reg)).toBeLessThan(10);
    expect(results[5000].unreg / floor(results[1000].unreg)).toBeLessThan(10);
  });

  it('coalesces many mutations in one tick into a single publish (microtask)', async () => {
    const { reg, publish } = make();
    for (let i = 0; i < 100; i++) reg.register(btn(`a${i}`));
    reg.unregister('a3');
    reg.update('a4', { label: 'changed' });
    expect(publish).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(reg.getPublishedState()!.components.length).toBe(99);
    expect((window as any).__UI_STATE__.components.find((c: UIComponent) => c.id === 'a4').label).toBe('changed');
    // nothing pending -> no extra publish
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('sync flush publishes immediately and the scheduled microtask does not republish', async () => {
    const { reg, publish } = make();
    reg.register(btn('x'));
    expect(reg.flush()).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect((window as any).__UI_STATE__.components.map((c: UIComponent) => c.id)).toEqual(['x']);
    expect(reg.flush()).toBe(false);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('unregister removes all descendants and keeps unrelated nodes', () => {
    const { reg } = make();
    reg.register(btn('root'));
    reg.register(btn('a', 'root'));
    reg.register(btn('b', 'a'));
    reg.register(btn('c', 'b'));
    reg.register(btn('other'));
    reg.register(btn('other-child', 'other'));
    reg.flush();
    reg.unregister('a');
    reg.flush();
    const s = reg.getPublishedState()!;
    expect(s.components.map((c) => c.id)).toEqual(['root', 'other']);
    expect(s.components[0].children).toEqual([]);
    expect(reg.get('b')).toBeUndefined();
    expect(reg.get('c')).toBeUndefined();
    expect(s.components[1].children!.map((c) => c.id)).toEqual(['other-child']);
  });

  it('keeps ordinals on re-register and handles re-parenting / late parents', () => {
    const { reg } = make();
    reg.register(btn('child', 'late'));
    reg.register(btn('first'));
    reg.flush();
    expect(reg.getPublishedState()!.components.map((c) => c.id)).toEqual(['child', 'first']);
    reg.register(btn('late')); // parent arrives later, ordinal 2
    reg.register(btn('first', undefined, { label: 'again' })); // keeps ordinal 1
    reg.flush();
    const s = reg.getPublishedState()!;
    expect(s.components.map((c) => c.id)).toEqual(['first', 'late']);
    expect(s.components[0].label).toBe('again');
    expect(s.components[0].ordinal).toBe(1);
    expect(s.components[1].children!.map((c) => c.id)).toEqual(['child']);
    reg.unregister('late'); // descendant via index even though child registered first
    reg.flush();
    expect(reg.getPublishedState()!.components.map((c) => c.id)).toEqual(['first']);
  });

  it('updateComponent bails out when nothing changed and preserves type/ordinal', () => {
    const { reg, publish } = make();
    reg.register(btn('u', undefined, { label: 'one' }));
    reg.flush();
    publish.mockClear();
    reg.update('u', { label: 'one' });
    reg.update('u', { type: 'dialog' } as any);
    reg.update('missing', { label: 'zzz' });
    reg.flush();
    expect(publish).not.toHaveBeenCalled();
    reg.update('u', { label: 'two', type: 'dialog' } as any);
    reg.flush();
    expect(publish).toHaveBeenCalledTimes(1);
    const u = reg.getPublishedState()!.components[0];
    expect(u.label).toBe('two');
    expect(u.type).toBe('button');
    expect(u.ordinal).toBe(0);
  });
});
