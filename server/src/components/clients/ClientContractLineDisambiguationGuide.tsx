'use client';

import React, { useState } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import { AlertTriangle, Info, CheckCircle, HelpCircle, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';

interface ClientPlanDisambiguationGuideProps {
  className?: string;
}

const ClientPlanDisambiguationGuide: React.FC<ClientPlanDisambiguationGuideProps> = ({
  className = ''
}) => {
  // Reuse the existing PlanDisambiguationGuide component's implementation
  // but with client-specific context and examples
  
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  return (
    <Card className={`p-4 ${className}`}>
      <h3 className="text-lg font-medium mb-4">Contract Line Disambiguation Guide</h3>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="bestPractices">Best Practices</TabsTrigger>
          <TabsTrigger value="scenarios">Common Scenarios</TabsTrigger>
          <TabsTrigger value="troubleshooting">Troubleshooting</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>Understanding Contract Line Disambiguation for This Client</AlertTitle>
            <AlertDescription>
              <p className="text-sm mb-3">
                When a client has multiple contract lines that include the same service, the system needs to determine which contract line to use for time entries and usage records. This guide explains how to manage this situation for this specific client.
              </p>
              <div className="bg-white p-3 rounded-md border border-primary-200">
                <h5 className="text-sm font-medium mb-2">Key Concepts:</h5>
                <ul className="text-xs space-y-2 text-gray-700">
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span><strong>Service Overlap:</strong> When the same service appears in multiple contract lines for this client.</span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span><strong>Explicit Selection:</strong> When users must manually choose which contract line to bill against for this client.</span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span><strong>Default Plan:</strong> The system's automatic choice when a service appears in multiple contract lines for this client.</span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span><strong>Bucket Priority:</strong> Bucket contract lines are given priority when disambiguating services for this client.</span>
                  </li>
                </ul>
              </div>
            </AlertDescription>
          </Alert>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-md">
              <h4 className="text-md font-medium text-amber-800 mb-2 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Potential Issues for This Client
              </h4>
              <ul className="text-sm space-y-2 text-amber-700">
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Incorrect billing due to automatic contract line selection</span>
                </li>
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>User confusion when selecting contract lines for time entry</span>
                </li>
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Reporting inconsistencies across different contract lines</span>
                </li>
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Unexpected billing behavior for this client</span>
                </li>
              </ul>
            </div>
            
            <div className="p-4 bg-green-50 border border-green-100 rounded-md">
              <h4 className="text-md font-medium text-green-800 mb-2 flex items-center">
                <CheckCircle className="h-5 w-5 mr-2" />
                Benefits of Proper Disambiguation
              </h4>
              <ul className="text-sm space-y-2 text-green-700">
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Accurate billing and revenue recognition</span>
                </li>
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Simplified time entry and usage tracking</span>
                </li>
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Clear reporting and analytics</span>
                </li>
                <li className="flex items-start">
                  <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                  <span>Improved client transparency</span>
                </li>
              </ul>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="bestPractices" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>Best Practices for Contract Line Disambiguation</AlertTitle>
            <AlertDescription>
              Follow these best practices to ensure accurate billing and minimize confusion when managing multiple contract lines for this client.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('bp1')}
              >
                <span className="font-medium">1. Minimize Service Overlaps</span>
                {expandedSections['bp1'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['bp1'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    Whenever possible, avoid having the same service in multiple contract lines for this client. This simplifies billing and reporting.
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Review the Service Overlap Matrix to identify overlapping services</li>
                    <li>Consider consolidating contract lines or reorganizing services</li>
                    <li>If overlaps are necessary, ensure clear documentation of which contract line should be used when</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('bp2')}
              >
                <span className="font-medium">2. Use Clear Plan Naming Conventions</span>
                {expandedSections['bp2'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['bp2'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    Name contract lines in a way that clearly indicates their purpose and scope for this client.
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Include the contract line type in the name (e.g., "Monthly Support Bucket", "Project-Based Plan")</li>
                    <li>Consider including dates or version numbers for contract lines that change over time</li>
                    <li>Use consistent naming patterns across all contract lines for this client</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('bp3')}
              >
                <span className="font-medium">3. Document Disambiguation Rules</span>
                {expandedSections['bp3'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['bp3'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    Clearly document how service overlaps should be handled for this specific client.
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Create client-specific guidelines for which contract line to use in different scenarios</li>
                    <li>Share these guidelines with all team members who work with this client</li>
                    <li>Include examples of common situations and how they should be handled</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="scenarios" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>Common Disambiguation Scenarios</AlertTitle>
            <AlertDescription>
              These examples illustrate how contract line disambiguation works in common scenarios for this client.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('sc1')}
              >
                <span className="font-medium">Scenario 1: Bucket Plan + Standard Plan</span>
                {expandedSections['sc1'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['sc1'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    When a service appears in both a bucket contract line and a standard contract line for this client:
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>The bucket contract line is given priority by default</li>
                    <li>Time entries and usage will be billed against the bucket contract line until it's depleted</li>
                    <li>After the bucket is depleted, the standard contract line will be used automatically</li>
                    <li>Users can manually override this behavior by explicitly selecting a contract line during time entry</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('sc2')}
              >
                <span className="font-medium">Scenario 2: Multiple Standard Plans</span>
                {expandedSections['sc2'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['sc2'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    When a service appears in multiple standard contract lines for this client:
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Users will be prompted to select which contract line to bill against during time entry</li>
                    <li>The most recently created contract line will be suggested as the default</li>
                    <li>If no contract line is explicitly selected, the system will use the most recently created contract line</li>
                    <li>Consider consolidating these contract lines to avoid confusion</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('sc3')}
              >
                <span className="font-medium">Scenario 3: Multiple Bucket Plans</span>
                {expandedSections['sc3'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['sc3'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    When a service appears in multiple bucket contract lines for this client:
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Users will be prompted to select which bucket to bill against during time entry</li>
                    <li>The bucket with the earliest expiration date will be suggested as the default</li>
                    <li>If no bucket is explicitly selected, the system will use the bucket with the earliest expiration date</li>
                    <li>This helps ensure that hours in buckets that expire sooner are used first</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="troubleshooting" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>Troubleshooting Contract Line Disambiguation</AlertTitle>
            <AlertDescription>
              Solutions for common issues related to contract line disambiguation for this client.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('ts1')}
              >
                <span className="font-medium">Issue: Time Entry Billed to Wrong Plan</span>
                {expandedSections['ts1'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['ts1'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    If time entries are being billed to the wrong contract line for this client:
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Check if the time entry has an explicit contract_line_id assigned</li>
                    <li>Verify that the service is included in the expected contract line</li>
                    <li>Review the disambiguation rules to understand why a particular contract line was selected</li>
                    <li>Update the time entry to explicitly select the correct contract line</li>
                    <li>Consider updating the client's contract line configuration to avoid future issues</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('ts2')}
              >
                <span className="font-medium">Issue: Plan Selection Not Appearing</span>
                {expandedSections['ts2'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['ts2'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    If the contract line selection dropdown is not appearing during time entry for this client:
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Verify that the service is actually included in multiple active contract lines</li>
                    <li>Check if one of the contract lines has expired or is not yet active</li>
                    <li>Ensure that the client and service selections are made before expecting the contract line dropdown</li>
                    <li>Try refreshing the page or clearing the browser cache</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('ts3')}
              >
                <span className="font-medium">Issue: Inconsistent Reporting</span>
                {expandedSections['ts3'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['ts3'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    If you're seeing inconsistent reporting for services that appear in multiple contract lines for this client:
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>Use the contract_line_id filter in reports to see data for specific contract lines</li>
                    <li>Check if time entries or usage records have explicit contract line assignments</li>
                    <li>Review historical data to see if contract line assignments have changed over time</li>
                    <li>Consider updating the client's contract line configuration to reduce overlaps</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
};

export default ClientPlanDisambiguationGuide;