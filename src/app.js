import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { registrationRoutes } from './routes/registrations.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db) {
  const app = express();
  const auth = createAuth(db);
  const registrations = registrationRoutes(db, auth);

  app.use(express.json());
  app.use(express.static(publicDir));
  app.use('/api', auth.authenticate);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes(db, auth));
  app.post('/api/events/:id/registrations', auth.requireAuth, registrations.register);
  app.use('/api/events', eventRoutes(db, auth));
  app.use('/api/registrations', registrations.router);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
