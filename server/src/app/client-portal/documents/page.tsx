import type { Metadata } from 'next';
import { ClientDocumentsPage } from '@alga-psa/client-portal/components';

export const metadata: Metadata = {
  title: 'Documents',
};

export default function DocumentsPage() {
  return <ClientDocumentsPage />;
}
