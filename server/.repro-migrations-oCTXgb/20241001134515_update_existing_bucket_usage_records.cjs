exports.up = function(knex) {
  return knex.schema.hasColumn('bucket_usage', 'service_catalog_id')
    .then(exists => {
      if (exists) {
        return knex('bucket_usage')
          .whereNull('service_catalog_id')
          .update({
            service_catalog_id: knex('service_catalog')
              .where({ service_name: 'Default Bucket Service' })
              .select('service_id')
              .first()
          });
      } else {
        console.log('service_catalog_id column does not exist in bucket_usage table. Skipping update.');
        return Promise.resolve();
      }
    });
};

exports.down = function(knex) {
  // This down migration is empty because we can't revert to the previous state
  return Promise.resolve();
};
