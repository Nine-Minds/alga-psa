import React from 'react';
import type { ExtensionRendererProps } from './types';

/**
 * Deprecated host-side renderer.
 * The extension UI is now iframe-only and must be served via the Runner.
 * Use iframeBridge utilities instead.
 */
export function ExtensionRenderer(_props: ExtensionRendererProps) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[ext-v2] ExtensionRenderer is removed. Tenant UI must be served via Runner iframe; host-side dynamic rendering is removed.');
  }
  throw new Error('ExtensionRenderer removed: iframe-only UI is required. Use iframeBridge and serve extension UI from Runner.');
}

export default ExtensionRenderer;
