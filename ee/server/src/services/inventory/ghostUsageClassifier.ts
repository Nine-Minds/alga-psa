import { resolveChatProvider } from '../chatProviderResolver';

/**
 * Ghost-usage ticket classifier (PRD §17.2) — EE implementation.
 *
 * Deliberately thin: it owns the prompt and the provider call, returns the RAW
 * model output, and nothing else. Parsing (tolerant JSON extraction), gating
 * (edition / add-on / tenant opt-in), and persistence all live with the caller
 * (server/src ghostUsageAiActions + @alga-psa/inventory lib), so this file has
 * no dependency on the inventory package and the behavior that needs tests sits
 * in testable trees. Modeled on inboundEmailRuleAiClassifier.
 */

export interface GhostTicketClassifierInput {
  ticket_id: string;
  /** §17.3 — the bounded title+comments bundle. Nothing else is ever sent. */
  text: string;
}

export interface GhostTicketClassifierOutput {
  ticket_id: string;
  /** Raw model content; null means the provider call itself failed (retryable). */
  raw: string | null;
  model: string | null;
  error: string | null;
}

export interface GhostUsageTicketClassifier {
  classifyBatch(
    tenantId: string,
    inputs: GhostTicketClassifierInput[],
    opts?: { concurrency?: number },
  ): Promise<GhostTicketClassifierOutput[]>;
}

const MAX_OUTPUT_TOKENS = 200;
const DEFAULT_CONCURRENCY = 3;

const SYSTEM_PROMPT = [
  'You audit closed MSP service-desk tickets for unrecorded hardware usage.',
  'Decide whether the described work PHYSICALLY consumed a part from the technician\'s own stock',
  '(a drive, RAM, IP phone, laptop, access point, cable, or similar installed, replaced, swapped, or delivered).',
  'Reply "hardware_missing" when the text clearly describes such hardware being used, so a parts charge is likely missing.',
  'Reply "no_hardware" when the work was remote/software/config/advisory, or the hardware was customer-supplied,',
  'a vendor warranty/RMA replacement, or explicitly not used.',
  'Reply "unclear" when the text does not say. Never guess beyond the text.',
  'Respond with ONLY a JSON object:',
  '{"classification": "hardware_missing" | "no_hardware" | "unclear", "confidence": <number 0..1>, "reason": "<one short sentence citing the text>"}',
].join(' ');

type ResolvedProvider = Awaited<ReturnType<typeof resolveChatProvider>>;

async function classifyOne(
  provider: ResolvedProvider,
  tenantId: string,
  input: GhostTicketClassifierInput,
): Promise<GhostTicketClassifierOutput> {
  try {
    const completion = await provider.client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input.text },
      ],
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...provider.requestOverrides.resolveTurnOverrides(),
    });

    // Structured usage line so per-tenant token metering can be layered on
    // without changing this module (same contract as the email classifier).
    if (completion.usage) {
      console.info('ghostUsageClassifier: token usage', {
        tenantId,
        ticketId: input.ticket_id,
        model: provider.model,
        usage: completion.usage,
      });
    }

    const raw = completion.choices?.[0]?.message?.content ?? '';
    return {
      ticket_id: input.ticket_id,
      raw: typeof raw === 'string' ? raw : JSON.stringify(raw),
      model: provider.model,
      error: null,
    };
  } catch (error) {
    return {
      ticket_id: input.ticket_id,
      raw: null,
      model: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const classifier: GhostUsageTicketClassifier = {
  async classifyBatch(tenantId, inputs, opts) {
    if (inputs.length === 0) return [];

    let provider: ResolvedProvider;
    try {
      provider = await resolveChatProvider();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return inputs.map((input) => ({
        ticket_id: input.ticket_id,
        raw: null,
        model: null,
        error: `Chat provider unavailable: ${message}`,
      }));
    }

    const concurrency = Math.max(1, Math.min(opts?.concurrency ?? DEFAULT_CONCURRENCY, inputs.length));
    const results: GhostTicketClassifierOutput[] = new Array(inputs.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (true) {
          const i = next++;
          if (i >= inputs.length) return;
          results[i] = await classifyOne(provider, tenantId, inputs[i]);
        }
      }),
    );
    return results;
  },
};

export function createGhostUsageClassifier(): GhostUsageTicketClassifier {
  return classifier;
}
