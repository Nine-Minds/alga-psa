import { describe, it, expect } from 'vitest';
import { ticketDetailsInitialProps } from '../ticketDetailsInitialProps';

const user = (id: string) => ({ user_id: id, first_name: 'Ada', last_name: 'Lovelace' }) as any;

describe('ticketDetailsInitialProps', () => {
  it('maps created and updated users to the initial* props', () => {
    const created = user('u1');
    const updated = user('u2');
    expect(ticketDetailsInitialProps({ createdByUser: created, updatedByUser: updated })).toEqual({
      initialCreatedByUser: created,
      initialUpdatedByUser: updated,
    });
  });

  it('normalises null/undefined to null', () => {
    expect(ticketDetailsInitialProps({})).toEqual({ initialCreatedByUser: null, initialUpdatedByUser: null });
    expect(ticketDetailsInitialProps({ createdByUser: null, updatedByUser: undefined })).toEqual({
      initialCreatedByUser: null,
      initialUpdatedByUser: null,
    });
  });
});
