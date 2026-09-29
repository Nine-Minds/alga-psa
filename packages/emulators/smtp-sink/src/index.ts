import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { z } from 'zod';
import type { ControlRegistry, EmulatorCore, EmulatorPackage, HostEnv } from '@alga-psa/emulator-host';

/**
 * Structural slice of mailparser's ParsedMail. The repo ships an ambient
 * `any` shim for mailparser (types/mailparser.d.ts) that shadows
 * @types/mailparser, so the parse result is typed locally.
 */
interface ParsedAddressList {
  value: Array<{ address?: string }>;
}

interface ParsedMailSlice {
  from?: { text?: string };
  to?: ParsedAddressList | ParsedAddressList[];
  subject?: string;
  text?: unknown;
  html?: unknown;
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  attachments?: Array<{
    filename?: string;
    contentType: string;
    contentDisposition?: string;
    contentId?: string;
    content: Buffer;
    size: number;
  }>;
}

export interface CapturedAttachment {
  filename: string | null;
  contentType: string;
  contentDisposition: string | null;
  contentId: string | null;
  contentBase64: string;
  size: number;
}

export interface CapturedEmail {
  id: number;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: CapturedAttachment[];
  receivedAt: string;
}

/**
 * SMTP capture (MailHog/Mailpit stand-in): accepts any mail, parses it, and
 * exposes it through state views. Arm `reject-mail` to test delivery-failure
 * handling in outbound email code.
 */
export class SmtpSinkCore implements EmulatorCore {
  readonly emails: CapturedEmail[] = [];
  rejectWithCode: number | null = null;
  private nextId = 1;
  generation = 0;

  constructor(readonly env: HostEnv) {}

  reset(): void {
    this.generation++;
    this.emails.length = 0;
    this.rejectWithCode = null;
    this.nextId = 1;
  }

  capture(input: Omit<CapturedEmail, 'id' | 'receivedAt' | 'messageId' | 'inReplyTo' | 'references' | 'attachments'>
    & Partial<Pick<CapturedEmail, 'messageId' | 'inReplyTo' | 'references' | 'attachments'>>): CapturedEmail {
    const email: CapturedEmail = {
      messageId: null, inReplyTo: null, references: [], attachments: [],
      ...input, id: this.nextId++, receivedAt: this.env.clock.now().toISOString(),
    };
    this.emails.push(email);
    return email;
  }
}

const smtpSinkEmulator: EmulatorPackage<SmtpSinkCore> = {
  id: 'smtp-sink',
  displayName: 'SMTP Sink',
  defaultPort: 4040,

  createCore: (env) => new SmtpSinkCore(env),

  requestHistoryProtocol: 'smtp',
  async serve(core, port, env, journal) {
    const pending = new Map<string, () => void>();
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onClose(session) { pending.get(session.id)?.(); },
      onData(stream, session, callback) {
        const finish = journal.begin();
        const generation = core.generation;
        const rejectCode = core.rejectWithCode;
        let done = false;
        const abort = () => { if (done) return; done = true; pending.delete(session.id); finish(null, true); };
        pending.set(session.id, abort);
        stream.once('error', abort);
        const respond = (error?: Error & { responseCode?: number }) => {
          if (done) return;
          done = true;
          pending.delete(session.id);
          callback(error);
          // smtp-server uses 450 for an error without an explicit responseCode.
          finish(error ? error.responseCode || 450 : 250, false);
        };
        if (rejectCode !== null) {
          stream.on('data', () => undefined);
          stream.on('end', () => {
            const error = new Error('Rejected by smtp-sink fault') as Error & { responseCode: number };
            error.responseCode = rejectCode;
            respond(error);
          });
          return;
        }
        simpleParser(stream)
          .then((mail: ParsedMailSlice) => {
            if (done) return;
            if (generation === core.generation) core.capture({
              from: mail.from?.text ?? '',
              to: (Array.isArray(mail.to) ? mail.to : mail.to ? [mail.to] : []).flatMap((addr) =>
                addr.value.map((v) => v.address ?? ''),
              ),
              subject: mail.subject ?? '',
              text: typeof mail.text === 'string' ? mail.text : '',
              html: typeof mail.html === 'string' ? mail.html : null,
              messageId: mail.messageId ?? null,
              inReplyTo: mail.inReplyTo ?? null,
              references: Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [],
              attachments: (mail.attachments ?? []).map(attachment => ({
                filename: attachment.filename ?? null,
                contentType: attachment.contentType,
                contentDisposition: attachment.contentDisposition ?? null,
                contentId: attachment.contentId ?? null,
                contentBase64: attachment.content.toString('base64'),
                size: attachment.size,
              })),
            });
            respond();
          })
          .catch((error: Error) => {
            env.log('smtp-sink failed to parse message');
            respond(error);
          });
      },
    });

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, () => resolve());
    });
    const address = server.server.address();
    const boundPort = address && typeof address === 'object' ? address.port : port;

    return {
      port: boundPort,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    };
  },

  register(reg: ControlRegistry, core) {
    reg.fault({
      name: 'reject-mail',
      description: 'Refuse incoming messages with an SMTP error code',
      params: z.object({ code: z.number().int().min(400).max(599).default(550) }),
      arm: ({ code }) => {
        core.rejectWithCode = code ?? 550;
      },
      disarm: () => {
        core.rejectWithCode = null;
      },
    });

    reg.action({
      name: 'clear',
      description: 'Drop all captured emails',
      run: () => {
        const dropped = core.emails.length;
        core.emails.length = 0;
        return { dropped };
      },
    });

    reg.stateView({
      name: 'emails',
      description: 'Captured emails, oldest first',
      get: () => core.emails,
    });
  },
};

export default smtpSinkEmulator;
export { smtpSinkEmulator as emulator };
