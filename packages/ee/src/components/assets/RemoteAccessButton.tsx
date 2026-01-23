'use client';

/**
 * Remote Access Button - Community Edition Stub
 *
 * This is a placeholder component for Community Edition builds.
 * RMM integrations are only available in Enterprise Edition.
 */

import React from 'react';
import type { Asset } from '@alga-psa/types';

interface RemoteAccessButtonProps {
  asset: Asset;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

// Returns null in CE - no remote access without RMM integration
export function RemoteAccessButton(_props: RemoteAccessButtonProps): null {
  return null;
}

export function RemoteAccessIndicator(_props: { asset: Asset }): null {
  return null;
}

export default RemoteAccessButton;
