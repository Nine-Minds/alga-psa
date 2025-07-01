"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react"
import { Suspense, useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { PrivacyHelper } from '../lib/analytics/privacy.client'
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
  
  useEffect(() => {
    // Check if telemetry is enabled
    if (!isPostHogEnabled()) {
      console.log('Usage statistics disabled by ALGA_USAGE_STATS environment variable')
      return
    }
    
    posthog.init(posthogConfig.apiKey, {
      api_host: "/ingest",
      ui_host: posthogConfig.uiHost,
      ...posthogConfig.defaultConfig,
      debug: process.env.NODE_ENV === "development",
      loaded: (posthog) => {
        // For on-premise deployments, use anonymous ID
        if (process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE !== 'hosted') {
          const anonymousId = PrivacyHelper.getInstanceId()
          posthog.identify(anonymousId)
        }
        setIsInitialized(true)
      },
      // Sanitize properties before sending
      sanitize_properties: (properties) => {
        return PrivacyHelper.sanitizeProperties(properties)
      },
      // Disable session recording for privacy
      disable_session_recording: posthogConfig.features.sessionRecording === false,
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      {isInitialized && <SuspendedPostHogPageView />}
      {children}
    </PHProvider>
  )
}