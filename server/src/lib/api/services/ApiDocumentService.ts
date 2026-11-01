/**
 * API Document Service
 *
 * Minimal BaseService implementation for the document attach endpoint. Attaching
 * is served by `attachDocumentFromBytes`, so the CRUD methods are intentionally
 * unsupported -- the controller never calls them.
 */

import type { BaseService, ListOptions } from '../controllers/types';
import { NotImplementedError } from '../middleware/apiMiddleware';

export class ApiDocumentService implements BaseService {
  private unsupported(): never {
    throw new NotImplementedError('Documents resource does not support this operation');
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
