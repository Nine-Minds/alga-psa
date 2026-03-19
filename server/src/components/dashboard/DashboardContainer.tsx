'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { usePostHog } from 'posthog-js/react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { usePerformanceTracking } from '@alga-psa/analytics/client';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isEnterprise } from '@/lib/features';

// App shell: dashboard landing container (server-owned, uses analytics).
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

interface FeatureCardProps {
  icon: any;
  title: string;
  description: string;
  analyticsName: string;
}

interface FeatureCardDefinition {
  id: string;
  icon: any;
  href?: string;
  analyticsName: string;
  titleKey: string;
  titleDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
}

const featureCards: FeatureCardDefinition[] = [
  {
    id: 'tickets',
    icon: Ticket,
    href: '/msp/tickets',
    analyticsName: 'ticket_management',
    titleKey: 'features.tickets.title',
    titleDefault: 'Ticket Management',
    descriptionKey: 'features.tickets.description',
    descriptionDefault: 'Streamline support with routing, SLA tracking, and guided workflows.',
  },
  {
    id: 'monitoring',
    icon: HeartPulse,
    href: '/msp/jobs',
    analyticsName: 'system_monitoring',
    titleKey: 'features.monitoring.title',
    titleDefault: 'System Monitoring',
    descriptionKey: 'features.monitoring.description',
    descriptionDefault: 'Watch critical signals across clients and trigger automation when needed.',
  },
  {
    id: 'security',
    icon: Shield,
    href: '/msp/security-settings',
    analyticsName: 'security_management',
    titleKey: 'features.security.title',
    titleDefault: 'Security Management',
    descriptionKey: 'features.security.description',
    descriptionDefault: 'Manage policies, approvals, and audit responses in one place.',
  },
  {
    id: 'projects',
    icon: ClipboardList,
    href: '/msp/projects',
    analyticsName: 'project_management',
    titleKey: 'features.projects.title',
    titleDefault: 'Project Management',
    descriptionKey: 'features.projects.description',
    descriptionDefault: 'Organize delivery plans, tasks, and milestones for every engagement.',
  },
  {
    id: 'reports',
    icon: BarChart3,
    analyticsName: 'reporting_analytics',
    titleKey: 'features.reports.title',
    titleDefault: 'Reporting & Analytics',
    descriptionKey: 'features.reports.description',
    descriptionDefault: 'Build rollups on utilization, SLA attainment, and profitability.',
  },
  {
    id: 'schedule',
    icon: Calendar,
    href: '/msp/schedule',
    analyticsName: 'schedule_management',
    titleKey: 'features.schedule.title',
    titleDefault: 'Schedule Management',
    descriptionKey: 'features.schedule.description',
    descriptionDefault: 'Coordinate onsite visits and remote sessions with bi-directional sync.',
  },
];

const FeatureCard = ({ icon: Icon, title, description, analyticsName }: FeatureCardProps) => {
  const posthog = usePostHog();

  const handleHover = () => {
    posthog?.capture('feature_card_hovered', {
      feature_name: analyticsName,
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

function EnterpriseWelcomeBanner({ title, description }: { title: string; description: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-violet-600 to-cyan-500 px-6 py-5 shadow-[0_10px_30px_rgba(2,6,23,0.12)]">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {title}
          </h1>
          <p className="mt-1 text-sm text-white/80">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

function CommunityWelcomeBanner({ title, description }: { title: string; description: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[rgb(var(--color-border-200))] bg-white px-6 py-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-[rgb(var(--color-border-200))] bg-[rgb(var(--color-primary-50))]">
          <Sparkles className="h-5 w-5" style={{ color: 'rgb(var(--color-primary-500))' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'rgb(var(--color-text-900))' }}>
            {title}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

const WelcomeDashboard = ({ onboardingSection }: DashboardContainerProps) => {
  const posthog = usePostHog();
  const { t } = useTranslation('msp/dashboard');

  usePerformanceTracking('dashboard');

  useEffect(() => {
    posthog?.capture('dashboard_viewed', {
      dashboard_type: isEnterprise ? 'welcome' : 'generic',
      section_count: isEnterprise && onboardingSection ? 3 : 2,
    });
    posthog?.capture('feature_discovered', {
      feature_name: 'dashboard_overview',
      discovery_method: 'navigation',
    });
  }, [posthog]);

  const translatedFeatureCards = featureCards.map((feature) => ({
    ...feature,
    title: t(feature.titleKey, { defaultValue: feature.titleDefault }),
    description: t(feature.descriptionKey, { defaultValue: feature.descriptionDefault }),
  }));

  const welcomeTitle = t('welcome.title', {
    defaultValue: 'Welcome to Your MSP Command Center',
  });
  const welcomeDescription = t('welcome.description', {
    defaultValue: 'Track onboarding progress, configure critical services, and keep every client experience consistent.',
  });
  const welcomeCommunityTitle = t('welcome.titleCommunity', {
    defaultValue: 'Welcome back',
  });
  const welcomeCommunityDescription = t('welcome.descriptionCommunity', {
    defaultValue: 'Jump into tickets, scheduling, projects, and reporting from your dashboard.',
  });

  return (
    <ReflectionContainer id="dashboard-main" label="MSP Dashboard">
      <div className="min-h-screen p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-8">
              {isEnterprise ? (
                <EnterpriseWelcomeBanner
                  title={welcomeTitle}
                  description={welcomeDescription}
                />
              ) : (
                <CommunityWelcomeBanner
                  title={welcomeCommunityTitle}
                  description={welcomeCommunityDescription}
                />
              )}

              {isEnterprise ? onboardingSection : null}

              <div>
                <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>
                  {t('features.heading', { defaultValue: 'Platform Features' })}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {translatedFeatureCards.map((feature) =>
                    feature.href ? (
                      <Link
                        key={feature.id}
                        href={feature.href}
                        onClick={() =>
                          posthog?.capture('feature_accessed', {
                            feature_name: feature.analyticsName,
                            access_method: 'dashboard_card',
                          })
                        }
                      >
                        <FeatureCard
                          icon={feature.icon}
                          title={feature.title}
                          description={feature.description}
                          analyticsName={feature.analyticsName}
                        />
                      </Link>
                    ) : (
                      <div
                        key={feature.id}
                        onClick={() =>
                          toast.success(
                            t('features.comingSoon', { defaultValue: 'Coming soon!' })
                          )
                        }
                        className="cursor-pointer"
                      >
                        <FeatureCard
                          icon={feature.icon}
                          title={feature.title}
                          description={feature.description}
                          analyticsName={feature.analyticsName}
                        />
                      </div>
                    )
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-[rgb(var(--color-border-200))] bg-white p-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>
                      {t('knowledgeBase.title', { defaultValue: 'Need a deeper dive?' })}
                    </h3>
                    <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
                      {t('knowledgeBase.description', {
                        defaultValue: 'Explore deployment runbooks and best practices in the knowledge base.',
                      })}
                    </p>
                  </div>
                  <Link
                    href="https://www.nineminds.com/documentation"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 rounded-md text-sm font-medium text-white bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] transition-colors"
                  >
                    {t('knowledgeBase.cta', { defaultValue: 'Visit resources' })}
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
