import React from 'react';

// EE shim: reuse the CE stub/implementation.
// The server build aliases '@' to server/src, so this pulls from
// server/src/empty/components/settings/extensions/InstallExtensionSimple.
// In EE editions where a specialized UI is needed, replace this shim
// with a real implementation.
import CEInstallExtensionSimple from '@/empty/components/settings/extensions/InstallExtensionSimple';

export default function InstallExtensionSimple(props: any) {
  return <CEInstallExtensionSimple {...props} />;
}

