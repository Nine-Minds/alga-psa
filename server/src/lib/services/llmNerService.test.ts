/**
 * Unit tests for Alga Guard LLM NER Service
 *
 * Tests the LLM-based Named Entity Recognition service including:
 * - Configuration management
 * - Response parsing
 * - Entity deduplication
 * - Text chunking
 * - Error handling
 *
 * Note: Most tests mock the LLM API calls since unit tests shouldn't
 * require a running LLM server. Integration tests should be used
 * to verify actual LLM connectivity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  configureLlmNer,
  getLlmNerConfig,
  detectEntities,
  detectPersonNames,
  detectAddresses,
  detectNamesAndAddresses,
  checkLlmNerHealth,
  type NerEntity,
} from './llmNerService';

// ============================================================================
// Configuration Tests
// ============================================================================

describe('LLM NER Configuration', () => {
  const originalConfig = getLlmNerConfig();

  afterEach(() => {
    // Reset config after each test
    configureLlmNer(originalConfig);
  });

  it('should have sensible default configuration', () => {
    const config = getLlmNerConfig();

    expect(config.endpoint).toBeDefined();
    expect(config.model).toBeDefined();
    expect(config.timeout_ms).toBeGreaterThan(0);
    expect(config.max_tokens).toBeGreaterThan(0);
    expect(config.temperature).toBe(0); // Deterministic
    expect(config.max_text_length).toBeGreaterThan(1000);
    expect(config.batch_size).toBeGreaterThan(0);
  });

  it('should allow configuration updates', () => {
    configureLlmNer({
      endpoint: 'http://custom-llm:8080/v1',
      model: 'custom-model',
      timeout_ms: 60000,
    });

    const config = getLlmNerConfig();
    expect(config.endpoint).toBe('http://custom-llm:8080/v1');
    expect(config.model).toBe('custom-model');
    expect(config.timeout_ms).toBe(60000);
  });

  it('should preserve unmodified config values', () => {
    const originalMaxTokens = getLlmNerConfig().max_tokens;

    configureLlmNer({
      endpoint: 'http://new-endpoint:8080/v1',
    });

    const config = getLlmNerConfig();
    expect(config.max_tokens).toBe(originalMaxTokens);
  });
});

// ============================================================================
// Response Parsing Tests (Internal Logic)
// ============================================================================

describe('NER Response Parsing', () => {
  // We test the parsing logic by mocking fetch and checking the results

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle empty text gracefully', async () => {
    const result = await detectEntities({
      text: '',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toEqual([]);
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle very short text gracefully', async () => {
    const result = await detectEntities({
      text: 'Hi',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toEqual([]);
  });

  it('should parse valid JSON response from LLM', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              { text: 'John Smith', type: 'PERSON', start: 10, end: 20, confidence: 0.95 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await detectEntities({
      text: 'Contact: John Smith for assistance.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].text).toBe('John Smith');
    expect(result.entities[0].type).toBe('PERSON');
    expect(result.entities[0].confidence).toBe(0.95);
    expect(result.tokens_processed).toBe(150);
  });

  it('should handle markdown code blocks in response', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: '```json\n[{"text": "Jane Doe", "type": "PERSON", "start": 0, "end": 8, "confidence": 0.9}]\n```',
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await detectEntities({
      text: 'Jane Doe is the manager.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].text).toBe('Jane Doe');
  });

  it('should handle invalid JSON gracefully', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: 'This is not valid JSON',
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await detectEntities({
      text: 'Some text to analyze.',
      entity_types: ['PERSON'],
    });

    // Should return empty array, not throw
    expect(result.entities).toEqual([]);
  });

  it('should verify entity text exists in original', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              // This entity doesn't exist in the text
              { text: 'Nonexistent Name', type: 'PERSON', start: 0, end: 16, confidence: 0.9 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await detectEntities({
      text: 'John Smith is here.',
      entity_types: ['PERSON'],
    });

    // Should filter out non-matching entity
    expect(result.entities).toEqual([]);
  });

  it('should correct entity positions if text matches but indices are wrong', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              // Wrong indices but text exists
              { text: 'John Smith', type: 'PERSON', start: 0, end: 10, confidence: 0.9 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const text = 'Contact: John Smith for help.';
    const result = await detectEntities({
      text,
      entity_types: ['PERSON'],
    });

    expect(result.entities).toHaveLength(1);
    // Should find the correct position
    const expectedStart = text.indexOf('John Smith');
    expect(result.entities[0].start_index).toBe(expectedStart);
    expect(result.entities[0].end_index).toBe(expectedStart + 'John Smith'.length);
  });
});

// ============================================================================
// Entity Deduplication Tests
// ============================================================================

describe('Entity Deduplication', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should deduplicate overlapping entities keeping higher confidence', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              { text: 'John', type: 'PERSON', start: 0, end: 4, confidence: 0.7 },
              { text: 'John Smith', type: 'PERSON', start: 0, end: 10, confidence: 0.95 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await detectEntities({
      text: 'John Smith is the CEO.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].text).toBe('John Smith');
    expect(result.entities[0].confidence).toBe(0.95);
  });

  it('should keep non-overlapping entities', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              { text: 'John Smith', type: 'PERSON', start: 0, end: 10, confidence: 0.9 },
              { text: 'Jane Doe', type: 'PERSON', start: 15, end: 23, confidence: 0.9 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await detectEntities({
      text: 'John Smith and Jane Doe are partners.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toHaveLength(2);
  });
});

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe('Convenience Functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detectPersonNames should only return PERSON entities', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              { text: 'John Smith', type: 'PERSON', start: 0, end: 10, confidence: 0.9 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const entities = await detectPersonNames('John Smith is the manager.');
    expect(entities.every(e => e.type === 'PERSON')).toBe(true);
  });

  it('detectAddresses should only return ADDRESS entities', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              { text: '123 Main St, Springfield, IL 62701', type: 'ADDRESS', start: 12, end: 46, confidence: 0.9 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const entities = await detectAddresses('Ship to: 123 Main St, Springfield, IL 62701');
    expect(entities.every(e => e.type === 'ADDRESS')).toBe(true);
  });

  it('detectNamesAndAddresses should return separated results', async () => {
    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify([
              { text: 'John Smith', type: 'PERSON', start: 0, end: 10, confidence: 0.9 },
              { text: '123 Main St', type: 'ADDRESS', start: 20, end: 31, confidence: 0.85 },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const { names, addresses } = await detectNamesAndAddresses('John Smith lives at 123 Main St today.');

    expect(names).toHaveLength(1);
    expect(names[0].type).toBe('PERSON');
    expect(addresses).toHaveLength(1);
    expect(addresses[0].type).toBe('ADDRESS');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle API errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }));

    // Should not throw, just return empty results
    const result = await detectEntities({
      text: 'Some text to analyze.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toEqual([]);
  });

  it('should handle network errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    // Should not throw, just return empty results
    const result = await detectEntities({
      text: 'Some text to analyze.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toEqual([]);
  });

  it('should handle timeout errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('AbortError')));

    const result = await detectEntities({
      text: 'Some text to analyze.',
      entity_types: ['PERSON'],
    });

    expect(result.entities).toEqual([]);
  });
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe('Health Check', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return available=true when service is up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
    }));

    const health = await checkLlmNerHealth();

    expect(health.available).toBe(true);
    expect(health.endpoint).toBeDefined();
    expect(health.model).toBeDefined();
    expect(health.error).toBeUndefined();
  });

  it('should return available=false when service returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    const health = await checkLlmNerHealth();

    expect(health.available).toBe(false);
    expect(health.error).toBe('HTTP 503');
  });

  it('should return available=false when service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const health = await checkLlmNerHealth();

    expect(health.available).toBe(false);
    expect(health.error).toBe('Connection refused');
  });
});

// ============================================================================
// Entity Limiting Tests
// ============================================================================

describe('Entity Limiting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should respect max_entities_per_type limit', async () => {
    // Generate 10 entities
    const entities = Array.from({ length: 10 }, (_, i) => ({
      text: `Person ${i}`,
      type: 'PERSON',
      start: i * 10,
      end: i * 10 + 8,
      confidence: 0.9,
    }));

    const mockResponse = {
      id: 'test-id',
      choices: [
        {
          message: {
            content: JSON.stringify(entities),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const text = entities.map((_, i) => `Person ${i}`).join(' and ');
    const result = await detectEntities({
      text,
      entity_types: ['PERSON'],
      max_entities_per_type: 3,
    });

    expect(result.entities.length).toBeLessThanOrEqual(3);
  });
});
