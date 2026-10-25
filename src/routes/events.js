import { Router } from 'express';
import { HttpError } from '../errors.js';
import { transaction } from '../db.js';
import * as v from '../validate.js';

const EVENT_SELECT = `
  SELECT e.*, u.name AS organizer_name,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') AS registered_count,
    (SELECT r.id FROM registrations r WHERE r.event_id = e.id AND r.user_id = :uid AND r.status = 'registered') AS my_registration_id
  FROM events e JOIN users u ON u.id = e.organizer_id`;

export function presentEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    registeredCount: row.registered_count,
    seatsLeft: Math.max(row.capacity - row.registered_count, 0),
    isFull: row.registered_count >= row.capacity,
    hasStarted: row.starts_at <= new Date().toISOString(),
    organizer: { id: row.organizer_id, name: row.organizer_name },
    myRegistrationId: row.my_registration_id ?? null,
    createdAt: row.created_at,
  };
}

export function eventRoutes(db, auth) {
  const router = Router();
  const q = {
    one: db.prepare(`${EVENT_SELECT} WHERE e.id = :id`),
    insert: db.prepare(`
      INSERT INTO events (organizer_id, title, description, location, starts_at, ends_at, capacity)
      VALUES (:organizer_id, :title, :description, :location, :starts_at, :ends_at, :capacity)`),
    update: db.prepare(`
      UPDATE events SET title = :title, description = :description, location = :location,
        starts_at = :starts_at, ends_at = :ends_at, capacity = :capacity
      WHERE id = :id`),
    remove: db.prepare('DELETE FROM events WHERE id = ?'),
    attendees: db.prepare(`
      SELECT r.id, r.status, r.phone, r.notes, r.created_at, r.cancelled_at, u.id AS user_id, u.name, u.email
      FROM registrations r JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ? ORDER BY r.created_at`),
  };

  const loadEvent = (id, user) => {
    const row = q.one.get({ id, uid: user?.id ?? 0 });
    if (!row) throw new HttpError(404, 'Event not found');
    return row;
  };

  const assertCanManage = (row, user) => {
    if (user.role !== 'admin' && row.organizer_id !== user.id) {
      throw new HttpError(403, 'Only the event organizer can do this');
    }
  };

  // Validates a full event payload; `current` supplies defaults for partial updates.
  const readEventBody = (body = {}, current = {}) => {
    const pick = (key, fallback) => (body[key] !== undefined ? body[key] : fallback);
    const event = {
      title: v.string(pick('title', current.title), 'title', { max: 150 }),
      description: v.string(pick('description', current.description), 'description', { required: false, max: 5000 }) ?? '',
      location: v.string(pick('location', current.location), 'location', { max: 200 }),
      starts_at: v.date(pick('startsAt', current.starts_at), 'startsAt'),
      ends_at: v.date(pick('endsAt', current.ends_at), 'endsAt', { required: false }),
      capacity: v.integer(pick('capacity', current.capacity), 'capacity', { min: 1, max: 100000 }),
    };
    if (event.ends_at && event.ends_at <= event.starts_at) {
      throw new HttpError(400, '"endsAt" must be after "startsAt"');
    }
    return event;
  };

  // GET /api/events?search=&when=upcoming|past|all&mine=true&page=&limit=
  router.get('/', (req, res) => {
    const when = v.oneOf(req.query.when, 'when', ['upcoming', 'past', 'all'], { fallback: 'upcoming' });
    const page = v.integer(req.query.page, 'page', { required: false, min: 1 }) ?? 1;
    const limit = v.integer(req.query.limit, 'limit', { required: false, min: 1, max: 100 }) ?? 20;
    const search = v.string(req.query.search, 'search', { required: false, max: 100 });

    // node:sqlite rejects named parameters that the SQL doesn't use, so only add what's referenced.
    const where = [];
    const params = {};
    if (when !== 'all') {
      where.push(when === 'upcoming' ? 'e.starts_at > :now' : 'e.starts_at <= :now');
      params.now = new Date().toISOString();
    }
    if (search) {
      where.push('(e.title LIKE :search OR e.description LIKE :search OR e.location LIKE :search)');
      params.search = `%${search}%`;
    }
    if (req.query.mine === 'true') {
      if (!req.user) throw new HttpError(401, 'Authentication required');
      where.push('e.organizer_id = :organizer');
      params.organizer = req.user.id;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = when === 'past' ? 'DESC' : 'ASC';

    const total = db.prepare(`SELECT COUNT(*) AS n FROM events e ${whereSql}`).get(params).n;
    const rows = db
      .prepare(`${EVENT_SELECT} ${whereSql} ORDER BY e.starts_at ${order} LIMIT :limit OFFSET :offset`)
      .all({ ...params, uid: req.user?.id ?? 0, limit, offset: (page - 1) * limit });

    res.json({ data: rows.map(presentEvent), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  router.get('/:id', (req, res) => {
    res.json(presentEvent(loadEvent(v.id(req.params.id), req.user)));
  });

  router.post('/', auth.requireRole('organizer', 'admin'), (req, res) => {
    const event = readEventBody(req.body);
    if (event.starts_at <= new Date().toISOString()) throw new HttpError(400, '"startsAt" must be in the future');
    const id = Number(q.insert.run({ ...event, organizer_id: req.user.id }).lastInsertRowid);
    res.status(201).json(presentEvent(loadEvent(id, req.user)));
  });

  router.patch('/:id', auth.requireRole('organizer', 'admin'), (req, res) => {
    const id = v.id(req.params.id);
    transaction(db, () => {
      const current = loadEvent(id, req.user);
      assertCanManage(current, req.user);
      const event = readEventBody(req.body, current);
      if (event.capacity < current.registered_count) {
        throw new HttpError(409, `Capacity can't be lower than the ${current.registered_count} people already registered`);
      }
      q.update.run({ ...event, id });
    });
    res.json(presentEvent(loadEvent(id, req.user)));
  });

  router.delete('/:id', auth.requireRole('organizer', 'admin'), (req, res) => {
    const id = v.id(req.params.id);
    assertCanManage(loadEvent(id, req.user), req.user);
    q.remove.run(id);
    res.status(204).end();
  });

  // Attendee list for the organizer.
  router.get('/:id/registrations', auth.requireRole('organizer', 'admin'), (req, res) => {
    const id = v.id(req.params.id);
    assertCanManage(loadEvent(id, req.user), req.user);
    res.json(
      q.attendees.all(id).map((r) => ({
        id: r.id,
        status: r.status,
        phone: r.phone,
        notes: r.notes,
        registeredAt: r.created_at,
        cancelledAt: r.cancelled_at,
        user: { id: r.user_id, name: r.name, email: r.email },
      })),
    );
  });

  return router;
}
