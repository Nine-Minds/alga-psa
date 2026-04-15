'use client';

/**
 * Remote Access Button
 *
 * Remote access is temporarily disabled across all asset surfaces.
 */

import type { Asset } from '@alga-psa/types';

interface RemoteAccessButtonProps {
  asset: Asset;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

function RemoteAccessButton(_: RemoteAccessButtonProps) {
  return null;
}

function RemoteAccessIndicator(_: { asset: Asset; className?: string }) {
  return null;
}

export { RemoteAccessButton, RemoteAccessIndicator };
export type { RemoteAccessButtonProps };
export default RemoteAccessButton;
