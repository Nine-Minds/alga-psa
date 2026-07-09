/**
 * Adaptive Card builders for Teams bot replies.
 *
 * Bot responses carry an Adaptive Card 1.5 attachment as the primary
 * rendering and keep the hero-card representation as a fallback for clients
 * or channels that reject adaptive content (the send path retries once with
 * the hero rendering on a 4xx card rejection).
 */

export const TEAMS_ADAPTIVE_CARD_CONTENT_TYPE = 'application/vnd.microsoft.card.adaptive';

export interface TeamsAdaptiveCardOpenUrlAction {
  type: 'Action.OpenUrl';
  title: string;
  url: string;
}

export interface TeamsAdaptiveCardSubmitAction {
  type: 'Action.Submit';
  title: string;
  data: Record<string, unknown>;
}

export type TeamsAdaptiveCardAction = TeamsAdaptiveCardOpenUrlAction | TeamsAdaptiveCardSubmitAction;

export interface TeamsAdaptiveCardContent {
  type: 'AdaptiveCard';
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json';
  version: '1.5';
  msteams?: { width: 'Full' };
  body: Array<Record<string, unknown>>;
  actions?: TeamsAdaptiveCardAction[];
}

export interface TeamsAdaptiveCardAttachment {
  contentType: typeof TEAMS_ADAPTIVE_CARD_CONTENT_TYPE;
  content: TeamsAdaptiveCardContent;
}

export function buildAdaptiveOpenUrlAction(title: string, url: string): TeamsAdaptiveCardOpenUrlAction {
  return { type: 'Action.OpenUrl', title, url };
}

export function buildAdaptiveSubmitAction(
  title: string,
  data: Record<string, unknown>
): TeamsAdaptiveCardSubmitAction {
  return { type: 'Action.Submit', title, data };
}

/**
 * Action.Submit payload equivalent to a hero-card imBack button: Teams sends
 * the value back as a normal user message, so the deterministic command
 * parser handles it unchanged.
 */
export function buildAdaptiveImBackAction(title: string, value: string): TeamsAdaptiveCardSubmitAction {
  return buildAdaptiveSubmitAction(title, {
    msteams: { type: 'imBack', value },
  });
}

/** Action.Submit payload for inline bot card actions (assign, add note). */
export function buildBotCardActionSubmit(
  title: string,
  data: { actionId: string } & Record<string, unknown>
): TeamsAdaptiveCardSubmitAction {
  return buildAdaptiveSubmitAction(title, {
    command: 'bot_card_action',
    ...data,
  });
}

export function buildTeamsAdaptiveCard(params: {
  title: string;
  text: string;
  actions?: TeamsAdaptiveCardAction[];
}): TeamsAdaptiveCardAttachment {
  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: params.title,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
    },
  ];

  if (params.text) {
    body.push({
      type: 'TextBlock',
      text: params.text,
      wrap: true,
    });
  }

  return {
    contentType: TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
    content: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      msteams: { width: 'Full' },
      body,
      ...(params.actions && params.actions.length > 0 ? { actions: params.actions } : {}),
    },
  };
}

interface HeroCardButtonShape {
  type: 'openUrl' | 'imBack';
  title: string;
  value: string;
}

interface HeroCardContentShape {
  title: string;
  text: string;
  buttons?: HeroCardButtonShape[];
}

/** Convert a hero-card rendering into the equivalent Adaptive Card. */
export function buildAdaptiveCardFromHeroContent(content: HeroCardContentShape): TeamsAdaptiveCardAttachment {
  const actions = (content.buttons || []).map((button) =>
    button.type === 'openUrl'
      ? buildAdaptiveOpenUrlAction(button.title, button.value)
      : buildAdaptiveImBackAction(button.title, button.value)
  );

  return buildTeamsAdaptiveCard({
    title: content.title,
    text: content.text,
    actions,
  });
}

/**
 * Ticket card with inline actions: Assign to me / Add note execute through
 * the action registry via `bot_card_action` submits; Open is a deep link.
 */
export function buildTicketAdaptiveCard(params: {
  title: string;
  text: string;
  ticketId: string;
  idempotencyKey: string;
  openUrl?: string | null;
  canAssign: boolean;
  canAddNote: boolean;
}): TeamsAdaptiveCardAttachment {
  const actions: TeamsAdaptiveCardAction[] = [];

  if (params.canAssign) {
    actions.push(
      buildBotCardActionSubmit('Assign to me', {
        actionId: 'assign_ticket',
        ticketId: params.ticketId,
        idempotencyKey: params.idempotencyKey,
      })
    );
  }

  if (params.canAddNote) {
    actions.push(
      buildBotCardActionSubmit('Add note', {
        actionId: 'add_note',
        ticketId: params.ticketId,
      })
    );
  }

  if (params.openUrl) {
    actions.push(buildAdaptiveOpenUrlAction('Open', params.openUrl));
  }

  return buildTeamsAdaptiveCard({
    title: params.title,
    text: params.text,
    actions,
  });
}
