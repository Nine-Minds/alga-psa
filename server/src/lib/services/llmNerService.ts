/**
 * Alga Guard - LLM-based Named Entity Recognition Service
 *
 * Uses a local LLM (vLLM/TGI compatible) to detect names and addresses in text.
 * Designed for private GPU infrastructure (A100/H100) with no external API calls.
 *
 * Features:
 * - F062: Name detection via LLM NER (replaces spaCy)
 * - F063: Address detection via LLM NER (replaces spaCy)
 */

// ============================================================================
// Types
// ============================================================================

export interface NerEntity {
  /** The extracted entity text */
  text: string;
  /** Entity type (PERSON, ADDRESS, ORGANIZATION, etc.) */
  type: 'PERSON' | 'ADDRESS' | 'ORGANIZATION' | 'LOCATION';
  /** Start character index in the original text */
  start_index: number;
  /** End character index in the original text */
  end_index: number;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface NerRequest {
  /** Text to analyze */
  text: string;
  /** Entity types to detect */
  entity_types: NerEntity['type'][];
  /** Maximum entities to return per type */
  max_entities_per_type?: number;
}

export interface NerResponse {
  /** Detected entities */
  entities: NerEntity[];
  /** Processing time in milliseconds */
  processing_time_ms: number;
  /** Model used */
  model: string;
  /** Tokens processed */
  tokens_processed?: number;
}

export interface LlmNerConfig {
  /** LLM API endpoint (OpenAI-compatible) */
  endpoint: string;
  /** API key (if required) */
  api_key?: string;
  /** Model to use */
  model: string;
  /** Request timeout in milliseconds */
  timeout_ms: number;
  /** Maximum tokens in response */
  max_tokens: number;
  /** Temperature (0 for deterministic) */
  temperature: number;
  /** Maximum text length to process in single request */
  max_text_length: number;
  /** Batch size for chunked processing */
  batch_size: number;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: LlmNerConfig = {
  endpoint: process.env.LLM_NER_ENDPOINT || 'http://localhost:8000/v1',
  api_key: process.env.LLM_NER_API_KEY,
  model: process.env.LLM_NER_MODEL || 'meta-llama/Llama-3.1-8B-Instruct',
  timeout_ms: 30000,
  max_tokens: 4096,
  temperature: 0, // Deterministic for consistency
  max_text_length: 8000, // ~2000 tokens
  batch_size: 5,
};

let config: LlmNerConfig = { ...DEFAULT_CONFIG };

/**
 * Configure the LLM NER service
 */
export function configureLlmNer(newConfig: Partial<LlmNerConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get current configuration (for testing)
 */
export function getLlmNerConfig(): LlmNerConfig {
  return { ...config };
}

// ============================================================================
// Prompt Templates
// ============================================================================

const NER_SYSTEM_PROMPT = `You are a precise Named Entity Recognition (NER) system. Extract entities from text and return them in JSON format.

Rules:
1. Only extract entities you are confident about (>80% confidence)
2. Return exact character positions (0-indexed start, end is exclusive)
3. For PERSON: Extract full names (first + last), not partial names or titles
4. For ADDRESS: Extract complete street addresses including number, street, city, state, zip
5. Do not extract email addresses, phone numbers, or URLs (handled separately)
6. Return an empty array if no entities found
7. Assign confidence scores: 0.95 for clear matches, 0.85 for likely matches, 0.75 for possible matches

Output format (JSON array):
[{"text": "John Smith", "type": "PERSON", "start": 10, "end": 20, "confidence": 0.95}]`;

function buildNerPrompt(text: string, entityTypes: NerEntity['type'][]): string {
  const typesStr = entityTypes.join(', ');
  return `Extract all ${typesStr} entities from the following text. Return only a JSON array.

Text:
"""
${text}
"""

Entities (JSON array):`;
}

// ============================================================================
// API Client
// ============================================================================

interface OpenAICompatibleResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Call the LLM API with OpenAI-compatible format
 */
async function callLlmApi(
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; tokens?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout_ms);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.api_key) {
      headers['Authorization'] = `Bearer ${config.api_key}`;
    }

    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: config.max_tokens,
        temperature: config.temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OpenAICompatibleResponse;
    const content = data.choices[0]?.message?.content || '[]';
    const tokens = data.usage?.total_tokens;

    return { content, tokens };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse LLM response into entities
 */
function parseNerResponse(content: string, originalText: string): NerEntity[] {
  // Extract JSON array from response (handle markdown code blocks)
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      return [];
    }

    // Validate and normalize entities
    return parsed
      .filter((e: unknown): e is Record<string, unknown> => {
        if (typeof e !== 'object' || e === null) return false;
        const entity = e as Record<string, unknown>;
        return (
          typeof entity.text === 'string' &&
          typeof entity.type === 'string' &&
          typeof entity.start === 'number' &&
          typeof entity.end === 'number'
        );
      })
      .map((e) => {
        const entity = e as { text: string; type: string; start: number; end: number; confidence?: number };

        // Verify the text matches what's at the position
        const extractedText = originalText.substring(entity.start, entity.end);
        const textMatches = extractedText === entity.text;

        // If positions don't match, try to find the text
        let startIndex = entity.start;
        let endIndex = entity.end;

        if (!textMatches) {
          const foundIndex = originalText.indexOf(entity.text);
          if (foundIndex !== -1) {
            startIndex = foundIndex;
            endIndex = foundIndex + entity.text.length;
          }
        }

        return {
          text: entity.text,
          type: entity.type as NerEntity['type'],
          start_index: startIndex,
          end_index: endIndex,
          confidence: typeof entity.confidence === 'number' ? entity.confidence : 0.85,
        };
      })
      .filter((e) => {
        // Final validation - entity text should exist in original
        return originalText.includes(e.text);
      });
  } catch {
    // If JSON parsing fails, return empty array
    return [];
  }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Detect named entities in text using local LLM
 *
 * @param request - NER request with text and entity types
 * @returns NER response with detected entities
 */
export async function detectEntities(request: NerRequest): Promise<NerResponse> {
  const startTime = Date.now();
  const { text, entity_types, max_entities_per_type = 100 } = request;

  // Handle empty or very short text
  if (!text || text.trim().length < 10) {
    return {
      entities: [],
      processing_time_ms: Date.now() - startTime,
      model: config.model,
    };
  }

  // Chunk text if too long
  const chunks = chunkText(text, config.max_text_length);
  const allEntities: NerEntity[] = [];
  let totalTokens = 0;

  for (const chunk of chunks) {
    const prompt = buildNerPrompt(chunk.text, entity_types);

    try {
      const { content, tokens } = await callLlmApi(NER_SYSTEM_PROMPT, prompt);
      const entities = parseNerResponse(content, chunk.text);

      // Adjust indices for chunk offset
      for (const entity of entities) {
        entity.start_index += chunk.offset;
        entity.end_index += chunk.offset;
      }

      allEntities.push(...entities);
      if (tokens) totalTokens += tokens;
    } catch (error) {
      // Log error but continue with other chunks
      console.error(`LLM NER error for chunk at offset ${chunk.offset}:`, error);
    }
  }

  // Deduplicate overlapping entities
  const dedupedEntities = deduplicateEntities(allEntities);

  // Limit entities per type
  const limitedEntities = limitEntitiesPerType(dedupedEntities, max_entities_per_type);

  return {
    entities: limitedEntities,
    processing_time_ms: Date.now() - startTime,
    model: config.model,
    tokens_processed: totalTokens || undefined,
  };
}

/**
 * Detect person names in text
 */
export async function detectPersonNames(text: string): Promise<NerEntity[]> {
  const response = await detectEntities({
    text,
    entity_types: ['PERSON'],
  });
  return response.entities;
}

/**
 * Detect addresses in text
 */
export async function detectAddresses(text: string): Promise<NerEntity[]> {
  const response = await detectEntities({
    text,
    entity_types: ['ADDRESS'],
  });
  return response.entities;
}

/**
 * Detect both names and addresses in a single call (more efficient)
 */
export async function detectNamesAndAddresses(text: string): Promise<{
  names: NerEntity[];
  addresses: NerEntity[];
}> {
  const response = await detectEntities({
    text,
    entity_types: ['PERSON', 'ADDRESS'],
  });

  return {
    names: response.entities.filter(e => e.type === 'PERSON'),
    addresses: response.entities.filter(e => e.type === 'ADDRESS'),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface TextChunk {
  text: string;
  offset: number;
}

/**
 * Split text into chunks for processing
 */
function chunkText(text: string, maxLength: number): TextChunk[] {
  if (text.length <= maxLength) {
    return [{ text, offset: 0 }];
  }

  const chunks: TextChunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    let chunkEnd = offset + maxLength;

    // Try to break at a paragraph or sentence boundary
    if (chunkEnd < text.length) {
      // Look for paragraph break first
      const paragraphBreak = text.lastIndexOf('\n\n', chunkEnd);
      if (paragraphBreak > offset + maxLength / 2) {
        chunkEnd = paragraphBreak + 2;
      } else {
        // Look for sentence break
        const sentenceBreak = text.lastIndexOf('. ', chunkEnd);
        if (sentenceBreak > offset + maxLength / 2) {
          chunkEnd = sentenceBreak + 2;
        }
      }
    } else {
      chunkEnd = text.length;
    }

    chunks.push({
      text: text.substring(offset, chunkEnd),
      offset,
    });

    offset = chunkEnd;
  }

  return chunks;
}

/**
 * Remove duplicate/overlapping entities
 */
function deduplicateEntities(entities: NerEntity[]): NerEntity[] {
  if (entities.length <= 1) return entities;

  // Sort by start index
  const sorted = [...entities].sort((a, b) => a.start_index - b.start_index);
  const result: NerEntity[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];

    // Check for overlap
    if (current.start_index >= last.end_index) {
      // No overlap, add
      result.push(current);
    } else if (current.confidence > last.confidence) {
      // Overlap with higher confidence, replace
      result[result.length - 1] = current;
    }
    // Else: overlap with lower confidence, skip
  }

  return result;
}

/**
 * Limit entities per type
 */
function limitEntitiesPerType(entities: NerEntity[], maxPerType: number): NerEntity[] {
  const byType: Map<string, NerEntity[]> = new Map();

  for (const entity of entities) {
    const existing = byType.get(entity.type) || [];
    if (existing.length < maxPerType) {
      existing.push(entity);
      byType.set(entity.type, existing);
    }
  }

  return Array.from(byType.values()).flat();
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the LLM NER service is available
 */
export async function checkLlmNerHealth(): Promise<{
  available: boolean;
  endpoint: string;
  model: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${config.endpoint}/models`, {
      method: 'GET',
      headers: config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {},
    });

    return {
      available: response.ok,
      endpoint: config.endpoint,
      model: config.model,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      available: false,
      endpoint: config.endpoint,
      model: config.model,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
