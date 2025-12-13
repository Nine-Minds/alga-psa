First, run:

node setup/create_database.js
npx knex --knexfile knexfile.cjs migrate:latest --env development
npx knex seed:run --knexfile knexfile.cjs --env development
