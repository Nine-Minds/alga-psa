import { describe, expect, it } from 'vitest';
import { normalizeDefaultBindings, ShortcutRegistry } from './registry';
import type { ShortcutAction } from './types';

function action(id: string): ShortcutAction {
  return {
    id,
    labelKey: `actions.${id}.label`,
    groupKey: 'groups.test',
    defaultBindings: ['mod+k'],
    scope: 'global',
    handler: () => undefined,
  };
}

describe('ShortcutRegistry', () => {
  it('adds and removes actions keyed by stable id', () => {
    const registry = new ShortcutRegistry();
    const first = action('global.search');
    const replacement = action('global.search');

    const unregisterFirst = registry.add(first);
    expect(registry.get('global.search')).toBe(first);
    expect(registry.list()).toEqual([first]);

    registry.add(replacement);
    expect(registry.get('global.search')).toBe(replacement);
    expect(registry.list()).toEqual([replacement]);

    unregisterFirst();
    expect(registry.get('global.search')).toBe(replacement);

    registry.remove('global.search');
    expect(registry.list()).toEqual([]);
  });

  it('expands single-array default binding sugar to both platforms', () => {
    expect(normalizeDefaultBindings(['mod+k'])).toEqual({
      mac: ['mod+k'],
      other: ['mod+k'],
    });
    expect(normalizeDefaultBindings({ mac: ['mod+k'], other: ['ctrl+k'] })).toEqual({
      mac: ['mod+k'],
      other: ['ctrl+k'],
    });
  });
});
