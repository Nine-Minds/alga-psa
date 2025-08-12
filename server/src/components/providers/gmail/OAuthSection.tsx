"use client";

import React from 'react';
import { Button } from 'server/src/components/ui/Button';
import { CheckCircle, Clock } from 'lucide-react';

export type OAuthStatus = 'idle' | 'authorizing' | 'success' | 'error';

interface Labels {
  title: string;
  descriptionIdle: string;
  descriptionSuccess: string;
  buttonIdleText: string;
  buttonAuthorizingText?: string;
  buttonSuccessText?: string;
}

interface Props {
  oauthStatus: OAuthStatus;
  onAuthorize: () => void | Promise<void>;
  authorizeButtonId: string;
  buttonDisabled: boolean;
  isEditing: boolean;
  autoSubmitCountdown: number | null;
  onCancelAutoSubmit: () => void;
  labels: Labels;
}

export function OAuthSection({
  oauthStatus,
  onAuthorize,
  authorizeButtonId,
  buttonDisabled,
  isEditing,
  autoSubmitCountdown,
  onCancelAutoSubmit,
  labels,
}: Props) {
  return (
    <div className="space-y-4">
      <div className={`p-4 rounded-lg transition-colors ${
        oauthStatus === 'success' ? 'bg-green-50 border-2 border-green-200' : 'bg-blue-50'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium">{labels.title}</h4>
            <p className="text-sm text-muted-foreground">
              {oauthStatus === 'success' ? labels.descriptionSuccess : labels.descriptionIdle}
            </p>
          </div>
          <Button
            id={authorizeButtonId}
            type="button"
            variant="outline"
            onClick={onAuthorize}
            disabled={buttonDisabled || oauthStatus === 'authorizing'}
          >
            {oauthStatus === 'authorizing' && (
              <>
                <Clock className="h-4 w-4 mr-2 animate-spin" />
                {labels.buttonAuthorizingText || 'Authorizing...'}
              </>
            )}
            {oauthStatus === 'success' && (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                {labels.buttonSuccessText || 'Authorized'}
              </>
            )}
            {(oauthStatus === 'idle' || oauthStatus === 'error') && labels.buttonIdleText}
          </Button>
        </div>
      </div>

      {oauthStatus === 'success' && (
        <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                  <span className="text-amber-600 font-semibold">2</span>
                </div>
              </div>
              <div className="ml-3">
                <h4 className="font-medium text-amber-800">Complete Setup</h4>
                <p className="text-sm text-amber-700">
                  {autoSubmitCountdown !== null ? (
                    <>Auto-completing in <strong>{autoSubmitCountdown}</strong> seconds, or click "<strong>{isEditing ? 'Update Provider' : 'Add Provider'}</strong>" below now.</>
                  ) : (
                    <>Click "<strong>{isEditing ? 'Update Provider' : 'Add Provider'}</strong>" below to finish configuration.</>
                  )}
                </p>
              </div>
            </div>
            {autoSubmitCountdown !== null && (
              <Button
                id="cancel-auto-submit"
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancelAutoSubmit}
              >
                Cancel Auto-Submit
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

