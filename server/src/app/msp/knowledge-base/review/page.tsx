import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { KnowledgeBasePage } from '@alga-psa/documents/components';
import { getExperimentalFeatures } from '@alga-psa/tenancy/actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.knowledgeBase.review.title', { defaultValue: 'Knowledge Base Review' }),
  };
}

export default async function KBReviewPage() {
  let aiAssistantEnabled = false;
  try {
    const features = await getExperimentalFeatures();
    aiAssistantEnabled = features.aiAssistant ?? false;
  } catch {
    // Feature flag fetch failure is non-fatal
  }

  return <KnowledgeBasePage activeTab="review" aiAssistantEnabled={aiAssistantEnabled} />;
}
