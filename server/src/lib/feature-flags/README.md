# Feature Flags Implementation

This directory contains the feature flags implementation using PostHog, allowing for controlled feature rollouts, A/B testing, and dynamic feature toggling.

## Overview

Feature flags enable you to:
- **Control feature rollouts** - Gradually release features to specific user segments
- **A/B testing** - Test different variations of features
- **Quick rollbacks** - Disable problematic features without deployment
- **Environment-specific features** - Enable features only in certain environments
- **User-specific features** - Target features to specific users or roles

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  React Client   │────▶│  PostHog Client  │────▶│   PostHog   │
│  (useFeatureFlag)│     │   (Browser SDK)  │     │    Cloud    │
└─────────────────┘     └──────────────────┘     └─────────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐            │
│  Server Side    │────▶│  PostHog Server  │────────────┘
│  (featureFlags) │     │   (Node SDK)     │
└─────────────────┘     └──────────────────┘
```

## Usage

### Client-Side (React Components)

#### Basic Usage
```tsx
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

function MyComponent() {
  const { enabled, loading } = useFeatureFlag('new_feature');

  if (loading) return <Skeleton />;
  
  return enabled ? <NewFeature /> : <OldFeature />;
}
```

#### Using the FeatureFlag Component
```tsx
import { FeatureFlag } from '@/hooks/useFeatureFlag';

function MyPage() {
  return (
    <FeatureFlag 
      flag="experimental_feature"
      fallback={<StandardVersion />}
    >
      <ExperimentalVersion />
    </FeatureFlag>
  );
}
```

#### A/B Testing with Variants
```tsx
import { FeatureFlagVariant } from '@/hooks/useFeatureFlag';

function Dashboard() {
  return (
    <FeatureFlagVariant
      flag="dashboard_layout"
      variants={{
        control: <ClassicDashboard />,
        modern: <ModernDashboard />,
        compact: <CompactDashboard />,
      }}
      defaultVariant="control"
    />
  );
}
```

### Server-Side (Next.js)

#### In Server Components
```tsx
import { ServerFeatureFlag } from '@/lib/feature-flags/serverFeatureFlags';

export default async function BillingPage() {
  return (
    <ServerFeatureFlag flag="new_billing_system">
      <NewBillingDashboard />
    </ServerFeatureFlag>
  );
}
```

#### In API Routes
```ts
import { checkFeatureFlag } from '@/lib/feature-flags/serverFeatureFlags';

export async function POST(request: Request) {
  const aiEnabled = await checkFeatureFlag('ai_features', {
    companySize: 'enterprise',
  });

  if (aiEnabled) {
    // Use AI features
  }
}
```

#### In Server Actions
```ts
'use server';

import { checkFeatureFlag } from '@/lib/feature-flags/serverFeatureFlags';

export async function createTicket(data: TicketData) {
  const automationEnabled = await checkFeatureFlag('ticket_automation');
  
  if (automationEnabled) {
    await automateTicketAssignment(data);
  }
}
```

## Feature Flag Configuration

### Default Values

Feature flags have default values defined in `featureFlags.ts`:

```ts
const defaults: Record<string, boolean> = {
  // Core features (enabled by default)
  'enable_ticket_automation': true,
  'enable_time_tracking': true,
  
  // New features (disabled by default)
  'new_ticket_ui': false,
  'ai_ticket_suggestions': false,
};
```

### Context Properties

You can pass context to influence feature flag evaluation:

```ts
const context: FeatureFlagContext = {
  userId: 'user_123',
  tenantId: 'tenant_456',
  userRole: 'admin',
  companySize: 'enterprise',
  deploymentType: 'hosted',
  subscriptionPlan: 'pro',
  customProperties: {
    beta_tester: true,
    region: 'us-west',
  }
};
```

## API Endpoints

### GET /api/v1/feature-flags
Get all feature flags for the current user.

```bash
GET /api/v1/feature-flags
Authorization: Bearer <token>

Response:
{
  "flags": {
    "new_ticket_ui": true,
    "ai_features": false,
    "dashboard_layout": "modern"
  },
  "context": {
    "userId": "user_123",
    "deployment": "hosted"
  }
}
```

### GET /api/v1/feature-flags?flags=flag1,flag2
Get specific feature flags.

### POST /api/v1/feature-flags
Check feature flags with custom context.

```bash
POST /api/v1/feature-flags
Content-Type: application/json

{
  "flags": ["new_billing", "ai_features"],
  "context": {
    "companySize": "enterprise",
    "subscriptionPlan": "pro"
  }
}
```

## Performance Considerations

1. **Caching**: Feature flags are cached for 1 minute to reduce API calls
2. **React Cache**: Server-side checks use React's cache to deduplicate within a request
3. **Batch Loading**: Multiple flags can be checked in a single API call
4. **Local Defaults**: If PostHog is unavailable, local defaults are used

## Testing

### Override Feature Flags in Development

```ts
import { featureFlags } from '@/lib/feature-flags/featureFlags';

// Set override
featureFlags.setOverride('new_feature', true);

// Clear override
featureFlags.clearOverride('new_feature');

// Clear all caches
featureFlags.clearCache();
```

### Environment-Based Flags

Set these environment variables to adjust feature-flag behavior without touching PostHog:

```env
# .env.development
NEXT_PUBLIC_FORCE_FEATURE_FLAGS=new_ui:true,ai_features:false

# .env.test
NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=true
```

- `NEXT_PUBLIC_FORCE_FEATURE_FLAGS` lets you hard-code specific flag values for client-side testing.
- `NEXT_PUBLIC_DISABLE_FEATURE_FLAGS` bypasses PostHog entirely and treats every flag check as enabled, which is helpful when you need to surface all gated UI locally. Server-side code will honor the same behavior if you set `DISABLE_FEATURE_FLAGS=true`.

## Best Practices

1. **Naming Convention**: Use descriptive, action-oriented names
   - ✅ `enable_ticket_automation`
   - ❌ `flag_123`

2. **Gradual Rollout**: Start with a small percentage and increase
   ```
   Day 1: 5% of users
   Day 3: 25% of users
   Day 7: 50% of users
   Day 14: 100% of users
   ```

3. **Clean Up**: Remove feature flags once features are stable
   ```ts
   // Before
   if (featureFlag('new_dashboard')) {
     return <NewDashboard />;
   }
   return <OldDashboard />;

   // After (when stable)
   return <NewDashboard />;
   ```

4. **Error Handling**: Always provide fallbacks
   ```tsx
   const { enabled, error } = useFeatureFlag('feature');
   
   if (error) {
     // Use default behavior
     return <DefaultComponent />;
   }
   ```

5. **Documentation**: Document what each flag controls
   ```ts
   /**
    * Enable AI-powered ticket suggestions
    * - Suggests ticket category based on description
    * - Recommends priority level
    * - Auto-assigns to best available agent
    */
   'ai_ticket_suggestions': false,
   ```

## Monitoring

Feature flag usage is automatically tracked in PostHog:
- `feature_flag_evaluated` - When a flag is checked
- `feature_flag_variant_assigned` - When a variant is assigned

You can view metrics in PostHog:
- Evaluation frequency
- User distribution across variants
- Performance impact
- Error rates by feature flag

## Troubleshooting

### Feature flag not working
1. Check if PostHog is enabled: `ALGA_USAGE_STATS=true`
2. Verify the flag exists in PostHog dashboard
3. Check browser console for errors
4. Ensure user context is being passed correctly

### Performance issues
1. Enable caching if not already enabled
2. Batch multiple flag checks
3. Use server-side evaluation for initial render
4. Consider using local overrides for development

### Inconsistent behavior
1. Clear the cache: `featureFlags.clearCache()`
2. Check if user properties are consistent
3. Verify deployment type is set correctly
4. Look for timing issues with async evaluation
