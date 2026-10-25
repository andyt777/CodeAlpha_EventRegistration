import { Router } from 'express';
import { hashPassword, verifyPassword } from '../auth.js';
import { HttpError } from '../errors.js';
import * as v from '../validate.js';

export function authRoutes(db, auth) {
  const router = Router();
  const q = {
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insert: db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'),
  };
  const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

  // Anyone can sign up as an attendee or an organizer; admins are created by the seed only.
  router.post('/register', (req, res) => {
    const name = v.string(req.body?.name, 'name', { max: 100 });
    const email = v.email(req.body?.email);
    const password = v.string(req.body?.password, 'password', { min: 6, max: 128 });
    const role = v.oneOf(req.body?.role, 'role', ['attendee', 'organizer'], { fallback: 'attendee' });

    if (q.byEmail.get(email)) throw new HttpError(409, 'An account with this email already exists');
    const id = Number(q.insert.run(name, email, hashPassword(password), role).lastInsertRowid);
    res.status(201).json({ token: auth.issueToken(id), user: { id, name, email, role } });
  });

  router.post('/login', (req, res) => {
    const email = v.email(req.body?.email);
    const password = v.string(req.body?.password, 'password', { max: 128 });
    const user = q.byEmail.get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    res.json({ token: auth.issueToken(user.id), user: publicUser(user) });
  });

  router.post('/logout', auth.requireAuth, (req, res) => {
    auth.revoke(req);
    res.status(204).end();
  });

  router.get('/me', auth.requireAuth, (req, res) => res.json(req.user));

  return router;
}
