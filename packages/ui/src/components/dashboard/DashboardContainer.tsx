'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { usePostHog } from 'posthog-js/react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { usePerformanceTracking } from '@alga-psa/analytics/client';
import {
  Ticket,
  BarChart3,
  Shield,
  HeartPulse,
  ClipboardList,
  Calendar,
  Sparkles,
} from 'lucide-react';

interface DashboardContainerProps {
  onboardingSection?: React.ReactNode;
}

const FeatureCard = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => {
  const posthog = usePostHog();

  const handleHover = () => {
    posthog?.capture('feature_card_hovered', {
      feature_name: title.toLowerCase().replace(/\s+/g, '_'),
    });
  };

  return (
    <div
      className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white hover:shadow-lg transition-shadow p-4"
      onMouseEnter={handleHover}
    >
      <div className="flex items-start space-x-4">
        <div className="p-2 rounded-lg" style={{ background: 'rgb(var(--color-primary-50))' }}>
          <Icon className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
        </div>
        <div>
          <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>
            {title}
          </h3>
          <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
};

function WelcomeBanner() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-violet-600 to-cyan-500 px-6 py-5 shadow-[0_10px_30px_rgba(2,6,23,0.12)]">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Welcome to Your MSP Command Center
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Track onboarding progress, configure critical services, and keep every client experience consistent.
          </p>
        </div>
      </div>
    </div>
  );
}

const WelcomeDashboard = ({ onboardingSection }: DashboardContainerProps) => {
  const posthog = usePostHog();

  usePerformanceTracking('dashboard');

  useEffect(() => {
    posthog?.capture('dashboard_viewed', {
      dashboard_type: 'welcome',
      section_count: 3,
    });
    posthog?.capture('feature_discovered', {
      feature_name: 'dashboard_overview',
      discovery_method: 'navigation',
    });
  }, [posthog]);

  return (
    <ReflectionContainer id="dashboard-main" label="MSP Dashboard">
      <div className="min-h-screen p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-8">
              <WelcomeBanner />

              {onboardingSection}

              <div>
                <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>
                  Platform Features
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Link
                    href="/msp/tickets"
                    onClick={() =>
                      posthog?.capture('feature_accessed', {
                        feature_name: 'ticket_management',
                        access_method: 'dashboard_card',
                      })
                    }
                  >
                    <FeatureCard
                      icon={Ticket}
                      title="Ticket Management"
                      description="Streamline support with routing, SLA tracking, and guided workflows."
                    />
                  </Link>
                  <Link href="/msp/jobs">
                    <FeatureCard
                      icon={HeartPulse}
                      title="System Monitoring"
                      description="Watch critical signals across clients and trigger automation when needed."
                    />
                  </Link>
                  <Link href="/msp/security-settings">
                    <FeatureCard
                      icon={Shield}
                      title="Security Management"
                      description="Manage policies, approvals, and audit responses in one place."
                    />
                  </Link>
                  <Link href="/msp/projects">
                    <FeatureCard
                      icon={ClipboardList}
                      title="Project Management"
                      description="Organize delivery plans, tasks, and milestones for every engagement."
                    />
                  </Link>
                  <div onClick={() => toast.success('Coming soon!')} className="cursor-pointer">
                    <FeatureCard
                      icon={BarChart3}
                      title="Reporting & Analytics"
                      description="Build rollups on utilization, SLA attainment, and profitability."
                    />
                  </div>
                  <Link href="/msp/schedule">
                    <FeatureCard
                      icon={Calendar}
                      title="Schedule Management"
                      description="Coordinate onsite visits and remote sessions with bi-directional sync."
                    />
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-[rgb(var(--color-border-200))] bg-white p-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>
                      Need a deeper dive?
                    </h3>
                    <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
                      Explore deployment runbooks and best practices in the knowledge base.
                    </p>
                  </div>
                  <Link
                    href="https://www.nineminds.com/documentation"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 rounded-md text-sm font-medium text-white bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] transition-colors"
                  >
                    Visit resources
                  </Link>
                </div>
              </div>

          </div>
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default WelcomeDashboard;
