/**
 * Email Provider Selector Component
 * Displays a card-based selection interface for choosing between Google and Microsoft email providers
 */

'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Search, Building2, Mail } from 'lucide-react';

interface EmailProviderSelectorProps {
  onProviderSelected: (providerType: 'google' | 'microsoft' | 'imap') => void;
  onCancel?: () => void;
  hideHeader?: boolean;
}

export function EmailProviderSelector({ 
  onProviderSelected, 
  onCancel,
  hideHeader = false,
}: EmailProviderSelectorProps) {
  
  const handleProviderClick = (providerType: 'google' | 'microsoft' | 'imap') => {
    onProviderSelected(providerType);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      {!hideHeader && (
        <div className="text-center">
          <h3 className="text-lg font-semibold">Choose Your Email Provider</h3>
          <p className="text-muted-foreground mt-2">
            Select the email service you want to use for inbound email processing. 
            You can configure multiple email providers per account.
          </p>
        </div>
      )}

      {/* Provider Selection Cards */}
      <div id="email-provider-selector" className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        
        {/* Google Gmail Card */}
        <Card 
          id="google-provider-selector-card"
          className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-2 hover:border-green-200 bg-gradient-to-br from-white to-green-50"
          onClick={() => handleProviderClick('google')}
        >
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <div className="flex items-center justify-center">
                  {/* Google-style search icon */}
                  <div className="relative w-8 h-8">
                    <Search className="h-8 w-8 text-white" />
                  </div>
                </div>
              </div>
            </div>
            <CardTitle className="text-xl font-bold text-gray-800">Gmail</CardTitle>
            <CardDescription className="text-base text-gray-600">
              Google Workspace / Gmail Integration
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="text-sm text-gray-600 space-y-2">
              <p>✓ Gmail and Google Workspace accounts</p>
              <p>✓ Label-based email filtering</p>
              <p>✓ Real-time email processing</p>
              <p>✓ Automatic OAuth authentication</p>
            </div>
            <Button 
              id="setup-google-provider-button"
              className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                handleProviderClick('google');
              }}
            >
              Set up Gmail
            </Button>
          </CardContent>
        </Card>

        {/* Microsoft 365 Card */}
        <Card 
          id="microsoft-provider-selector-card"
          className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-2 hover:border-blue-200 bg-gradient-to-br from-white to-blue-50"
          onClick={() => handleProviderClick('microsoft')}
        >
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 shadow-lg">
                <div className="flex items-center justify-center">
                  {/* Microsoft-style building/enterprise icon */}
                  <Building2 className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>
            <CardTitle className="text-xl font-bold text-gray-800">Microsoft 365</CardTitle>
            <CardDescription className="text-base text-gray-600">
              Microsoft 365 / Outlook Integration
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="text-sm text-gray-600 space-y-2">
              <p>✓ Microsoft 365 and Outlook accounts</p>
              <p>✓ Folder-based email filtering</p>
              <p>✓ Real-time email processing</p>
              <p>✓ Azure AD OAuth integration</p>
            </div>
            <Button 
              id="setup-microsoft-provider-button"
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                handleProviderClick('microsoft');
              }}
            >
              Set up Microsoft 365
            </Button>
          </CardContent>
        </Card>

        {/* IMAP Card */}
        <Card
          id="imap-provider-selector-card"
          className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-2 hover:border-indigo-200 bg-gradient-to-br from-white to-indigo-50"
          onClick={() => handleProviderClick('imap')}
        >
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg">
                <div className="flex items-center justify-center">
                  <Mail className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>
            <CardTitle className="text-xl font-bold text-gray-800">IMAP</CardTitle>
            <CardDescription className="text-base text-gray-600">
              Custom IMAP Server Integration
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="text-sm text-gray-600 space-y-2">
              <p>✓ Any IMAP-compliant mailbox</p>
              <p>✓ Folder-based email filtering</p>
              <p>✓ OAuth2 or password authentication</p>
              <p>✓ Real-time IDLE listener</p>
            </div>
            <Button
              id="setup-imap-provider-button"
              className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-semibold shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                handleProviderClick('imap');
              }}
            >
              Set up IMAP
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Cancel Button (if provided) */}
      {onCancel && (
        <div className="text-center">
          <Button 
            id="cancel-provider-selection-button"
            variant="outline" 
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Help Text */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
          Choose the provider your organization already uses. If you use Google Workspace, pick Gmail; if you use Microsoft 365, pick Microsoft 365. You can change this later by removing and reconfiguring your email provider.
        </p>
      </div>
    </div>
  );
}
