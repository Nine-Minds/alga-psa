import SurveyModuleFrame from 'server/src/components/surveys/SurveyModuleFrame';

export default function SurveysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SurveyModuleFrame>{children}</SurveyModuleFrame>;
}
