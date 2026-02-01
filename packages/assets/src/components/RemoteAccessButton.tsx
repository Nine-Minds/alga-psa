'use client';

/**
 * Remote Access Button - Dynamic Import Wrapper
 *
 * Dynamically imports the EE or CE version of the RemoteAccessButton.
 * EE version provides actual remote access functionality via NinjaOne.
 * CE version renders nothing.
 */

import dynamic from 'next/dynamic';
import type { Asset } from '@alga-psa/types';

interface RemoteAccessButtonProps {
  asset: Asset;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

// Dynamic import that resolves to EE or CE version based on webpack alias
const RemoteAccessButton = dynamic(
  () => import('@enterprise/components/assets/RemoteAccessButton').then(mod => mod.RemoteAccessButton),
  {
    ssr: false,
    loading: () => null, // Don't show loading state
  }
);

// Also export the indicator component
const RemoteAccessIndicator = dynamic(
  () => import('@enterprise/components/assets/RemoteAccessButton').then(mod => mod.RemoteAccessIndicator),
  {
    ssr: false,
    loading: () => null,
  }
);

export { RemoteAccessButton, RemoteAccessIndicator };
export type { RemoteAccessButtonProps };
export default RemoteAccessButton;
