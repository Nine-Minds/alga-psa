'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CollaborativeEditor } from '@alga-psa/documents/components';
import { createBlockDocument, getBlockContent } from '@alga-psa/documents/actions/documentBlockContentActions';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { syncCollabSnapshot } from '@alga-psa/documents/actions/collaborativeEditingActions';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type PresenceUser = {
  id: string;
  name: string;
  color: string;
};

interface CollabTestPageClientProps {
  userId: string;
  userName: string;
  tenantId: string;
}

const DEFAULT_DOC_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
    },
  ],
};

export default function CollabTestPageClient({ userId, userName, tenantId }: CollabTestPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [documentIdInput, setDocumentIdInput] = useState('');
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<PresenceUser[]>([]);
  const [isSynced, setIsSynced] = useState(false);

  const roomName = useMemo(() => {
    if (!activeDocumentId) return null;
    return `document:${tenantId}:${activeDocumentId}`;
  }, [activeDocumentId, tenantId]);

  useEffect(() => {
    const docId = searchParams.get('doc');
    setDocumentIdInput(docId ?? '');
    if (!docId) {
      setActiveDocumentId(null);
      setDocError(null);
      return;
    }

    setIsLoadingDoc(true);
    setDocError(null);
    getBlockContent(docId)
      .then((content) => {
        if (!content) {
          setDocError('Document not found. Check the ID and try again.');
          setActiveDocumentId(null);
          return;
        }
        setActiveDocumentId(docId);
      })
      .catch((error) => {
        console.error('[collab-test] Failed to load document:', error);
        setDocError('Failed to load document.');
        setActiveDocumentId(null);
      })
      .finally(() => setIsLoadingDoc(false));
  }, [searchParams]);

  const handleOpenDocument = () => {
    if (!documentIdInput.trim()) {
      setDocError('Enter a document ID to open.');
      return;
    }
    setDocError(null);
    router.push(`/msp/test/collab?doc=${encodeURIComponent(documentIdInput.trim())}`);
  };

  const handleCreateDocument = async () => {
    setIsCreating(true);
    setDocError(null);
    setSnapshotMessage(null);
    try {
      const result = await createBlockDocument({
        document_name: `Collab Test ${new Date().toISOString()}`,
        user_id: userId,
        block_data: DEFAULT_DOC_CONTENT,
      });
      if (isActionPermissionError(result)) {
        setDocError(result.permissionError);
        return;
      }
      router.push(`/msp/test/collab?doc=${encodeURIComponent(result.document_id)}`);
    } catch (error) {
      console.error('[collab-test] Failed to create document:', error);
      setDocError('Failed to create document.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSnapshot = async () => {
    if (!activeDocumentId) return;
    setIsSnapshotting(true);
    setSnapshotMessage(null);
    try {
      const result = await syncCollabSnapshot(activeDocumentId);
      if (!result?.success) {
        setSnapshotMessage(result?.message || 'Snapshot failed.');
        return;
      }
      setSnapshotMessage('Snapshot saved to document_block_content.');
    } catch (error) {
      console.error('[collab-test] Snapshot failed:', error);
      setSnapshotMessage('Snapshot failed.');
    } finally {
      setIsSnapshotting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
              Document ID
            </label>
            <Input
              value={documentIdInput}
              onChange={(event) => setDocumentIdInput(event.target.value)}
              placeholder="Enter document ID"
            />
          </div>
          <Button id="collab-test-open-btn" onClick={handleOpenDocument} disabled={isLoadingDoc || isCreating}>
            Open
          </Button>
          <Button id="collab-test-create-btn" variant="secondary" onClick={handleCreateDocument} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create New Document'}
          </Button>
          <Button
            id="collab-test-snapshot-btn"
            variant="secondary"
            onClick={handleSnapshot}
            disabled={!activeDocumentId || isSnapshotting}
          >
            {isSnapshotting ? 'Snapshotting...' : 'Snapshot to DB'}
          </Button>
        </div>
        {docError && <div className="text-sm text-red-500">{docError}</div>}
        {snapshotMessage && <div className="text-sm text-[rgb(var(--color-text-600))]">{snapshotMessage}</div>}
      </Card>

      <details className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <summary className="cursor-pointer text-sm font-medium text-[rgb(var(--color-text-700))]">
          Debug Panel
        </summary>
        <div className="mt-3 grid gap-2 text-sm text-[rgb(var(--color-text-600))]">
          <div>Room: {roomName ?? '—'}</div>
          <div>Connection: {connectionStatus}</div>
          <div>Connected users: {connectedUsers.length}</div>
          <div>Y.js sync: {isSynced ? 'synced' : 'syncing'}</div>
        </div>
      </details>

      {activeDocumentId ? (
        <CollaborativeEditor
          documentId={activeDocumentId}
          tenantId={tenantId}
          userId={userId}
          userName={userName}
          searchMentions={searchUsersForMentions}
          onConnectionStatusChange={setConnectionStatus}
          onUsersChange={setConnectedUsers}
          onSyncStateChange={setIsSynced}
        />
      ) : (
        <Card className="p-6 text-sm text-[rgb(var(--color-text-600))]">
          {isLoadingDoc ? 'Loading document...' : 'Open or create a document to start collaborating.'}
        </Card>
      )}
    </div>
  );
}
