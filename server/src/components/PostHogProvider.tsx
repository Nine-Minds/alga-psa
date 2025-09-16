"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
// Removed PrivacyHelper - PostHog handles data privacy natively
import { posthogConfig, isPostHogEnabled } from '../config/posthog.config'

function SuspendedPostHogPageView() {
  const posthogClient = usePostHog()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!posthogClient) return
    const search = searchParams?.toString() ?? ''
    const url = search ? `${pathname}?${search}` : pathname
    posthogClient.capture('$pageview', { path: pathname, url })
  }, [posthogClient, pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)

  // Mark as hydrated after mount
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    // Only initialize PostHog after hydration to avoid mismatches
    if (!isHydrated) return

    // Check if telemetry is enabled
    if (!isPostHogEnabled()) {
      console.log('Usage statistics disabled by ALGA_USAGE_STATS environment variable')
      return
    }

    posthog.init(posthogConfig.apiKey, {
      api_host: posthogConfig.apiHost,
      ui_host: posthogConfig.uiHost,
      ...posthogConfig.defaultConfig,
      debug: process.env.NODE_ENV === "development",
      loaded: (posthog) => {
        // If user IDs should be anonymized, use simple anonymous ID
        if (process.env.NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS !== 'false') {
          const anonymousId = `anonymous_${window.location.hostname}`
          posthog.identify(anonymousId)
        }
        setIsInitialized(true)
      },
      // Bootstrap feature flags to make them available immediately
      bootstrap: {
        distinctID: undefined,
        isIdentifiedID: false,
        featureFlags: {}
      },
      // Disable session recording for privacy
      disable_session_recording: posthogConfig.features.sessionRecording === false,
    })
  }, [isHydrated])

  return (
    <PHProvider client={posthog}>
      {isInitialized && <SuspendedPostHogPageView />}
      {children}
    </PHProvider>
  )
}