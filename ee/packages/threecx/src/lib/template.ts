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
  'entityId',
  'entityType',
  'transcription',
  'summary',
  'recordingUrl',
] as const;

export const THREECX_REPORT_CALL_VARIABLES: Record<(typeof THREECX_REPORT_CALL_POST_KEYS)[number], string> = {
  callType: '[CallType]',
  number: '[Number]',
  agentExtension: '[Agent]',
  agentEmail: '[AgentEmail]',
  queueExtension: '[QueueExtension]',
  durationSeconds: '[Duration]',
  startTimeUtc: '[CallStartTimeUTC]',
  establishedTimeUtc: '[CallEstablishedTimeUTC]',
  endTimeUtc: '[CallEndTimeUTC]',
  entityId: '[EntityId]',
  entityType: '[EntityType]',
  transcription: '[Transcription]',
  summary: '[Summary]',
  recordingUrl: '[RecordingUrl]',
};

/** The JSON body 3CX posts to report-chat; mirrors ThreecxReportChatBody. */
export const THREECX_REPORT_CHAT_POST_KEYS = [
  'number',
  'email',
  'name',
  'agentEmail',
  'queueExtension',
  'durationSeconds',
  'startTimeUtc',
  'endTimeUtc',
  'messages',
  'entityId',
  'entityType',
] as const;

export const THREECX_REPORT_CHAT_VARIABLES: Record<(typeof THREECX_REPORT_CHAT_POST_KEYS)[number], string> = {
  number: '[Number]',
  email: '[Email]',
  name: '[Name]',
  agentEmail: '[AgentEmail]',
  queueExtension: '[QueueExtension]',
  durationSeconds: '[Duration]',
  startTimeUtc: '[ChatStartTimeUTC]',
  endTimeUtc: '[ChatEndTimeUTC]',
  messages: '[ChatMessages]',
  entityId: '[EntityId]',
  entityType: '[EntityType]',
};

/** The JSON body 3CX posts to create a contact; mirrors ThreecxCreateContactBody. */
export const THREECX_CREATE_CONTACT_POST_KEYS = ['firstName', 'lastName', 'number', 'email', 'company'] as const;

export const THREECX_CREATE_CONTACT_VARIABLES: Record<(typeof THREECX_CREATE_CONTACT_POST_KEYS)[number], string> = {
  firstName: '[FirstName]',
  lastName: '[LastName]',
  number: '[Number]',
  email: '[Email]',
  company: '[Company]',
};

function postText(variables: Record<string, string>): string {
  return JSON.stringify(variables);
}

/** Response path → 3CX output type, shared by every scenario that returns a contact. */
export const THREECX_CONTACT_OUTPUTS: ReadonlyArray<readonly [name: string, path: string, type: string]> = [
  ['ContactUrl', 'contacts.0.contactUrl', 'ContactUrl'],
  ['FirstName', 'contacts.0.firstName', 'FirstName'],
  ['LastName', 'contacts.0.lastName', 'LastName'],
  ['CompanyName', 'contacts.0.companyName', 'CompanyName'],
  ['Email', 'contacts.0.email', 'Email'],
  ['PhoneBusiness', 'contacts.0.phone', 'PhoneBusiness'],
  ['EntityId', 'contacts.0.entityId', 'EntityId'],
  ['EntityType', 'contacts.0.entityType', 'EntityType'],
];

function contactOutputs(): string {
  // The JSON response shape is { contacts: [ { contactUrl, firstName, ... } ] };
  // the first contact drives the caller-id pop.
  const variables = THREECX_CONTACT_OUTPUTS
    .map(([name, path]) => `        <Variable Name="${name}" Path="${path}" />`)
    .join('\n');
  const outputs = THREECX_CONTACT_OUTPUTS
    .map(([name, , type]) => `        <Output Type="${type}" Passes="0" Value="${name}" />`)
    .join('\n');
  return `      <Variables>\n${variables}\n      </Variables>\n      <Outputs AllowEmpty="true">\n${outputs}\n      </Outputs>`;
}

function authHeaders(): string[] {
  return [
    '        <Headers>',
    '          <Value Key="Authorization">Bearer [ApiKey]</Value>',
    '        </Headers>',
  ];
}

function lookupScenario(id: string, url: string, queryDescription: string): string {
  return [
    `    <Scenario Id="${escapeXmlAttr(id)}" Type="REST">`,
    `      <Request SkipIf="" Url="${escapeXmlAttr(url)}" RequestType="GET" ResponseType="Json" RequestContentType="application/json">`,
    ...authHeaders(),
    '      </Request>',
    `      <!-- ${queryDescription} -->`,
    contactOutputs(),
    '    </Scenario>',
  ].join('\n');
}

function postScenario(id: string, url: string, body: Record<string, string>, withOutputs: boolean): string {
  return [
    `    <Scenario Id="${id}" Type="REST">`,
    `      <Request SkipIf="" Url="${escapeXmlAttr(url)}" RequestType="POST" ResponseType="Json" RequestContentType="application/json" PostText="${escapeXmlAttr(postText(body))}">`,
    ...authHeaders(),
    '      </Request>',
    ...(withOutputs ? [contactOutputs()] : []),
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

  const url = (segment: string) => threecxRouteUrl(baseUrl, tenantSlug, segment);
  const lookupUrl = `${url(THREECX_ROUTE_SEGMENTS.lookup)}?${THREECX_QUERY_PARAMS.number}=[Number]`;
  const emailUrl = `${url(THREECX_ROUTE_SEGMENTS.lookupByEmail)}?${THREECX_QUERY_PARAMS.email}=[Email]`;
  const searchUrl = `${url(THREECX_ROUTE_SEGMENTS.search)}?${THREECX_QUERY_PARAMS.q}=[SearchText]`;

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
    postScenario('CreateContactRecordFromClient', url(THREECX_ROUTE_SEGMENTS.contacts), THREECX_CREATE_CONTACT_VARIABLES, true),
    postScenario('ReportCall', url(THREECX_ROUTE_SEGMENTS.reportCall), THREECX_REPORT_CALL_VARIABLES, false),
    postScenario('ReportChat', url(THREECX_ROUTE_SEGMENTS.reportChat), THREECX_REPORT_CHAT_VARIABLES, false),
    '  </Scenarios>',
    '</Crm>',
  ].join('\n');
}
