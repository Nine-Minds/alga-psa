import type { Knex } from 'knex';
import type {
  IOpportunitySettings,
  OpportunityGeneratorKey,
} from '@alga-psa/types';

export interface GeneratedSuggestion {
  client_id: string;
  title: string;
  evidence: Record<string, unknown>;
  mrr_cents: number;
  nrr_cents: number;
  currency_code: string;
  dedupe_key: string;
}

export interface SuggestionGenerator {
  key: OpportunityGeneratorKey;
  run(ctx: {
    knex: Knex;
    tenant: string;
    settings: IOpportunitySettings;
  }): Promise<GeneratedSuggestion[]>;
}

export interface GeneratorRunSummary {
  key: OpportunityGeneratorKey;
  generated: number;
  fired: number;
  created: number;
  reopened: number;
  deduped: number;
}
