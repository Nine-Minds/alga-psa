import express, { type Express, type RequestHandler } from 'express';

export const healthzHandler: RequestHandler = (_request, response) => {
  response.status(200).json({ status: 'ok' });
};

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.get('/healthz', healthzHandler);

  return app;
}
