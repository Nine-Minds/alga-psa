/** @vitest-environment jsdom */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

// Resolve keys against the shipped en bundle so a renamed or missing key fails
// here instead of rendering a raw dotted key to the operator.
function loadCommonMessages(): Map<string, string> {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, 'server/public/locales/en'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Unable to locate server/public/locales/en');
    }
    dir = parent;
  }

  const bundle = JSON.parse(
    fs.readFileSync(path.join(dir, 'server/public/locales/en/common.json'), 'utf8')
  ) as Record<string, unknown>;

  const flat = new Map<string, string>();
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const qualified = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, qualified);
      } else if (typeof value === 'string') {
        flat.set(qualified, value);
      }
    }
  };
  walk(bundle, '');
  return flat;
}

const messages = loadCommonMessages();

const translatorMode = { bootstrap: false };

// Mirrors the pre-init translator in packages/ui useTranslation: no resources
// yet, so the call site's fallback copy is all the dialog has.
const translate = (key: string, options?: unknown): string => {
  if (translatorMode.bootstrap) {
    if (typeof options === 'string') return options;
    const defaultValue = (options as { defaultValue?: unknown } | undefined)?.defaultValue;
    return typeof defaultValue === 'string' ? defaultValue : key;
  }
  const template = messages.get(key);
  if (template !== undefined) return template;
  return typeof options === 'string' ? options : key;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/components', () => ({
  Dialog: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));

const { default: Alert } = await import('./Alert');

afterEach(() => {
  cleanup();
  translatorMode.bootstrap = false;
});

describe('auth Alert close control', () => {
  it('labels the close control from the common bundle', () => {
    render(<Alert type="error" title="SSO sign-in failed" message="No match." isOpen />);

    expect(screen.getByRole('dialog').textContent).not.toContain('common.close');
    expect(screen.getAllByLabelText('Close').length).toBeGreaterThan(0);
  });

  it('still reads as copy before the common namespace loads', () => {
    translatorMode.bootstrap = true;

    render(<Alert type="error" title="SSO sign-in failed" message="No match." isOpen />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('common.close');
    expect(dialog.textContent).toContain('Close');
  });
});
