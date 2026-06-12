import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  parseTicketRoom,
  validateDocumentRoomAccess,
} from '../../../../../hocuspocus/tenantValidation.js';

describe('ticket room validation', () => {
  beforeEach(() => {
    process.env.HOCUSPOCUS_JWT_SECRET = 'tenant-validation-secret';
    process.env.NODE_ENV = 'test';
  });

  it('T015: parseTicketRoom parses valid names and rejects malformed names', () => {
    expect(parseTicketRoom('ticket:tenant1:abc-123')).toEqual({
      tenantId: 'tenant1',
      ticketId: 'abc-123',
    });
    expect(parseTicketRoom('ticket:tenant1')).toBeNull();
    expect(parseTicketRoom('document:tenant1:abc-123')).toBeNull();
  });

  it('T011: rejects JWTs signed with the wrong secret', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'wrong-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-1:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('Ticket validation failed');
  });

  it('T012: rejects expired JWTs', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'tenant-validation-secret',
      { expiresIn: -1 }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-1:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('expired');
  });

  it('T013: rejects tenant mismatches between the JWT and the ticket room', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-x',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'tenant-validation-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-y:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('room tenant mismatch');
  });

  it('T014: rejects ticket mismatches between the JWT and the ticket room', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ticketId: 'ticket-a',
      },
      'tenant-validation-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-1:ticket-b',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('room ticket mismatch');
  });

  it('T016: notifications rooms still bypass validation unchanged', () => {
    expect(
      validateDocumentRoomAccess(
        'notifications:tenant-1:user-1',
        new Request('http://localhost/hocuspocus')
      )
    ).toEqual({ status: 'bypass', reason: 'notifications' });
  });

  it('T017: document room validation still uses tenantId from the request query', () => {
    expect(
      validateDocumentRoomAccess(
        'document:tenant-1:doc-1',
        new Request('http://localhost/hocuspocus?tenantId=tenant-1')
      )
    ).toEqual({
      status: 'ok',
      tenantId: 'tenant-1',
      documentId: 'doc-1',
    });
  });

  it('T021: handshake validation rejects a ticket room when the token targets another tenant', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-x',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'tenant-validation-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-y:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('room tenant mismatch');
  });
});
