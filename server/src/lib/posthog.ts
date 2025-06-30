// This file is deprecated - use lib/analytics/posthog.ts instead
import { analytics } from './analytics/posthog'

export default function PostHogClient() {
  console.warn('PostHogClient() is deprecated. Use analytics from lib/analytics/posthog.ts instead')
  return analytics
}