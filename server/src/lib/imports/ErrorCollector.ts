import { ImportValidationError } from '@/lib/imports/errors';
import type { ValidationResult } from '../../types/imports.types';

/**
 * Utility to collect validation errors without failing fast.
 */
export class ImportErrorCollector {
  private readonly errors: ImportValidationError[] = [];
  private warnings: string[] = [];

  add(error: ImportValidationError): void {
    this.errors.push(error);
  }

  addMany(errors: ImportValidationError[]): void {
    if (errors.length === 0) return;
    this.errors.push(...errors);
  }

  addWarning(message: string): void {
    this.warnings.push(message);
  }

  addWarnings(messages: string[]): void {
    if (messages.length === 0) return;
    this.warnings = this.warnings.concat(messages);
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  getErrors(): ImportValidationError[] {
    return [...this.errors];
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  clear(): void {
    this.errors.length = 0;
    this.warnings.length = 0;
  }

  toResult(): ValidationResult {
    return {
      isValid: this.errors.length === 0,
      errors: this.getErrors(),
      warnings: this.getWarnings()
    };
  }
}

export const createImportErrorCollector = (): ImportErrorCollector => new ImportErrorCollector();
