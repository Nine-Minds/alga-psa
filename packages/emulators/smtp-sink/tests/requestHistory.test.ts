import net from 'node:net';
import nodemailer from 'nodemailer';
import { afterEach, expect, it } from 'vitest';
import { EmulatorHost } from '../../host/src/host';
import smtpSink, { SmtpSinkCore } from '../src/index';

let host: EmulatorHost;
const sockets: net.Socket[] = [];
afterEach(async () => { sockets.splice(0).forEach(s => s.destroy()); await host?.stop(); });
async function setup(capacity = 1000, emulator = smtpSink) {
  host = new EmulatorHost({ emulators: [emulator], controlPort: 0, ports: { 'smtp-sink': 0 }, requestHistoryLimit: capacity });
  const { controlPort, ports } = await host.start();
  const base = `http://127.0.0.1:${controlPort}/control/smtp-sink`;
  const read = async () => (await (await fetch(`${base}/requests`)).json()).result;
  const reset = () => fetch(`${base}/reset`, { method: 'POST' });
  const mail = () => nodemailer.createTransport({ host: '127.0.0.1', port: ports['smtp-sink'], secure: false }).sendMail({ from: 'private-sender@example.test', to: 'private-recipient@example.test', subject: 'private-subject', text: 'private-body' });
  return { base, read, reset, mail, port: ports['smtp-sink'] };
}
async function pendingData(port: number) {
  const socket = net.connect(port, '127.0.0.1'); sockets.push(socket);
  let buffer = ''; const replies: string[] = []; let wake: (() => void) | undefined;
  socket.on('data', bytes => { buffer += bytes.toString(); let end; while ((end = buffer.indexOf('\r\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (/^\d{3} /.test(line)) replies.push(line); } wake?.(); });
  const reply = async (code: number) => {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('SMTP reply deadline')), 3000); const check = () => { if (replies.length) { clearTimeout(timer); resolve(); } }; wake = check; check(); });
    expect(replies.shift()).toMatch(new RegExp(`^${code} `));
  };
  await reply(220);
  for (const [command, code] of [['EHLO local', 250], ['MAIL FROM:<private-sender@example.test>', 250], ['RCPT TO:<private-recipient@example.test>', 250], ['DATA', 354]] as const) { socket.write(command + '\r\n'); await reply(code); }
  socket.write('Subject: private-subject\r\n\r\nprivate-body');
  return { socket, reply };
}
it('journals real accepted and rejected DATA outcomes without message data', async () => {
  const { base, read, mail } = await setup();
  expect((await mail()).response).toMatch(/^250 /);
  await fetch(`${base}/faults/reject-mail/arm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 552 }) });
  await expect(mail()).rejects.toMatchObject({ responseCode: 552 });
  const journal = await read();
  expect(journal).toMatchObject({ supported: true, complete: true, inFlight: 0, dropped: 0 });
  expect(journal.requests).toEqual([250, 552].map((status, i) => ({ protocol: 'smtp', command: 'DATA', sequence: i + 1, status, aborted: false, startedAt: expect.any(String), durationMs: expect.any(Number) })));
  expect(JSON.stringify(journal)).not.toContain('private-');
});
it('reports in-flight DATA, aborted sockets, bounded drops and reset generation isolation', async () => {
  const { read, mail, reset, port, base } = await setup(1);
  const abandoned = await pendingData(port);
  expect(await read()).toMatchObject({ supported: true, complete: false, inFlight: 1 });
  abandoned.socket.destroy();
  await expect.poll(async () => (await read()).requests).toMatchObject([{ protocol: 'smtp', command: 'DATA', status: null, aborted: true }]);
  await mail();
  expect(await read()).toMatchObject({ complete: false, dropped: 1, inFlight: 0 });
  const old = await pendingData(port);
  const generation = (await read()).generation;
  await reset();
  old.socket.write('\r\n.\r\n'); await old.reply(250);
  expect(await read()).toMatchObject({ generation: generation + 1, complete: true, inFlight: 0, dropped: 0, requests: [] });
  expect((await (await fetch(`${base}/state/emails`)).json()).result).toEqual([]);
  await mail();
  expect((await read()).requests).toMatchObject([{ sequence: 1, status: 250, aborted: false }]);
});

it('records the actual default 450 reply when DATA processing fails without an SMTP code', async () => {
  class FailingCapture extends SmtpSinkCore {
    override capture(): never { throw new Error('private-processing-detail'); }
  }
  const { read, mail } = await setup(1000, { ...smtpSink, createCore: env => new FailingCapture(env) });
  await expect(mail()).rejects.toMatchObject({ responseCode: 450 });
  expect(await read()).toMatchObject({ complete: true, inFlight: 0, requests: [{ protocol: 'smtp', command: 'DATA', status: 450, aborted: false }] });
  expect(JSON.stringify(await read())).not.toContain('private-');
});
