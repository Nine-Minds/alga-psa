import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  technicianArrivedEventPayloadSchema,
  technicianCheckedOutEventPayloadSchema,
  technicianDispatchedEventPayloadSchema,
  technicianEnRouteEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/schedulingEventSchemas';
import {
  buildTechnicianArrivedPayload,
  buildTechnicianCheckedOutPayload,
  buildTechnicianDispatchedPayload,
  buildTechnicianEnRoutePayload,
  isTechnicianArrivedStatus,
  isTechnicianCheckedOutStatus,
  isTechnicianEnRouteStatus,
} from '../technicianDispatchEventBuilders';

describe('technicianDispatchEventBuilders', () => {
  it('builds schema-valid TECHNICIAN_DISPATCHED payloads', () => {
    const payload = buildWorkflowPayload(
      buildTechnicianDispatchedPayload({
        appointmentId: '8c6f7ee0-a97e-4d5e-b6a8-04cc74c2c7bd',
        ticketId: '7f2e7af3-25c0-49c8-8c89-1b4e6b6b9b11',
        technicianUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2',
        dispatchedByUserId: 'c98cbb3c-e4f0-4e63-a0c4-7fdc2a25b2b7',
      }),
      {
        tenantId: 'tenant-123',
        actor: { actorType: 'USER', actorUserId: 'c98cbb3c-e4f0-4e63-a0c4-7fdc2a25b2b7' },
      }
    );
    expect(() => technicianDispatchedEventPayloadSchema.parse(payload)).not.toThrow();
  });

  it('builds schema-valid TECHNICIAN_EN_ROUTE payloads', () => {
    const payload = buildWorkflowPayload(
      buildTechnicianEnRoutePayload({
        appointmentId: '8c6f7ee0-a97e-4d5e-b6a8-04cc74c2c7bd',
        technicianUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2',
      }),
      {
        tenantId: 'tenant-123',
        actor: { actorType: 'USER', actorUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2' },
      }
    );
    expect(() => technicianEnRouteEventPayloadSchema.parse(payload)).not.toThrow();
  });

  it('builds schema-valid TECHNICIAN_ARRIVED payloads', () => {
    const payload = buildWorkflowPayload(
      buildTechnicianArrivedPayload({
        appointmentId: '8c6f7ee0-a97e-4d5e-b6a8-04cc74c2c7bd',
        technicianUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2',
      }),
      {
        tenantId: 'tenant-123',
        actor: { actorType: 'USER', actorUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2' },
      }
    );
    expect(() => technicianArrivedEventPayloadSchema.parse(payload)).not.toThrow();
  });

  it('builds schema-valid TECHNICIAN_CHECKED_OUT payloads', () => {
    const payload = buildWorkflowPayload(
      buildTechnicianCheckedOutPayload({
        appointmentId: '8c6f7ee0-a97e-4d5e-b6a8-04cc74c2c7bd',
        technicianUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2',
      }),
      {
        tenantId: 'tenant-123',
        actor: { actorType: 'USER', actorUserId: '4a4a0a5b-4a66-4bfb-a4a6-8b8c84c6d7e2' },
      }
    );
    expect(() => technicianCheckedOutEventPayloadSchema.parse(payload)).not.toThrow();
  });

  it('detects en-route/arrived/checked-out status strings', () => {
    expect(isTechnicianEnRouteStatus('en_route')).toBe(true);
    expect(isTechnicianEnRouteStatus('En Route')).toBe(true);
    expect(isTechnicianEnRouteStatus('en-route')).toBe(true);
    expect(isTechnicianEnRouteStatus('enroute')).toBe(true);

    expect(isTechnicianArrivedStatus('arrived')).toBe(true);
    expect(isTechnicianArrivedStatus('on_site')).toBe(true);
    expect(isTechnicianArrivedStatus('On Site')).toBe(true);
    expect(isTechnicianArrivedStatus('onsite')).toBe(true);

    expect(isTechnicianCheckedOutStatus('checked_out')).toBe(true);
    expect(isTechnicianCheckedOutStatus('Checked Out')).toBe(true);
    expect(isTechnicianCheckedOutStatus('checked-out')).toBe(true);
  });
});

