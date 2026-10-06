import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(
  __dirname,
  '../../../../migrations/20261006120000_stamp_workflow_ticket_create_notify.cjs'
));
const { stampDefinition, unstampDefinition } = migration as {
  stampDefinition: (d: any) => any;
  unstampDefinition: (d: any) => any;
};

const call = (actionId: string, inputMapping: Record<string, unknown> = {}) => ({
  type: 'action.call',
  config: { actionId, inputMapping },
});

describe('stamp_workflow_ticket_create_notify', () => {
  it('stamps internal:true on a workflow without its own notifications, nested under try/then', () => {
    const def = { steps: [{ type: 'control.try', try: [{ type: 'control.if', then: [call('tickets.create', { title: 't' })] }] }] };
    const out = stampDefinition(def);
    const step = out.steps[0].try[0].then[0];
    expect(step.config.inputMapping.notify).toEqual({ internal: true, contact: false });
    expect(step.config.inputMapping.title).toBe('t');
  });

  it('stamps internal:false when the workflow sends its own notification at any depth', () => {
    const def = {
      steps: [call('tickets.create'), { type: 'control.forEach', body: [call('email.send')] }],
    };
    expect(stampDefinition(def).steps[0].config.inputMapping.notify).toEqual({ internal: false, contact: false });
    const def2 = { steps: [{ type: 'x', else: [call('notifications.send_in_app')] }, call('tickets.create')] };
    expect(stampDefinition(def2).steps[1].config.inputMapping.notify).toEqual({ internal: false, contact: false });
  });

  it('leaves an existing notify alone and returns the same reference when nothing changes', () => {
    const def = { steps: [call('tickets.create', { notify: { internal: true, contact: true } })] };
    expect(stampDefinition(def)).toBe(def);
    const none = { steps: [call('clients.find')] };
    expect(stampDefinition(none)).toBe(none);
  });

  it('down round-trips stamped literals and keeps author-chosen values', () => {
    const def = { steps: [call('tickets.create', { title: 't' }), call('email.send')] };
    expect(unstampDefinition(stampDefinition(def))).toEqual(def);
    const custom = { steps: [call('tickets.create', { notify: { internal: true, contact: true } })] };
    expect(unstampDefinition(custom)).toBe(custom);
  });
});
