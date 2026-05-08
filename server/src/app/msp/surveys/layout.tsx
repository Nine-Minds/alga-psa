import SurveyModuleFrame from '@alga-psa/surveys/components/SurveyModuleFrame';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/surveys', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  return <SurveyModuleFrame>{children}</SurveyModuleFrame>;
}
