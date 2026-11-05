'use client';

import Link from 'next/link';
import AssetForm from './AssetForm';

/** Full intake composes the same registry, custom-field validation, ownership,
 * assignment, and procurement controls used by the existing asset editor. */
export default function FullAddAssetForm() {
  return <main className="mx-auto max-w-5xl space-y-4 p-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Add asset</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">Choose a tenant number or keep an existing printed tag.</p>
      </div>
      <Link href="/msp/assets" className="text-sm underline">Back to assets</Link>
    </div>
    <AssetForm createMode />
  </main>;
}
