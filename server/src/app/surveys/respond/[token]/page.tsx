import { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import SurveyResponsePage from 'server/src/components/surveys/public/SurveyResponsePage';
import { getSurveyInvitationForToken } from 'server/src/lib/actions/surveyResponseActions';
import { getServerTranslation } from 'server/src/lib/i18n/server';

type PageParams = {
  params: { token: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();

  return {
    title: t('surveys.response.pageTitle', 'Customer Satisfaction Survey'),
  };
}

function parseInitialRating(
  searchParams?: Record<string, string | string[] | undefined>
): number | null {
  if (!searchParams) {
    return null;
  }

  const value = searchParams.rating;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function Page({ params, searchParams }: PageParams) {
  const { token } = params;
  const initialRating = parseInitialRating(searchParams);
  const { t } = await getServerTranslation();

  try {
    const invitation = await getSurveyInvitationForToken(token);

    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4">
        <SurveyResponsePage
          token={token}
          invitation={invitation}
          initialRating={initialRating ?? undefined}
        />
      </div>
    );
  } catch (error) {
    console.error('[SurveyResponsePage] Invalid survey token', error);

    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4">
        <Card className="mx-auto max-w-xl shadow-lg" id="survey-response-invalid-card">
          <CardHeader>
            <CardTitle>{t('surveys.response.invalidTitle', 'Survey unavailable')}</CardTitle>
            <CardDescription>{t('surveys.response.invalidMessage', 'This feedback link is no longer valid or has already been used.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              {t('surveys.response.supportMessage', 'If you have questions, please contact your technician.')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
}
