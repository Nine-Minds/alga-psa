import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Resolve the expiration date for a newly issued credit: an explicit date wins;
 * otherwise the client's billing settings (falling back to tenant defaults)
 * decide whether and when the credit expires.
 */
export async function resolveCreditExpirationDate(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string,
    manualExpirationDate?: string
): Promise<string | undefined> {
    const clientSettings = await tenantDb(trx, tenant).table('client_billing_settings')
        .where({ client_id: clientId, tenant })
        .first();

    const defaultSettings = await tenantDb(trx, tenant).table('default_billing_settings')
        .first();

    let isCreditExpirationEnabled = true;
    if (typeof clientSettings?.enable_credit_expiration === 'boolean') {
        isCreditExpirationEnabled = clientSettings.enable_credit_expiration;
    } else if (typeof defaultSettings?.enable_credit_expiration === 'boolean') {
        isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
    }

    if (!isCreditExpirationEnabled) {
        return undefined;
    }

    if (manualExpirationDate) {
        return manualExpirationDate;
    }

    let expirationDays: number | undefined;
    if (typeof clientSettings?.credit_expiration_days === 'number') {
        expirationDays = clientSettings.credit_expiration_days;
    } else if (typeof defaultSettings?.credit_expiration_days === 'number') {
        expirationDays = defaultSettings.credit_expiration_days;
    }

    if (expirationDays && expirationDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + expirationDays);
        return expDate.toISOString();
    }

    return undefined;
}
