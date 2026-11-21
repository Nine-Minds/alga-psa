'use client';

import React from 'react';
import { STRIPE_CAPABILITIES, STRIPE_PERMISSION_MANIFEST } from '../../lib/payments/stripePermissionManifest';

export function StripePermissionHelp({ id, title, deferredLabel }: { id: string; title: string; deferredLabel: string }) {
  return <details className="text-sm">
    <summary id={id} className="cursor-pointer font-medium">{title}</summary>
    <div className="mt-2 space-y-2">
      {STRIPE_CAPABILITIES.map((capability) => <section key={capability}>
        <h4 className="font-medium">{capability}</h4>
        <ul className="list-disc list-inside">
          {STRIPE_PERMISSION_MANIFEST.filter((permission) => permission.capabilities.includes(capability)).map((permission) => <li key={permission.id}>
            <code>{permission.id}</code> ({permission.access}){permission.probe.kind === 'first-use' ? ` — ${deferredLabel}` : ''}
          </li>)}
        </ul>
      </section>)}
    </div>
  </details>;
}
