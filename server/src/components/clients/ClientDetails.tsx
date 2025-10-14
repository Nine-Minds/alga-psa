'use client';

import React from 'react';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import Link from 'next/link';

interface ClientDetailsProps {
  client: IClient;
  documents: IDocument[];
  contacts: IContact[];
}

export default function ClientDetails({ client, documents, contacts }: ClientDetailsProps) {
  return (
    <div className="space-y-6">
      {/* Client Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client.client_name}</h1>
          <p className="text-gray-600">Client Details</p>
        </div>
        <Link href={`/msp/contacts?client=${client.client_id}`}>
          <Button variant="outline">
            View in Contacts
          </Button>
        </Link>
      </div>

      {/* Client Information */}
      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Client Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Client Name</label>
              <p className="mt-1 text-sm text-gray-900">{client.client_name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <p className="mt-1 text-sm text-gray-900">
                {client.is_inactive ? 'Inactive' : 'Active'}
              </p>
            </div>
            {client.address && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Address</label>
                <p className="mt-1 text-sm text-gray-900">{client.address}</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Contacts Section */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Contacts ({contacts.length})</h2>
            <Link href={`/msp/contacts?client=${client.client_id}`}>
              <Button variant="outline" size="sm">
                Manage Contacts
              </Button>
            </Link>
          </div>
          {contacts.length > 0 ? (
            <div className="space-y-3">
              {contacts.slice(0, 5).map((contact) => (
                <div key={contact.contact_name_id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                  <div>
                    <p className="font-medium text-gray-900">{contact.full_name}</p>
                    <p className="text-sm text-gray-600">{contact.email}</p>
                    {contact.role && (
                      <p className="text-xs text-gray-500">{contact.role}</p>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    {contact.is_inactive ? 'Inactive' : 'Active'}
                  </div>
                </div>
              ))}
              {contacts.length > 5 && (
                <p className="text-sm text-gray-600 pt-2">
                  And {contacts.length - 5} more contacts...
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-600">No contacts found for this client.</p>
          )}
        </div>
      </Card>

      {/* Documents Section */}
      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Documents ({documents.length})</h2>
          {documents.length > 0 ? (
            <div className="space-y-3">
              {documents.slice(0, 5).map((document) => (
                <div key={document.document_id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                  <div>
                    <p className="font-medium text-gray-900">{document.name}</p>
                    <p className="text-sm text-gray-600">
                      {document.file_size ? `${Math.round(document.file_size / 1024)} KB` : 'Unknown size'}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500">
                    {document.uploaded_at ? new Date(document.uploaded_at).toLocaleDateString() : 'Unknown date'}
                  </div>
                </div>
              ))}
              {documents.length > 5 && (
                <p className="text-sm text-gray-600 pt-2">
                  And {documents.length - 5} more documents...
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-600">No documents found for this client.</p>
          )}
        </div>
      </Card>
    </div>
  );
}