import { Router } from 'express';
import { HttpError } from '../errors.js';
import { transaction } from '../db.js';
import * as v from '../validate.js';

const REGISTRATION_SELECT = `
  SELECT r.*, e.title, e.location, e.starts_at, e.ends_at, e.organizer_id
  FROM registrations r JOIN events e ON e.id = r.event_id`;

function presentRegistration(row) {
  return {
    id: row.id,
    status: row.status,
    phone: row.phone,
    notes: row.notes,
    registeredAt: row.created_at,
    cancelledAt: row.cancelled_at,
    event: {
      id: row.event_id,
      title: row.title,
      location: row.location,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    },
  };
}

export function registrationRoutes(db, auth) {
  const q = {
    event: db.prepare('SELECT * FROM events WHERE id = ?'),
    countActive: db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status = 'registered'"),
    existing: db.prepare('SELECT * FROM registrations WHERE event_id = ? AND user_id = ?'),
    insert: db.prepare('INSERT INTO registrations (event_id, user_id, phone, notes) VALUES (?, ?, ?, ?)'),
    reactivate: db.prepare(`
      UPDATE registrations
      SET status = 'registered', phone = ?, notes = ?, cancelled_at = NULL,
          created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`),
    cancel: db.prepare(`
      UPDATE registrations SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`),
    one: db.prepare(`${REGISTRATION_SELECT} WHERE r.id = ?`),
  };

  const loadOwned = (id, user) => {
    const row = q.one.get(id);
    if (!row) throw new HttpError(404, 'Registration not found');
    const allowed = row.user_id === user.id || row.organizer_id === user.id || user.role === 'admin';
    if (!allowed) throw new HttpError(404, 'Registration not found');
    return row;
  };

  // Mounted at /api/events/:eventId/registrations (POST) — submit the registration form.
  const register = (req, res) => {
    const eventId = v.id(req.params.id, 'event id');
    const phone = v.string(req.body?.phone, 'phone', { required: false, max: 30 });
    const notes = v.string(req.body?.notes, 'notes', { required: false, max: 1000 });

    // Capacity check and insert run in one transaction so two people can't take the last seat.
    const { id, created } = transaction(db, () => {
      const event = q.event.get(eventId);
      if (!event) throw new HttpError(404, 'Event not found');
      if (event.starts_at <= new Date().toISOString()) throw new HttpError(400, 'This event has already started');

      const existing = q.existing.get(eventId, req.user.id);
      if (existing?.status === 'registered') throw new HttpError(409, 'You are already registered for this event');
      if (q.countActive.get(eventId).n >= event.capacity) throw new HttpError(409, 'This event is full');

      if (existing) {
        q.reactivate.run(phone, notes, existing.id);
        return { id: existing.id, created: false };
      }
      return { id: Number(q.insert.run(eventId, req.user.id, phone, notes).lastInsertRowid), created: true };
    });

    res.status(created ? 201 : 200).json(presentRegistration(q.one.get(id)));
  };

  const router = Router();
  router.use(auth.requireAuth);

  // GET /api/registrations?status=registered|cancelled — the current user's registrations
  router.get('/', (req, res) => {
    const status = v.oneOf(req.query.status, 'status', ['registered', 'cancelled'], { required: false });
    const rows = db
      .prepare(`${REGISTRATION_SELECT} WHERE r.user_id = ? ${status ? 'AND r.status = ?' : ''} ORDER BY e.starts_at`)
      .all(...[req.user.id, status].filter(Boolean));
    res.json(rows.map(presentRegistration));
  });

  router.get('/:id', (req, res) => {
    res.json(presentRegistration(loadOwned(v.id(req.params.id), req.user)));
  });

  // Cancel a registration (kept in the database with status "cancelled").
  router.delete('/:id', (req, res) => {
    const row = loadOwned(v.id(req.params.id), req.user);
    if (row.status === 'cancelled') throw new HttpError(409, 'This registration is already cancelled');
    if (row.starts_at <= new Date().toISOString()) throw new HttpError(400, "You can't cancel after the event has started");
    q.cancel.run(row.id);
    res.json(presentRegistration(q.one.get(row.id)));
  });

  return { router, register };
}
