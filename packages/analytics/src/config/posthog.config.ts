/**
 * PostHog Configuration
 * 
 * This file contains public configuration for PostHog analytics.
 * The API key here is a public key that's safe to expose in frontend code.
 */

export const posthogConfig = {
  // Public API key - safe to commit to source control
  apiKey: 'phc_RiwIhTqFG1NOWw6TS53fpnj3B7fAGv2Ixx7JD2S4IIn',
  
  // PostHog instance URL
  apiHost: 'https://us.i.posthog.com',
  
  // Ingestion endpoint (used by Next.js rewrites)
  ingestHost: 'https://us.i.posthog.com',
  
  // UI host for PostHog toolbar and debugging
  uiHost: 'https://us.posthog.com',
  
  // Default configuration
  defaultConfig: {
    capture_pageview: 'history_change' as const,
    capture_pageleave: true,
    capture_exceptions: true,
    autocapture: true,
    disable_session_recording: true,
  },
  
  // Feature flags
  features: {
    sessionRecording: false,
    featureFlags: true,
    experiments: false,
  },
}

// Helper to check if usage statistics should be enabled
export function isPostHogEnabled(): boolean {
  // Check environment variable override
  // Using generic name so we can switch providers in the future
  if (process.env.ALGA_USAGE_STATS === 'false' || 
      process.env.NEXT_PUBLIC_ALGA_USAGE_STATS === 'false') {
    return false;
  }
  
  // Usage statistics are enabled by default
  return true;
}