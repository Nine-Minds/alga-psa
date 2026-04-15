'use client';

import React, { useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/clients');

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  return (
    <Card className={`p-4 ${className}`}>
      <h3 className="text-lg font-medium mb-4">
        {t('clientContractLineGuide.title', {
          defaultValue: 'Contract Line Disambiguation Guide'
        })}
      </h3>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">
            {t('clientContractLineGuide.tabs.overview', { defaultValue: 'Overview' })}
          </TabsTrigger>
          <TabsTrigger value="bestPractices">
            {t('clientContractLineGuide.tabs.bestPractices', { defaultValue: 'Best Practices' })}
          </TabsTrigger>
          <TabsTrigger value="scenarios">
            {t('clientContractLineGuide.tabs.scenarios', { defaultValue: 'Common Scenarios' })}
          </TabsTrigger>
          <TabsTrigger value="troubleshooting">
            {t('clientContractLineGuide.tabs.troubleshooting', { defaultValue: 'Troubleshooting' })}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>
              {t('clientContractLineGuide.overview.title', {
                defaultValue: 'Understanding Contract Line Disambiguation for This Client'
              })}
            </AlertTitle>
            <AlertDescription>
              <p className="text-sm mb-3">
                {t('clientContractLineGuide.overview.description', {
                  defaultValue:
                    'When a client has multiple contract lines that include the same service, the system needs to determine which contract line to use for time entries and usage records. This guide explains how to manage this situation for this specific client.'
                })}
              </p>
              <div className="bg-white p-3 rounded-md border border-primary-200">
                <h5 className="text-sm font-medium mb-2">
                  {t('clientContractLineGuide.overview.keyConceptsTitle', {
                    defaultValue: 'Key Concepts:'
                  })}
                </h5>
                <ul className="text-xs space-y-2 text-gray-700">
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span>
                      <strong>
                        {t('clientContractLineGuide.overview.serviceOverlapLabel', {
                          defaultValue: 'Service Overlap:'
                        })}
                      </strong>{' '}
                      {t('clientContractLineGuide.overview.serviceOverlapDescription', {
                        defaultValue:
                          'When the same service appears in multiple contract lines for this client.'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span>
                      <strong>
                        {t('clientContractLineGuide.overview.explicitSelectionLabel', {
                          defaultValue: 'Explicit Selection:'
                        })}
                      </strong>{' '}
                      {t('clientContractLineGuide.overview.explicitSelectionDescription', {
                        defaultValue:
                          'When users must manually choose which contract line to bill against for this client.'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span>
                      <strong>
                        {t('clientContractLineGuide.overview.explicitAssignmentLabel', {
                          defaultValue: 'Explicit Assignment Required:'
                        })}
                      </strong>{' '}
                      {t('clientContractLineGuide.overview.explicitAssignmentDescription', {
                        defaultValue:
                          'When a service appears in multiple contract lines, users must choose the intended assignment context instead of relying on implicit fallback.'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0 text-primary-500" />
                    <span>
                      <strong>
                        {t('clientContractLineGuide.overview.bucketPriorityLabel', {
                          defaultValue: 'Bucket Priority:'
                        })}
                      </strong>{' '}
                      {t('clientContractLineGuide.overview.bucketPriorityDescription', {
                        defaultValue:
                          'Bucket contract lines are given priority when disambiguating services for this client.'
                      })}
                    </span>
                  </li>
                </ul>
              </div>
            </AlertDescription>
          </Alert>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Alert variant="warning">
              <AlertDescription>
                <h4 className="text-md font-medium mb-2">
                  {t('clientContractLineGuide.overview.potentialIssuesTitle', {
                    defaultValue: 'Potential Issues for This Client'
                  })}
                </h4>
                <ul className="text-sm space-y-2">
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.issueIncorrectBilling', {
                        defaultValue: 'Incorrect billing when assignment context is ambiguous'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.issueUserConfusion', {
                        defaultValue: 'User confusion when selecting contract lines for time entry'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.issueReporting', {
                        defaultValue: 'Reporting inconsistencies across different contract lines'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.issueUnexpectedBilling', {
                        defaultValue: 'Unexpected billing behavior for this client'
                      })}
                    </span>
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
            
            <Alert variant="success">
              <AlertDescription>
                <h4 className="text-md font-medium mb-2">
                  {t('clientContractLineGuide.overview.benefitsTitle', {
                    defaultValue: 'Benefits of Proper Disambiguation'
                  })}
                </h4>
                <ul className="text-sm space-y-2">
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.benefitBilling', {
                        defaultValue: 'Accurate billing and revenue recognition'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.benefitTracking', {
                        defaultValue: 'Simplified time entry and usage tracking'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.benefitReporting', {
                        defaultValue: 'Clear reporting and analytics'
                      })}
                    </span>
                  </li>
                  <li className="flex items-start">
                    <ArrowRight className="h-3 w-3 mt-0.5 mr-1 flex-shrink-0" />
                    <span>
                      {t('clientContractLineGuide.overview.benefitTransparency', {
                        defaultValue: 'Improved client transparency'
                      })}
                    </span>
                </li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </TabsContent>
        
        <TabsContent value="bestPractices" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>
              {t('clientContractLineGuide.bestPractices.title', {
                defaultValue: 'Best Practices for Contract Line Disambiguation'
              })}
            </AlertTitle>
            <AlertDescription>
              {t('clientContractLineGuide.bestPractices.description', {
                defaultValue:
                  'Follow these best practices to ensure accurate billing and minimize confusion when managing multiple contract lines for this client.'
              })}
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('bp1')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.bestPractices.minimizeOverlapsTitle', {
                    defaultValue: '1. Minimize Service Overlaps'
                  })}
                </span>
                {expandedSections['bp1'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['bp1'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.bestPractices.minimizeOverlapsDescription', {
                      defaultValue:
                        'Whenever possible, avoid having the same service in multiple contract lines for this client. This simplifies billing and reporting.'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.bestPractices.minimizeOverlapsItem1', {
                        defaultValue: 'Review the Service Overlap Matrix to identify overlapping services'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.bestPractices.minimizeOverlapsItem2', {
                        defaultValue: 'Consider consolidating contract lines or reorganizing services'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.bestPractices.minimizeOverlapsItem3', {
                        defaultValue:
                          'If overlaps are necessary, ensure clear documentation of which contract line should be used when'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('bp2')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.bestPractices.clearNamingTitle', {
                    defaultValue: '2. Use Clear Plan Naming Conventions'
                  })}
                </span>
                {expandedSections['bp2'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['bp2'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.bestPractices.clearNamingDescription', {
                      defaultValue:
                        'Name contract lines in a way that clearly indicates their purpose and scope for this client.'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.bestPractices.clearNamingItem1', {
                        defaultValue:
                          'Include the contract line type in the name (e.g., "Monthly Support Bucket", "Project-Based Plan")'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.bestPractices.clearNamingItem2', {
                        defaultValue:
                          'Consider including dates or version numbers for contract lines that change over time'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.bestPractices.clearNamingItem3', {
                        defaultValue:
                          'Use consistent naming patterns across all contract lines for this client'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('bp3')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.bestPractices.documentRulesTitle', {
                    defaultValue: '3. Document Disambiguation Rules'
                  })}
                </span>
                {expandedSections['bp3'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['bp3'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.bestPractices.documentRulesDescription', {
                      defaultValue:
                        'Clearly document how service overlaps should be handled for this specific client.'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.bestPractices.documentRulesItem1', {
                        defaultValue:
                          'Create client-specific guidelines for which contract line to use in different scenarios'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.bestPractices.documentRulesItem2', {
                        defaultValue:
                          'Share these guidelines with all team members who work with this client'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.bestPractices.documentRulesItem3', {
                        defaultValue:
                          'Include examples of common situations and how they should be handled'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="scenarios" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>
              {t('clientContractLineGuide.scenarios.title', {
                defaultValue: 'Common Disambiguation Scenarios'
              })}
            </AlertTitle>
            <AlertDescription>
              {t('clientContractLineGuide.scenarios.description', {
                defaultValue:
                  'These examples illustrate how contract line disambiguation works in common scenarios for this client.'
              })}
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('sc1')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.scenarios.scenario1Title', {
                    defaultValue: 'Scenario 1: Bucket Plan + Standard Plan'
                  })}
                </span>
                {expandedSections['sc1'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['sc1'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.scenarios.scenario1Description', {
                      defaultValue:
                        'When a service appears in both a bucket contract line and a standard contract line for this client:'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario1Item1', {
                        defaultValue: 'The bucket contract line is given priority by default'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario1Item2', {
                        defaultValue:
                          "Time entries and usage will be billed against the bucket contract line until it's depleted"
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario1Item3', {
                        defaultValue:
                          'After the bucket is depleted, the standard contract line will be used automatically'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario1Item4', {
                        defaultValue:
                          'Users can manually override this behavior by explicitly selecting a contract line during time entry'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('sc2')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.scenarios.scenario2Title', {
                    defaultValue: 'Scenario 2: Multiple Standard Plans'
                  })}
                </span>
                {expandedSections['sc2'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['sc2'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.scenarios.scenario2Description', {
                      defaultValue:
                        'When a service appears in multiple standard contract lines for this client:'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario2Item1', {
                        defaultValue:
                          'Users will be prompted to select which contract line to bill against during time entry'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario2Item2', {
                        defaultValue:
                          'If no contract line is explicitly selected, billing should stop with an ambiguity error that requires user choice'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario2Item3', {
                        defaultValue: 'Consider consolidating these contract lines to avoid confusion'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('sc3')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.scenarios.scenario3Title', {
                    defaultValue: 'Scenario 3: Multiple Bucket Plans'
                  })}
                </span>
                {expandedSections['sc3'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['sc3'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.scenarios.scenario3Description', {
                      defaultValue:
                        'When a service appears in multiple bucket contract lines for this client:'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario3Item1', {
                        defaultValue:
                          'Users will be prompted to select which bucket to bill against during time entry'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario3Item2', {
                        defaultValue:
                          'If no bucket is explicitly selected, billing should stop with an ambiguity error that requires user choice'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.scenarios.scenario3Item3', {
                        defaultValue:
                          'Teams can define internal guidance for choosing between overlapping buckets'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="troubleshooting" className="space-y-4">
          <Alert variant="info">
            <AlertTitle>
              {t('clientContractLineGuide.troubleshooting.title', {
                defaultValue: 'Troubleshooting Contract Line Disambiguation'
              })}
            </AlertTitle>
            <AlertDescription>
              {t('clientContractLineGuide.troubleshooting.description', {
                defaultValue:
                  'Solutions for common issues related to contract line disambiguation for this client.'
              })}
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('ts1')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.troubleshooting.issueWrongPlanTitle', {
                    defaultValue: 'Issue: Time Entry Billed to Wrong Plan'
                  })}
                </span>
                {expandedSections['ts1'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['ts1'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.troubleshooting.issueWrongPlanDescription', {
                      defaultValue:
                        'If time entries are being billed to the wrong contract line for this client:'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueWrongPlanItem1', {
                        defaultValue: 'Check if the time entry has an explicit contract_line_id assigned'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueWrongPlanItem2', {
                        defaultValue: 'Verify that the service is included in the expected contract line'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueWrongPlanItem3', {
                        defaultValue:
                          'Review the disambiguation rules to understand why a particular contract line was selected'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueWrongPlanItem4', {
                        defaultValue: 'Update the time entry to explicitly select the correct contract line'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueWrongPlanItem5', {
                        defaultValue:
                          "Consider updating the client's contract line configuration to avoid future issues"
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('ts2')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.troubleshooting.issueSelectionMissingTitle', {
                    defaultValue: 'Issue: Plan Selection Not Appearing'
                  })}
                </span>
                {expandedSections['ts2'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['ts2'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.troubleshooting.issueSelectionMissingDescription', {
                      defaultValue:
                        'If the contract line selection dropdown is not appearing during time entry for this client:'
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueSelectionMissingItem1', {
                        defaultValue:
                          'Verify that the service is actually included in multiple active contract lines'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueSelectionMissingItem2', {
                        defaultValue:
                          'Check if one of the contract lines has expired or is not yet active'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueSelectionMissingItem3', {
                        defaultValue:
                          'Ensure that the client and service selections are made before expecting the contract line dropdown'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueSelectionMissingItem4', {
                        defaultValue: 'Try refreshing the page or clearing the browser cache'
                      })}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-3 bg-gray-50 hover:bg-gray-100 text-left"
                onClick={() => toggleSection('ts3')}
              >
                <span className="font-medium">
                  {t('clientContractLineGuide.troubleshooting.issueReportingTitle', {
                    defaultValue: 'Issue: Inconsistent Reporting'
                  })}
                </span>
                {expandedSections['ts3'] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSections['ts3'] && (
                <div className="p-3 border-t border-gray-200">
                  <p className="text-sm text-gray-700 mb-2">
                    {t('clientContractLineGuide.troubleshooting.issueReportingDescription', {
                      defaultValue:
                        "If you're seeing inconsistent reporting for services that appear in multiple contract lines for this client:"
                    })}
                  </p>
                  <ul className="text-sm space-y-1 text-gray-700 list-disc pl-5">
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueReportingItem1', {
                        defaultValue:
                          'Use the contract_line_id filter in reports to see data for specific contract lines'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueReportingItem2', {
                        defaultValue:
                          'Check if time entries or usage records have explicit contract line assignments'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueReportingItem3', {
                        defaultValue:
                          'Review historical data to see if contract line assignments have changed over time'
                      })}
                    </li>
                    <li>
                      {t('clientContractLineGuide.troubleshooting.issueReportingItem4', {
                        defaultValue:
                          "Consider updating the client's contract line configuration to reduce overlaps"
                      })}
                    </li>
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
