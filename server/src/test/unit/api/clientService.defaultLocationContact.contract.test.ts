import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { locationAddressSql } from '../../../lib/api/services/locationAddressSql';

function readClientServiceSource(): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../lib/api/services/ClientService.ts'), 'utf8');
}

describe('client phone, email and address come from the default location', () => {
  it('getById joins the default location and selects its contact columns', () => {
    const source = readClientServiceSource();
    const getById = source.slice(source.indexOf('async getById('), source.indexOf('async create('));

    expect(getById).toContain('joinDefaultLocation(db, clientQuery);');
    expect(getById).toContain('...defaultLocationContactColumns(trx),');
  });

  it('list selects the same contact columns from its existing default-location join', () => {
    const source = readClientServiceSource();
    const list = source.slice(source.indexOf('async list('), source.indexOf('async getById('));

    expect(list).toContain('joinDefaultLocation(db, dataQuery);');
    expect(list).toContain('...defaultLocationContactColumns(trx),');
  });

  it('maps location phone, email and formatted address onto the client response fields', () => {
    const source = readClientServiceSource();
    expect(source).toContain("'cl.phone as phone_no', 'cl.email as email', trx.raw(`${locationAddressSql('cl')} as address`)");
  });

  it('keeps the default-location join tenant-scoped and default+active only', () => {
    const source = readClientServiceSource();
    const helper = source.slice(source.indexOf('function joinDefaultLocation('), source.indexOf('function defaultLocationContactColumns('));
    expect(helper).toContain("db.tenantJoinFirstMatching(query, 'client_locations', 'cl', 'c.client_id', 'client_id'");
    expect(helper).toContain("rootTenantColumn: 'c.tenant'");
    expect(helper).toContain('[`${alias}.is_default`]: true');
    expect(helper).toContain('[`${alias}.is_active`]: true');
  });
});

describe('locationAddressSql', () => {
  it('skips empty parts and yields NULL for an empty address', () => {
    expect(locationAddressSql('cl')).toBe(
      "NULLIF(CONCAT_WS(', ', NULLIF(cl.address_line1, ''), NULLIF(cl.address_line2, ''), NULLIF(cl.city, ''), NULLIF(cl.state_province, ''), NULLIF(cl.postal_code, ''), NULLIF(cl.country_name, '')), '')"
    );
  });
});
