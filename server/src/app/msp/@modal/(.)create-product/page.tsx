import type { Metadata } from 'next';
import CreateProductRouteClient from '../../_components/CreateProductRouteClient';

export const metadata: Metadata = {
  title: 'Create Product',
};

export default function CreateProductModalPage() {
  return <CreateProductRouteClient closeMode="back" />;
}
