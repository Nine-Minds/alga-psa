import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { renderThreecxTemplate, threecxTemplateFilename } from './template';
import {
  THREECX_API_BASE,
  THREECX_QUERY_PARAMS,
  THREECX_ROUTE_SEGMENTS,
} from './routeConstants';

const BASE = 'https://app.example.com';
const SLUG = 'abcdef012345';
const VERSION = 3;
const COUNTRY = 'US';

const xml = renderThreecxTemplate({ baseUrl: BASE, tenantSlug: SLUG, templateVersion: VERSION, country: COUNTRY });

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const doc = parser.parse(xml);

function scenarios(): any[] {
  const list = doc.Crm.Scenarios.Scenario;
  return Array.isArray(list) ? list : [list];
}

describe('renderThreecxTemplate', () => {
  it('T091: the XML parses with Name AlgaPSA, the given Version and Country, and one ApiKey password parameter', () => {
    expect(doc.Crm['@_Name']).toBe('AlgaPSA');
    expect(String(doc.Crm['@_Version'])).toBe(String(VERSION));
    expect(doc.Crm['@_Country']).toBe(COUNTRY);

    const params = doc.Crm.Parameters.Parameter;
    const paramList = Array.isArray(params) ? params : [params];
    expect(paramList).toHaveLength(1);
    expect(paramList[0]['@_Name']).toBe('ApiKey');
    expect(paramList[0]['@_Type']).toBe('Password');
  });

  it('T092: the template sets number prefix handling to Plus', () => {
    expect(doc.Crm.Number['@_Prefix']).toBe('Plus');
  });

  it('T093: scenarios carry Ids "", LookupByEmail, SearchContacts and ReportCall', () => {
    const ids = scenarios().map((s) => String(s['@_Id'] ?? ''));
    expect(ids).toEqual(['', 'LookupByEmail', 'SearchContacts', 'ReportCall']);
  });

  it('T094: every scenario request sends Authorization: Bearer [ApiKey]', () => {
    for (const scenario of scenarios()) {
      const values = scenario.Request.Headers.Value;
      const headerList = Array.isArray(values) ? values : [values];
      const auth = headerList.find((v: any) => v['@_Key'] === 'Authorization');
      expect(auth['#text']).toBe('Bearer [ApiKey]');
    }
  });

  it('T095: every scenario URL is built from the route constants', () => {
    const byId = Object.fromEntries(scenarios().map((s) => [String(s['@_Id'] ?? ''), s.Request['@_Url']]));

    expect(byId['']).toBe(`${BASE}${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.lookup}?${THREECX_QUERY_PARAMS.number}=[Number]`);
    expect(byId['LookupByEmail']).toBe(`${BASE}${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.lookupByEmail}?${THREECX_QUERY_PARAMS.email}=[Email]`);
    expect(byId['SearchContacts']).toContain(`/${THREECX_ROUTE_SEGMENTS.search}?${THREECX_QUERY_PARAMS.q}=`);
    expect(byId['ReportCall']).toBe(`${BASE}${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.reportCall}`);
  });

  it('T096: the rendered URLs derive from the constants, not baked-in literals', () => {
    // Each segment appears exactly where the constant places it; renaming a
    // constant would move it in both the render and this expectation.
    for (const segment of Object.values(THREECX_ROUTE_SEGMENTS)) {
      expect(xml).toContain(`/${SLUG}/${segment}`);
    }
  });

  it('T097: the lookup scenario maps the JSON fields to 3CX output types', () => {
    const lookup = scenarios().find((s) => String(s['@_Id'] ?? '') === '');
    const outputs = lookup.Outputs.Output;
    const outputList = Array.isArray(outputs) ? outputs : [outputs];
    const types = outputList.map((o: any) => o['@_Type']);
    expect(types).toEqual(expect.arrayContaining(['ContactUrl', 'FirstName', 'LastName', 'CompanyName', 'Email', 'PhoneBusiness']));

    const variables = lookup.Variables.Variable;
    const varList = Array.isArray(variables) ? variables : [variables];
    const contactUrlVar = varList.find((v: any) => v['@_Name'] === 'ContactUrl');
    expect(contactUrlVar['@_Path']).toBe('contacts.0.contactUrl');
    const phoneVar = varList.find((v: any) => v['@_Name'] === 'PhoneBusiness');
    expect(phoneVar['@_Path']).toBe('contacts.0.phone');
  });

  it('T098: the ReportCall scenario posts JSON whose keys match the report-call contract', () => {
    const reportCall = scenarios().find((s) => String(s['@_Id'] ?? '') === 'ReportCall');
    const postText = reportCall.Request['@_PostText'];
    const body = JSON.parse(postText);
    expect(Object.keys(body).sort()).toEqual(
      [
        'agentEmail',
        'agentExtension',
        'callType',
        'durationSeconds',
        'endTimeUtc',
        'establishedTimeUtc',
        'number',
        'queueExtension',
        'startTimeUtc',
      ],
    );
  });

  it('names the download file after the tenant slug', () => {
    expect(threecxTemplateFilename(SLUG)).toBe(`algapsa-3cx-${SLUG}.xml`);
  });
});
