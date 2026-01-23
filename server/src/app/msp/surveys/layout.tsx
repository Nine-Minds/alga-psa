import SurveyModuleFrame from '@alga-psa/surveys/components/SurveyModuleFrame';

export default function SurveysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SurveyModuleFrame>{children}</SurveyModuleFrame>;
}
