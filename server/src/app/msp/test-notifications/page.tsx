'use client';

import { useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { createTestNotificationAction, createMultipleTestNotificationsAction } from 'server/src/lib/actions/notification-actions/testNotificationActions';

export default function TestNotificationsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  const handleCreateSingleTest = async () => {
    setIsLoading(true);
    setResult('');
    
    try {
      const response = await createTestNotificationAction();
      if (response.success) {
        setResult('✅ Test notification created successfully! Check the notification bell in the header.');
      } else {
        setResult(`❌ Failed to create test notification: ${response.error}`);
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMultipleTests = async () => {
    setIsLoading(true);
    setResult('');
    
    try {
      const response = await createMultipleTestNotificationsAction();
      if (response.success) {
        setResult(`✅ Created ${response.count} test notifications successfully! Check the notification bell in the header.`);
      } else {
        setResult(`❌ Failed to create test notifications: ${response.error}`);
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Test Notification System</h1>
      
      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Manual Notification Testing</h2>
          <p className="text-gray-600 mb-4">
            Use these buttons to manually create test notifications and verify the system is working.
          </p>
          
          <div className="space-y-4">
            <div>
              <Button 
                id="create-single-test"
                onClick={handleCreateSingleTest}
                disabled={isLoading}
                className="mr-4"
              >
                {isLoading ? 'Creating...' : 'Create Single Test Notification'}
              </Button>
              
              <Button 
                id="create-multiple-tests"
                onClick={handleCreateMultipleTests}
                disabled={isLoading}
                variant="outline"
              >
                {isLoading ? 'Creating...' : 'Create Multiple Test Notifications'}
              </Button>
            </div>
            
            {result && (
              <div className={`p-3 rounded-md ${
                result.startsWith('✅') 
                  ? 'bg-green-50 text-green-800 border border-green-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {result}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Event-Based Testing</h2>
          <p className="text-gray-600 mb-4">
            To test event-based notifications, try these actions:
          </p>
          
          <div className="space-y-2 text-sm">
            <div className="flex items-center">
              <span className="w-4 h-4 bg-blue-100 rounded-full mr-2"></span>
              <span><strong>Create a new ticket</strong> → Should trigger TICKET_CREATED notification</span>
            </div>
            <div className="flex items-center">
              <span className="w-4 h-4 bg-green-100 rounded-full mr-2"></span>
              <span><strong>Assign a ticket</strong> → Should trigger TICKET_ASSIGNED notification</span>
            </div>
            <div className="flex items-center">
              <span className="w-4 h-4 bg-yellow-100 rounded-full mr-2"></span>
              <span><strong>Change ticket priority from Low to High</strong> → Should trigger TICKET_PRIORITY_ESCALATED notification</span>
            </div>
            <div className="flex items-center">
              <span className="w-4 h-4 bg-purple-100 rounded-full mr-2"></span>
              <span><strong>Close a ticket</strong> → Should trigger TICKET_CLOSED notification</span>
            </div>
            <div className="flex items-center">
              <span className="w-4 h-4 bg-orange-100 rounded-full mr-2"></span>
              <span><strong>Add @mention in ticket comment</strong> → Should trigger USER_MENTIONED notification</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">What to Check</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p>After creating notifications, check:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>The red notification badge appears on the bell icon in the header</li>
              <li>Clicking the bell shows the notification dropdown</li>
              <li>Notifications appear in real-time without page refresh</li>
              <li>Clicking "Mark all as read" clears the badge</li>
              <li>Individual notifications can be marked as read</li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}