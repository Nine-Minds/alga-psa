'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { 
  debugNotificationSystem, 
  createTestNotification, 
  checkNotificationPreferences 
} from 'server/src/lib/actions/notification-actions/debugNotificationActions';

export default function NotificationDebugPage() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runDebug = async (debugFunction: () => Promise<any>, name: string) => {
    setLoading(true);
    try {
      const result = await debugFunction();
      setResults({ name, result, timestamp: new Date().toISOString() });
    } catch (error) {
      setResults({ 
        name, 
        result: { success: false, error: error.message }, 
        timestamp: new Date().toISOString() 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Notification System Debug</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Button
          onClick={() => runDebug(debugNotificationSystem, 'System Debug')}
          disabled={loading}
          className="h-20"
        >
          🔍 Debug Notification System
        </Button>
        
        <Button
          onClick={() => runDebug(createTestNotification, 'Test Notification')}
          disabled={loading}
          className="h-20"
        >
          ✨ Create Test Notification
        </Button>
        
        <Button
          onClick={() => runDebug(checkNotificationPreferences, 'Check Preferences')}
          disabled={loading}
          className="h-20"
        >
          ⚙️ Check User Preferences
        </Button>
      </div>

      {loading && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span>Running debug test...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card>
          <CardHeader>
            <CardTitle>
              {results.name} Results
              <span className="text-sm font-normal text-gray-500 ml-2">
                {new Date(results.timestamp).toLocaleString()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-100 p-4 rounded-md overflow-auto text-sm">
              {JSON.stringify(results.result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Debug Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold">System Debug</h4>
            <p className="text-sm text-gray-600">
              Checks notification types, templates, publishes a test event, and verifies notification creation.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold">Test Notification</h4>
            <p className="text-sm text-gray-600">
              Creates a notification directly in the database (bypasses event system).
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold">Check Preferences</h4>
            <p className="text-sm text-gray-600">
              Shows current user&apos;s notification preferences and settings.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}