import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { notFound } from 'next/navigation';
import DocumentTemplatesPage from '@alga-psa/billing/components/billing-dashboard/documents/DocumentTemplatesPage';
import {
  getDocumentTypeRegistryEntry,
  isDocumentType,
} from '@alga-psa/billing/lib/document-templates/registry';

export async function generateMetadata(
  { params }: { params: Promise<{ type: string }> },
): Promise<Metadata> {
  const { type } = await params;
  const { t } = await getServerTranslation(undefined, 'metadata');
  if (!isDocumentType(type)) {
    return {
      title: t('msp.documentTemplates.detail.fallbackTitle', { defaultValue: 'Document Layouts' }),
    };
  }
  // The registry label itself still comes from packages/billing in English —
  // packages/* is outside the current i18n sweep.
  return {
    title: t('msp.documentTemplates.detail.title', {
      documentType: getDocumentTypeRegistryEntry(type).label,
      defaultValue: '{{documentType}} Layouts',
    }),
  };
}

export default async function DocumentTemplatesRoute(
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  if (!isDocumentType(type)) {
    notFound();
  }
  return <DocumentTemplatesPage documentType={type} />;
}

export const dynamic = 'force-dynamic';
