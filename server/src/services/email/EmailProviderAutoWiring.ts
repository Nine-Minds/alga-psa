/**
 * Email Provider Auto-Wiring Service
 * Automatically configures email providers and establishes connections
 */

import { EmailProviderService } from './EmailProviderService';
import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import { GmailAdapter } from './providers/GmailAdapter';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import axios from 'axios';

export interface AutoWiringResult {
  success: boolean;
  provider?: EmailProviderConfig;
  status: 'configured' | 'failed' | 'partial';
  steps: AutoWiringStep[];
  error?: string;
}

export interface AutoWiringStep {
  step: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
  timestamp: string;
}

export interface MicrosoftAutoWiringConfig {
  tenant: string;
  providerName: string;
  mailbox: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  redirectUri: string;
  authorizationCode: string; // OAuth authorization code from frontend
}

export interface GmailAutoWiringConfig {
  tenant: string;
  providerName: string;
  mailbox: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
  redirectUri: string;
  authorizationCode: string; // OAuth authorization code from frontend
  pubsubTopicName: string;
  pubsubSubscriptionName: string;
}

export class EmailProviderAutoWiring {
  private emailProviderService: EmailProviderService;
  private steps: AutoWiringStep[] = [];

  constructor() {
    this.emailProviderService = new EmailProviderService();
  }

  /**
   * Auto-wire Microsoft 365 email provider
   */
  async autoWireMicrosoft(config: MicrosoftAutoWiringConfig): Promise<AutoWiringResult> {
    this.steps = [];
    
    try {
      console.log(`🔧 Starting Microsoft auto-wiring for: ${config.mailbox}`);

      // Step 1: Exchange authorization code for tokens
      this.addStep('oauth_exchange', 'Exchange authorization code for access tokens', 'in_progress');
      
      const tokens = await this.exchangeMicrosoftAuthCode(config);
      this.updateLastStep('completed');

      // Step 2: Create provider configuration
      this.addStep('create_provider', 'Create email provider configuration', 'in_progress');
      
      const providerData = {
        tenant: config.tenant,
        providerType: 'microsoft' as const,
        providerName: config.providerName,
        mailbox: config.mailbox,
        isActive: true,
        vendorConfig: {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          tenantId: config.tenantId || 'common',
          redirectUri: config.redirectUri,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.expiresAt,
          autoProcessEmails: true,
          folderFilters: ['Inbox'],
          maxEmailsPerSync: 50
        }
      };

      const provider = await this.emailProviderService.createProvider(providerData);
      this.updateLastStep('completed');

      // Step 3: Test connection
      this.addStep('test_connection', 'Test connection to Microsoft Graph API', 'in_progress');
      
      const adapter = new MicrosoftGraphAdapter(provider);
      const testResult = await adapter.testConnection();
      
      if (!testResult.success) {
        this.updateLastStep('failed', testResult.error);
        throw new Error(`Connection test failed: ${testResult.error}`);
      }
      this.updateLastStep('completed');

      // Step 4: Initialize webhook
      this.addStep('setup_webhook', 'Initialize webhook subscription', 'in_progress');
      
      try {
        await this.emailProviderService.initializeProviderWebhook(provider.id);
        this.updateLastStep('completed');
      } catch (webhookError: any) {
        this.updateLastStep('failed', webhookError.message);
        console.warn(`Webhook setup failed, but provider was created: ${webhookError.message}`);
        // Don't fail the entire process for webhook issues
      }

      // Step 5: Final verification
      this.addStep('final_verification', 'Verify provider is fully configured', 'in_progress');
      
      const finalProvider = await this.emailProviderService.getProvider(provider.id);
      if (finalProvider?.connection_status === 'connected') {
        this.updateLastStep('completed');
      } else {
        this.updateLastStep('failed', 'Provider not in connected state');
      }

      console.log(`✅ Microsoft auto-wiring completed for: ${config.mailbox}`);

      return {
        success: true,
        provider: finalProvider || provider,
        status: 'configured',
        steps: this.steps
      };

    } catch (error: any) {
      console.error(`❌ Microsoft auto-wiring failed for ${config.mailbox}:`, error);
      
      if (this.steps.length > 0) {
        this.updateLastStep('failed', error.message);
      }

      return {
        success: false,
        status: 'failed',
        steps: this.steps,
        error: error.message
      };
    }
  }

  /**
   * Auto-wire Gmail email provider
   */
  async autoWireGmail(config: GmailAutoWiringConfig): Promise<AutoWiringResult> {
    this.steps = [];
    
    try {
      console.log(`🔧 Starting Gmail auto-wiring for: ${config.mailbox}`);

      // Step 1: Exchange authorization code for tokens
      this.addStep('oauth_exchange', 'Exchange authorization code for access tokens', 'in_progress');
      
      const tokens = await this.exchangeGoogleAuthCode(config);
      this.updateLastStep('completed');

      // Step 2: Create provider configuration
      this.addStep('create_provider', 'Create email provider configuration', 'in_progress');
      
      const providerData = {
        tenant: config.tenant,
        providerType: 'google' as const,
        providerName: config.providerName,
        mailbox: config.mailbox,
        isActive: true,
        vendorConfig: {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          projectId: config.projectId,
          redirectUri: config.redirectUri,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.expiresAt,
          pubsubTopicName: config.pubsubTopicName,
          pubsubSubscriptionName: config.pubsubSubscriptionName,
          autoProcessEmails: true,
          labelFilters: ['INBOX'],
          maxEmailsPerSync: 50
        }
      };

      const provider = await this.emailProviderService.createProvider(providerData);
      this.updateLastStep('completed');

      // Step 3: Test connection
      this.addStep('test_connection', 'Test connection to Gmail API', 'in_progress');
      
      const adapter = new GmailAdapter(provider);
      const testResult = await adapter.testConnection();
      
      if (!testResult.success) {
        this.updateLastStep('failed', testResult.error);
        throw new Error(`Connection test failed: ${testResult.error}`);
      }
      this.updateLastStep('completed');

      // Step 4: Initialize webhook and Pub/Sub
      this.addStep('setup_webhook', 'Initialize Gmail webhook and Pub/Sub', 'in_progress');
      
      try {
        await this.emailProviderService.initializeProviderWebhook(provider.id);
        this.updateLastStep('completed');
      } catch (webhookError: any) {
        this.updateLastStep('failed', webhookError.message);
        console.warn(`Webhook setup failed, but provider was created: ${webhookError.message}`);
        // Don't fail the entire process for webhook issues
      }

      // Step 5: Final verification
      this.addStep('final_verification', 'Verify provider is fully configured', 'in_progress');
      
      const finalProvider = await this.emailProviderService.getProvider(provider.id);
      if (finalProvider?.connection_status === 'connected') {
        this.updateLastStep('completed');
      } else {
        this.updateLastStep('failed', 'Provider not in connected state');
      }

      console.log(`✅ Gmail auto-wiring completed for: ${config.mailbox}`);

      return {
        success: true,
        provider: finalProvider || provider,
        status: 'configured',
        steps: this.steps
      };

    } catch (error: any) {
      console.error(`❌ Gmail auto-wiring failed for ${config.mailbox}:`, error);
      
      if (this.steps.length > 0) {
        this.updateLastStep('failed', error.message);
      }

      return {
        success: false,
        status: 'failed',
        steps: this.steps,
        error: error.message
      };
    }
  }

  /**
   * Exchange Microsoft authorization code for tokens
   */
  private async exchangeMicrosoftAuthCode(config: MicrosoftAutoWiringConfig): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    try {
      // Get OAuth client credentials
      const secretProvider = await getSecretProviderInstance();
      const clientId = process.env.MICROSOFT_CLIENT_ID || await secretProvider.getTenantSecret(config.tenant, 'microsoft_client_id');
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || await secretProvider.getTenantSecret(config.tenant, 'microsoft_client_secret');
      
      if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth credentials not configured');
      }

      // Exchange authorization code for tokens
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: config.authorizationCode,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        scope: 'https://graph.microsoft.com/.default offline_access'
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000)
      };
    } catch (error: any) {
      console.error('Failed to exchange Microsoft authorization code:', error.response?.data || error.message);
      throw new Error(`Microsoft token exchange failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Exchange Google authorization code for tokens
   */
  private async exchangeGoogleAuthCode(config: GmailAutoWiringConfig): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    try {
      // Get OAuth client credentials
      const secretProvider = await getSecretProviderInstance();
      const clientId = process.env.GOOGLE_CLIENT_ID || await secretProvider.getTenantSecret(config.tenant, 'google_client_id');
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || await secretProvider.getTenantSecret(config.tenant, 'google_client_secret');
      
      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth credentials not configured');
      }

      // Exchange authorization code for tokens
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: config.authorizationCode,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      // Note: Google may not return a refresh token on subsequent authorizations
      // unless you force re-approval or it's the first authorization
      return {
        accessToken: access_token,
        refreshToken: refresh_token || '',
        expiresAt: new Date(Date.now() + expires_in * 1000)
      };
    } catch (error: any) {
      console.error('Failed to exchange Google authorization code:', error.response?.data || error.message);
      throw new Error(`Google token exchange failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Add a new step to the auto-wiring process
   */
  private addStep(step: string, description: string, status: AutoWiringStep['status']): void {
    this.steps.push({
      step,
      description,
      status,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Update the status of the last step
   */
  private updateLastStep(status: AutoWiringStep['status'], error?: string): void {
    if (this.steps.length === 0) return;
    
    const lastStep = this.steps[this.steps.length - 1];
    lastStep.status = status;
    if (error) {
      lastStep.error = error;
    }
  }

  /**
   * Get auto-wiring status for a provider
   */
  async getAutoWiringStatus(providerId: string): Promise<{
    isAutoWired: boolean;
    status: string;
    lastAutoWiring?: string;
    steps?: AutoWiringStep[];
  }> {
    try {
      const provider = await this.emailProviderService.getProvider(providerId);
      if (!provider) {
        return { isAutoWired: false, status: 'not_found' };
      }

      // Check if provider has auto-wiring metadata
      const autoWiringData = (provider.provider_config as any)?.autoWiring;
      
      return {
        isAutoWired: !!autoWiringData,
        status: provider.connection_status,
        lastAutoWiring: autoWiringData?.lastRun,
        steps: autoWiringData?.lastSteps
      };

    } catch (error: any) {
      console.error(`Error getting auto-wiring status for ${providerId}:`, error);
      return { isAutoWired: false, status: 'error' };
    }
  }
}