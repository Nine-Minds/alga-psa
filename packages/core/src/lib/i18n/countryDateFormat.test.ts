import { describe, expect, it } from 'vitest';
import { countryDateFormat, coveredCountryCodes, SYSTEM_DATE_FORMAT } from './countryDateFormat';

describe('countryDateFormat', () => {
  it('writes the US shape for US', () => {
    const format = countryDateFormat('US');
    expect(format.order).toEqual(['month', 'day', 'year']);
    expect(format.separator).toBe('/');
    expect(format.hour12).toBe(true);
    expect(format.datePattern).toBe('MM/dd/yyyy');
    expect(format.dateTimePattern).toBe('MM/dd/yyyy h:mm a');
  });

  it('writes day-first for AU, on a 12-hour dial', () => {
    const format = countryDateFormat('AU');
    expect(format.datePattern).toBe('dd/MM/yyyy');
    expect(format.hour12).toBe(true);
    expect(format.dateTimePattern).toBe('dd/MM/yyyy h:mm a');
  });

  it('writes day-first for GB, on a 24-hour clock', () => {
    const format = countryDateFormat('GB');
    expect(format.datePattern).toBe('dd/MM/yyyy');
    expect(format.hour12).toBe(false);
    expect(format.dateTimePattern).toBe('dd/MM/yyyy HH:mm');
  });

  it('writes dotted day-first for DE', () => {
    expect(countryDateFormat('DE').datePattern).toBe('dd.MM.yyyy');
    expect(countryDateFormat('DE').hour12).toBe(false);
  });

  it('writes ISO order for CA', () => {
    const format = countryDateFormat('CA');
    expect(format.order).toEqual(['year', 'month', 'day']);
    expect(format.datePattern).toBe('yyyy-MM-dd');
    expect(format.hour12).toBe(true);
  });

  it('writes day-first for BR', () => {
    expect(countryDateFormat('BR').datePattern).toBe('dd/MM/yyyy');
    expect(countryDateFormat('BR').hour12).toBe(false);
  });

  it('falls back to the fixed system default for the XX placeholder', () => {
    expect(countryDateFormat('XX')).toEqual(SYSTEM_DATE_FORMAT);
    expect(countryDateFormat('xx')).toEqual(SYSTEM_DATE_FORMAT);
  });

  it('falls back to the fixed system default for garbage, blanks and nothing', () => {
    for (const value of [null, undefined, '', '   ', 'Australia', 'AUS', 'Z', '12', 42 as never]) {
      expect(countryDateFormat(value as string | null | undefined)).toEqual(SYSTEM_DATE_FORMAT);
    }
  });

  it('accepts lowercase and padded codes', () => {
    expect(countryDateFormat(' au ').datePattern).toBe('dd/MM/yyyy');
    expect(countryDateFormat('de').datePattern).toBe('dd.MM.yyyy');
  });

  it('reports the country it resolved, and null for the default', () => {
    expect(countryDateFormat('DE').country).toBe('DE');
    expect(countryDateFormat('XX').country).toBeNull();
  });

  it('covers the whole countries reference set exactly once', () => {
    const codes = coveredCountryCodes();
    expect(codes).toHaveLength(249);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('never returns a pattern whose parts disagree with its order', () => {
    const token = { day: 'dd', month: 'MM', year: 'yyyy' } as const;
    for (const code of coveredCountryCodes()) {
      const format = countryDateFormat(code);
      expect(format.datePattern).toBe(format.order.map((part) => token[part]).join(format.separator));
    }
  });
});
