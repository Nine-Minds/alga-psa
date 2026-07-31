import type { Metadata } from 'next';
import CreateProjectRouteClient from '../_components/CreateProjectRouteClient';

export const metadata: Metadata = {
  title: 'Create Project',
};

export default function CreateProjectPage() {
  return <CreateProjectRouteClient closeMode="replace" />;
}
