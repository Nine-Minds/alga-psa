import { createTenantKnex } from '@alga-psa/db';
import { getAvailableCredit } from '../lib/creditBalance';

class ClientContractLine {
    /**
     * Available credit is derived from non-expired credit_tracking remainders;
     * there is no cached balance to update.
     */
    static async getClientCredit(clientId: string, currencyCode?: string): Promise<number> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for getting client credit');
        }

        return getAvailableCredit(db, tenant, clientId, currencyCode);
    }
}

export default ClientContractLine;
