# Plan Service Configuration Enhancement Implementation Notes

This document provides an overview of the backend implementation for the Plan Service Configuration Enhancement Project.

## Components Implemented

### 1. TypeScript Interfaces

Created TypeScript interfaces for each plan service configuration type in `server/src/interfaces/planServiceConfiguration.interfaces.ts`:
- `IPlanServiceConfiguration` (base interface)
- `IPlanServiceFixedConfig`
- `IPlanServiceHourlyConfig`
- `IPlanServiceUsageConfig`
- `IPlanServiceBucketConfig`
- `IPlanServiceRateTier`
- `IUserTypeRate`

### 2. Models

Implemented model files for each configuration type:
- `PlanServiceConfiguration` - Base model for all configurations
- `PlanServiceFixedConfig` - Fixed price configuration
- `PlanServiceHourlyConfig` - Hourly configuration with user type rates
- `PlanServiceUsageConfig` - Usage-based configuration with rate tiers
- `PlanServiceBucketConfig` - Bucket plan configuration

### 3. Service Layer

Created a service for handling configuration switching:
- `PlanServiceConfigurationService` - Manages different configuration types and their relationships

### 4. Actions

Implemented action files for the configurations:
- `planServiceConfigurationActions.ts` - Core actions for managing configurations
- `planServiceActions.ts` - Updated to handle the new configuration tables

### 5. Billing Engine Updates

Modified the billing engine to use the new configuration:
- Updated query changes in `billingEngine.ts` to filter by service configuration type
- Updated calculation methods to use the new configuration tables:
  - `calculateFixedPriceCharges`
  - `calculateTimeBasedCharges`
  - `calculateUsageBasedCharges`
  - `calculateBucketPlanCharges`
  - `calculateProductCharges`
  - `calculateLicenseCharges`
- Updated the `applyProrationToPlan` method to work with the new configuration structure

## Usage Examples

### Creating a new service configuration

```typescript
import * as planServiceActions from 'server/src/lib/actions';

// Add a service to a plan with specific configuration
const configId = await planServiceActions.addServiceToPlan(
  planId,
  serviceId,
  quantity,
  customRate,
  'Fixed', // Configuration type
  {
    enable_proration: true,
    billing_cycle_alignment: 'start'
  }
);
```

### Retrieving a configuration with details

```typescript
import * as planServiceConfigActions from 'server/src/lib/actions/planServiceConfigurationActions';

// Get a configuration with its type-specific details
const configDetails = await planServiceConfigActions.getConfigurationWithDetails(configId);
console.log(configDetails.baseConfig); // Base configuration
console.log(configDetails.typeConfig); // Type-specific configuration
console.log(configDetails.rateTiers); // Rate tiers (for usage-based)
console.log(configDetails.userTypeRates); // User type rates (for hourly)
```

### Updating a configuration

```typescript
import * as planServiceActions from 'server/src/lib/actions';

// Update a service in a plan
await planServiceActions.updatePlanService(
  planId,
  serviceId,
  {
    quantity: 5,
    customRate: 100,
    typeConfig: {
      // Type-specific configuration updates
      enable_proration: false
    }
  }
);
```

## Usage

The implementation completely replaces the old `plan_services` table with the new configuration-based approach. All service configurations are now stored in the appropriate configuration tables based on their type.