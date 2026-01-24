'use client';

import { useState } from 'react';
import { TaskInbox, EmbeddedTaskInbox } from './TaskInbox';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';

/**
 * Task Inbox Example Page
 * 
 * This component demonstrates the Task Inbox components in different configurations.
 * It's intended for development and testing purposes.
 */
export default function TaskInboxExample() {
  const [view, setView] = useState<'full' | 'embedded'>('full');
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Task Inbox System</h1>
      
      <Card className="p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">View Options</h2>
        <div className="flex space-x-4">
          <Button
            id="view-full-inbox"
            variant={view === 'full' ? 'default' : 'outline'}
            onClick={() => setView('full')}
          >
            Full Task Inbox
          </Button>
          <Button
            id="view-embedded-inbox"
            variant={view === 'embedded' ? 'default' : 'outline'}
            onClick={() => setView('embedded')}
          >
            Embedded Task Inbox
          </Button>
        </div>
      </Card>
      
      {view === 'full' ? (
        <TaskInbox />
      ) : (
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold mb-4">User Activities Dashboard</h2>
          <p className="text-gray-600 mb-6">
            This demonstrates how the Task Inbox can be embedded in the user activities screen.
          </p>
          
          <Tabs value="tasks" onValueChange={(value) => console.log(`Tab changed to ${value}`)} className="w-full">
            <TabsList>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="messages">Messages</TabsTrigger>
            </TabsList>
            <TabsContent value="tasks">
              <EmbeddedTaskInbox />
            </TabsContent>
            <TabsContent value="notifications">
              <Card className="p-4">
                <p className="text-gray-500">No new notifications</p>
              </Card>
            </TabsContent>
            <TabsContent value="messages">
              <Card className="p-4">
                <p className="text-gray-500">No new messages</p>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}