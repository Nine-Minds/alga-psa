/**
 * @alga-psa/surveys
 *
 * Main entry point exports buildable models/services code only.
 * For runtime code, use:
 * - '@alga-psa/surveys/actions' for server actions
 * - '@alga-psa/surveys/components' for React components
 */

// Buildable exports
export * from './models';
export * from './services/SurveyAnalyticsService';
export * from './services/SurveyDashboardService';
