import { Extension } from '@hocuspocus/server'

export function createDirectMessagePersistenceExtension(pgClient) {
  return new Extension({
    name: 'DirectMessagePersistence',

    async onStoreDocument({ documentName, document, requestHeaders, requestParameters }) {
      // Only handle direct message threads
      if (!documentName.startsWith('dm-thread-')) {
        return;
      }

      try {
        const threadId = documentName.replace('dm-thread-', '');
        const yMessages = document.getArray('messages');
        const messages = yMessages.toArray();

        // Get the last persisted message timestamp for this thread
        const lastPersistedQuery = `
          SELECT MAX(created_at) as last_persisted
          FROM direct_messages 
          WHERE thread_id = $1
        `;
        const lastPersistedResult = await pgClient.query(lastPersistedQuery, [threadId]);
        const lastPersisted = lastPersistedResult.rows[0]?.last_persisted || new Date(0);

        // Filter messages that need to be persisted
        const newMessages = messages.filter(msg => {
          if (!msg.id || !msg.sender_id || !msg.message || !msg.timestamp) {
            return false;
          }
          const messageDate = new Date(msg.timestamp);
          return messageDate > lastPersisted;
        });

        if (newMessages.length === 0) {
          return;
        }

        // Get tenant info from thread participants
        const threadQuery = `
          SELECT DISTINCT tenant, sender_id, recipient_id
          FROM direct_messages
          WHERE thread_id = $1
          LIMIT 1
        `;
        const threadResult = await pgClient.query(threadQuery, [threadId]);
        
        if (threadResult.rows.length === 0) {
          console.warn(`No existing thread found for ${threadId}, cannot determine tenant`);
          return;
        }

        const { tenant } = threadResult.rows[0];

        // Persist new messages to database
        for (const message of newMessages) {
          // Determine recipient based on sender
          const recipientQuery = `
            SELECT CASE 
              WHEN sender_id = $1 THEN recipient_id 
              ELSE sender_id 
            END as recipient_id
            FROM direct_messages
            WHERE thread_id = $2
            AND (sender_id = $1 OR recipient_id = $1)
            LIMIT 1
          `;
          const recipientResult = await pgClient.query(recipientQuery, [message.sender_id, threadId]);
          
          if (recipientResult.rows.length === 0) {
            console.warn(`Cannot determine recipient for message from ${message.sender_id} in thread ${threadId}`);
            continue;
          }

          const recipientId = recipientResult.rows[0].recipient_id;

          const insertQuery = `
            INSERT INTO direct_messages (
              direct_message_id,
              tenant,
              sender_id,
              recipient_id,
              thread_id,
              message,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (tenant, direct_message_id) DO NOTHING
          `;

          await pgClient.query(insertQuery, [
            message.id,
            tenant,
            message.sender_id,
            recipientId,
            threadId,
            message.message,
            new Date(message.timestamp)
          ]);
        }

        console.log(`Persisted ${newMessages.length} new messages for thread ${threadId}`);

      } catch (error) {
        console.error('Error persisting direct messages:', error);
      }
    },

    async onLoadDocument({ documentName, document }) {
      // Only handle direct message threads
      if (!documentName.startsWith('dm-thread-')) {
        return;
      }

      try {
        const threadId = documentName.replace('dm-thread-', '');
        
        // Load recent messages from database (last 50 messages)
        const messagesQuery = `
          SELECT direct_message_id, sender_id, message, created_at
          FROM direct_messages
          WHERE thread_id = $1
          AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 50
        `;
        
        const result = await pgClient.query(messagesQuery, [threadId]);
        const messages = result.rows.reverse(); // Reverse to get chronological order

        if (messages.length > 0) {
          const yMessages = document.getArray('messages');
          
          // Clear existing messages and load from database
          yMessages.delete(0, yMessages.length);
          
          // Add messages from database
          const hocuspocusMessages = messages.map(row => ({
            id: row.direct_message_id,
            sender_id: row.sender_id,
            message: row.message,
            timestamp: new Date(row.created_at).getTime(),
            thread_id: threadId,
            type: 'message'
          }));

          yMessages.push(hocuspocusMessages);
          console.log(`Loaded ${messages.length} messages for thread ${threadId}`);
        }

      } catch (error) {
        console.error('Error loading direct messages:', error);
      }
    }
  });
}