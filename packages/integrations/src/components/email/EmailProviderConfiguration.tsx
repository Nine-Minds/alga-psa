/**
 * Email Provider Configuration Component
 * Main interface for managing email provider configurations (Microsoft and Gmail)
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertTriangle, Plus, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  GmailProviderForm,
  ImapProviderForm,
  MicrosoftProviderForm,
} from '@alga-psa/integrations/email/providers/entry';
import { EmailProviderList } from './EmailProviderList';
import { ProviderSetupWizardDialog } from './ProviderSetupWizardDialog';
import { InboundTicketDefaultsManager } from './admin/InboundTicketDefaultsManager';
import { InboundEmailRulesManager } from './admin/InboundEmailRulesManager';
import { Microsoft365DiagnosticsDialog } from './admin/Microsoft365DiagnosticsDialog';
import { DrawerOutlet, DrawerProvider, useDrawer } from '@alga-psa/ui';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEmailProviders,
  deleteEmailProvider,
  testEmailProviderConnection,
  resyncImapProvider,
  retryMicrosoftSubscriptionRenewal
} from '../../actions/email-actions/emailProviderActions';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  EmailProvider,
  GoogleEmailProviderConfig,
  ImapEmailProviderConfig,
  MicrosoftEmailProviderConfig,
} from './types';
import { isMicrosoftConsumerEnterpriseEdition } from '../../lib/microsoftConsumerVisibility';
import { getMicrosoftConsumerSetupStatus } from '@alga-psa/integrations/actions';
import type { MicrosoftCredentialCapability } from '../../actions/integrations/providerReadiness';

export interface EmailProviderConfigurationProps {
  onProviderAdded?: (provider: EmailProvider) => void;
  onProviderUpdated?: (provider: EmailProvider) => void;
  onProviderDeleted?: (providerId: string) => void;
}

function EmailProviderConfigurationContent({
  onProviderAdded,
  onProviderUpdated,
  onProviderDeleted
}: EmailProviderConfigurationProps) {
  const { t } = useTranslation('msp/email-providers');
  const isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition();
  const [providers, setProviders] = useState<EmailProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showDefaultsManager, setShowDefaultsManager] = useState(false);
  const [tenant, setTenant] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'providers' | 'defaults' | 'rules'>('providers');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsProvider, setDiagnosticsProvider] = useState<EmailProvider | null>(null);
  const [microsoftCredentialCapability, setMicrosoftCredentialCapability] = useState<MicrosoftCredentialCapability | null | undefined>(undefined);
  const { openDrawer, closeDrawer } = useDrawer();

  // Load existing providers on component mount
  useEffect(() => {
    loadProviders();
  }, []);

  useEffect(() => {
    if (!isEnterpriseEdition) return;

    const loadMicrosoftCredentialCapability = async () => {
      try {
        const result = await getMicrosoftConsumerSetupStatus('email');
        setMicrosoftCredentialCapability(result.success ? result.credentialCapability || null : null);
      } catch {
        setMicrosoftCredentialCapability(null);
      }
    };

    loadMicrosoftCredentialCapability();
  }, [isEnterpriseEdition]);

  // Get tenant on mount
  useEffect(() => {
    const fetchTenant = async () => {
      try {
        const user = await getCurrentUser();
        if (user?.tenant) {
          setTenant(user.tenant);
        }
      } catch (error) {
        console.error('Failed to get tenant:', error);
      }
    };
    fetchTenant();
  }, []);

  // Listen for requests to open defaults tab from child forms
  useEffect(() => {
    const openDefaults = () => setActiveSection('defaults');
    window.addEventListener('open-defaults-tab', openDefaults);
    return () => window.removeEventListener('open-defaults-tab', openDefaults);
  }, []);

  // Wizard handles add flow; no inline auto-open

  const loadProviders = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getEmailProviders();
      setProviders(data.providers || []);
    } catch (err) {
      console.error('Failed to load email providers:', err);
      setError(t('configuration.feedback.loadProvidersError', {
        defaultValue: 'Failed to load email providers',
      }));
    } finally {
      setLoading(false);
    }
  };

  // Add handled via wizard; we refresh list on completion

  const handleProviderUpdated = (provider: EmailProvider) => {
    setProviders(prev => prev.map(p => p.id === provider.id ? provider : p));
    onProviderUpdated?.(provider);
  };

  const handleProviderDeleted = async (providerId: string) => {
    try {
      const result = await deleteEmailProvider(providerId);
      if (isActionMessageError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      setProviders(prev => prev.filter(p => p.id !== providerId));

      // No inline selector; wizard handles starting setup

      onProviderDeleted?.(providerId);
    } catch (err: any) {
      setError(getErrorMessage(err));
    }
  };

  const handleTestConnection = async (provider: EmailProvider) => {
    try {
      setError(null);

      const toastId = toast.loading(t('configuration.feedback.testingConnection', {
        defaultValue: 'Testing connection for {{providerName}}...',
        providerName: provider.providerName,
      }));
      const result = await testEmailProviderConnection(provider.id);

      if (result.success) {
        // Update provider status
        const updatedProvider = { ...provider, status: 'connected' as const };
        handleProviderUpdated(updatedProvider);
        toast.success(t('configuration.feedback.connectionSuccess', {
          defaultValue: 'Connected to {{providerName}}.',
          providerName: provider.providerName,
        }), { id: toastId });
      } else {
        const message = result.error || t('configuration.feedback.connectionError', {
          defaultValue: 'Connection test failed',
        });
        setError(message);
        toast.error(message, { id: toastId });
      }
    } catch (err) {
      const message = t('configuration.feedback.connectionError', {
        defaultValue: 'Connection test failed',
      });
      setError(message);
      handleError(err, message);
    }
  };

  const handleRefreshWatchSubscription = async (provider: EmailProvider) => {
    try {
      setError(null);

      const response = await fetch('/api/email/refresh-watch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: provider.id }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Refresh the providers list to show updated status
        await loadProviders();
      } else {
        setError(result.error || t('configuration.feedback.refreshWatchError', {
          defaultValue: 'Failed to refresh watch subscription',
        }));
      }
    } catch (err) {
      console.error('Failed to refresh email watch subscription:', err);
      setError(t('configuration.feedback.refreshWatchError', {
        defaultValue: 'Failed to refresh watch subscription',
      }));
    }
  };

  const handleRetryRenewal = async (provider: EmailProvider) => {
    try {
      setError(null);
      const result = await retryMicrosoftSubscriptionRenewal(provider.id);
      if (result.success) {
        await loadProviders();
      } else {
        setError(result.message || t('configuration.feedback.renewalError', {
          defaultValue: 'Renewal failed',
        }));
      }
    } catch (err) {
      console.error('Failed to retry email subscription renewal:', err);
      setError(t('configuration.feedback.renewalError', {
        defaultValue: 'Renewal failed',
      }));
    }
  };

  const handleReconnectOAuth = async (provider: EmailProvider) => {
    try {
      setError(null);
      const response = await fetch('/api/email/oauth/imap/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.authUrl) {
        throw new Error(result.error || t('configuration.feedback.initiateOauthError', {
          defaultValue: 'Failed to initiate IMAP OAuth',
        }));
      }
      window.open(result.authUrl, '_blank', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to initiate IMAP OAuth:', err);
      setError(t('configuration.feedback.initiateOauthError', {
        defaultValue: 'Failed to initiate IMAP OAuth',
      }));
    }
  };

  const handleResyncProvider = async (provider: EmailProvider) => {
    try {
      setError(null);
      const toastId = toast.loading(t('configuration.feedback.resyncing', {
        defaultValue: 'Resyncing {{providerName}}...',
        providerName: provider.providerName,
      }));
      const result = await resyncImapProvider(provider.id);
      if (!result.success) {
        const message = result.error || t('configuration.feedback.resyncError', {
          defaultValue: 'Failed to resync IMAP provider',
        });
        toast.error(message, { id: toastId });
        setError(message);
        return;
      }
      toast.success(t('configuration.feedback.resyncStarted', {
        defaultValue: 'Resync started for {{providerName}}.',
        providerName: provider.providerName,
      }), { id: toastId });
      await loadProviders();
    } catch (err) {
      const message = t('configuration.feedback.resyncError', {
        defaultValue: 'Failed to resync IMAP provider',
      });
      setError(message);
      handleError(err, message);
    }
  };

  const handleRunDiagnostics = (provider: EmailProvider) => {
    setDiagnosticsProvider(provider);
    setDiagnosticsOpen(true);
  };

  // Inline add/setup flow removed in favor of wizard

  const handleEditCancel = () => {
    closeDrawer();
  };

  const openEditDrawer = (provider: EmailProvider) => {
    if (!isEnterpriseEdition && provider.providerType === 'microsoft') {
      setError(t('configuration.feedback.enterpriseOnly', {
        defaultValue: 'Microsoft 365 inbound email is only available in Pro.',
      }));
      return;
    }

    openDrawer(
      (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{t('configuration.editDrawer.title', {
              defaultValue: 'Edit Email Provider',
            })}</h2>
            <p className="text-sm text-muted-foreground">{t('configuration.editDrawer.description', {
              defaultValue: 'Update configuration for {{providerName}}',
              providerName: provider.providerName,
            })}</p>
          </div>
          {provider.providerType === 'microsoft' && (
            <MicrosoftProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
              credentialCapability={microsoftCredentialCapability}
            />
          )}
          {provider.providerType === 'google' && (
            <GmailProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
            />
          )}
          {provider.providerType === 'imap' && (
            <ImapProviderForm
              tenant={tenant}
              provider={provider}
              onSuccess={(p) => { handleProviderUpdated(p); closeDrawer(); }}
              onCancel={handleEditCancel}
            />
          )}
        </div>
      )
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingIndicator 
          layout="stacked" 
          text={t('configuration.loading', {
            defaultValue: 'Loading email providers...',
          })}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  // Build right-hand content for Providers section
  const renderProvidersContent = () => {
    const visibleProviders = isEnterpriseEdition
      ? providers
      : providers.filter((provider) => provider.providerType !== 'microsoft');
    const providerCounts = providers.reduce(
      (acc, provider) => {
        acc[provider.providerType] = (acc[provider.providerType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    // Standard providers view with wizard-based add flow
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{t('configuration.header.title', {
              defaultValue: 'Email Provider Configuration',
            })}</h2>
            <p className="text-muted-foreground">
              {isEnterpriseEdition
                ? t('configuration.header.description.enterprise', {
                  defaultValue: 'Configure Gmail, Microsoft 365, or IMAP providers to receive and process inbound emails as tickets',
                })
                : t('configuration.header.description.standard', {
                  defaultValue: 'Configure Gmail or IMAP providers to receive and process inbound emails as tickets',
                })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {isEnterpriseEdition
                ? t('configuration.header.counts.enterprise', {
                  defaultValue: 'Gmail: {{gmail}} · Microsoft: {{microsoft}} · IMAP: {{imap}}',
                  gmail: providerCounts.google || 0,
                  microsoft: providerCounts.microsoft || 0,
                  imap: providerCounts.imap || 0,
                })
                : t('configuration.header.counts.standard', {
                  defaultValue: 'Gmail: {{gmail}} · IMAP: {{imap}}',
                  gmail: providerCounts.google || 0,
                  imap: providerCounts.imap || 0,
                })}
            </p>
          </div>
          <Button
            id="add-provider-btn"
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('configuration.actions.addProvider', {
              defaultValue: 'Add Email Provider',
            })}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <EmailProviderList
          providers={visibleProviders}
          onEdit={openEditDrawer}
          onDelete={handleProviderDeleted}
          onTestConnection={handleTestConnection}
          onRefresh={loadProviders}
          onRefreshWatchSubscription={handleRefreshWatchSubscription}
          onRetryRenewal={handleRetryRenewal}
          onReconnectOAuth={handleReconnectOAuth}
          onResyncProvider={handleResyncProvider}
          onRunDiagnostics={handleRunDiagnostics}
          onAddClick={() => setWizardOpen(true)}
        />


        {/* Help Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t('configuration.setup.title', {
              defaultValue: 'Setup Instructions',
            })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEnterpriseEdition && (
              <div className="space-y-3">
                <h4 className="font-medium mb-2">{t('configuration.setup.microsoft.title', {
                  defaultValue: 'Microsoft 365 Setup',
                })}</h4>
                {microsoftCredentialCapability === undefined ? (
                  <p className="text-sm text-muted-foreground">
                    {t('configuration.setup.microsoft.checkingCredentials', { defaultValue: 'Checking Microsoft credential availability…' })}
                  </p>
                ) : microsoftCredentialCapability?.source === 'platform' ? (
                  <>
                    <Alert>
                      <ShieldCheck className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-medium">{t('configuration.setup.microsoft.platform.title', { defaultValue: 'Microsoft sign-in is ready' })}</div>
                        <div className="text-sm text-muted-foreground">
                          {t('configuration.setup.microsoft.platform.description', { defaultValue: 'Alga PSA supplies the Microsoft application. Add a provider, enter the mailbox details, and connect with Microsoft—no Entra app registration is needed.' })}
                        </div>
                      </AlertDescription>
                    </Alert>
                    <details className="rounded-md border px-3 py-2 text-sm">
                      <summary id="microsoft-byo-setup-summary" className="cursor-pointer font-medium">
                        {t('configuration.setup.microsoft.byo.summary', { defaultValue: 'Advanced: use your own Microsoft app' })}
                      </summary>
                      <div className="mt-2 space-y-2 text-muted-foreground">
                        <p className="text-[rgb(var(--badge-warning-text))]">
                          {t('configuration.setup.microsoft.byo.warning', { defaultValue: 'This is normally unnecessary on hosted Alga PSA and should be used only when your organization requires its own Entra application.' })}
                        </p>
                        <p>{t('configuration.setup.microsoft.byo.description', { defaultValue: 'Open Settings → Integrations → Providers, expand the Microsoft advanced options, and add your tenant-owned app before returning here.' })}</p>
                      </div>
                    </details>
                  </>
                ) : microsoftCredentialCapability?.source === 'tenant' ? (
                  <Alert variant={microsoftCredentialCapability.ready ? 'default' : 'warning'}>
                    {microsoftCredentialCapability.ready ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    <AlertDescription>
                      <div className="font-medium">
                        {microsoftCredentialCapability.ready
                          ? t('configuration.setup.microsoft.tenant.title', { defaultValue: 'Your organization’s Microsoft app is selected' })
                          : t('configuration.setup.microsoft.tenant.incompleteTitle', { defaultValue: 'Your Microsoft app needs attention' })}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {microsoftCredentialCapability.ready
                          ? t('configuration.setup.microsoft.tenant.description', { defaultValue: 'New Microsoft mailboxes will use the tenant-owned app selected in Providers settings. This choice is preserved even when platform credentials are available.' })
                          : microsoftCredentialCapability.message || t('configuration.setup.microsoft.tenant.incompleteDescription', { defaultValue: 'Finish configuring the Microsoft app selected in Providers settings before connecting a mailbox.' })}
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <p>{t('configuration.setup.microsoft.manualRequired', { defaultValue: 'Platform Microsoft credentials are unavailable in this deployment. Configure your own Microsoft app to connect a mailbox.' })}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        1. {t('configuration.setup.microsoft.steps.registerApp', { defaultValue: 'Register an application in Azure AD' })}<br/>
                        2. {t('configuration.setup.microsoft.steps.permissions', { defaultValue: 'Configure API permissions for Mail.Read' })}<br/>
                        3. {t('configuration.setup.microsoft.steps.redirectUrl', { defaultValue: 'Set up the redirect URL in your app registration' })}<br/>
                        4. {t('configuration.setup.microsoft.steps.credentials', { defaultValue: 'Use the Client ID and Client Secret in the form above' })}
                      </p>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            <div>
              <h4 className="font-medium mb-2">{t('configuration.setup.gmail.title', {
                defaultValue: 'Gmail Setup',
              })}</h4>
              <p className="text-sm text-muted-foreground">
                {process.env.NEXT_PUBLIC_EDITION === 'enterprise' ? (
                  <>
                    1. {t('configuration.setup.gmail.enterpriseSteps.enterAddress', {
                      defaultValue: 'Enter your Gmail address and provider name',
                    })}<br/>
                    2. {t('configuration.setup.gmail.enterpriseSteps.connect', {
                      defaultValue: 'Click "Connect Gmail" to authorize access',
                    })}<br/>
                    3. {t('configuration.setup.gmail.enterpriseSteps.preferences', {
                      defaultValue: 'Configure email processing preferences',
                    })}<br/>
                    4. {t('configuration.setup.gmail.enterpriseSteps.save', {
                      defaultValue: 'Save to complete setup',
                    })}
                  </>
                ) : (
                  <>
                    1. {t('configuration.setup.gmail.standardSteps.project', {
                      defaultValue: 'Create a project in Google Cloud Console',
                    })}<br/>
                    2. {t('configuration.setup.gmail.standardSteps.oauth', {
                      defaultValue: 'Enable Gmail API and create OAuth2 credentials',
                    })}<br/>
                    3. {t('configuration.setup.gmail.standardSteps.pubsub', {
                      defaultValue: 'Set up Pub/Sub topic for push notifications',
                    })}<br/>
                    4. {t('configuration.setup.gmail.standardSteps.consent', {
                      defaultValue: 'Configure the OAuth consent screen and add test users',
                    })}
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // Vertical layout wrapper with left nav
  return (
    <div className="flex gap-6">
      {/* Vertical tabs area with subtle separator bar and no card */}
      <div className="w-56 shrink-0 pr-4 mr-4 border-r border-[rgb(var(--color-border-200))]">
        <nav className="flex flex-col gap-1">
          <Button
            id="nav-providers"
            variant="ghost"
            className={`justify-start w-full px-2 py-2 rounded-md ${
              activeSection === 'providers'
                ? 'text-[rgb(var(--color-primary-700))] font-semibold underline decoration-[rgb(var(--color-primary-600))] decoration-2 underline-offset-4 bg-primary-500/10'
                : 'text-[rgb(var(--color-text-700))] hover:text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-50))]'
            }`}
            onClick={() => setActiveSection('providers')}
          >
            {t('configuration.nav.providers', {
              defaultValue: 'Providers',
            })}
          </Button>
          <Button
            id="nav-defaults"
            variant="ghost"
            className={`justify-start w-full px-2 py-2 rounded-md ${
              activeSection === 'defaults'
                ? 'text-[rgb(var(--color-primary-700))] font-semibold underline decoration-[rgb(var(--color-primary-600))] decoration-2 underline-offset-4 bg-primary-500/10'
                : 'text-[rgb(var(--color-text-700))] hover:text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-50))]'
            }`}
            onClick={() => setActiveSection('defaults')}
          >
            {t('configuration.nav.defaults', {
              defaultValue: 'Defaults',
            })}
          </Button>
          <Button
            id="nav-inbound-rules"
            variant="ghost"
            className={`justify-start w-full px-2 py-2 rounded-md ${
              activeSection === 'rules'
                ? 'text-[rgb(var(--color-primary-700))] font-semibold underline decoration-[rgb(var(--color-primary-600))] decoration-2 underline-offset-4 bg-primary-500/10'
                : 'text-[rgb(var(--color-text-700))] hover:text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-50))]'
            }`}
            onClick={() => setActiveSection('rules')}
          >
            {t('configuration.nav.inboundRules', {
              defaultValue: 'Inbound Rules',
            })}
          </Button>
        </nav>
      </div>
      <div className="flex-1 min-w-0">
        {activeSection === 'providers' ? (
          <>
            {renderProvidersContent()}
            <ProviderSetupWizardDialog
              isOpen={wizardOpen}
              onClose={() => setWizardOpen(false)}
              onComplete={async (provider) => { onProviderAdded?.(provider); setWizardOpen(false); await loadProviders(); }}
              tenant={tenant}
              microsoftCredentialCapability={microsoftCredentialCapability}
            />
            <Microsoft365DiagnosticsDialog
              isOpen={diagnosticsOpen}
              onClose={() => setDiagnosticsOpen(false)}
              provider={diagnosticsProvider}
            />
          </>
        ) : activeSection === 'defaults' ? (
          <div className="space-y-4">
            <InboundTicketDefaultsManager onDefaultsChange={() => {
              // Refresh providers and notify forms to reload defaults lists
              loadProviders();
              window.dispatchEvent(new CustomEvent('inbound-defaults-updated'));
            }} />
          </div>
        ) : (
          <div className="space-y-4">
            <InboundEmailRulesManager />
          </div>
        )}
      </div>
    </div>
  );
}

export function EmailProviderConfiguration(props: EmailProviderConfigurationProps) {
  return (
    <DrawerProvider>
      <EmailProviderConfigurationContent {...props} />
      {/* This component owns its DrawerProvider, so it must also render an outlet. */}
      <DrawerOutlet />
    </DrawerProvider>
  );
}
