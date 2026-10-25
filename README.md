# CodeAlpha Event Registration System

A REST API and web app for publishing events and managing registrations, built with **Express.js** and **SQLite**. This is CodeAlpha Backend Development, Task 2.

Attendees can browse events, register through a form, view their registrations and cancel them. Organizers log in to create, edit and delete their events and to see the attendee list.

## Features

- **Models**: users, sessions, events, registrations, with foreign keys and constraints
- **Authentication**: sign up and log in with salted `scrypt` password hashes and bearer tokens (only SHA-256 hashes of the tokens are stored)
- **Roles**: `attendee`, `organizer`, `admin`. Only organizers and admins can manage events, and organizers can only manage their own.
- **Event APIs**: list with search, upcoming/past filter and pagination; event details with seats left
- **Registration APIs**: submit a registration form (phone, notes); view or cancel your own registrations
- **Business rules**:
  - capacity is enforced inside a database transaction, so two people can't take the last seat
  - no duplicate registrations; a cancelled registration can be re-activated
  - you can't register for, or cancel, an event that has already started
  - capacity can't be reduced below the number of people already registered
- **Organizer dashboard** (optional task item): create, edit and delete events, and see the attendee list
- **Frontend**: plain HTML/CSS/JS single page
- **Automated API tests** with `node:test`

## Frontend

**Gatherly** is a landing page that also works as the app, built for sign-ups.

- **Hero**: a benefit headline and a short sign-up form (`POST /api/auth/register`), visible without scrolling, next to the next two real upcoming events.
- **Form states**: fields are validated in the browser; the button shows a spinner while the request runs; on success a welcome card replaces the form; server errors appear under the matching field.
- **Social proof**: live counts of upcoming events, seats booked and organizers.
- **Page sections**: 3 outcome-focused benefits, 3 steps, a call-to-action for organizers, a FAQ accordion with 4 objections, and a closing call-to-action.
- **Events**: cards with a date block, seats-left bar and status badges. The detail view registers you in one click. If you aren't logged in yet, you sign up first and then go straight back to that event.
- **My tickets** (`#/tickets`): upcoming and past tabs, with cancellation behind a confirm dialog.
- **Organizer dashboard** (`#/organizer`): stats and fill rate, create/edit event modal, attendee list with **CSV export**.

## Tech stack

Node.js 22.13+ (tested on 24), Express 5, SQLite via the built-in `node:sqlite`, and plain HTML/CSS/JS. The only npm dependency is `express`.

## Getting started

```bash
npm install
npm start        # http://localhost:3000
npm run dev      # auto-restart on changes
npm test         # API tests (in-memory database)
```

On first start the database is filled with demo data:

| Role      | Email                   | Password       |
|-----------|-------------------------|----------------|
| Admin     | admin@example.com       | admin123       |
| Organizer | organizer@example.com   | organizer123   |
| Attendee  | attendee@example.com    | attendee123    |

Environment variables: `PORT` (default `3000`), `DB_FILE` (default `data/events.db`), `SEED=false` to skip demo data.

## API

Send the token from login or register as `Authorization: Bearer <token>`.

### Auth

| Method | Path                  | Auth | Description                                         |
|--------|-----------------------|------|-----------------------------------------------------|
| POST   | `/api/auth/register`  | –    | `{ name, email, password, role? }` (`attendee` / `organizer`) |
| POST   | `/api/auth/login`     | –    | `{ email, password }` → `{ token, user }`            |
| GET    | `/api/auth/me`        | ✔    | Current user                                         |
| POST   | `/api/auth/logout`    | ✔    | Invalidate the token                                 |

### Events

| Method | Path                               | Auth              | Description |
|--------|------------------------------------|-------------------|-------------|
| GET    | `/api/events`                      | optional          | `?search=&when=upcoming\|past\|all&mine=true&page=&limit=` |
| GET    | `/api/events/:id`                  | optional          | Event details, `seatsLeft`, `myRegistrationId` |
| POST   | `/api/events`                      | organizer / admin | `{ title, description?, location, startsAt, endsAt?, capacity }` |
| PATCH  | `/api/events/:id`                  | owner / admin     | Partial update |
| DELETE | `/api/events/:id`                  | owner / admin     | Delete the event and its registrations |
| GET    | `/api/events/:id/registrations`    | owner / admin     | Attendee list |

### Registrations

| Method | Path                               | Auth | Description |
|--------|------------------------------------|------|-------------|
| POST   | `/api/events/:id/registrations`    | ✔    | Register: `{ phone?, notes? }` |
| GET    | `/api/registrations`               | ✔    | My registrations (`?status=registered\|cancelled`) |
| GET    | `/api/registrations/:id`           | ✔    | One registration |
| DELETE | `/api/registrations/:id`           | ✔    | Cancel (kept with status `cancelled`) |

Errors always look like `{ "error": "message" }`, with status codes `400` validation, `401` not logged in, `403` not allowed, `404` not found, and `409` conflict (full, duplicate).

### Example

```bash
# log in
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"attendee@example.com","password":"attendee123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

# register for event 1
curl -X POST localhost:3000/api/events/1/registrations -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"phone":"0700 000 000"}'

# my registrations
curl localhost:3000/api/registrations -H "Authorization: Bearer $TOKEN"
```

## Database schema

```
users (id, name, email UNIQUE, password_hash, role, created_at)
sessions (token_hash PK, user_id → users, expires_at)
events (id, organizer_id → users, title, description, location, starts_at, ends_at, capacity, created_at)
registrations (id, event_id → events, user_id → users, status, phone, notes, created_at, cancelled_at,
               UNIQUE(event_id, user_id))
```

## Project structure

```
src/
  server.js             # entry point
  app.js                # Express app wiring
  db.js                 # schema, transactions, demo seed
  auth.js               # password hashing, tokens, auth middleware
  validate.js           # input validation helpers
  errors.js             # HttpError + error handler
  routes/
    auth.js
    events.js
    registrations.js
public/                 # frontend: index.html, css/base.css + css/app.css, js/ui.js + js/app.js
test/                   # API tests
```
