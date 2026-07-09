import type { Metadata } from 'next';
import CreateAssetRouteClient from '../_components/CreateAssetRouteClient';

export const metadata: Metadata = {
  title: 'Create Asset',
};

export default function CreateAssetPage() {
  return <CreateAssetRouteClient closeMode="replace" />;
}
