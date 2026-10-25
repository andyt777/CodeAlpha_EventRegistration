import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signUp(name, role) {
  const email = `${name.toLowerCase()}@test.com`;
  const res = await call('POST', '/api/auth/register', { body: { name, email, password: 'secret123', role } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.token;
}

const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();

let organizer;
let alice;
let bob;
let carol;
let eventId;

test('users can sign up, log in and see their profile', async () => {
  organizer = await signUp('Org', 'organizer');
  alice = await signUp('Alice');
  bob = await signUp('Bob');
  carol = await signUp('Carol');

  const dup = await call('POST', '/api/auth/register', { body: { name: 'X', email: 'alice@test.com', password: 'secret123' } });
  assert.equal(dup.status, 409);

  const bad = await call('POST', '/api/auth/login', { body: { email: 'alice@test.com', password: 'wrong-pass' } });
  assert.equal(bad.status, 401);

  const login = await call('POST', '/api/auth/login', { body: { email: 'alice@test.com', password: 'secret123' } });
  assert.equal(login.status, 200);
  const me = await call('GET', '/api/auth/me', { token: login.body.token });
  assert.equal(me.body.role, 'attendee');
});

test('only organizers can create events', async () => {
  const payload = { title: 'Node Meetup', location: 'Online', startsAt: inDays(5), capacity: 2 };
  assert.equal((await call('POST', '/api/events', { body: payload })).status, 401);
  assert.equal((await call('POST', '/api/events', { token: alice, body: payload })).status, 403);

  const bad = await call('POST', '/api/events', { token: organizer, body: { ...payload, startsAt: inDays(-1) } });
  assert.equal(bad.status, 400);

  const res = await call('POST', '/api/events', { token: organizer, body: payload });
  assert.equal(res.status, 201);
  assert.equal(res.body.seatsLeft, 2);
  eventId = res.body.id;
});

test('lists events and shows event details', async () => {
  const list = await call('GET', '/api/events');
  assert.equal(list.status, 200);
  assert.equal(list.body.pagination.total, 1);
  assert.equal(list.body.data[0].title, 'Node Meetup');

  const all = await call('GET', '/api/events?when=all&search=meetup');
  assert.equal(all.body.data.length, 1);

  const detail = await call('GET', `/api/events/${eventId}`);
  assert.equal(detail.body.organizer.name, 'Org');
  assert.equal((await call('GET', '/api/events/9999')).status, 404);
});

test('registration respects capacity and duplicates', async () => {
  const first = await call('POST', `/api/events/${eventId}/registrations`, { token: alice, body: { phone: '0700000000' } });
  assert.equal(first.status, 201);
  assert.equal(first.body.event.id, eventId);

  assert.equal((await call('POST', `/api/events/${eventId}/registrations`, { token: alice })).status, 409);
  assert.equal((await call('POST', `/api/events/${eventId}/registrations`, { token: bob })).status, 201);

  const full = await call('POST', `/api/events/${eventId}/registrations`, { token: carol });
  assert.equal(full.status, 409);
  assert.match(full.body.error, /full/);

  const detail = await call('GET', `/api/events/${eventId}`, { token: alice });
  assert.equal(detail.body.seatsLeft, 0);
  assert.equal(detail.body.myRegistrationId, first.body.id);
});

test('users can view and cancel their registrations, freeing the seat', async () => {
  const mine = await call('GET', '/api/registrations', { token: alice });
  assert.equal(mine.body.length, 1);
  const regId = mine.body[0].id;

  // Bob can't see or cancel Alice's registration.
  assert.equal((await call('DELETE', `/api/registrations/${regId}`, { token: bob })).status, 404);

  const cancelled = await call('DELETE', `/api/registrations/${regId}`, { token: alice });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await call('DELETE', `/api/registrations/${regId}`, { token: alice })).status, 409);

  assert.equal((await call('POST', `/api/events/${eventId}/registrations`, { token: carol })).status, 201);

  // Carol took the seat, so Alice can't come back until someone else cancels.
  assert.equal((await call('POST', `/api/events/${eventId}/registrations`, { token: alice })).status, 409);
});

test('organizer sees attendees and cannot shrink capacity below registrations', async () => {
  const attendees = await call('GET', `/api/events/${eventId}/registrations`, { token: organizer });
  assert.equal(attendees.status, 200);
  assert.equal(attendees.body.filter((r) => r.status === 'registered').length, 2);

  assert.equal((await call('GET', `/api/events/${eventId}/registrations`, { token: alice })).status, 403);

  const shrink = await call('PATCH', `/api/events/${eventId}`, { token: organizer, body: { capacity: 1 } });
  assert.equal(shrink.status, 409);

  const grow = await call('PATCH', `/api/events/${eventId}`, { token: organizer, body: { capacity: 3 } });
  assert.equal(grow.status, 200);
  assert.equal(grow.body.seatsLeft, 1);

  // A cancelled registration can be re-activated when there is room again.
  const again = await call('POST', `/api/events/${eventId}/registrations`, { token: alice });
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'registered');
});

test('deleting an event removes its registrations', async () => {
  assert.equal((await call('DELETE', `/api/events/${eventId}`, { token: alice })).status, 403);
  assert.equal((await call('DELETE', `/api/events/${eventId}`, { token: organizer })).status, 204);
  const mine = await call('GET', '/api/registrations', { token: bob });
  assert.equal(mine.body.length, 0);
});

test('logout invalidates the token', async () => {
  assert.equal((await call('POST', '/api/auth/logout', { token: bob })).status, 204);
  assert.equal((await call('GET', '/api/auth/me', { token: bob })).status, 401);
});
