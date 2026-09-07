import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/inboundRequesterReply.ts', 'src/inboundEmailReply.ts', 'src/inboundEmailAttachments.ts', 'src/inboundConversationEvents.ts', 'src/nativeConversationEvents.ts', 'src/scheduledCommentPublication.ts'], format: ['esm'], dts: false, clean: true });
