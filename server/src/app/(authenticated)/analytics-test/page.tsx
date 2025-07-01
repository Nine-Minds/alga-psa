'use client';

import { useState } from 'react';
import { Card, Button, Badge, Heading, Text, Flex, Box } from '@radix-ui/themes';
import { CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { usePostHog } from 'posthog-js/react';

export default function AnalyticsTestPage() {
  const [testResults, setTestResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const posthog = usePostHog();

  const runTests = async () => {
    setLoading(true);
    try {
      // Test client-side event
      posthog?.capture('analytics_test_started', {
        test_type: 'comprehensive',
        timestamp: new Date().toISOString()
      });

      const response = await fetch('/api/test-all-analytics');
      const data = await response.json();
      setTestResults(data);

      // Test client-side event
      posthog?.capture('analytics_test_completed', {
        success: data.status === 'success',
        events_sent: data.total_events_sent
      });
    } catch (error) {
      setTestResults({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === 'sent') return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === 'error') return <XCircle className="w-4 h-4 text-red-500" />;
    return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Heading size="8" mb="2">Analytics Test Suite</Heading>
      <Text size="3" color="gray" mb="6">
        Test all implemented analytics events to verify they&apos;re working correctly
      </Text>

      <Card className="mb-6">
        <Flex direction="column" gap="4">
          <Box>
            <Heading size="4" mb="2">Test Information</Heading>
            <Text size="2" color="gray">
              This will send test events to PostHog with a test_run: true flag to distinguish them from real usage data.
            </Text>
          </Box>

          <Button 
            onClick={runTests} 
            disabled={loading}
            size="3"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Tests...
              </>
            ) : (
              'Run All Tests'
            )}
          </Button>
        </Flex>
      </Card>

      {testResults && (
        <Card>
          <Flex direction="column" gap="4">
            <Flex justify="between" align="center">
              <Heading size="4">Test Results</Heading>
              <Badge 
                color={testResults.status === 'success' ? 'green' : 'red'}
                size="2"
              >
                {testResults.status}
              </Badge>
            </Flex>

            {testResults.analytics_enabled !== undefined && (
              <Box>
                <Text size="2" weight="bold">Analytics Status: </Text>
                <Badge color={testResults.analytics_enabled ? 'green' : 'gray'}>
                  {testResults.analytics_enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </Box>
            )}

            {testResults.total_events_sent && (
              <Box>
                <Text size="2" weight="bold">Total Events Sent: </Text>
                <Text size="2">{testResults.total_events_sent}</Text>
              </Box>
            )}

            {testResults.test_results && (
              <Box>
                <Heading size="3" mb="2">Event Results</Heading>
                <div className="space-y-2">
                  {Object.entries(testResults.test_results).map(([event, status]) => (
                    <Flex key={event} align="center" gap="2" className="py-1">
                      {getStatusIcon(status as string)}
                      <Text size="2" className="font-mono">{event}</Text>
                      <Text size="1" color="gray">({status as string})</Text>
                    </Flex>
                  ))}
                </div>
              </Box>
            )}

            {testResults.error && (
              <Box className="p-3 bg-red-50 rounded">
                <Text size="2" color="red">Error: {testResults.error}</Text>
              </Box>
            )}

            <Box className="mt-4 p-3 bg-gray-50 rounded">
              <Text size="1" className="font-mono">
                {JSON.stringify(testResults, null, 2)}
              </Text>
            </Box>
          </Flex>
        </Card>
      )}
    </div>
  );
}