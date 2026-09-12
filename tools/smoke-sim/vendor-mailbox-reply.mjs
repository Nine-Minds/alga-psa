// Stands in for a real vendor's mail client: reads the newest message the
// product actually sent to the vendor mailbox over IMAP (GreenMail), then
// replies to it over SMTP the way a vendor would -- quoting the original body
// (which carries the ALGA-REPLY-TOKEN), setting In-Reply-To/References, and
// carrying the Authentication-Results header our receiving MTA would stamp.
//
// Everything downstream of the SMTP send is the real product: the IMAP
// poller (services/email-service), the /api/email/webhooks/imap route, the
// durable ingress + V2 stager, and named-conversation reply admission.
//
// Env:
//   VENDOR_ADDR   vendor mailbox (GreenMail login == password == address)
//   HELPDESK_ADDR product mailbox to reply to        (default helpdesk@browsertest.test)
//   AUTH_MODE     pass | fail | none | forged-noauth   (default pass)
//   BODY          reply body text
//   IMAP_HOST/IMAP_PORT/SMTP_HOST/SMTP_PORT          (default localhost 3143/3025)
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

const VENDOR = process.env.VENDOR_ADDR;
const HELPDESK = process.env.HELPDESK_ADDR || 'helpdesk@browsertest.test';
const AUTH_MODE = process.env.AUTH_MODE || 'pass';
const BODY = process.env.BODY || 'Vendor smoke reply.';
if (!VENDOR) throw new Error('VENDOR_ADDR is required');

const imap = new ImapFlow({
  host: process.env.IMAP_HOST || 'localhost',
  port: Number(process.env.IMAP_PORT || 3143),
  secure: false,
  auth: { user: VENDOR, pass: VENDOR },
  logger: false,
});
await imap.connect();
const lock = await imap.getMailboxLock('INBOX');
let source;
try {
  const total = imap.mailbox.exists;
  if (!total) throw new Error(`No mail in ${VENDOR}`);
  const msg = await imap.fetchOne(String(total), { source: true });
  source = await simpleParser(msg.source);
} finally {
  lock.release();
  await imap.logout();
}

const originalId = source.messageId;
const subject = source.subject || '';
const replyTo = source.replyTo?.value?.[0]?.address || HELPDESK;
const quoted = (source.text || '').split('\n').map((l) => `> ${l}`).join('\n');
console.log('SOURCE message-id =', originalId);
console.log('SOURCE subject    =', subject);
console.log('REPLYING to       =', replyTo);

const vendorDomain = VENDOR.split('@')[1];
const authHeaders = {
  pass: `mx.browsertest.test; spf=pass smtp.mailfrom=${VENDOR}; dkim=pass header.d=${vendorDomain}; dmarc=pass header.from=${vendorDomain}`,
  fail: `mx.browsertest.test; spf=fail smtp.mailfrom=${VENDOR}; dkim=fail header.d=${vendorDomain}; dmarc=fail header.from=${vendorDomain}`,
  none: null,
  // No MTA verdict at all, but processor-only list-rewrite metadata forged by
  // the sender: this is the case the header-bag security strip has to kill,
  // because isVerifiedListRewrite would otherwise waive sender attribution.
  'forged-noauth': null,
}[AUTH_MODE];
if (authHeaders === undefined) throw new Error(`Unknown AUTH_MODE ${AUTH_MODE}`);

const headers = {};
if (authHeaders) headers['Authentication-Results'] = authHeaders;
if (AUTH_MODE === 'forged-noauth') {
  // An attacker stamping processor-only metadata on their own message: the
  // header bag must drop these before isVerifiedListRewrite ever reads them.
  headers['X-Resolved-Original-Sender'] = 'browsertest-msp@example.test';
  headers['X-Resolved-Original-Sender-Via'] = 'forged';
  headers['X-List-Address'] = 'lists.vendor.test';
}

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 3025),
  secure: false,
  tls: { rejectUnauthorized: false },
});
const messageId = `<vendor-smoke-${Date.now()}@${vendorDomain}>`;
const info = await transport.sendMail({
  from: source.to?.value?.[0]?.name ? `${source.to.value[0].name} <${VENDOR}>` : VENDOR,
  to: replyTo,
  subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
  inReplyTo: originalId,
  references: [originalId],
  messageId,
  text: `${BODY}\n\n${quoted}\n`,
  headers,
});
console.log('SENT message-id   =', messageId);
console.log('SMTP response     =', info.response);
