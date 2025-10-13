exports.seed = function (knex) {
    return Promise.resolve();
    // return knex('tenants').select('tenant').first()
    //     .then((tenant) => {
    //         if (!tenant) return;
    //         return knex('bucket_plans').insert([
    //             {
    //                 tenant: tenant.tenant,
    //                 contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Wonderland Basic' }).select('contract_line_id').first(),
    //                 total_hours: 40,
    //                 billing_period: 'Monthly',
    //                 overage_rate: 100.00
    //             },
    //             {
    //                 tenant: tenant.tenant,
    //                 contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Oz Premium' }).select('contract_line_id').first(),
    //                 total_hours: 100,
    //                 billing_period: 'Monthly',
    //                 overage_rate: 150.00
    //             }
    //         ]);
    //     });
};