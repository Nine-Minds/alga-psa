'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { submitSurveyResponse } from 'server/src/lib/actions/surveyResponseActions';
import type { SurveyInvitationView } from 'server/src/lib/actions/surveyResponseActions';
import { useTranslation } from 'server/src/lib/i18n/client';

interface SurveyResponsePageProps {
  token: string;
  invitation: SurveyInvitationView;
  initialRating?: number | null;
}

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error';

export function SurveyResponsePage({ token, invitation, initialRating }: SurveyResponsePageProps) {
  const { t } = useTranslation('common');
  const formInstanceId = useId();
  const [selectedRating, setSelectedRating] = useState<number | null>(initialRating ?? null);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<SubmissionState>(initialRating ? 'submitting' : 'idle');
  const [error, setError] = useState<string | null>(null);

  const ratingScale = invitation.template.ratingScale;
  const ratingOptions = useMemo(() => {
    return Array.from({ length: ratingScale }, (_, index) => {
      const rating = index + 1;
      const label = invitation.template.ratingLabels?.[String(rating)];
      return { rating, label };
    });
  }, [invitation.template.ratingLabels, ratingScale]);

  const thankYouMessage = invitation.template.thankYouText;

  const submitResponse = async (rating: number, commentText: string) => {
    setStatus('submitting');
    setError(null);
    try {
      await submitSurveyResponse({
        token,
        rating,
        comment: commentText.trim() || undefined,
      });
      setStatus('success');
    } catch (err) {
      console.error('[SurveyResponsePage] Failed to submit survey response', err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('surveys.response.errorMessage', 'We could not record your feedback. Please try again.')
      );
      setStatus('error');
    }
  };

  useEffect(() => {
    if (
      initialRating &&
      Number.isInteger(initialRating) &&
      initialRating >= 1 &&
      initialRating <= ratingScale
    ) {
      void submitResponse(initialRating, '');
      setSelectedRating(initialRating);
    } else {
      setStatus('idle');
    }
    // We intentionally run this effect only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRatingSelect = (rating: number) => {
    if (status === 'success') {
      return;
    }
    setSelectedRating(rating);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRating) {
      setError(t('surveys.response.selectRatingError', 'Select a rating before submitting.'));
      return;
    }
    await submitResponse(selectedRating, comment);
  };

  if (status === 'success') {
    return (
      <Card className="mx-auto max-w-xl shadow-lg" id="survey-response-success-card">
        <CardHeader>
          <CardTitle>{t('surveys.response.submittedTitle', 'Thank you for your response!')}</CardTitle>
          <CardDescription>{invitation.template.promptText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>{t('surveys.response.submittedMessage', thankYouMessage, { thankYouText: thankYouMessage })}</p>
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
            <span className="font-medium">
              {t('surveys.response.ratingSubmitted', 'Feedback submitted')}
            </span>{' '}
            · {selectedRating} / {ratingScale}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-xl shadow-lg" id="survey-response-card">
      <form onSubmit={handleSubmit} className="space-y-6">
        <CardHeader>
          <CardTitle>{invitation.template.promptText}</CardTitle>
          <CardDescription>
            {t('surveys.response.ratingPrompt', 'How was your experience?')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === 'submitting' && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3">
              <LoadingIndicator layout="inline" text={t('surveys.response.submitting', 'Submitting feedback…')} />
            </div>
          )}

          {error && (
            <Alert variant="destructive" id={`${formInstanceId}-error`}>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('surveys.response.ratingAssistive', 'Select a score from 1 to {{scale}}', { scale: ratingScale })}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ratingOptions.map(({ rating, label }) => {
                const isSelected = selectedRating === rating;
                return (
                  <Button
                    key={rating}
                    id={`survey-response-rating-${rating}`}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    className="flex flex-col items-center gap-1 py-4 text-base"
                    onClick={() => handleRatingSelect(rating)}
                    disabled={status === 'submitting'}
                    aria-pressed={isSelected}
                    aria-label={
                      label
                        ? `${rating} – ${label}`
                        : t('surveys.response.ratingAssistive', 'Select a score from 1 to {{scale}}', {
                            scale: ratingScale,
                          })
                    }
                  >
                    <span className="text-xl font-semibold">{rating}</span>
                    {label && <span className="text-xs text-gray-600">{label}</span>}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor={`${formInstanceId}-comment`}>
              {t('surveys.response.commentLabel', 'Additional comments (optional)')}
            </label>
            <TextArea
              id={`${formInstanceId}-comment`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="min-h-[120px]"
              disabled={status === 'submitting'}
            />
          </div>

          <div className="flex justify-end">
            <Button
              id={`${formInstanceId}-submit`}
              type="submit"
              disabled={status === 'submitting' || !selectedRating}
            >
              {status === 'submitting'
                ? t('surveys.response.submitting', 'Submitting feedback…')
                : t('surveys.response.submitButton', 'Submit feedback')}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

export default SurveyResponsePage;
