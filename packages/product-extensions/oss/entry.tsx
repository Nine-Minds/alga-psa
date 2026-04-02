import React from 'react';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// OSS stub implementation for Extensions feature
export const metadata = {
  title: 'Extensions - Enterprise Feature'
};

export async function generateMetadata(): Promise<Metadata> {
  return metadata;
}

type PageParams = { id: string };

export default async function Page({ params }: { params: PageParams | Promise<PageParams> }) {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');
  const resolvedParams = await params;

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">
          {t('enterpriseFeature.title', { defaultValue: 'Enterprise Feature' })}
        </h2>
        <p className="text-gray-600">
          {t('enterpriseFeature.description', {
            defaultValue: '{{feature}} require Enterprise Edition. Please upgrade to access this feature.',
            feature: t('page.title', { defaultValue: 'Extensions' })
          })}
        </p>
        <p className="text-sm text-gray-500 mt-2">
          {t('detail.extensionId', {
            defaultValue: 'Extension ID: {{id}}',
            id: resolvedParams.id
          })}
        </p>
      </div>
    </div>
  );
}

// Named exports for compatibility
export const ExtensionPage = Page;
export const ExtensionPageMetadata = metadata;
