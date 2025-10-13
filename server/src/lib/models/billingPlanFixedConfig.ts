// Temporary shim to satisfy legacy imports; actual fixed config
// is handled via contract_line_fixed_config and plan service configs.
import { Knex } from 'knex';

export default class BillingPlanFixedConfig {
  constructor(private _trx?: Knex, private _tenant?: string) {}
  async upsert(_data: any): Promise<boolean> {
    // No-op shim for compile-time compatibility
    return true;
  }
}

