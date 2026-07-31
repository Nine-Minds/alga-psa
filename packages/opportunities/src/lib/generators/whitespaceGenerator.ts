import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IWhitespaceGrid } from '@alga-psa/types';
import type { GeneratedSuggestion, SuggestionGenerator } from './types';

interface ActiveClientRow {
  client_id: string;
  client_name: string;
  default_currency_code: string;
}

interface CategoryRow {
  category_id: string;
  category_name: string;
}

interface PresenceRow {
  client_id: string;
  category_id: string;
}

export function assembleWhitespaceGrid(
  clients: ActiveClientRow[],
  categories: CategoryRow[],
  presenceRows: PresenceRow[],
): IWhitespaceGrid {
  const clientCategories = new Map<string, Set<string>>(
    clients.map((client) => [client.client_id, new Set<string>()]),
  );
  for (const row of presenceRows) clientCategories.get(row.client_id)?.add(row.category_id);

  const categoryStats = categories.map((category) => {
    const adopted = clients.reduce(
      (count, client) => count + (clientCategories.get(client.client_id)?.has(category.category_id) ? 1 : 0),
      0,
    );
    const adoption = clients.length === 0 ? 0 : (adopted / clients.length) * 100;
    return {
      category_id: category.category_id,
      category_name: category.category_name,
      adopted_client_count: adopted,
      adoption_percentage: adoption,
      is_comparable: clients.length > 0 && adopted / clients.length >= 0.5,
    };
  });

  return {
    active_contract_client_count: clients.length,
    categories: categoryStats,
    clients: clients.map((client) => ({
      client_id: client.client_id,
      client_name: client.client_name,
      cells: categoryStats.map((category) => ({
        category_id: category.category_id,
        has_category: clientCategories.get(client.client_id)?.has(category.category_id) ?? false,
      })),
    })),
  };
}

export async function loadWhitespaceGrid(
  knex: Knex,
  tenant: string,
  now = new Date(),
): Promise<{ grid: IWhitespaceGrid; currencies: Map<string, string> }> {
  const today = now.toISOString().slice(0, 10);
  const db = tenantDb(knex, tenant);
  const clientQuery = db.table('client_contracts as cc');
  db.tenantJoin(clientQuery, 'clients as c', 'cc.client_id', 'c.client_id');
  const clients = await clientQuery
    .where({ 'cc.is_active': true, 'c.is_inactive': false })
    .where('cc.start_date', '<=', today)
    .andWhere((builder) => builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today))
    .distinct('cc.client_id', 'c.client_name', 'c.default_currency_code') as ActiveClientRow[];

  const categories = await db.table('service_categories')
    .select('category_id', 'category_name')
    .orderBy('category_name') as CategoryRow[];

  const directQuery = db.table('client_contracts as cc');
  db.tenantJoin(directQuery, 'contract_lines as cl', 'cc.contract_id', 'cl.contract_id');
  const directPresence = await directQuery
    .where({ 'cc.is_active': true, 'cl.is_active': true })
    .where('cc.start_date', '<=', today)
    .andWhere((builder) => builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today))
    .whereNotNull('cl.service_category')
    .distinct('cc.client_id', 'cl.service_category as category_id') as PresenceRow[];

  const serviceQuery = db.table('client_contracts as cc');
  db.tenantJoin(serviceQuery, 'contract_lines as cl', 'cc.contract_id', 'cl.contract_id');
  db.tenantJoin(serviceQuery, 'contract_line_services as cls', 'cl.contract_line_id', 'cls.contract_line_id');
  db.tenantJoin(serviceQuery, 'service_catalog as sc', 'cls.service_id', 'sc.service_id');
  const servicePresence = await serviceQuery
    .where({ 'cc.is_active': true, 'cl.is_active': true, 'sc.is_active': true })
    .where('cc.start_date', '<=', today)
    .andWhere((builder) => builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today))
    .whereNotNull('sc.category_id')
    .distinct('cc.client_id', 'sc.category_id') as PresenceRow[];

  const uniquePresence = new Map<string, PresenceRow>();
  for (const row of [...directPresence, ...servicePresence]) {
    uniquePresence.set(`${row.client_id}:${row.category_id}`, row);
  }
  return {
    grid: assembleWhitespaceGrid(clients, categories, [...uniquePresence.values()]),
    currencies: new Map(clients.map((client) => [client.client_id, client.default_currency_code])),
  };
}

export async function buildWhitespaceSuggestions(
  knex: Knex,
  tenant: string,
): Promise<GeneratedSuggestion[]> {
  const { grid, currencies } = await loadWhitespaceGrid(knex, tenant);
  const categoryById = new Map(grid.categories.map((category) => [category.category_id, category]));
  const suggestions: GeneratedSuggestion[] = [];
  for (const client of grid.clients) {
    for (const cell of client.cells) {
      const category = categoryById.get(cell.category_id);
      if (!category?.is_comparable || cell.has_category) continue;
      suggestions.push({
        client_id: client.client_id,
        title: `${client.client_name}: ${category.category_name} opportunity`,
        evidence: {
          category_id: category.category_id,
          category_name: category.category_name,
          missing_service_name: category.category_name,
          adoption_percentage: category.adoption_percentage,
          adopted_client_count: category.adopted_client_count,
          comparable_client_count: grid.active_contract_client_count,
        },
        mrr_cents: 0,
        nrr_cents: 0,
        currency_code: currencies.get(client.client_id) ?? 'USD',
        dedupe_key: `whitespace:${client.client_id}:${category.category_id}`,
      });
    }
  }
  return suggestions;
}

export const whitespaceGenerator: SuggestionGenerator = {
  key: 'whitespace',
  run: ({ knex, tenant }) => buildWhitespaceSuggestions(knex, tenant),
};
