import type { Metadata } from 'next';
import ServiceRequestDefinitionEditorPage from '../ServiceRequestDefinitionEditorPage';
import { getServiceRequestDefinitionEditorDataAction } from '../actions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ definitionId: string }>;
}): Promise<Metadata> {
  const { definitionId } = await params;
  try {
    const data = await getServiceRequestDefinitionEditorDataAction(definitionId);
    const name = data?.basics.name?.trim();
    return { title: name ? name : 'Service Request' };
  } catch {
    return { title: 'Service Request' };
  }
}

export default function ServiceRequestDefinitionEditorRoute() {
  return <ServiceRequestDefinitionEditorPage />;
}
