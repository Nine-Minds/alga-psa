import { describe, expect, test, vi, beforeEach } from 'vitest';

describe('theme bridge (postMessage)', () => {
  beforeEach(() => {
    // Clear any inline styles from previous tests
    document.documentElement.removeAttribute('style');
  });

  test('applyTheme sets CSS variables on document root', () => {
    const root = document.documentElement;
    const vars = {
      '--alga-bg': '#ffffff',
      '--alga-fg': '#0f172a',
      '--alga-primary': '#8a4dea',
    };
    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    expect(root.style.getPropertyValue('--alga-bg')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--alga-fg')).toBe('#0f172a');
    expect(root.style.getPropertyValue('--alga-primary')).toBe('#8a4dea');
  });

  test('message handler applies theme from Alga envelope format', () => {
    const root = document.documentElement;

    // Simulate receiving a theme message
    const handler = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.alga === true && data.version === '1' && data.type === 'theme') {
        Object.entries(data.payload as Record<string, string>).forEach(([key, value]) => {
          root.style.setProperty(key, value);
        });
      }
    };
    window.addEventListener('message', handler);

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        alga: true,
        version: '1',
        type: 'theme',
        payload: {
          '--alga-bg': '#0b0f14',
          '--alga-secondary-foreground': '#ffffff',
        },
      },
    }));

    expect(root.style.getPropertyValue('--alga-bg')).toBe('#0b0f14');
    expect(root.style.getPropertyValue('--alga-secondary-foreground')).toBe('#ffffff');

    window.removeEventListener('message', handler);
  });

  test('ignores non-Alga messages', () => {
    const root = document.documentElement;

    const handler = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.alga === true && data.version === '1' && data.type === 'theme') {
        Object.entries(data.payload as Record<string, string>).forEach(([key, value]) => {
          root.style.setProperty(key, value);
        });
      }
    };
    window.addEventListener('message', handler);

    window.dispatchEvent(new MessageEvent('message', {
      data: { someOtherMessage: true },
    }));

    expect(root.style.getPropertyValue('--alga-bg')).toBe('');

    window.removeEventListener('message', handler);
  });
});
