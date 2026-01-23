/**
 * Wrapper component for EmailProviderConfiguration
 * Since server actions handle tenant context, this is now just a simple wrapper
 */

'use client';

import React from 'react';
import { EmailProviderConfiguration } from './EmailProviderConfiguration';

export function EmailProviderConfigurationWrapper() {
  return <EmailProviderConfiguration />;
}