// src/utils/templateParser.ts

import * as P from 'parsimmon';

// Define the parser
const templateParser = P.createLanguage({
    expression: r => P.string('{{').then(r.variable).skip(P.string('}}')),
    variable: () => P.regexp(/[a-zA-Z0-9_.]+/),
    template: r => P.alt(r.expression, P.any).many().map(parts => parts.join('')),
});

// Function to parse a template string
export function parseTemplate(template: string): string {
    const result = templateParser.template.parse(template);
    if (result.status) {
        return result.value;
    } else {
        console.error('Failed to parse template:', (result as any).expected);
        return template; // Return the original template if parsing fails
    }
}

// Function to render a template with data
export function renderTemplate(template: string, data: Record<string, any>): string {
    const parsed = parseTemplate(template);
    return parsed.replace(/{{(.*?)}}/g, (match, p1: string) => {
        const keys = p1.split('.');
        let value: any = data;
        for (const key of keys) {
            if (value === undefined || value === null) break;
            value = value[key];
        }
        return value !== undefined && value !== null ? String(value) : match;
    });
}