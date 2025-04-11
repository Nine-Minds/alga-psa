'use client';
import React from 'react';
import { Card } from '@radix-ui/themes';
import Link from 'next/link';
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
  Building2
} from 'lucide-react';

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => {
  return (
  <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white hover:shadow-lg transition-shadow p-4">
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

const QuickStartCard = ({ icon: Icon, step, title, description, href }: { icon: any, step: string, title: string, description: string, href?: string }) => (
  <Link href={href || ''} className="block rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4 hover:shadow-lg transition-shadow">
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

const WelcomeDashboard = () => {
  return (
    <div className="p-6 min-h-screen" style={{ background: 'rgb(var(--background))' }}>
      {/* Welcome Banner */}
      <div className="rounded-lg mb-6 p-6" 
           style={{ background: 'linear-gradient(to right, rgb(var(--color-primary-500)), rgb(var(--color-secondary-500)))' }}>
        <div className="max-w-3xl">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickStartCard
            icon={Building2}
            step="1"
            title="Add Your First Client"
            description="Start by setting up your client profiles and their IT infrastructure details."
            href="/msp/companies?create=true"
          />
          <QuickStartCard
            icon={Server}
            step="2"
            title="Configure Assets"
            description="Add and organize your managed devices, servers, and network equipment."
            href="/msp/assets"
          />
          <QuickStartCard
            icon={Users}
            step="3"
            title="Invite Team Members"
            description="Bring in your team and assign roles to start collaborating."
            href="/msp/settings?tab=users"
          />
        </div>
      </div>

      {/* Features Grid */}
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>Platform Features</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/msp/tickets">
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
        <Link href="/msp/assets">
          <FeatureCard 
            icon={FileSpreadsheet}
            title="Asset Management"
            description="Track hardware, software, and license information in one centralized location."
          />
        </Link>
        <FeatureCard 
          icon={BarChart3}
          title="Reporting & Analytics"
          description="Generate comprehensive reports on performance, SLAs, and business metrics."
        />
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
          <div className="flex space-x-4 mt-4 md:mt-0">
            <Settings className="h-5 w-5" style={{ color: 'rgb(var(--color-text-400))' }} />
            <Laptop className="h-5 w-5" style={{ color: 'rgb(var(--color-text-400))' }} />
            <Clock className="h-5 w-5" style={{ color: 'rgb(var(--color-text-400))' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeDashboard;
