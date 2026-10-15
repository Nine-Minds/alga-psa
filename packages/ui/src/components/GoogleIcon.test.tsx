import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SiGoogle } from 'react-icons/si';
import { GoogleIcon } from './GoogleIcon';

describe('Google sign-in glyph', () => {
  it.each(['h-8 w-8', 'h-16 w-16'])('preserves the rendered icon with %s sizing and decorative accessibility', className => {
    const props = { className, style: { color: '#34A853' }, 'aria-hidden': true as const };
    // Compare rendered SVG behavior, not component source or import strings.
    expect(renderToStaticMarkup(<GoogleIcon {...props} />)).toBe(renderToStaticMarkup(<SiGoogle {...props} />));
  });
});
