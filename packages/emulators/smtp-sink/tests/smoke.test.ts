import nodemailer from 'nodemailer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import smtpSink from '../src/index';

let host: EmulatorHost;
let control: string;
let transporter: nodemailer.Transporter;

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
  const { controlPort, ports } = await host.start();
  control = `http://127.0.0.1:${controlPort}`;
  transporter = nodemailer.createTransport({
    host: '127.0.0.1',
    port: ports['smtp-sink'],
    secure: false,
    tls: { rejectUnauthorized: false },
  });
});

afterAll(async () => {
  await host.stop();
});

beforeEach(async () => {
  await fetch(`${control}/control/smtp-sink/reset`, { method: 'POST' });
});

describe('smtp sink', () => {
  it('preserves binary attachment bytes and reply headers received over SMTP', async () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80, 0x0a]);
    const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
    await transporter.sendMail({
      from: 'agent@alga.test', to: 'customer@example.test', subject: 'Attachment reply',
      text: 'See the attached invoice.', html: '<p>Invoice</p><img src="cid:logo@alga.test">',
      messageId: '<reply@alga.test>', inReplyTo: '<original@example.test>',
      references: ['<root@example.test>', '<original@example.test>'],
      attachments: [
        { filename: 'invoice.pdf', content: pdf, contentType: 'application/pdf' },
        { filename: 'logo.png', content: logo, contentType: 'image/png', cid: 'logo@alga.test' },
      ],
    });
    const state = await (await fetch(`${control}/control/smtp-sink/state/emails`)).json() as any;
    expect(state.result).toHaveLength(1);
    expect(state.result[0]).toMatchObject({
      messageId: '<reply@alga.test>', inReplyTo: '<original@example.test>',
      references: ['<root@example.test>', '<original@example.test>'],
    });
    // MIME nesting can put related inline parts before ordinary attachments.
    expect(state.result[0].attachments).toHaveLength(2);
    expect(state.result[0].attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: 'invoice.pdf', contentType: 'application/pdf', contentDisposition: 'attachment', size: pdf.length, contentBase64: pdf.toString('base64') }),
      expect.objectContaining({ filename: 'logo.png', contentType: 'image/png', contentDisposition: 'inline', contentId: '<logo@alga.test>', size: logo.length, contentBase64: logo.toString('base64') }),
    ]));
    await fetch(`${control}/control/smtp-sink/reset`, { method: 'POST' });
    expect((await (await fetch(`${control}/control/smtp-sink/state/emails`)).json() as any).result).toEqual([]);
  });

  it('captures and parses delivered mail', async () => {
    await transporter.sendMail({
      from: 'Alga <noreply@alga.test>',
      to: 'customer@example.test',
      subject: 'Invoice #42',
      text: 'Your invoice is attached.',
      html: '<p>Your invoice is attached.</p>',
    });

    const state = (await (await fetch(`${control}/control/smtp-sink/state/emails`)).json()) as any;
    expect(state.result).toHaveLength(1);
    expect(state.result[0]).toMatchObject({
      to: ['customer@example.test'],
      subject: 'Invoice #42',
    });
    expect(state.result[0].from).toContain('noreply@alga.test');
    expect(state.result[0].text).toContain('Your invoice is attached.');
    expect(state.result[0].html).toContain('<p>');
  });

  it('rejects mail while the reject-mail fault is armed', async () => {
    await fetch(`${control}/control/smtp-sink/faults/reject-mail/arm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 552 }),
    });
    await expect(
      transporter.sendMail({ from: 'a@alga.test', to: 'b@example.test', subject: 'nope', text: 'x' }),
    ).rejects.toMatchObject({ responseCode: 552 });

    await fetch(`${control}/control/smtp-sink/faults/reject-mail/disarm`, { method: 'POST' });
    await transporter.sendMail({ from: 'a@alga.test', to: 'b@example.test', subject: 'ok now', text: 'x' });

    const state = (await (await fetch(`${control}/control/smtp-sink/state/emails`)).json()) as any;
    expect(state.result.map((email: any) => email.subject)).toContain('ok now');
  });

  it('resets cleanly', async () => {
    await fetch(`${control}/control/smtp-sink/reset`, { method: 'POST' });
    const state = (await (await fetch(`${control}/control/smtp-sink/state/emails`)).json()) as any;
    expect(state.result).toHaveLength(0);
  });
});
