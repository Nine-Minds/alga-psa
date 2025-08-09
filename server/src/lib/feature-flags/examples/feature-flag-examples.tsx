/*
 * Feature Flag Usage Examples
 * These are example patterns showing how to use feature flags in different scenarios.
 * The components referenced here are placeholders and don't actually exist.
 */

// Export empty component to satisfy TypeScript
export default function FeatureFlagExamples() {
  return null;
}

/* EXAMPLES COMMENTED OUT TO AVOID COMPILATION ERRORS

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

// Example 5: Using feature flags in API routes
import { checkFeatureFlag } from '../../serverFeatureFlags';

export async function POST(request: Request) {
  const aiEnabled = await checkFeatureFlag('ai_ticket_suggestions');
  
  if (aiEnabled) {
    // Use AI to generate suggestions
    const suggestions = await generateAISuggestions(ticketData);
    ticketData.suggestions = suggestions;
  }

  // Continue with normal ticket creation
  const ticket = await createTicket(ticketData);
  return Response.json(ticket);
}

// Example 6: Progressive feature rollout
export function ReportsPage() {
  const { enabled: phase1 } = useFeatureFlag('reports_phase_1');
  const { enabled: phase2 } = useFeatureFlag('reports_phase_2');
  const { enabled: phase3 } = useFeatureFlag('reports_phase_3');

  return (
    <div>
      <h1>Reports</h1>
      
      <BasicReports />
      
      {phase1 && <AdvancedFilters />}
      
      {phase2 && <CustomReportBuilder />}
      
      {phase3 && <AIInsights />}
    </div>
  );
}

// Example 7: User-specific feature flags
export function AdminSettings() {
  const user = useCurrentUser();
  
  return (
    <FeatureFlag 
      flag="admin_analytics_dashboard"
      context={{ userId: user.id }}
    >
      <AdminAnalyticsDashboard />
    </FeatureFlag>
  );
}

// Example 8: Multiple feature flag checks
export function IntegrationsPage() {
  const { flags } = useFeatureFlags([
    'slack_integration',
    'teams_integration',
    'jira_integration'
  ]);

  return (
    <div>
      <h1>Integrations</h1>
      
      {flags.slack_integration && (
        <IntegrationCard
          name="Slack"
          description="Connect your Slack workspace"
          onConnect={connectSlack}
        />
      )}
      
      {flags.teams_integration && (
        <IntegrationCard
          name="Microsoft Teams"
          description="Connect your Teams workspace"
          onConnect={connectTeams}
        />
      )}
      
      {flags.jira_integration && (
        <IntegrationCard
          name="Jira"
          description="Sync tickets with Jira"
          onConnect={connectJira}
        />
      )}
    </div>
  );
}

// Example 9: Feature flag with metadata
export function TicketList() {
  const { enabled, metadata } = useFeatureFlag('new_ticket_filters');
  
  return (
    <TicketList
      enableAdvancedFilters={enabled}
      filterConfig={metadata?.filterConfig}
    />
  );
}

// Example 10: Feature flags in configuration
export const featureFlaggedConfig = {
  maxUploadSize: await checkFeatureFlag('large_file_uploads') ? 100 : 10, // MB
  allowedFileTypes: await checkFeatureFlag('extended_file_types') 
    ? ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.zip']
    : ['.pdf', '.doc', '.docx'],
  autoSaveInterval: await checkFeatureFlag('aggressive_autosave') ? 10 : 60, // seconds
};

// Example 11: Feature flags based on environment
import { checkFeatureFlag, getFeatureFlagVariant } from '../../serverFeatureFlags';

export async function BackupSettings() {
  const isProduction = process.env.NODE_ENV === 'production';
  const cloudBackupEnabled = await checkFeatureFlag('cloud_backup');

  if (!isProduction || !cloudBackupEnabled) {
    return (
      <div className="feature-unavailable">
        This feature is only available in production environment
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

*/ // END OF EXAMPLES