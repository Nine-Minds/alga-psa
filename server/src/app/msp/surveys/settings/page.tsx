import SurveySettings from '@alga-psa/surveys/components/SurveySettings';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Survey Settings',
};

export default function SurveySetupPage() {
  return <SurveySettings />;
}
