import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'attendee' CHECK (role IN ('attendee', 'organizer', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    location     TEXT NOT NULL,
    starts_at    TEXT NOT NULL,
    ends_at      TEXT,
    capacity     INTEGER NOT NULL CHECK (capacity > 0),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);

  CREATE TABLE IF NOT EXISTS registrations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
    phone        TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    cancelled_at TEXT,
    UNIQUE (event_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_registrations_user ON registrations(user_id);
`;

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function openDb(file, { seed = false } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  if (seed) seedDemoData(db);
  return db;
}

function seedDemoData(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const admin = addUser.run('Admin', 'admin@example.com', hashPassword('admin123'), 'admin').lastInsertRowid;
  const organizer = addUser.run('Olivia Organizer', 'organizer@example.com', hashPassword('organizer123'), 'organizer').lastInsertRowid;
  addUser.run('Alex Attendee', 'attendee@example.com', hashPassword('attendee123'), 'attendee');

  const day = (n, hour) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const addEvent = db.prepare(`
    INSERT INTO events (organizer_id, title, description, location, starts_at, ends_at, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  addEvent.run(organizer, 'Intro to Node.js Workshop', 'Hands-on workshop: build your first REST API with Express.', 'Online (Zoom)', day(7, 16), day(7, 18), 50);
  addEvent.run(organizer, 'Backend Developers Meetup', 'Talks on databases, caching and API design, followed by networking.', 'Tech Hub, Room 2', day(14, 17), day(14, 20), 30);
  addEvent.run(admin, 'Hackathon 2026', '24-hour hackathon. Teams of up to 4 people. Food included!', 'University Campus, Hall A', day(30, 9), day(31, 9), 100);
  addEvent.run(organizer, 'SQL Masterclass', 'Joins, indexes and query plans explained with real examples.', 'Online (Google Meet)', day(3, 15), day(3, 17), 3);
}
