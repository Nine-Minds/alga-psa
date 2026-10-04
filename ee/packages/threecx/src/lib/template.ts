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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 3CX DateTime variables stringify in the PBX's local culture; the routes
 * require ISO-8601 UTC, so format them explicitly.
 */
function isoUtc(variable: string): string {
  return `[[${variable}].ToString("yyyy-MM-ddTHH:mm:ssZ")]`;
}

/** [Duration] is "hh:mm:ss"; the routes take whole seconds. */
const DURATION_SECONDS = '[[[DurationTimespan].get_TotalSeconds()].ToString("F0")]';

/**
 * The JSON body 3CX posts to report-call. Mirrors ThreecxReportCallBody so the
 * validator test can assert the keys match the route contract. Values are 3CX
 * expressions the CRM engine evaluates at call time.
 */
export const THREECX_REPORT_CALL_POST_KEYS = [
  'callType',
  'number',
  'agentExtension',
  'agentEmail',
  'queueExtension',
  'durationSeconds',
  'startTimeUtc',
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
  durationSeconds: DURATION_SECONDS,
  // establishedTimeUtc is optional on the route and left out: missed calls
  // have no established time, and formatting a null DateTime fails in 3CX.
  startTimeUtc: isoUtc('CallStartTimeUTC'),
  endTimeUtc: isoUtc('CallEndTimeUTC'),
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
  durationSeconds: DURATION_SECONDS,
  startTimeUtc: isoUtc('ChatStartTimeUTC'),
  endTimeUtc: isoUtc('ChatEndTimeUTC'),
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

/**
 * Variable name → response path → 3CX output type, shared by every scenario
 * that returns a contact. Paths are absolute from the response root; 3CX
 * iterates the `contacts` array itself and does not support positional
 * indexes like `contacts.0.x`.
 */
export const THREECX_CONTACT_OUTPUTS: ReadonlyArray<readonly [name: string, path: string, type: string]> = [
  ['ContactUrl', 'contacts.contactUrl', 'ContactUrl'],
  ['FirstName', 'contacts.firstName', 'FirstName'],
  ['LastName', 'contacts.lastName', 'LastName'],
  ['CompanyName', 'contacts.companyName', 'CompanyName'],
  ['Email', 'contacts.email', 'Email'],
  ['PhoneBusiness', 'contacts.phone', 'PhoneBusiness'],
  ['EntityId', 'contacts.entityId', 'EntityId'],
  ['EntityType', 'contacts.entityType', 'EntityType'],
];

function contactOutputs(allowEmpty: boolean): string[] {
  return [
    '      <Rules>',
    '        <Rule Type="Any" Ethalon="">contacts.contactUrl</Rule>',
    '      </Rules>',
    '      <Variables>',
    ...THREECX_CONTACT_OUTPUTS.flatMap(([name, path]) => [
      `        <Variable Name="${name}" Path="${path}">`,
      '          <Filter />',
      '        </Variable>',
    ]),
    '      </Variables>',
    `      <Outputs AllowEmpty="${allowEmpty}">`,
    ...THREECX_CONTACT_OUTPUTS.map(([name, , type]) => `        <Output Type="${type}" Passes="0" Value="[${name}]" />`),
    '      </Outputs>',
  ];
}

function authHeaders(): string[] {
  return [
    '        <Headers>',
    '          <Value Key="Authorization" Passes="0" Type="String">Bearer [ApiKey]</Value>',
    '        </Headers>',
  ];
}

function lookupScenario(id: string, url: string, comment: string, allowEmpty: boolean): string {
  return [
    `    <!-- ${comment} -->`,
    `    <Scenario Id="${escapeXml(id)}" Type="REST">`,
    `      <Request SkipIf="" Url="${escapeXml(url)}" MessagePasses="0" RequestContentType="" RequestEncoding="UrlEncoded" RequestType="Get" ResponseType="Json">`,
    ...authHeaders(),
    '      </Request>',
    ...contactOutputs(allowEmpty),
    '    </Scenario>',
  ].join('\n');
}

function postScenario(
  id: string,
  url: string,
  comment: string,
  body: Record<string, string>,
  withOutputs: boolean,
): string {
  const values = Object.entries(body).map(
    ([key, expression]) => `          <Value Key="${key}" Passes="1" Type="String">${escapeXml(expression)}</Value>`,
  );
  return [
    `    <!-- ${comment} -->`,
    `    <Scenario Id="${id}" Type="REST">`,
    `      <Request SkipIf="" Url="${escapeXml(url)}" MessagePasses="0" RequestContentType="" RequestEncoding="Json" RequestType="Post" ResponseType="Json">`,
    ...authHeaders(),
    '        <PostValues>',
    ...values,
    '        </PostValues>',
    '      </Request>',
    ...(withOutputs ? contactOutputs(false) : []),
    '    </Scenario>',
  ].join('\n');
}

/**
 * Renders the 3CX CRM template XML for a tenant, following the 3CX CRM
 * Template XML description (enum values are case-sensitive: Get/Post,
 * Json/UrlEncoded). Every URL is built from the route constants, so a route
 * rename breaks the validator test rather than the template.
 *
 * Number handling: Prefix="Zeros" sends international numbers as 00…, which
 * survives the query string (a leading + decodes to a space) and which
 * normalizeToE164 reads as international. MaxLength stays empty so 3CX never
 * truncates the number before our E.164 matcher sees it.
 */
export function renderThreecxTemplate(input: RenderThreecxTemplateInput): string {
  const { baseUrl, tenantSlug, templateVersion } = input;
  // Mandatory on <Crm> but unused by 3CX at runtime.
  const country = (input.country ?? '').trim() || 'Global';

  const url = (segment: string) => threecxRouteUrl(baseUrl, tenantSlug, segment);
  const lookupUrl = `${url(THREECX_ROUTE_SEGMENTS.lookup)}?${THREECX_QUERY_PARAMS.number}=[Number]`;
  const emailUrl = `${url(THREECX_ROUTE_SEGMENTS.lookupByEmail)}?${THREECX_QUERY_PARAMS.email}=[Email]`;
  const searchUrl = `${url(THREECX_ROUTE_SEGMENTS.search)}?${THREECX_QUERY_PARAMS.q}=[SearchText]`;

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Crm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" Country="${escapeXml(country)}" Name="AlgaPSA" Version="${templateVersion}" SupportsEmojis="true">`,
    '  <Number Prefix="Zeros" MaxLength="" />',
    '  <Connection MaxConcurrentRequests="4" />',
    '  <Parameters>',
    '    <Parameter Name="ApiKey" Type="Password" Parent="General Configuration" Editor="String" Title="AlgaPSA API key:" Default="" />',
    '  </Parameters>',
    '  <Authentication Type="No" />',
    '  <Scenarios>',
    lookupScenario('', lookupUrl, 'Lookup by number', true),
    lookupScenario('LookupByEmail', emailUrl, 'Lookup by email', false),
    lookupScenario('SearchContacts', searchUrl, 'Free text search', false),
    postScenario('CreateContactRecordFromClient', url(THREECX_ROUTE_SEGMENTS.contacts), 'Create contact from the 3CX client', THREECX_CREATE_CONTACT_VARIABLES, true),
    postScenario('ReportCall', url(THREECX_ROUTE_SEGMENTS.reportCall), 'Call journaling', THREECX_REPORT_CALL_VARIABLES, false),
    postScenario('ReportChat', url(THREECX_ROUTE_SEGMENTS.reportChat), 'Chat journaling', THREECX_REPORT_CHAT_VARIABLES, false),
    '  </Scenarios>',
    '</Crm>',
  ].join('\n');
}
