/** Shared field sources for interactive reads and background delivery. */
export const coManagedConversationBodySources = ['conversation',
  'note', 'markdown_content', 'created_at', 'updated_at', 'thread_id', 'parent_comment_id', 'collaboration_audience'] as const;
export const coManagedConversationAuthorSources = ['author', 'actor', 'user_id', 'contact_id', 'users', 'contacts', 'actor_reference_id', 'actor_display_name', 'actor_organization_name',
  'actor_tenant', 'actor_user_id', 'actor_kind', 'external_author_email', 'first_name', 'last_name', 'full_name', 'display_name', 'organization_name'] as const;
export const coManagedConversationAttachmentSources = ['attachments', 'documents', 'external_files', 'co_management_conversation_attachments',
  'attachment_id', 'file_id', 'file_name', 'mime_type', 'file_size', 'storage_path', 'fileName', 'mimeType', 'size'] as const;
