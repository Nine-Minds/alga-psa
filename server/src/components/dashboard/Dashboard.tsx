'use client';
import React, { useEffect } from 'react';
import { Card } from '@radix-ui/themes';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent, ContainerComponent } from '../../types/ui-reflection/types';
import { usePostHog } from 'posthog-js/react';
import { performanceTracker, usePerformanceTracking } from '../../lib/analytics/client';
import {
  Ticket,
  BarChart3,
  Clock,
  Users,
  Server,
  Shield,
  Laptop,
  HeartPulse,
  FileSpreadsheet,
  Calendar,
  Settings,
  Building2,
  ClipboardList,
  UserCheck,
  Sparkles,
} from 'lucide-react';

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => {
  const posthog = usePostHog();
  
  const handleHover = () => {
    posthog?.capture('feature_card_hovered', {
      feature_name: title.toLowerCase().replace(/\s+/g, '_')
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
        <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>{title}</h3>
        <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>{description}</p>
      </div>
    </div>
  </div>
  );
}

const QuickStartCard = ({ icon: Icon, step, title, description, href }: { icon: any, step: string, title: string, description: string, href?: string }) => {
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `quick-start-${step.toLowerCase()}`,
    type: 'button',
    label: `${step}. ${title}`,
    variant: 'default',
    helperText: description
  });

  const posthog = usePostHog();
  
  const handleClick = () => {
    posthog?.capture('quick_start_step_clicked', {
      step_number: step,
      step_title: title,
      destination: href
    });
  };
  
  return (
    <Link 
      {...automationIdProps}
      href={href || ''} 
      className="block rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4 hover:shadow-lg transition-shadow"
      onClick={handleClick}
    >
      <div className="text-center">
        <div className="p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4"
             style={{ background: 'rgb(var(--color-primary-50))' }}>
          <Icon className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
        </div>
        <h3 className="font-semibold mb-2" style={{ color: 'rgb(var(--color-text-900))' }}>{step}. {title}</h3>
        <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>{description}</p>
      </div>
    </Link>
  );
};

const WelcomeDashboard = () => {
  const posthog = usePostHog();
  
  // Track page performance
  usePerformanceTracking('dashboard');
  
  // Track dashboard view and feature discovery
  useEffect(() => {
    posthog?.capture('dashboard_viewed', {
      dashboard_type: 'welcome',
      section_count: 3 // Welcome, Quick Start, Features
    });
    
    // Track feature discovery
    posthog?.capture('feature_discovered', {
      feature_name: 'dashboard_overview',
      discovery_method: 'navigation'
    });
  }, [posthog]);
  
  return (
    <ReflectionContainer id="dashboard-main" label="MSP Dashboard">
      <div className="p-6 min-h-screen" style={{ background: 'rgb(var(--background))' }}>
      {/* Welcome Banner */}
      <div className="rounded-lg mb-6 p-6" 
           style={{ background: 'linear-gradient(to right, rgb(var(--color-primary-500)), rgb(var(--color-secondary-500)))' }}>
        <div className="max-w-6xl">
          <h1 className="text-3xl font-bold mb-2 text-white">Welcome to Your MSP Command Center</h1>
          <p className="text-lg text-white opacity-90">
            Your all-in-one platform for managing IT services, tracking assets, 
            and delivering exceptional support to your clients.
          </p>
        </div>
      </div>

      {/* Quick Start Section */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>Quick Start Guide</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickStartCard
            icon={Sparkles}
            step="1"
            title="Launch Setup Wizard"
            description="Configure everything in one place with our guided setup wizard."
            href="/msp/onboarding"
          />
          <QuickStartCard
            icon={Building2}
            step="2"
            title="Add Your First Client"
            description="Start by setting up your client profiles and their IT infrastructure details."
            href="/msp/clients?create=true"
          />
          <QuickStartCard
            icon={UserCheck}
            step="3"
            title="Set up team for time approvals"
            description="Configure your team members and set up time approval workflows."
            href="/msp/settings?tab=teams"
          />
          <QuickStartCard
            icon={Users}
            step="4"
            title="Invite Team Members"
            description="Bring in your team and assign roles to start collaborating."
            href="/msp/settings?tab=users"
          />
        </div>
      </div>

      {/* Features Grid */}
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>Platform Features</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/msp/tickets" onClick={() => posthog?.capture('feature_accessed', { feature_name: 'ticket_management', access_method: 'dashboard_card' })}>
          <FeatureCard 
            icon={Ticket}
            title="Ticket Management"
            description="Streamline support with our advanced ticketing system. Track, assign, and resolve issues efficiently."
          />
        </Link>
        <Link href="/msp/jobs">
          <FeatureCard
            icon={HeartPulse}
            title="System Monitoring"
            description="Keep track of system health, performance metrics, and critical alerts in real-time."
          />
        </Link>
        <Link href="/msp/security-settings">
          <FeatureCard
            icon={Shield}
            title="Security Management"
            description="Manage security policies, updates, and compliance requirements across your client base."
          />
        </Link>
        <Link href="/msp/projects"> 
          <FeatureCard
            icon={ClipboardList}
            title="Project Management"
            description="Organize projects, add tasks, track progress, and manage project timelines."
          />
        </Link>
        <div onClick={() => toast.success('Coming Soon!')} className="cursor-pointer">
          <FeatureCard
            icon={BarChart3}
            title="Reporting & Analytics"
            description="Generate comprehensive reports on performance, SLAs, and business metrics."
          />
        </div>
        <Link href="/msp/schedule">
          <FeatureCard 
            icon={Calendar}
            title="Schedule Management"
            description="Plan maintenance windows, schedule technician visits, and manage project timelines."
          />
        </Link>
      </div>

      {/* Getting Started Footer */}
      <div className="mt-8 rounded-lg border border-dashed border-[rgb(var(--color-border-200))] bg-white p-4">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div>
            <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>Ready to get started?</h3>
            <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
              Check out our documentation to learn more about setting up your workspace.
            </p>
          </div>
          <div className="mt-4 md:mt-0">
            <Link
              href="https://www.nineminds.com/documentation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 rounded-md text-sm font-medium text-white bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] transition-colors"
            >
              Visit Resources
            </Link>
          </div>
        </div>
      </div>
      </div>
    </ReflectionContainer>
  );
};

export default WelcomeDashboard;
