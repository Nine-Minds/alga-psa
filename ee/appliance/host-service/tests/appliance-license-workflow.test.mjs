import test from 'node:test';
import assert from 'node:assert/strict';
import { connectToTemporal } from '../../../../server/scripts/appliance-license-workflow.mjs';

test('connectToTemporal preserves the Temporal Connection static receiver', async () => {
  const options = { address: 'temporal.example.test:7233' };
  const connection = {
    ensureConnected: async () => {},
  };

  class FakeConnection {
    static lazy(receivedOptions) {
      assert.equal(this, FakeConnection);
      assert.deepEqual(receivedOptions, options);
      return connection;
    }

    static async connect(receivedOptions) {
      const created = this.lazy(receivedOptions);
      await created.ensureConnected();
      return created;
    }
  }

  assert.equal(await connectToTemporal(options, FakeConnection), connection);
});
