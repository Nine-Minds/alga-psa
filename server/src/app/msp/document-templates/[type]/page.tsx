import type { Metadata } from 'next';
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
  if (!isDocumentType(type)) {
    return { title: 'Document Layouts' };
  }
  return { title: `${getDocumentTypeRegistryEntry(type).label} Layouts` };
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
