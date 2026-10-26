// Shared actors and fixture ids for guide 09 / 12 / main recordings (no secrets written to evidence).
const { credential } = require('../../scripts/runtime.cjs');
const fx = require('/home/robert/card-review-private/co-managed-it-3363/reprovision-20261025-fixtures.json');
const actors = {
  qa: () => ({ name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password }),
  alice: () => ({ name: 'alice', ...credential('reprovision-20261025-active-admin.json') }),
  kansas: () => ({ name: 'kansas', ...credential('reprovision-20261025-departing-admin.json') }),
};
const A = fx.active, OZ = fx.oz, WR = A.customer;
const sharedRoute = (ticket) => `/msp/co-management/tickets/${WR}/${A.relationship}/${ticket}`;
const taskRoute = (task) => `/msp/co-management/tasks/${WR}/${A.relationship}/${task}`;
module.exports = { fx, actors, A, OZ, WR, sharedRoute, taskRoute };
