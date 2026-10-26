// Shared actors and fixture ids for the deploy-fix live proofs (no secrets are written to evidence).
const { credential, sql } = require('./runtime.cjs');
const fx = require('/home/robert/card-review-private/co-managed-it-3363/reprovision-20261025-fixtures.json');
const actors = {
  qa: () => ({ name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password }),
  alice: () => ({ name: 'alice', ...credential('reprovision-20261025-active-admin.json') }),
  kansas: () => ({ name: 'kansas', ...credential('reprovision-20261025-departing-admin.json') }),
};
const json = (query) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${query}) x`));
const sink = async () => (await (await fetch('http://127.0.0.1:9177/control/smtp-sink/state/emails')).json()).result || [];
const mailsTo = (mails, address, marker) => mails.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(address)
  && (!marker || (String(m.text) + String(m.html) + String(m.subject)).includes(marker)));
module.exports = { fx, actors, json, sink, mailsTo, A: fx.active, D: fx.departing, OZ: fx.oz, WR: fx.active.customer, KS: fx.departing.customer };
