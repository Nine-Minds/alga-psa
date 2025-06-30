// Example 1: Using feature flags in a React component
'use client';

import { useFeatureFlag, FeatureFlag } from '../../../hooks/useFeatureFlag';

export function NewTicketUI() {
  // Check if new ticket UI is enabled
  const { enabled, loading } = useFeatureFlag('new_ticket_ui');

  if (loading) {
    return <div>Loading...</div>;
  }

  if (enabled) {
    return <NewTicketForm />; // New UI
  } else {
    return <LegacyTicketForm />; // Old UI
  }
}

// Example 2: Using the FeatureFlag component
export function TicketPage() {
  return (
    <div>
      <h1>Create Ticket</h1>
      
      <FeatureFlag 
        flag="ai_ticket_suggestions"
        fallback={<StandardTicketForm />}
      >
        <AIEnhancedTicketForm />
      </FeatureFlag>
    </div>
  );
}

// Example 3: A/B testing with feature flag variants
import { useFeatureFlagVariant, FeatureFlagVariant } from '../../../hooks/useFeatureFlag';

export function DashboardLayout() {
  const { variant } = useFeatureFlagVariant('dashboard_layout');

  return (
    <FeatureFlagVariant
      flag="dashboard_layout"
      variants={{
        classic: <ClassicDashboard />,
        modern: <ModernDashboard />,
        compact: <CompactDashboard />,
      }}
      defaultVariant="classic"
    />
  );
}

// Example 4: Server-side feature flags in a Server Component
import { ServerFeatureFlag } from '../../serverFeatureFlags';

export default async function BillingPage() {
  return (
    <div>
      <h1>Billing</h1>
      
      <ServerFeatureFlag flag="advanced_billing_features">
        <AdvancedBillingDashboard />
      </ServerFeatureFlag>
      
      <ServerFeatureFlag 
        flag="beta_payment_processing"
        fallback={<StandardPaymentOptions />}
      >
        <BetaPaymentProcessing />
      </ServerFeatureFlag>
    </div>
  );
}

// Example 5: Feature flags in API routes
import { checkFeatureFlag } from '../../serverFeatureFlags';

export async function createTicketHandler(request: Request) {
  const aiSuggestionsEnabled = await checkFeatureFlag('ai_ticket_suggestions', {
    // Optional: override context
    companySize: 'enterprise',
  });

  if (aiSuggestionsEnabled) {
    // Use AI to suggest ticket properties
    const suggestions = await generateAISuggestions(ticketData);
    ticketData = { ...ticketData, ...suggestions };
  }

  // Continue with ticket creation
  return createTicket(ticketData);
}

// Example 6: Progressive feature rollout
export function FeatureRolloutExample() {
  const { enabled: phase1 } = useFeatureFlag('new_reporting_phase1');
  const { enabled: phase2 } = useFeatureFlag('new_reporting_phase2');
  const { enabled: phase3 } = useFeatureFlag('new_reporting_phase3');

  return (
    <div>
      <h1>Reports</h1>
      
      {/* Always available */}
      <BasicReports />
      
      {/* Phase 1: Advanced filters */}
      {phase1 && <AdvancedFilters />}
      
      {/* Phase 2: Custom report builder */}
      {phase2 && <CustomReportBuilder />}
      
      {/* Phase 3: AI insights */}
      {phase3 && <AIInsights />}
    </div>
  );
}

// Example 7: Feature flags with user role context
export function AdminFeatures() {
  const { enabled } = useFeatureFlag('admin_analytics_dashboard', {
    properties: {
      userRole: 'admin',
      requiredPermission: 'analytics:view',
    },
  });

  if (!enabled) return null;

  return <AdminAnalyticsDashboard />;
}

// Example 8: Feature flags for integrations
export function IntegrationsPage() {
  const { flags } = useFeatureFlags();

  return (
    <div>
      <h1>Integrations</h1>
      
      {flags.enable_slack_integration && (
        <IntegrationCard
          name="Slack"
          description="Connect your Slack workspace"
          onConnect={connectSlack}
        />
      )}
      
      {flags.enable_teams_integration && (
        <IntegrationCard
          name="Microsoft Teams"
          description="Connect your Teams workspace"
          onConnect={connectTeams}
        />
      )}
      
      {flags.enable_jira_sync && (
        <IntegrationCard
          name="Jira"
          description="Sync tickets with Jira"
          beta={true}
          onConnect={connectJira}
        />
      )}
    </div>
  );
}

// Example 9: Performance optimization with feature flags
export function OptimizedTicketList() {
  const { enabled: lazyLoadingEnabled } = useFeatureFlag('enable_lazy_loading');
  const { enabled: websocketEnabled } = useFeatureFlag('enable_websocket_updates');

  return (
    <TicketList
      lazyLoad={lazyLoadingEnabled}
      realtimeUpdates={websocketEnabled}
      pageSize={lazyLoadingEnabled ? 20 : 50}
    />
  );
}

// Example 10: Feature flag with polling for real-time updates
export function LiveFeatureToggle() {
  const { enabled } = useFeatureFlag('maintenance_mode', {
    pollInterval: 30000, // Check every 30 seconds
  });

  if (enabled) {
    return (
      <div className="maintenance-banner">
        System is currently in maintenance mode
      </div>
    );
  }

  return null;
}

// Example 11: Conditional feature based on deployment type
export function CloudOnlyFeature() {
  const { enabled } = useFeatureFlag('cloud_backup_feature', {
    properties: {
      deploymentType: 'hosted',
    },
  });

  if (!enabled) {
    return (
      <div className="feature-unavailable">
        This feature is only available in hosted deployments
      </div>
    );
  }

  return <CloudBackupSettings />;
}

// Example 12: Feature flags in middleware
export async function featureFlagMiddleware(request: Request) {
  const betaApiEnabled = await checkFeatureFlag('beta_api_v2');
  
  if (request.url.includes('/api/v2') && !betaApiEnabled) {
    return new Response('API v2 is not yet available', { status: 404 });
  }

  return NextResponse.next();
}