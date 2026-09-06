import https from 'node:https';
import http from 'node:http';

// The test proxy exposes only the calendar callback at a fixed app destination.
export function createCalendarCallbackServer({ key, cert, targetHost = 'server', targetPort = 3000 }) {
  return https.createServer({ key, cert }, (request, response) => {
    const url = new URL(request.url, 'https://calendar-callback');
    if (url.pathname !== '/api/calendar/webhooks/microsoft') {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const headers = { ...request.headers, host: `${targetHost}:${targetPort}` };
    delete headers.connection;
    delete headers['proxy-authorization'];
    const upstream = http.request({ hostname: targetHost, port: targetPort, path: `${url.pathname}${url.search}`,
      method: 'POST', headers, timeout: 10000 }, result => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
      result.on('error', () => response.destroy());
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Calendar callback timed out')));
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502).end();
      else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
}
