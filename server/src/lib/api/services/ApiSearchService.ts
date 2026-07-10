/**
 * API Search Service
 *
 * Minimal BaseService implementation backing the unified full-text search
 * endpoint. Search is read-only and served by `runAppSearch`, so the CRUD
 * methods are intentionally unsupported — the controller never calls them.
 */

import type { BaseService, ListOptions } from '../controllers/types';
import { NotImplementedError } from '../middleware/apiMiddleware';

export class ApiSearchService implements BaseService {
  private unsupported(): never {
    throw new NotImplementedError('Search resource does not support this operation');
  }

  async list(_options: ListOptions, _context: any): Promise<{ data: any[]; total: number }> {
    return this.unsupported();
  }

  async getById(_id: string, _context: any): Promise<any | null> {
    return this.unsupported();
  }

  async create(_data: any, _context: any): Promise<any> {
    return this.unsupported();
  }

  async update(_id: string, _data: any, _context: any): Promise<any> {
    return this.unsupported();
  }

  async delete(_id: string, _context: any): Promise<void> {
    return this.unsupported();
  }
}
