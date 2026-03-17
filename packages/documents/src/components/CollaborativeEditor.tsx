'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import {
  Emoticon,
  createYjsProvider,
  EmojiSuggestionExtension,
  EmojiSuggestionPopup,
  MentionNode,
  MentionSuggestionExtension,
  MentionSuggestionPopup,
} from '@alga-psa/ui/editor';
import type { EmojiSuggestionState, MentionSuggestionState, MentionSuggestionUser } from '@alga-psa/ui/editor';
import AvatarIcon from '@alga-psa/ui/components/AvatarIcon';
import { Card } from '@alga-psa/ui/components/Card';
import { EditorToolbar } from './EditorToolbar';
import { handleMarkdownPaste } from './markdownPaste';
import styles from './CollaborativeEditor.module.css';
import { getBlockContent, updateBlockContent } from '../actions/documentBlockContentActions';
import {
  blockNoteJsonToProsemirrorJson,
  detectBlockContentFormat,
  parseBlockContent,
  normalizeProsemirrorJson,
} from '../lib/blockContentFormat';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type PresenceUser = {
  id: string;
  name: string;
  color: string;
};

export interface CollaborativeEditorHandle {
  getJSON: () => Record<string, unknown> | null;
}

interface CollaborativeEditorProps {
  documentId: string;
  tenantId: string;
  userId: string;
  userName: string;
  placeholder?: string;
  editorRef?: React.MutableRefObject<CollaborativeEditorHandle | null>;
  searchMentions?: (query: string) => Promise<MentionSuggestionUser[]>;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onSyncStateChange?: (synced: boolean) => void;
  onUsersChange?: (users: PresenceUser[]) => void;
  /** Pre-loaded block_data to seed Y.js fragment instead of fetching from DB. */
  initialContent?: unknown;
  /** Whether the AI assistant experimental feature is enabled. */
  aiAssistantEnabled?: boolean;
}

const USER_COLORS = [
  '#0ea5e9',
  '#14b8a6',
  '#f97316',
  '#ef4444',
  '#8b5cf6',
  '#22c55e',
  '#eab308',
  '#ec4899',
];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getUserColor = (userId: string) => {
  const index = hashString(userId) % USER_COLORS.length;
  return USER_COLORS[index];
};

const parseName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: 'User', lastName: '' };
  }
  return {
    firstName: parts[0] || 'User',
    lastName: parts.slice(1).join(' '),
  };
};

const buildPresenceUsers = (
  states: Array<[number, { user?: PresenceUser }]>,
  fallbackColor: string
) => {
  const users = states
    .map(([clientId, state]) => {
      if (!state.user) return null;
      return {
        id: state.user.id || `${clientId}`,
        name: state.user.name || 'User',
        color: state.user.color || fallbackColor,
      } as PresenceUser;
    })
    .filter(Boolean) as PresenceUser[];

  const seen = new Set<string>();
  return users.filter((user) => {
    if (seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
};

export function CollaborativeEditor({
  documentId,
  tenantId,
  userId,
  userName,
  placeholder,
  editorRef,
  searchMentions,
  onConnectionStatusChange,
  onSyncStateChange,
  onUsersChange,
  initialContent,
  aiAssistantEnabled = false,
}: CollaborativeEditorProps) {
  const roomName = useMemo(() => `document:${tenantId}:${documentId}`, [tenantId, documentId]);
  const { provider, ydoc } = useMemo(
    () =>
      createYjsProvider(roomName, {
        parameters: {
          tenantId,
          userId,
        },
      }),
    [roomName, tenantId, userId]
  );
  const userColor = useMemo(() => getUserColor(userId), [userId]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<PresenceUser[]>([]);
  const [emojiState, setEmojiState] = useState<EmojiSuggestionState>(null);
  const [mentionState, setMentionState] = useState<MentionSuggestionState>(null);
  const hasInitializedContent = useRef(false);
  const initialContentRef = useRef(initialContent);

  const handleEmojiStateChange = useCallback((state: EmojiSuggestionState) => {
    setEmojiState(state);
  }, []);

  const handleMentionStateChange = useCallback((state: MentionSuggestionState) => {
    setMentionState(state);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        undoRedo: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Underline,
      Emoticon,
      MentionNode,
      EmojiSuggestionExtension.configure({
        onStateChange: handleEmojiStateChange,
      }),
      MentionSuggestionExtension.configure({
        onStateChange: handleMentionStateChange,
      }),
      Collaboration.configure({
        document: ydoc,
        field: 'prosemirror',
      }),
      CollaborationCaret.configure({
        provider,
        user: {
          id: userId,
          name: userName,
          color: userColor,
        },
        render: (user) => {
          const cursor = document.createElement('span');
          cursor.classList.add('collaboration-caret');
          cursor.style.borderColor = user.color;

          const label = document.createElement('span');
          label.classList.add('collaboration-caret__label');
          label.style.backgroundColor = user.color;
          label.textContent = user.name;
          cursor.appendChild(label);

          return cursor;
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none',
      },
      handlePaste: () => {
        return false;
      },
      handleDOMEvents: {
        paste: (_view, event) => {
          const plainText = event.clipboardData?.getData('text/plain');
          const htmlText = event.clipboardData?.getData('text/html');
          return handleMarkdownPaste(plainText, htmlText, (html) => {
            editor?.commands.insertContent(html, {
              parseOptions: { preserveWhitespace: false },
            });
          });
        },
      },
    },
    onCreate: () => {
      setEditorReady(true);
    },
    onDestroy: () => {
      setEditorReady(false);
    },
  });

  // Expose editor handle to parent via ref
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor && editorReady && !editor.isDestroyed
      ? { getJSON: () => editor.getJSON() }
      : null;
    return () => { if (editorRef) editorRef.current = null; };
  }, [editor, editorReady, editorRef]);

  useEffect(() => {
    provider.awareness?.setLocalStateField('user', {
      id: userId,
      name: userName,
      color: userColor,
    });

    const handleStatus = ({ status }: { status: ConnectionStatus }) => {
      setConnectionStatus(status);
      onConnectionStatusChange?.(status);
    };

    const handleSynced = ({ state }: { state: boolean }) => {
      setIsSynced(state);
      onSyncStateChange?.(state);
    };

    const handleUnsyncedChanges = (count: number) => {
      setHasUnsyncedChanges(count > 0);
    };

    const handleAwarenessChange = () => {
      const awarenessStates = provider.awareness?.getStates?.();
      if (!awarenessStates) return;
      const users = buildPresenceUsers(Array.from(awarenessStates.entries()), userColor);
      setConnectedUsers(users);
      onUsersChange?.(users);
    };

    provider.on('status', handleStatus);
    provider.on('synced', handleSynced);
    provider.on('unsyncedChanges', handleUnsyncedChanges);
    provider.on('awarenessChange', handleAwarenessChange);

    handleStatus({ status: provider.status as ConnectionStatus });
    handleSynced({ state: provider.synced });
    setHasUnsyncedChanges(provider.hasUnsyncedChanges);
    handleAwarenessChange();

    return () => {
      provider.off('status', handleStatus);
      provider.off('synced', handleSynced);
      provider.off('unsyncedChanges', handleUnsyncedChanges);
      provider.off('awarenessChange', handleAwarenessChange);
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc, userId, userName, userColor, onConnectionStatusChange, onSyncStateChange, onUsersChange]);

  useEffect(() => {
    if (!editor || !editorReady) return;
    if (hasInitializedContent.current) return;

    const initializeFromBlockContent = async () => {
      if (!provider.synced) {
        await new Promise<void>((resolve) => {
          const handleSynced = ({ state }: { state: boolean }) => {
            if (!state) return;
            provider.off('synced', handleSynced);
            resolve();
          };
          provider.on('synced', handleSynced);
        });
      }

      const fragment = ydoc.getXmlFragment('prosemirror');
      if (fragment.length > 0) {
        hasInitializedContent.current = true;
        return;
      }

      try {
        // Use pre-loaded content when available; otherwise fetch from DB
        const blockData = initialContentRef.current !== undefined
          ? initialContentRef.current
          : (await getBlockContent(documentId))?.block_data ?? null;

        if (blockData) {
          const format = detectBlockContentFormat(blockData);
          if (format === 'blocknote') {
            const converted = blockNoteJsonToProsemirrorJson(blockData);
            prosemirrorJSONToYXmlFragment(editor.schema, converted, fragment);
            try {
              await updateBlockContent(documentId, {
                block_data: JSON.stringify(converted),
                user_id: userId,
              });
            } catch (persistError) {
              console.error('[CollaborativeEditor] Failed to persist converted block content:', persistError);
            }
          } else if (format === 'prosemirror') {
            const parsed = normalizeProsemirrorJson(parseBlockContent(blockData));
            prosemirrorJSONToYXmlFragment(editor.schema, parsed, fragment);
          }
        }
      } catch (error) {
        console.error('[CollaborativeEditor] Failed to initialize from block content:', error);
      } finally {
        hasInitializedContent.current = true;
      }
    };

    void initializeFromBlockContent();
  }, [editor, editorReady, provider, ydoc, documentId]);

  const saveStatus = connectionStatus === 'disconnected'
    ? 'Offline — changes will sync when reconnected'
    : hasUnsyncedChanges
      ? 'Saving...'
      : 'All changes saved';

  const connectionLabel = connectionStatus === 'connected'
    ? 'Connected'
    : connectionStatus === 'connecting'
      ? 'Connecting'
      : 'Disconnected';

  return (
    <Card className="p-4">
      <div className={styles.header}>
        <div className={styles.presenceBar}>
          {connectedUsers.length === 0 ? (
            <span className={styles.presenceEmpty}>No one else is editing</span>
          ) : (
            connectedUsers.map((user) => {
              const { firstName, lastName } = parseName(user.name);
              return (
                <div key={user.id} className={styles.userChip}>
                  <AvatarIcon userId={user.id} firstName={firstName} lastName={lastName} size="xs" />
                  <span>{user.name}</span>
                </div>
              );
            })
          )}
        </div>
        <div className={styles.statusBar}>
          <div className={styles.connectionStatus} data-status={connectionStatus}>
            <span className={styles.statusDot} />
            <span>{connectionLabel}</span>
          </div>
          <div className={styles.saveStatus}>
            {saveStatus}
            {connectionStatus === 'connected' && !isSynced ? ' (syncing)' : ''}
          </div>
        </div>
      </div>

      {editor && editorReady && !editor.isDestroyed ? (
        <div
          className={styles.editorContainer}
          data-placeholder={placeholder || 'Start writing...'}
          style={{ position: 'relative' }}
        >
          <EditorToolbar editor={editor} />
          <EditorContent editor={editor} />
          <EmojiSuggestionPopup editor={editor} suggestionState={emojiState} />
          {searchMentions && (
            <MentionSuggestionPopup
              editor={editor}
              suggestionState={mentionState}
              searchMentions={searchMentions}
              aiAssistantEnabled={aiAssistantEnabled}
            />
          )}
        </div>
      ) : (
        <div className="flex justify-center items-center h-64">Initializing editor...</div>
      )}
    </Card>
  );
}
