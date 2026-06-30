import { createTenantKnex, tenantDb } from '@alga-psa/db';

class ClientContractLine {
    static async updateClientCredit(clientId: string, amount: number): Promise<void> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for updating client credit');
        }

        const updatedRows = await tenantDb(db, tenant).table('clients')
            .where({ client_id: clientId })
            .increment('credit_balance', amount);

        if (updatedRows === 0) {
            throw new Error(`Client ${clientId} not found or belongs to different tenant`);
        }
    }

    static async getClientCredit(clientId: string): Promise<number> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for getting client credit');
        }

        const result = await tenantDb(db, tenant).table('clients')
            .where({ client_id: clientId })
            .select('credit_balance')
            .first();

        return result?.credit_balance ?? 0;
    }
}

export default ClientContractLine;
