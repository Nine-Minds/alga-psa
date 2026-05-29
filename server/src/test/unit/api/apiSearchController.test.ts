import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  runAppSearch: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('../../../lib/search/runAppSearch', () => ({
  runAppSearch: mocks.runAppSearch,
}));

vi.mock('../../../lib/db/db', () => ({
  getConnection: mocks.getConnection,
}));

import {
  ApiSearchController,
  searchApiQuerySchema,
} from '../../../lib/api/controllers/ApiSearchController';

describe('searchApiQuerySchema (GET query coercion)', () => {
  it('splits the comma-separated types param into an array', () => {
    const parsed = searchApiQuerySchema.parse({ query: 'laptop', types: 'ticket,project' });
    expect(parsed.types).toEqual(['ticket', 'project']);
  });

  it('coerces a string limit into a number', () => {
    const parsed = searchApiQuerySchema.parse({ query: 'laptop', limit: '5' });
    expect(parsed.limit).toBe(5);
  });

  it('leaves types undefined when the param is absent', () => {
    const parsed = searchApiQuerySchema.parse({ query: 'laptop' });
    expect(parsed.types).toBeUndefined();
  });

  it('rejects unknown object types', () => {
    expect(() => searchApiQuerySchema.parse({ query: 'x', types: 'ticket,bogus' })).toThrow();
  });

  it('rejects an empty query', () => {
    expect(() => searchApiQuerySchema.parse({ query: '' })).toThrow();
  });
});

describe('ApiSearchController.search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({ fake: 'knex' });
  });

  it('returns 401 when no API key is supplied', async () => {
    const controller = new ApiSearchController();
    const req = new NextRequest('http://localhost:3000/api/v1/search?query=laptop');

    const res = await controller.search()(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(mocks.runAppSearch).not.toHaveBeenCalled();
  });

  it('parses query params and delegates to runAppSearch with the authenticated user', async () => {
    const controller = new ApiSearchController();
    const user = { user_id: 'u1', tenant: 'tenant-1', user_type: 'internal' };
    const req = new NextRequest(
      'http://localhost:3000/api/v1/search?query=laptop&types=ticket,project&limit=5&sort=recent',
      { headers: { 'x-api-key': 'k' } },
    );

    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(
      Object.assign(req, { context: { tenant: 'tenant-1', user } }),
    );

    const searchResult = {
      results: [],
      groups: {},
      totalCount: 0,
    };
    mocks.runAppSearch.mockResolvedValue(searchResult);

    const res = await controller.search()(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(searchResult);
    expect(mocks.runAppSearch).toHaveBeenCalledWith(
      { fake: 'knex' },
      'tenant-1',
      user,
      { query: 'laptop', types: ['ticket', 'project'], limit: 5, sort: 'recent' },
    );
  });
});
