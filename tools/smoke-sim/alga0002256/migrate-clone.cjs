const knexLib = require('knex');
const cfg = require(process.cwd() + '/knexfile.cjs');
const c = { ...(cfg.migration || cfg), migrations: { ...(cfg.migration || cfg).migrations, disableMigrationsListValidation: true } };
const k = knexLib(c);
k.migrate.latest().then(([b, l]) => { console.log('batch', b, 'applied', l.length); console.log(l.join('\n')); return k.destroy(); }).catch(e => { console.error(e.message); k.destroy(); process.exit(1); });
