import { describe, it, expect } from 'vitest';

import { DocumentationService } from '@/lib/api/services/DocumentationService';

describe('DocumentationService', () => {
  describe('generateEnhancedSwaggerUI', () => {
    it('produces branded HTML shell with navigation, Swagger, and Prism assets', () => {
      const html = DocumentationService.generateEnhancedSwaggerUI();

      expect(html).toContain('<html lang="en">');
      expect(html).toContain('Alga PSA API Documentation');
      expect(html).toContain('class="doc-tab active" onclick="showTab(\'overview\')"');
      expect(html).toContain('id="swagger-ui"');
      expect(html).toContain('https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js');
      expect(html).toContain('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js');
      expect(html).toContain('localStorage.setItem(\'algaPsaApiKey\'');
    });

    it('includes quick start guidance and API status indicators', () => {
      const html = DocumentationService.generateEnhancedSwaggerUI();

      expect(html).toContain('⚡ Quick Start Guide');
      expect(html).toContain('class="status-indicator status-operational"');
      expect(html).toContain('Follow the HATEOAS links');
    });
  });

  describe('getApiExamples', () => {
    it('returns curated examples with multi-language snippets and metadata', () => {
      const examples = DocumentationService.getApiExamples();

      expect(examples.length).toBeGreaterThan(0);

      const listTeams = examples.find(example => example.endpoint === '/api/v1/teams' && example.method === 'GET');
      expect(listTeams).toBeDefined();
      expect(listTeams?.codeExamples.map(example => example.language)).toEqual(expect.arrayContaining(['curl', 'javascript', 'python']));
      expect(Array.isArray(listTeams?.response?.body?.data)).toBe(true);
      expect(listTeams?.response?.body?.data?.[0]._links.self.href).toBe('/api/v1/teams/team-123');
    });
  });

  describe('getDocumentationSections', () => {
    it('exposes getting started content with nested authentication guidance', () => {
      const sections = DocumentationService.getDocumentationSections();

      expect(sections.length).toBeGreaterThan(0);
      const gettingStarted = sections.find(section => section.id === 'getting-started');
      expect(gettingStarted).toBeDefined();
      expect(gettingStarted?.content).toContain('REST Level 3 maturity');
      expect(gettingStarted?.subsections?.[0].id).toBe('authentication');
      expect(gettingStarted?.subsections?.[0].content).toContain('X-API-Key');
    });
  });
});
