'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Image from 'next/image';
import Feedback from '../feedback/Feedback';

import './message.css';

export type FunctionCallMeta = {
  displayName: string;
  method: string;
  endpoint: string;
  action: 'approve' | 'decline';
  status: 'success' | 'declined' | 'pending' | 'error';
  timestamp: string;
  preview?: string;
};

type MessageProps = {
  messageId?: string;
  role: string;
  content: string;
  clientUrl?: string;
  isFunction?: boolean;
  reasoning?: string;
  functionCallMeta?: FunctionCallMeta;
};

const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');

const FunctionStatusIcon: React.FC<{ status: FunctionCallMeta['status'] }> = ({ status }) => {
  if (status === 'declined') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (status === 'error') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <line x1="10" y1="6" x2="10" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="14" r="1.2" fill="currentColor" />
      </svg>
    );
  }

  if (status === 'pending') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M4 10a6 6 0 1 1 2 4.47"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <polyline
          points="4 14 6.4 14.4 6 16.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <polyline
        points="5 10.5 8.5 14 15 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
};

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) {
    return '';
  }
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export const Message: React.FC<MessageProps> = ({
  messageId,
  role,
  content,
  clientUrl,
  isFunction,
  reasoning,
  functionCallMeta,
}) => {
  const transformMessage = (value: any) => {
    if (value == null) {
      return '';
    }
    let msg = value;
    msg = msg.replace(/<think>[\s\S]*?<\/think>/gi, '');
    msg = msg.replace(/\[CONTEXT\][\s\S]*?\[\/CONTEXT\]/g, '');
    msg = msg.replace(/\[INST\]|\[\/INST\]/g, '').replace('<|end_of_text|><s>', '');
    msg = msg.replace(/%link_to_ticket\("(\d+)"\)%/g, (match: string, g1: string) =>
      `[Ticket ${g1}](${clientUrl?.replace('ticket_id', g1)})`,
    );
    msg = msg.replace(/###[\s\S]*?\[\/CONTEXT\]/g, '');
    msg = msg.replace('<|end_of_text|>', '');
    return msg;
  };

  const isAssistantMessage = role === 'bot';
  const isUserMessage = role === 'user';
  const isFunctionMarker = role === 'function-call' && functionCallMeta;
  const isNotice = role === 'notice';
  const authorLabel = isAssistantMessage ? 'Alga' : isUserMessage ? 'You' : 'System';
  const statusLabel = isFunction ? 'Drafting response…' : null;

  if (isFunctionMarker && functionCallMeta) {
    const previewRaw = functionCallMeta.preview?.trim();
    const preview =
      previewRaw && previewRaw.length > 220 ? `${previewRaw.slice(0, 217)}…` : previewRaw;
    const statusLabel =
      functionCallMeta.status === 'success'
        ? 'Function executed'
        : functionCallMeta.status === 'declined'
          ? 'Function declined'
          : functionCallMeta.status === 'pending'
            ? 'Function queued'
            : 'Function error';

    return (
      <div className="message-wrapper">
        <div className={classNames('message-row', 'message-row--function')}>
          <div
            className={classNames(
              'function-card',
              `function-card--${functionCallMeta.status}`,
              `function-card--action-${functionCallMeta.action}`,
            )}
            role="note"
          >
            <div className="function-card__header">
              <span className="function-card__icon" data-status={functionCallMeta.status}>
                <FunctionStatusIcon status={functionCallMeta.status} />
              </span>
              <div className="function-card__titles">
                <span className="function-card__title">{statusLabel}</span>
                <span className="function-card__subtitle">{functionCallMeta.displayName}</span>
              </div>
            </div>
            <div className="function-card__meta">
              <span className="function-card__badge">{functionCallMeta.method}</span>
              <span className="function-card__endpoint">{functionCallMeta.endpoint}</span>
            </div>
            {preview ? <p className="function-card__preview">{preview}</p> : null}
            <span className="function-card__timestamp">
              {formatTimestamp(functionCallMeta.timestamp)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const bubbleClasses = classNames(
    'message-bubble',
    isAssistantMessage && 'message-bubble--assistant',
    isUserMessage && 'message-bubble--user',
    isNotice && 'message-bubble--notice',
    isFunction && 'message-bubble--processing',
  );

  const rowClasses = classNames(
    'message-row',
    isAssistantMessage && 'message-row--assistant',
    isUserMessage && 'message-row--user',
    isNotice && 'message-row--assistant',
  );

  const wrapperClasses = classNames(
    'message-wrapper',
    isAssistantMessage && 'message-wrapper--assistant',
    isUserMessage && 'message-wrapper--user',
  );

  const markdownContent = transformMessage(content);
  const reasoningContent = reasoning ? transformMessage(reasoning) : null;

  return (
    <div className={wrapperClasses}>
      <div className={rowClasses}>
        <div className={classNames('message-body', isUserMessage && 'message-body--user')}>
          {isAssistantMessage ? (
            <div className="message-avatar message-avatar--assistant">
              <Image src="/avatar-purple-no-shadow.svg" alt="Alga avatar" width={32} height={32} />
            </div>
          ) : null}

          <div className={bubbleClasses}>
            {(isAssistantMessage || isUserMessage) && (
              <div className="message-header">
                <span className="message-author">{authorLabel}</span>
                {statusLabel ? (
                  <span className="message-status" role="status">
                    <span className="message-status__dot" aria-hidden="true" />
                    {statusLabel}
                  </span>
                ) : null}
              </div>
            )}
            <div className="message-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                }}
              >
                {markdownContent}
              </ReactMarkdown>
            </div>

            {reasoningContent ? (
              <details className="message-reasoning">
                <summary>Show assistant reasoning</summary>
                <div className="message-reasoning__content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" />
                      ),
                    }}
                  >
                    {reasoningContent}
                  </ReactMarkdown>
                </div>
              </details>
            ) : null}
          </div>

          {isUserMessage ? (
            <div className="message-avatar message-avatar--user" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '60%', height: '60%' }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
          ) : null}
        </div>
      </div>

      {messageId ? (
        <div
          className={classNames(
            'message-feedback',
            isAssistantMessage ? 'message-feedback--assistant' : 'message-feedback--user',
          )}
        >
          <Feedback messageId={messageId} role={role} />
        </div>
      ) : null}
    </div>
  );
};

export default Message;
