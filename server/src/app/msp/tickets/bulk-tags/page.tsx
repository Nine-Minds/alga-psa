import type { Metadata } from 'next';
import BulkAddTagsRouteClient from '../_components/BulkAddTagsRouteClient';

export const metadata: Metadata = {
  title: 'Set Tags',
};

export default function BulkAddTagsPage() {
  return <BulkAddTagsRouteClient closeMode="replace" />;
}
