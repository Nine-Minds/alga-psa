import { describe, expect, it } from 'vitest';
import { withViaPrincipal } from './BaseService';

describe('withViaPrincipal (F049)', () => {
  it('returns the same row untouched when no via principal is set', () => {
    const row = { title: 'x', entered_by: 'u1' };
    expect(withViaPrincipal({ viaPrincipalUserId: undefined }, row)).toBe(row);
    expect(withViaPrincipal({ viaPrincipalUserId: null }, row)).toBe(row);
    expect(withViaPrincipal({}, row)).toBe(row);
    expect(row).toEqual({ title: 'x', entered_by: 'u1' });
  });

  it('adds the via column(s) only when set, without mutating the input', () => {
    const row = { title: 'x' };
    expect(withViaPrincipal({ viaPrincipalUserId: 'sp-1' }, row)).toEqual({ title: 'x', via_principal_id: 'sp-1' });
    expect(withViaPrincipal({ viaPrincipalUserId: 'sp-1' }, row, ['a_via_principal_id', 'b_via_principal_id'])).toEqual({
      title: 'x',
      a_via_principal_id: 'sp-1',
      b_via_principal_id: 'sp-1',
    });
    expect(row).toEqual({ title: 'x' });
  });
});
