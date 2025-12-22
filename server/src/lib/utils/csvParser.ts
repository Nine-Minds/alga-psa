export interface CSVParseResult<T> {
  data: T[];
  errors: string[];
}

export interface CSVParseOptions {
  header?: boolean;
}

export function parseCSV(text: string, options?: CSVParseOptions): string[][] | Record<string, string>[] {
  const rawRows = parseCSVRaw(text);

  if (options?.header && rawRows.length > 0) {
    const headers = rawRows[0];
    const dataRows = rawRows.slice(1);
    return dataRows.map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] ?? '';
      });
      return obj;
    });
  }

  return rawRows;
}

function parseCSVRaw(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Handle escaped quotes
        currentValue += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // End of field
      currentRow.push(currentValue.trim());
      currentValue = '';
    } else if (char === '\n' && !insideQuotes) {
      // End of row
      if (currentValue || currentRow.length > 0) {
        currentRow.push(currentValue.trim());
        if (currentRow.some(cell => cell)) { // Skip empty rows
          rows.push(currentRow);
        }
        currentRow = [];
        currentValue = '';
      }
    } else if (char === '\r') {
      // Skip carriage return
      continue;
    } else {
      currentValue += char;
    }
  }

  // Handle last row if it doesn't end with newline
  if (currentValue || currentRow.length > 0) {
    currentRow.push(currentValue.trim());
    if (currentRow.some(cell => cell)) { // Skip empty rows
      rows.push(currentRow);
    }
  }

  return rows;
}

export function unparseCSV(data: any[], fields: string[]): string {
  const escapeField = (field: string): string => {
    const stringField = String(field);
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
      return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
  };

  const rows = [
    fields.join(','),
    ...data.map((row):string => 
      fields.map((field):string=> escapeField(row[field] || '')).join(',')
    )
  ];

  return rows.join('\n');
}

export function validateCSVHeaders(headers: string[], requiredFields: string[]): string[] {
  const errors: string[] = [];
  const missingFields = requiredFields.filter(
    field => !headers.some(header => header.toLowerCase() === field.toLowerCase())
  );

  if (missingFields.length > 0) {
    errors.push(`Missing required fields: ${missingFields.join(', ')}`);
  }

  return errors;
}
