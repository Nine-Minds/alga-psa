'use server'

import { createTenantKnex } from '@server/lib/db';
import { getSession } from '@server/lib/auth/getSession';

// Type definitions for reports
export interface ContractRevenue {
  contract_name: string;
  client_name: string;
  monthly_recurring: number;
  total_billed_ytd: number;
  status: 'active' | 'upcoming' | 'expired';
}

export interface ContractExpiration {
  contract_name: string;
  client_name: string;
  end_date: string;
  days_until_expiration: number;
  monthly_value: number;
  auto_renew: boolean;
}

export interface BucketUsage {
  contract_name: string;
  client_name: string;
  total_hours: number;
  used_hours: number;
  remaining_hours: number;
  utilization_percentage: number;
  overage_hours: number;
}

export interface Profitability {
  contract_name: string;
  client_name: string;
  revenue: number;
  cost: number;
  profit: number;
  margin_percentage: number;
}

export interface ContractReportSummary {
  totalMRR: number;
  totalYTD: number;
  activeContractCount: number;
}

/**
 * Get contract revenue report data
 * Shows monthly recurring revenue and year-to-date billing by contract
 */
export async function getContractRevenueReport(): Promise<ContractRevenue[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    const today = new Date();
    const yearStart = new Date(today.getFullYear(), 0, 1);

    // First get aggregated invoice data by client to avoid cartesian product
    const invoicesByClient = await knex('invoices')
      .where({ tenant })
      .whereRaw('invoice_date >= ?', [yearStart.toISOString()])
      .select('client_id')
      .select(knex.raw('SUM(total_amount) as total_billed_ytd'))
      .groupBy('client_id');

    // Create a map for quick lookup
    const invoiceMap = new Map<string, number>();
    for (const inv of invoicesByClient) {
      invoiceMap.set(inv.client_id, inv.total_billed_ytd || 0);
    }

    // Query to get contract data (without invoices to avoid join issues)
    const data = await knex('contracts as c')
      .leftJoin('client_contracts as cc', function joinClientContracts() {
        this.on('c.contract_id', '=', 'cc.contract_id').andOn('c.tenant', '=', 'cc.tenant');
      })
      .leftJoin('clients as cl', function joinClients() {
        this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
      })
      .where({ 'c.tenant': tenant })
      .where(builder => {
        builder.where('cc.is_active', true).orWhereNull('cc.client_contract_id');
      })
      .select(
        'c.contract_id',
        'c.contract_name',
        'c.is_active',
        'cl.client_name',
        'cc.client_id',
        'cc.client_contract_id',
        'cc.start_date',
        'cc.end_date'
      );

    // Process data to aggregate by contract-client pair
    const aggregatedMap = new Map<string, any>();

    for (const row of data) {
      const key = `${row.contract_id}-${row.client_name || 'Unknown'}`;

      if (!aggregatedMap.has(key)) {
        // Determine status based on contract active flag first, then date logic
        let status: 'active' | 'upcoming' | 'expired' = row.is_active ? 'active' : 'expired';

        // Only apply date logic if contract is still active
        if (row.is_active) {
          if (row.start_date) {
            const startDate = new Date(row.start_date);
            if (startDate > today) {
              status = 'upcoming';
            }
          }
          if (row.end_date) {
            const endDate = new Date(row.end_date);
            if (endDate < today) {
              status = 'expired';
            }
          }
        }

        // Look up invoice total from the map using client_id
        const totalBilledYtd = row.client_id ? (invoiceMap.get(row.client_id) || 0) : 0;

        aggregatedMap.set(key, {
          contract_name: row.contract_name,
          client_name: row.client_name || 'Unknown Client',
          monthly_recurring: 0, // Will be calculated from contract lines
          total_billed_ytd: totalBilledYtd,
          status
        });
      }
    }

    // Query contract lines to get monthly recurring values
    const contractLines = await knex('contract_line_mappings as clm')
      .join('contract_lines as cl', function joinLines() {
        this.on('clm.contract_line_id', '=', 'cl.contract_line_id').andOn('clm.tenant', '=', 'cl.tenant');
      })
      .leftJoin('contract_line_fixed_config as cfg', function joinConfig() {
        this.on('clm.contract_line_id', '=', 'cfg.contract_line_id').andOn('clm.tenant', '=', 'cfg.tenant');
      })
      .where({ 'clm.tenant': tenant })
      .select(
        'clm.contract_id',
        'cl.contract_line_id',
        'cl.contract_line_name',
        'cfg.base_rate',
        'clm.custom_rate'
      );

    // Add monthly recurring to aggregated data
    for (const contractLine of contractLines) {
      const keys = Array.from(aggregatedMap.keys()).filter(k => k.startsWith(contractLine.contract_id));
      const rate = contractLine.custom_rate || contractLine.base_rate || 0;
      for (const key of keys) {
        const item = aggregatedMap.get(key)!;
        item.monthly_recurring += rate;
      }
    }

    return Array.from(aggregatedMap.values());
  } catch (error) {
    console.error('Error fetching contract revenue report:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract revenue report: ${error}`);
  }
}

/**
 * Get contract expiration report data
 * Track upcoming contract expirations and renewal opportunities
 */
export async function getContractExpirationReport(): Promise<ContractExpiration[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    const today = new Date();

    const data = await knex('contracts as c')
      .join('client_contracts as cc', function joinClientContracts() {
        this.on('c.contract_id', '=', 'cc.contract_id').andOn('c.tenant', '=', 'cc.tenant');
      })
      .leftJoin('clients as cl', function joinClients() {
        this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
      })
      .leftJoin('contract_line_mappings as clm', function joinMappings() {
        this.on('c.contract_id', '=', 'clm.contract_id').andOn('c.tenant', '=', 'clm.tenant');
      })
      .leftJoin('contract_line_fixed_config as cfg', function joinConfig() {
        this.on('clm.contract_line_id', '=', 'cfg.contract_line_id').andOn('clm.tenant', '=', 'cfg.tenant');
      })
      .where({ 'c.tenant': tenant, 'cc.is_active': true })
      .whereNotNull('cc.end_date')
      .select(
        'c.contract_id',
        'c.contract_name',
        'cl.client_name',
        'cc.end_date',
        'cfg.base_rate'
      )
      .orderBy('cc.end_date', 'asc');

    const expirations: ContractExpiration[] = data.map((row: any) => {
      const endDate = new Date(row.end_date);
      const daysUntilExpiration = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      return {
        contract_name: row.contract_name,
        client_name: row.client_name || 'Unknown Client',
        end_date: endDate.toISOString().split('T')[0],
        days_until_expiration: Math.max(0, daysUntilExpiration),
        monthly_value: row.base_rate || 0,
        auto_renew: false // This could be extended to check a flag in the database
      };
    });

    // Remove duplicates and aggregate by contract-client pair
    const seen = new Set<string>();
    const unique = expirations.filter(item => {
      const key = `${item.contract_name}-${item.client_name}-${item.end_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique;
  } catch (error) {
    console.error('Error fetching contract expiration report:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract expiration report: ${error}`);
  }
}

/**
 * Get bucket usage report data
 * Monitor bucket hours usage and identify overage situations
 */
export async function getBucketUsageReport(): Promise<BucketUsage[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    // Query for bucket-type contract lines and their time tracking
    // Note: We're working with contracts that have bucket-type lines
    // For now, we'll show all bucket contracts without specific hour allocations
    // (as the bucket config is stored separately and not directly linked to contract_line_id)
    const data = await knex('contracts as c')
      .leftJoin('contract_line_mappings as clm', function joinMappings() {
        this.on('c.contract_id', '=', 'clm.contract_id').andOn('c.tenant', '=', 'clm.tenant');
      })
      .leftJoin('contract_lines as cl_line', function joinLines() {
        this.on('clm.contract_line_id', '=', 'cl_line.contract_line_id').andOn('clm.tenant', '=', 'cl_line.tenant');
      })
      .leftJoin('client_contracts as cc', function joinClientContracts() {
        this.on('c.contract_id', '=', 'cc.contract_id').andOn('c.tenant', '=', 'cc.tenant');
      })
      .leftJoin('clients as cl', function joinClients() {
        this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
      })
      .leftJoin('time_entries as te', function joinTimeEntries() {
        this.on('clm.contract_line_id', '=', 'te.contract_line_id').andOn('clm.tenant', '=', 'te.tenant');
      })
      .where({ 'c.tenant': tenant, 'cl_line.contract_line_type': 'Bucket' })
      .select(
        'c.contract_id',
        'c.contract_name',
        'cl.client_name',
        knex.raw('COALESCE(SUM(te.billable_duration), 0) as used_minutes')
      )
      .groupBy('c.contract_id', 'c.contract_name', 'cl.client_name');

    const bucketUsages: BucketUsage[] = data
      .filter((row: any) => row.contract_name) // Filter out null results
      .map((row: any) => {
        // For bucket contracts, use a default allocation if not specified
        // This is a reasonable default of 40 hours per week
        const totalHours = 40;
        const usedHours = row.used_minutes ? Math.round(row.used_minutes / 60) : 0;
        const remainingHours = Math.max(0, totalHours - usedHours);
        const utilizationPercentage = totalHours > 0 ? Math.round((usedHours / totalHours) * 100) : 0;
        const overageHours = Math.max(0, usedHours - totalHours);

        return {
          contract_name: row.contract_name,
          client_name: row.client_name || 'Unknown Client',
          total_hours: totalHours,
          used_hours: usedHours,
          remaining_hours: remainingHours,
          utilization_percentage: utilizationPercentage,
          overage_hours: overageHours
        };
      });

    return bucketUsages;
  } catch (error) {
    console.error('Error fetching bucket usage report:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch bucket usage report: ${error}`);
  }
}

/**
 * Get profitability report data
 * Basic profit margins and revenue vs. cost analysis by contract
 */
export async function getProfitabilityReport(): Promise<Profitability[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    // Get total revenue for the year using SQL aggregation to avoid duplication
    const revenueResult = await knex('invoices')
      .where({ tenant })
      .whereRaw('invoice_date >= ?', [yearStart.toISOString()])
      .select(knex.raw('SUM(total_amount) as total_revenue'));

    const totalRevenue = (revenueResult[0]?.total_revenue as number) || 0;

    // Get time entries and cost data for the year - simplified approach
    const timeEntries = await knex('time_entries as te')
      .where({ 'te.tenant': tenant })
      .whereRaw('te.start_time >= ?', [yearStart.toISOString()])
      .select(knex.raw('SUM(billable_duration) as total_minutes'));

    const totalMinutes = (timeEntries[0]?.total_minutes as number) || 0;
    const totalHours = totalMinutes / 60;
    const totalCost = totalHours * 5000; // $50/hr = 5000 cents/hr

    const totalProfit = totalRevenue - totalCost;
    const marginPercentage = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;

    console.log('[Profitability Report Debug] Calculation:', {
      totalRevenue,
      totalMinutes,
      totalHours,
      totalCost,
      totalProfit,
      marginPercentage
    });

    // For now, return a single aggregated profitability record
    const profitabilities: Profitability[] = [
      {
        contract_name: 'All Contracts',
        client_name: 'Aggregate',
        revenue: totalRevenue,
        cost: totalCost,
        profit: totalProfit,
        margin_percentage: marginPercentage
      }
    ];

    // For now, we'll just return the aggregated view
    return profitabilities;
  } catch (error) {
    console.error('Error fetching profitability report:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch profitability report: ${error}`);
  }
}

/**
 * Get contract report summary statistics
 */
export async function getContractReportSummary(): Promise<ContractReportSummary> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }

    const revenueData = await getContractRevenueReport();

    const totalMRR = revenueData.reduce((sum, item) => sum + item.monthly_recurring, 0);
    const totalYTD = revenueData.reduce((sum, item) => sum + item.total_billed_ytd, 0);

    // Count active contracts
    const activeContracts = await knex('contracts')
      .where({ tenant, is_active: true })
      .count<{ count: string }>('* as count');

    const activeContractCount = Number(activeContracts[0]?.count ?? 0);

    return {
      totalMRR,
      totalYTD,
      activeContractCount
    };
  } catch (error) {
    console.error('Error fetching contract report summary:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract report summary: ${error}`);
  }
}
