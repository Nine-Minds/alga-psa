import React from 'react';
import { MessageEnvelope } from 'server/src/components/messaging/MessageEnvelope';

export default function MessagesPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
      </div>
      
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 text-center text-gray-500">
          <h3 className="text-lg font-medium mb-2">Messages Dashboard</h3>
          <p className="mb-4">Manage your direct messages with team members here.</p>
          <p className="text-sm">Full messaging interface coming soon. For now, use the message envelope icon in the header to access your messages.</p>
        </div>
      </div>
    </div>
  );
}