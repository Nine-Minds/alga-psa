import { describe, expect, it } from 'vitest';
import { parseBinding } from './parser';
import { matchEvent, type KeyboardShortcutEvent } from './matcher';
import type { BindingDescriptor, Platform } from './types';

function binding(input: string): BindingDescriptor {
  const result = parseBinding(input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

function keyEvent(overrides: Partial<KeyboardShortcutEvent>): KeyboardShortcutEvent {
  return {
    code: '',
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function matches(input: string, event: Partial<KeyboardShortcutEvent>, platform: Platform = 'other') {
  return matchEvent(keyEvent(event), binding(input), platform);
}

describe('matchEvent', () => {
  it('resolves mod to Meta on mac and Ctrl on other platforms', () => {
    expect(matches('mod+s', { code: 'KeyS', key: 's', metaKey: true }, 'mac')).toBe(true);
    expect(matches('mod+s', { code: 'KeyS', key: 's', ctrlKey: true }, 'mac')).toBe(false);
    expect(matches('mod+s', { code: 'KeyS', key: 's', ctrlKey: true }, 'other')).toBe(true);
    expect(matches('mod+s', { code: 'KeyS', key: 's', metaKey: true }, 'other')).toBe(false);
  });

  it('requires exact modifier-set equality for code-kind bindings', () => {
    expect(matches('mod+s', { code: 'KeyS', key: 's', ctrlKey: true })).toBe(true);
    expect(matches('mod+s', { code: 'KeyS', key: 'S', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(matches('mod+s', { code: 'KeyS', key: 's', ctrlKey: true, altKey: true })).toBe(false);
  });

  it("matches char-kind '?' using the produced event.key while Shift is implied by the glyph", () => {
    expect(matches('?', { code: 'Slash', key: '?', shiftKey: true })).toBe(true);
    expect(matches('?', { code: 'IntlRo', key: '?', shiftKey: true })).toBe(true);
    expect(matches('?', { code: 'Slash', key: '/', shiftKey: false })).toBe(false);
  });

  it("matches macOS Option+N by event.code even when event.key is a dead key", () => {
    expect(matches('alt+n', { code: 'KeyN', key: 'Dead', altKey: true }, 'mac')).toBe(true);
    expect(matches('alt+n', { code: 'KeyN', key: '˜', altKey: true }, 'mac')).toBe(true);
  });

  it('matches mod+letter on international layouts by physical event.code', () => {
    expect(matches('mod+s', { code: 'KeyS', key: 'ы', ctrlKey: true }, 'other')).toBe(true);
    expect(matches('mod+s', { code: 'KeyS', key: 'ß', ctrlKey: true }, 'other')).toBe(true);
    expect(matches('mod+s', { code: 'KeyA', key: 's', ctrlKey: true }, 'other')).toBe(false);
  });

  it("does not false-match AltGr as a mod+character binding", () => {
    expect(
      matches('mod+?', {
        code: 'Slash',
        key: '?',
        ctrlKey: true,
        altKey: true,
        getModifierState: (key) => key === 'AltGraph',
      }),
    ).toBe(false);
  });
});
