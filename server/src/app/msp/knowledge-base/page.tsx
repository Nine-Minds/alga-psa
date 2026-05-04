import { KnowledgeBasePage } from '@alga-psa/documents/components';
import { getExperimentalFeatures } from '@alga-psa/tenancy/actions';

export default async function KBArticlesPage() {
  let aiAssistantEnabled = false;
  try {
    const features = await getExperimentalFeatures();
    aiAssistantEnabled = features.aiAssistant ?? false;
  } catch {
    // Feature flag fetch failure is non-fatal
  }

  return <KnowledgeBasePage activeTab="articles" aiAssistantEnabled={aiAssistantEnabled} />;
}
