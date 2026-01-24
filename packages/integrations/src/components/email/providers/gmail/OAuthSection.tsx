"use client";

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
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
  labels: Labels;
}

export function OAuthSection({
  oauthStatus,
  onAuthorize,
  authorizeButtonId,
  buttonDisabled,
  isEditing,
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

      {/* Success state is conveyed in the header above; no countdown or extra steps. */}
    </div>
  );
}
