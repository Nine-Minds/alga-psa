'use client';

import React from 'react';

/**
 * Community Edition stub. Enterprise builds alias @enterprise to
 * ee/server/src, replacing this with the real settings component.
 */
export default function HuntressIntegrationSettings() {
  return (
    <div className="rounded-lg border p-6 text-center">
      <h3 className="text-base font-semibold">Huntress Integration</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        The Huntress security integration is an Enterprise feature.
      </p>
    </div>
  );
}
