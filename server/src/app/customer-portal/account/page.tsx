'use client';

import { Card } from "@/components/ui/Card";
import { Tabs } from '@radix-ui/themes';
import { useState } from 'react';
import ProfileSection from "@/components/customer-portal/account/ProfileSection";
import BillingSection from "@/components/customer-portal/account/BillingSection";
import ServicesSection from "@/components/customer-portal/account/ServicesSection";

export default function AccountPage() {
  const [activeTab, setActiveTab] = useState('profile');

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <h1 className="text-2xl font-semibold mb-6">Account Management</h1>
      
      <Card className="p-6">
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
          <Tabs.List className="mb-6 flex border-b border-gray-200">
            <Tabs.Trigger 
              value="profile"
              className={`px-4 py-2 -mb-px ${
                activeTab === 'profile' 
                  ? 'border-b-2 border-primary-500 text-primary-500' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Profile
            </Tabs.Trigger>
            <Tabs.Trigger 
              value="billing"
              className={`px-4 py-2 -mb-px ${
                activeTab === 'billing' 
                  ? 'border-b-2 border-primary-500 text-primary-500' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Billing
            </Tabs.Trigger>
            <Tabs.Trigger 
              value="services"
              className={`px-4 py-2 -mb-px ${
                activeTab === 'services' 
                  ? 'border-b-2 border-primary-500 text-primary-500' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Services
            </Tabs.Trigger>
          </Tabs.List>

          <div className="mt-6">
            <Tabs.Content value="profile">
              <ProfileSection />
            </Tabs.Content>

            <Tabs.Content value="billing">
              <BillingSection />
            </Tabs.Content>

            <Tabs.Content value="services">
              <ServicesSection />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </Card>
    </div>
  );
}
