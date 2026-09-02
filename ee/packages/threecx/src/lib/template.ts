import {
  THREECX_QUERY_PARAMS,
  THREECX_ROUTE_SEGMENTS,
  threecxRouteUrl,
} from './routeConstants';

export function threecxTemplateFilename(tenantSlug: string): string {
  return `algapsa-3cx-${tenantSlug}.xml`;
}

export interface RenderThreecxTemplateInput {
  baseUrl: string;
  tenantSlug: string;
  templateVersion: number;
  /** Tenant default ISO-3166 alpha-2 country; blank when unknown. */
  country?: string | null;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The JSON body 3CX posts to report-call. Mirrors ThreecxReportCallBody so the
 * validator test can assert the keys match the route contract. Values are 3CX
 * template variables the CRM engine substitutes at call time.
 */
export const THREECX_REPORT_CALL_POST_KEYS = [
  'callType',
  'number',
  'agentExtension',
  'agentEmail',
  'queueExtension',
  'durationSeconds',
  'startTimeUtc',
  'establishedTimeUtc',
  'endTimeUtc',
] as const;

function reportCallPostText(): string {
  const body: Record<string, string> = {
    callType: '[CallType]',
    number: '[Number]',
    agentExtension: '[Agent]',
    agentEmail: '[AgentEmail]',
    queueExtension: '[QueueExtension]',
    durationSeconds: '[Duration]',
    startTimeUtc: '[CallStartTimeUTC]',
    establishedTimeUtc: '[CallEstablishedTimeUTC]',
    endTimeUtc: '[CallEndTimeUTC]',
  };
  return JSON.stringify(body);
}

function lookupOutputs(): string {
  // The JSON response shape is { contacts: [ { contactUrl, firstName, ... } ] };
  // the first contact drives the caller-id pop.
  const map: Array<[string, string, string]> = [
    ['ContactUrl', 'contacts.0.contactUrl', 'ContactUrl'],
    ['FirstName', 'contacts.0.firstName', 'FirstName'],
    ['LastName', 'contacts.0.lastName', 'LastName'],
    ['CompanyName', 'contacts.0.companyName', 'CompanyName'],
    ['Email', 'contacts.0.email', 'Email'],
    ['PhoneBusiness', 'contacts.0.phone', 'PhoneBusiness'],
  ];
  const variables = map
    .map(([name, path]) => `        <Variable Name="${name}" Path="${path}" />`)
    .join('\n');
  const outputs = map
    .map(([, , type]) => `        <Output Type="${type}" Passes="0" Value="${map.find((m) => m[2] === type)![0]}" />`)
    .join('\n');
  return `      <Variables>\n${variables}\n      </Variables>\n      <Outputs AllowEmpty="true">\n${outputs}\n      </Outputs>`;
}

function lookupScenario(id: string, url: string, queryDescription: string): string {
  return [
    `    <Scenario Id="${escapeXmlAttr(id)}" Type="REST">`,
    `      <Request SkipIf="" Url="${escapeXmlAttr(url)}" RequestType="GET" ResponseType="Json" RequestContentType="application/json">`,
    '        <Headers>',
    '          <Value Key="Authorization">Bearer [ApiKey]</Value>',
    '        </Headers>',
    '      </Request>',
    `      <!-- ${queryDescription} -->`,
    lookupOutputs(),
    '    </Scenario>',
  ].join('\n');
}

function reportCallScenario(url: string): string {
  return [
    '    <Scenario Id="ReportCall" Type="REST">',
    `      <Request SkipIf="" Url="${escapeXmlAttr(url)}" RequestType="POST" ResponseType="Json" RequestContentType="application/json" PostText="${escapeXmlAttr(reportCallPostText())}">`,
    '        <Headers>',
    '          <Value Key="Authorization">Bearer [ApiKey]</Value>',
    '        </Headers>',
    '      </Request>',
    '    </Scenario>',
  ].join('\n');
}

/**
 * Renders the 3CX CRM template XML for a tenant. Every URL and header is built
 * from the route constants, so a route rename breaks the validator test rather
 * than the rendered template.
 */
export function renderThreecxTemplate(input: RenderThreecxTemplateInput): string {
  const { baseUrl, tenantSlug, templateVersion } = input;
  const country = (input.country ?? '').trim();

  const lookupUrl = `${threecxRouteUrl(baseUrl, tenantSlug, THREECX_ROUTE_SEGMENTS.lookup)}?${THREECX_QUERY_PARAMS.number}=[Number]`;
  const emailUrl = `${threecxRouteUrl(baseUrl, tenantSlug, THREECX_ROUTE_SEGMENTS.lookupByEmail)}?${THREECX_QUERY_PARAMS.email}=[Email]`;
  const searchUrl = `${threecxRouteUrl(baseUrl, tenantSlug, THREECX_ROUTE_SEGMENTS.search)}?${THREECX_QUERY_PARAMS.q}=[SearchText]`;
  const reportUrl = threecxRouteUrl(baseUrl, tenantSlug, THREECX_ROUTE_SEGMENTS.reportCall);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Crm Country="${escapeXmlAttr(country)}" Name="AlgaPSA" Version="${templateVersion}" SupportsEmojis="true" ListRendering="false">`,
    '  <Number Prefix="Plus" MaxLength="" />',
    '  <Authentication Type="No" />',
    '  <Parameters>',
    '    <Parameter Name="ApiKey" Type="Password" Editor="String" Title="API key" />',
    '  </Parameters>',
    '  <Scenarios>',
    lookupScenario('', lookupUrl, 'Lookup by number'),
    lookupScenario('LookupByEmail', emailUrl, 'Lookup by email'),
    lookupScenario('SearchContacts', searchUrl, 'Free-text search'),
    reportCallScenario(reportUrl),
    '  </Scenarios>',
    '</Crm>',
  ].join('\n');
}
