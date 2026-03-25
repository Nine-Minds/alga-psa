'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { RatingButton, RatingDisplay, type RatingType } from '../shared/RatingDisplay';

interface SurveyPreviewPanelProps {
  ratingType: RatingType;
  ratingScale: number;
  ratingLabels: Record<string, string>;
  promptText: string;
  commentPrompt: string;
  thankYouText: string;
}

/**
 * Inline live preview of the survey as the end user would see it.
 * Designed to sit side-by-side with the template form.
 */
export function SurveyPreviewPanel({
  ratingType,
  ratingScale,
  ratingLabels,
  promptText,
  commentPrompt,
  thankYouText,
}: SurveyPreviewPanelProps) {
  const { t } = useTranslation('common');
  const [previewTab, setPreviewTab] = useState<string>('survey');
  const [demoRating, setDemoRating] = useState<number | null>(null);

  const ratingOptions = useMemo(() => {
    return Array.from({ length: ratingScale }, (_, index) => {
      const rating = index + 1;
      const label = ratingLabels?.[String(rating)];
      return { rating, label };
    });
  }, [ratingLabels, ratingScale]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-700">
        {t('surveys.settings.templateForm.labels.preview', 'Preview')}
      </h3>

      <Tabs value={previewTab} onValueChange={setPreviewTab}>
        <TabsList>
          <TabsTrigger value="survey">
            {t('surveys.settings.preview.tabs.survey', 'Survey form')}
          </TabsTrigger>
          <TabsTrigger value="thankyou">
            {t('surveys.settings.preview.tabs.thankYou', 'Thank you')}
          </TabsTrigger>
        </TabsList>

        {/* Survey form preview */}
        <TabsContent value="survey">
          <Card className="mt-3 shadow-sm" id="survey-preview-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {promptText || t('surveys.settings.preview.noPrompt', 'Survey prompt')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  {t('surveys.response.ratingAssistive', 'Select a score from 1 to {{scale}}', {
                    scale: ratingScale,
                  })}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ratingOptions.map(({ rating, label }) => (
                    <RatingButton
                      key={rating}
                      rating={rating}
                      type={ratingType}
                      scale={ratingScale}
                      label={label}
                      selected={demoRating === rating}
                      onClick={() => setDemoRating(rating)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
                  {commentPrompt ||
                    t('surveys.response.commentLabel', 'Additional comments (optional)')}
                </label>
                <TextArea
                  className="min-h-[80px]"
                  disabled
                  placeholder={t(
                    'surveys.settings.preview.commentPlaceholder',
                    'Customer comments will appear here...'
                  )}
                />
              </div>

              <div className="flex justify-end">
                <Button id="survey-preview-submit" type="button" size="sm" disabled>
                  {t('surveys.response.submitButton', 'Submit feedback')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Thank-you screen preview */}
        <TabsContent value="thankyou">
          <Card className="mt-3 shadow-sm" id="survey-preview-thankyou-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t('surveys.response.submittedTitle', 'Thank you for your response!')}
              </CardTitle>
              <CardDescription>
                {promptText || t('surveys.settings.preview.noPrompt', 'Survey prompt')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {thankYouText || t('surveys.settings.preview.noThankYou', 'Thank you message')}
              </p>
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                <span className="text-xs font-medium text-gray-600">
                  {t('surveys.response.ratingSubmitted', 'Feedback submitted')}:
                </span>
                <RatingDisplay
                  rating={Math.ceil(ratingScale / 2)}
                  type={ratingType}
                  scale={ratingScale}
                  size="md"
                />
                <span className="text-xs text-gray-500">
                  ({Math.ceil(ratingScale / 2)} / {ratingScale})
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-gray-400">
        {t(
          'surveys.settings.preview.notice',
          'This is a preview. The actual survey is sent to customers via email.'
        )}
      </p>
    </div>
  );
}

export default SurveyPreviewPanel;
