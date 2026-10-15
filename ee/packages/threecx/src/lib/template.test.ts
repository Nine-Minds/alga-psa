import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import {
  renderThreecxTemplate,
  threecxTemplateFilename,
  THREECX_CREATE_CONTACT_POST_KEYS,
  THREECX_REPORT_CALL_POST_KEYS,
  THREECX_REPORT_CHAT_POST_KEYS,
} from './template';
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

function asList<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function scenario(id: string): any {
  return scenarios().find((s) => String(s['@_Id'] ?? '') === id);
}

/** PostValues rendered as { key: expression }. */
function postValues(id: string): Record<string, string> {
  const values = asList(scenario(id).Request.PostValues.Value);
  return Object.fromEntries(values.map((v: any) => [v['@_Key'], String(v['#text'])]));
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

  it('T092: numbers are sent with a 00 prefix and never truncated', () => {
    // A leading + would decode to a space in the lookup query string, and
    // MaxLength would strip the number below what the E.164 matcher needs.
    expect(doc.Crm.Number['@_Prefix']).toBe('Zeros');
    expect(doc.Crm.Number['@_MaxLength']).toBe('');
  });

  it('uses the enum spellings 3CX accepts, or the upload fails with "incorrect file format"', () => {
    expect(doc.Crm.Connection['@_MaxConcurrentRequests']).toBeDefined();
    for (const s of scenarios()) {
      const request = s.Request;
      const isPost = request.PostValues !== undefined;
      expect(request['@_RequestType']).toBe(isPost ? 'Post' : 'Get');
      expect(request['@_RequestEncoding']).toBe(isPost ? 'Json' : 'UrlEncoded');
      expect(request['@_ResponseType']).toBe('Json');
      expect(request['@_PostText']).toBeUndefined();
    }
    expect(xml).not.toMatch(/RequestType="(GET|POST)"/);
  });

  it('falls back to Global when the tenant has no country, since Country is mandatory', () => {
    const blank = parser.parse(renderThreecxTemplate({ baseUrl: BASE, tenantSlug: SLUG, templateVersion: VERSION, country: '' }));
    expect(blank.Crm['@_Country']).toBe('Global');
  });

  it('T093: scenarios carry the six reserved 3CX Ids in order', () => {
    const ids = scenarios().map((s) => String(s['@_Id'] ?? ''));
    expect(ids).toEqual(['', 'LookupByEmail', 'SearchContacts', 'CreateContactRecordFromClient', 'ReportCall', 'ReportChat']);
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
    expect(byId['CreateContactRecordFromClient']).toBe(`${BASE}${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.contacts}`);
    expect(byId['ReportChat']).toBe(`${BASE}${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.reportChat}`);
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
    const outputList = asList(lookup.Outputs.Output);
    const types = outputList.map((o: any) => o['@_Type']);
    expect(types).toEqual(expect.arrayContaining(['ContactUrl', 'FirstName', 'LastName', 'CompanyName', 'Email', 'PhoneBusiness']));

    // 3CX evaluates only bracketed output values; a bare name is a literal.
    for (const output of outputList) {
      expect(output['@_Value']).toMatch(/^\[[A-Za-z]+\]$/);
    }

    // Paths are absolute and unindexed; 3CX iterates the array itself.
    const varList = asList(lookup.Variables.Variable);
    expect(varList.find((v: any) => v['@_Name'] === 'ContactUrl')['@_Path']).toBe('contacts.contactUrl');
    expect(varList.find((v: any) => v['@_Name'] === 'PhoneBusiness')['@_Path']).toBe('contacts.phone');
    expect(xml).not.toMatch(/Path="[^"]*\.\d+\./);
    expect(asList(lookup.Rules.Rule)[0]['#text']).toBe('contacts.contactUrl');
  });

  it('T098: the ReportCall scenario posts JSON whose keys match the report-call contract', () => {
    const body = postValues('ReportCall');
    expect(Object.keys(body).sort()).toEqual([...THREECX_REPORT_CALL_POST_KEYS].sort());
    // [Duration] is hh:mm:ss and the UTC times are DateTime objects; the route
    // needs seconds and ISO-8601.
    expect(body.durationSeconds).toBe('[[[DurationTimespan].get_TotalSeconds()].ToString("F0")]');
    expect(body.startTimeUtc).toBe('[[CallStartTimeUTC].ToString("yyyy-MM-ddTHH:mm:ssZ")]');
    expect(body.endTimeUtc).toBe('[[CallEndTimeUTC].ToString("yyyy-MM-ddTHH:mm:ssZ")]');
    expect(scenario('ReportCall').Rules).toBeUndefined();
    expect(scenario('ReportCall').Outputs).toBeUndefined();
    expect(body.transcription).toBe('[Transcription]');
    expect(body.summary).toBe('[Summary]');
    expect(body.recordingUrl).toBe('[RecordingUrl]');
    expect(body.entityId).toBe('[EntityId]');
    expect(body.entityType).toBe('[EntityType]');
  });

  it('T211: every lookup scenario outputs EntityId and EntityType from the response', () => {
    for (const id of ['', 'LookupByEmail', 'SearchContacts', 'CreateContactRecordFromClient']) {
      const found = scenario(id);
      const types = asList(found.Outputs.Output).map((o: any) => o['@_Type']);
      expect(types).toEqual(expect.arrayContaining(['EntityId', 'EntityType']));
      const varList = asList(found.Variables.Variable);
      expect(varList.find((v: any) => v['@_Name'] === 'EntityId')['@_Path']).toBe('contacts.entityId');
      expect(varList.find((v: any) => v['@_Name'] === 'EntityType')['@_Path']).toBe('contacts.entityType');
    }
  });

  it('T215: CreateContactRecordFromClient posts the five client-entered variables to the contacts route', () => {
    const body = postValues('CreateContactRecordFromClient');
    expect(Object.keys(body).sort()).toEqual([...THREECX_CREATE_CONTACT_POST_KEYS].sort());
    expect(body).toEqual({ firstName: '[FirstName]', lastName: '[LastName]', number: '[Number]', email: '[Email]', company: '[Company]' });
    expect(scenario('CreateContactRecordFromClient').Request['@_RequestType']).toBe('Post');
  });

  it('T216: ReportChat posts the chat transcript and entity fields to the report-chat route', () => {
    const body = postValues('ReportChat');
    expect(Object.keys(body).sort()).toEqual([...THREECX_REPORT_CHAT_POST_KEYS].sort());
    expect(body.messages).toBe('[ChatMessages]');
    expect(body.startTimeUtc).toBe('[[ChatStartTimeUTC].ToString("yyyy-MM-ddTHH:mm:ssZ")]');
    expect(body.entityId).toBe('[EntityId]');
  });

  it('names the download file after the tenant slug', () => {
    expect(threecxTemplateFilename(SLUG)).toBe(`algapsa-3cx-${SLUG}.xml`);
  });
});
