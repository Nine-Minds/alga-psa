import { NextRequest } from 'next/server';
import { getExperimentalFeaturesForTenant } from '@alga-psa/tenancy/actions';
import { createTenantKnex, runWithTenant } from '@/lib/db';

const isEnterpriseEdition =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  process.env.EDITION === 'enterprise' ||
  process.env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

const DOCUMENT_ASSIST_SYSTEM_PROMPT = `You are Alga AI, an intelligent assistant embedded in a collaborative document editor for a Professional Services Automation (PSA) platform used by Managed Service Providers (MSPs).

Your role is to help users write, edit, and improve document content. You receive the full document context and a specific instruction from the user.

Guidelines:
- ALWAYS produce document content directly. NEVER ask clarifying questions, present options, or ask what the user wants. If the instruction is ambiguous, make the most reasonable interpretation and act on it.
- Do not include greetings, sign-offs, or meta-commentary like "Here is..." or "Sure, I can help with that."
- Your response will be inserted directly into the document, so output ONLY the content itself.
- Match the tone and style of the existing document content.
- Use markdown formatting: headings (#, ##, ###), bullet points (-), numbered lists (1.), bold (**text**), italic (*text*), code blocks (\`\`\`), inline code (\`text\`), and blockquotes (>).
- If the instruction asks you to rewrite or edit existing content, provide the improved version directly.
- If the instruction asks a question, provide the answer as document content (not as a chat reply).
- Keep responses focused and concise unless the instruction asks for detail.
- For technical MSP content (networking, security, troubleshooting), be accurate and specific.
- When following up on a previous exchange, maintain continuity and build on what was already discussed.`;

async function resolveDocumentName(tenantId: string, documentId: string): Promise<string> {
  try {
    const name = await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();
      const row = await knex('documents')
        .select('document_name')
        .where({ document_id: documentId, tenant: tenantId })
        .first();
      return row?.document_name || null;
    });
    return name || 'Untitled';
  } catch (error) {
    console.error('[document-assist] Failed to resolve document name:', error);
    return 'Untitled';
  }
}

export async function POST(req: NextRequest) {
  // Gate 1: Edition check
  if (!isEnterpriseEdition) {
    return new Response(
      JSON.stringify({ error: 'Document AI assist is only available in Enterprise Edition' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Gate 2: API key validation (server-to-server auth from Hocuspocus)
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.AI_DOCUMENT_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return new Response(
      JSON.stringify({ error: 'Invalid API key' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: {
    instruction: string;
    documentContext: string;
    documentId?: string;
    tenantId: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { instruction, documentContext, documentId, tenantId, conversationHistory } = body;

  if (!instruction || !tenantId) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: instruction, tenantId' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Gate 3: Defense-in-depth feature flag check (lightweight DB query, no auth needed)
  try {
    const features = await getExperimentalFeaturesForTenant(tenantId);
    if (!features.aiAssistant) {
      return new Response(
        JSON.stringify({ error: 'AI Assistant is not enabled for this tenant' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    console.error('[document-assist] Failed to check feature flag:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to verify feature flag' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Resolve human-readable document name
  const documentName = documentId
    ? await resolveDocumentName(tenantId, documentId)
    : 'Untitled';

  // Build conversation messages with optional history for follow-ups
  const validHistory = Array.isArray(conversationHistory)
    ? conversationHistory
        .filter(
          (msg) =>
            msg &&
            typeof msg.role === 'string' &&
            typeof msg.content === 'string' &&
            (msg.role === 'user' || msg.role === 'assistant'),
        )
        .slice(-10) // cap at last 10 messages
    : [];

  // Resolve AI provider and generate response
  try {
    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');
    const provider = await resolveChatProvider();

    const messages = [
      { role: 'system' as const, content: DOCUMENT_ASSIST_SYSTEM_PROMPT },
      ...validHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content: `Document: "${documentName}"

--- Document Content ---
${documentContext || '(empty document)'}
--- End Document Content ---

Instruction: ${instruction}`,
      },
    ];

    const completion = await provider.client.chat.completions.create({
      model: provider.model,
      messages,
      max_tokens: 2048,
      temperature: 0.55,
      ...provider.requestOverrides.resolveTurnOverrides(),
    });

    const responseText = completion.choices?.[0]?.message?.content || '';

    return new Response(
      JSON.stringify({ response: responseText }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[document-assist] AI completion failed:', error);
    return new Response(
      JSON.stringify({ error: 'AI completion failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
