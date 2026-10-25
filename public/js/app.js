import {
  $, $$, h, api, icon, iconEl, hydrateIcons, toast, withLoading, validate, rules, showFormError,
  clearFormErrors, confirmDialog, countUp, colorFor, initials, fmt, singleOpenFaq, enableBackdropClose, session,
} from './ui.js';

const state = {
  user: null,
  when: 'upcoming',
  search: '',
  ticketTab: 'upcoming',
  pendingAction: null, // run after the visitor logs in / signs up (e.g. register for the event they clicked)
};

const isOrganizer = () => ['organizer', 'admin'].includes(state.user?.role);
const firstName = (name) => String(name).split(' ')[0];
const nowIso = () => new Date().toISOString();

// ---------- small view helpers ----------
function dateBlock(iso) {
  const d = new Date(iso);
  return h('div', { className: 'date-block', 'aria-hidden': 'true' },
    h('span', { className: 'm' }, d.toLocaleString('en-US', { month: 'short' }).toUpperCase()),
    h('span', { className: 'd' }, d.getDate()),
  );
}

function coverStyle(title) {
  return { background: `linear-gradient(135deg, ${colorFor(title)} 0%, ${colorFor(`${title}·`)} 100%)` };
}

function timeRange(event) {
  const start = fmt.dateTime(event.startsAt);
  return event.endsAt ? `${start} – ${fmt.time(event.endsAt)}` : start;
}

function seatsBar(event) {
  const pct = Math.min(100, Math.round((event.registeredCount / event.capacity) * 100));
  return h('div', { className: 'seats' },
    h('div', { className: `seats-bar ${pct >= 80 ? 'hot' : ''}` }, h('span', { style: { width: `${pct}%` } })),
    h('div', { className: 'seats-text' },
      h('span', {}, h('strong', {}, fmt.number(event.registeredCount)), ` going`),
      h('span', {}, event.isFull ? 'Sold out' : `${fmt.number(event.seatsLeft)} seats left`),
    ),
  );
}

function statusBadge(event) {
  if (event.myRegistrationId) return h('span', { className: 'badge green' }, iconEl('check', 12), "You're going");
  if (event.hasStarted) return h('span', { className: 'badge' }, 'Ended');
  if (event.isFull) return h('span', { className: 'badge red' }, 'Sold out');
  if (event.seatsLeft <= 5) return h('span', { className: 'badge amber' }, `Only ${event.seatsLeft} left`);
  return null;
}

// ---------- header ----------
function renderHeader() {
  const box = $('#header-actions');
  if (!state.user) {
    box.replaceChildren(
      h('button', { className: 'btn btn-ghost btn-sm', onClick: () => openAuth('login') }, 'Log in'),
      h('button', { className: 'btn btn-cta btn-sm', onClick: goToSignup }, 'Sign up free'),
    );
    return;
  }
  box.replaceChildren(...[
    h('a', { className: 'btn btn-ghost btn-sm hide-sm', href: '#/tickets' }, iconEl('ticket', 16), 'My tickets'),
    isOrganizer() && h('a', { className: 'btn btn-ghost btn-sm hide-sm', href: '#/organizer' }, iconEl('grid', 16), 'Dashboard'),
    h('div', { className: 'user-chip' },
      h('span', { className: 'name' }, firstName(state.user.name)),
      h('span', { className: 'avatar', style: { background: colorFor(state.user.email) } }, initials(state.user.name)),
      h('button', { className: 'icon-btn', title: 'Log out', 'aria-label': 'Log out', html: icon('logout', 16), onClick: logout }),
    ),
  ].filter(Boolean));
}

// ---------- routing ----------
function route() {
  const page = location.hash.replace(/^#\/?/, '') || 'home';
  const target = { home: 'page-home', tickets: 'page-tickets', organizer: 'page-organizer' }[page] ?? 'page-home';
  if ((page === 'tickets' && !state.user) || (page === 'organizer' && !isOrganizer())) {
    location.hash = '#/';
    if (!state.user) openAuth('login');
    return;
  }
  $$('dialog[open]').forEach((d) => d.close());
  for (const id of ['page-home', 'page-tickets', 'page-organizer']) $(`#${id}`).hidden = id !== target;
  if (target === 'page-home') loadHome();
  if (target === 'page-tickets') loadTickets();
  if (target === 'page-organizer') loadOrganizer();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

// Nav links that point at a landing-page section work from any page.
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-scroll]');
  if (!link) return;
  e.preventDefault();
  const scroll = () => document.getElementById(link.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
  if ($('#page-home').hidden) {
    location.hash = '#/';
    setTimeout(scroll, 150);
  } else scroll();
});

function goToSignup() {
  if (state.user) return;
  if ($('#page-home').hidden) location.hash = '#/';
  setTimeout(() => {
    $('#hero-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#hero-form')?.elements.name.focus({ preventScroll: true });
  }, 100);
}

// ---------- landing ----------
async function loadHome() {
  renderHeroCard();
  await Promise.all([loadStats(), loadEvents()]);
}

function renderHeroCard() {
  const card = $('#hero-card');
  if (!state.user) {
    if (!$('#hero-form')) location.reload(); // restore the sign-up form after logout
    return;
  }
  card.replaceChildren(h('div', { className: 'success-card', style: { textAlign: 'left' } },
    h('h2', { style: { fontSize: '1.3rem', marginBottom: '6px' } }, `Welcome back, ${firstName(state.user.name)}`),
    h('p', { className: 'muted', style: { marginBottom: '18px' } }, 'Pick your next event below — registering takes one click.'),
    h('div', { className: 'actions' },
      h('a', { className: 'btn btn-cta', href: '#/', 'data-scroll': 'events' }, 'Browse events'),
      h('a', { className: 'btn btn-secondary', href: '#/tickets' }, iconEl('ticket', 16), 'My tickets'),
      isOrganizer() && h('a', { className: 'btn btn-ghost', href: '#/organizer' }, 'Organizer dashboard'),
    ),
  ));
}

async function loadStats() {
  try {
    const { data, pagination } = await api('/api/events?when=upcoming&limit=100');
    countUp($('#stat-events'), pagination.total);
    countUp($('#stat-seats'), data.reduce((sum, e) => sum + e.registeredCount, 0));
    countUp($('#stat-organizers'), new Set(data.map((e) => e.organizer.id)).size);
    $('#hero-pill').textContent = pagination.total
      ? `${pagination.total} upcoming event${pagination.total === 1 ? '' : 's'} open for registration`
      : 'New events are added every week';
    renderPreview(data.slice(0, 2));
  } catch { /* stats are optional */ }
}

function renderPreview(events) {
  const box = $('#preview');
  if (!events.length) return box.replaceChildren();
  box.replaceChildren(...events.map((event) => h('div', { className: 'mini', onClick: () => openEvent(event.id) },
    dateBlock(event.startsAt),
    h('div', { className: 'grow' },
      h('h3', {}, event.title),
      h('div', { className: 'meta' }, `${fmt.time(event.startsAt)} · ${event.location}`),
    ),
    statusBadge(event) ?? h('span', { className: 'badge brand' }, `${event.seatsLeft} seats left`),
  )));
}

// Hero sign-up form → POST /api/auth/register
$('#hero-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  clearFormErrors(form);
  const ok = validate(form, {
    name: [rules.required('Tell us your name')],
    email: [rules.required('Enter your email'), rules.email()],
    password: [rules.required('Choose a password'), rules.minLength(6, 'Use at least 6 characters')],
  });
  if (!ok) return;
  await withLoading(form.querySelector('[type="submit"]'), async () => {
    try {
      const { token, user } = await api('/api/auth/register', {
        method: 'POST',
        body: { name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), password: form.elements.password.value, role: 'attendee' },
      });
      signIn(token, user, { quiet: true });
      $('#hero-card').replaceChildren(h('div', { className: 'success-card' },
        h('div', { className: 'ok', html: icon('check', 26, 2.5) }),
        h('h3', {}, `You're in, ${firstName(user.name)}!`),
        h('p', {}, 'Your account is ready. Pick your first event — registering now takes a single click.'),
        h('div', { className: 'actions' }, h('a', { className: 'btn btn-cta', href: '#/', 'data-scroll': 'events' }, 'Browse events', iconEl('arrowRight', 16))),
      ));
    } catch (err) {
      showFormError(form, err, { email: /email|account/i, password: /password/i, name: /name/i });
    }
  });
});

// ---------- events ----------
function eventCard(event) {
  return h('article', { className: 'event-card', tabindex: '0', onClick: () => openEvent(event.id), onKeydown: (e) => e.key === 'Enter' && openEvent(event.id) },
    h('div', { className: 'cover', style: coverStyle(event.title) },
      dateBlock(event.startsAt),
      h('div', { className: 'status' }, statusBadge(event)),
    ),
    h('div', { className: 'event-body' },
      h('h3', {}, event.title),
      h('div', { className: 'meta-list' },
        h('span', {}, iconEl('clock', 15), timeRange(event)),
        h('span', {}, iconEl('pin', 15), event.location),
        h('span', {}, iconEl('user', 15), `By ${event.organizer.name}`),
      ),
      seatsBar(event),
    ),
  );
}

async function loadEvents() {
  const grid = $('#event-grid');
  const params = new URLSearchParams({ when: state.when, limit: 60 });
  if (state.search) params.set('search', state.search);
  try {
    const { data } = await api(`/api/events?${params}`);
    if (!data.length) {
      grid.replaceChildren(h('div', { className: 'empty card', style: { gridColumn: '1 / -1' } },
        h('div', { className: 'ic', html: icon('calendar', 26) }),
        h('strong', {}, state.search ? 'No events match your search' : 'No events here yet'),
        h('span', {}, state.search ? 'Try a different keyword.' : 'Check back soon — new events are added every week.'),
      ));
      return;
    }
    grid.replaceChildren(...data.map(eventCard));
  } catch (err) {
    grid.replaceChildren(h('div', { className: 'empty card', style: { gridColumn: '1 / -1' } }, h('strong', {}, "Couldn't load events"), h('span', {}, err.message)));
  }
}

$$('.chip[data-when]').forEach((chip) => chip.addEventListener('click', () => {
  state.when = chip.dataset.when;
  $$('.chip[data-when]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  loadEvents();
}));
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    loadEvents();
  }, 250);
});

// ---------- event detail & registration ----------
async function openEvent(id) {
  let event;
  try {
    event = await api(`/api/events/${id}`);
  } catch (err) {
    return toast(err.message, { type: 'error' });
  }
  const dialog = $('#event-dialog');
  const body = h('div', { className: 'modal-body', style: { paddingTop: '20px' } },
    h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '6px' } },
      dateBlock(event.startsAt),
      h('div', {}, h('h2', { style: { fontSize: '1.45rem' } }, event.title), h('div', { className: 'muted small' }, `Hosted by ${event.organizer.name}`)),
    ),
    h('div', { className: 'meta-list', style: { marginTop: '16px' } },
      h('span', {}, iconEl('clock', 16), timeRange(event)),
      h('span', {}, iconEl('pin', 16), event.location),
    ),
    event.description && h('p', { className: 'detail-desc' }, event.description),
    seatsBar(event),
    h('div', { id: 'register-area', style: { marginTop: '22px' } }),
  );
  dialog.querySelector('#event-dialog-body').replaceChildren(
    h('div', { className: 'detail-cover', style: coverStyle(event.title) },
      h('button', { className: 'icon-btn', 'aria-label': 'Close', html: icon('x', 18), onClick: () => dialog.close() }),
    ),
    body,
  );
  renderRegisterArea(event);
  if (!dialog.open) dialog.showModal();
}

function renderRegisterArea(event) {
  const area = $('#register-area');
  if (event.myRegistrationId) {
    area.replaceChildren(h('div', { className: 'actions', style: { justifyContent: 'space-between' } },
      h('span', { className: 'badge green', style: { height: '32px', fontSize: '.9rem' } }, iconEl('check', 14), "You're registered"),
      !event.hasStarted && h('button', { className: 'btn btn-danger btn-sm', onClick: () => cancelRegistration(event.myRegistrationId, () => openEvent(event.id)) }, 'Cancel my registration'),
    ));
    return;
  }
  if (event.hasStarted) return area.replaceChildren(h('p', { className: 'muted' }, 'This event has already started, so registration is closed.'));
  if (event.isFull) return area.replaceChildren(h('p', { className: 'muted' }, 'This event is sold out. Seats free up when people cancel — check back later.'));

  if (!state.user) {
    area.replaceChildren(
      h('button', {
        className: 'btn btn-cta btn-lg btn-block',
        onClick: () => {
          state.pendingAction = () => openEvent(event.id);
          $('#event-dialog').close();
          openAuth('register');
        },
      }, 'Register — it\'s free'),
      h('p', { className: 'switch-line', style: { marginTop: '10px' } }, 'You\'ll create a free account in the next step.'),
    );
    return;
  }

  const form = h('form', { className: 'form', novalidate: true },
    h('div', { className: 'form-row' },
      h('div', { className: 'field' }, h('label', { for: 'reg-phone' }, 'Phone ', h('span', { className: 'muted' }, '(optional)')),
        h('input', { id: 'reg-phone', name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: 'For last-minute changes' })),
    ),
    h('div', { className: 'field' }, h('label', { for: 'reg-notes' }, 'Note for the organizer ', h('span', { className: 'muted' }, '(optional)')),
      h('textarea', { id: 'reg-notes', name: 'notes', maxlength: '1000', placeholder: 'Dietary needs, accessibility, questions…', style: { minHeight: '72px' } })),
    h('div', { className: 'form-alert', role: 'alert' }),
    h('button', { className: 'btn btn-cta btn-lg btn-block', type: 'submit' }, `Confirm my seat as ${firstName(state.user.name)}`),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    if (!validate(form, { phone: [rules.pattern(/^[+\d][\d\s().-]{4,29}$/, 'Enter a valid phone number')] })) return;
    await withLoading(form.querySelector('[type="submit"]'), async () => {
      try {
        await api(`/api/events/${event.id}/registrations`, {
          method: 'POST',
          body: { phone: form.elements.phone.value.trim() || undefined, notes: form.elements.notes.value.trim() || undefined },
        });
        area.replaceChildren(h('div', { className: 'success-card' },
          h('div', { className: 'ok', html: icon('ticket', 26) }),
          h('h3', {}, "You're going!"),
          h('p', {}, `Your seat for ${event.title} is saved in My tickets.`),
          h('div', { className: 'actions' },
            h('a', { className: 'btn btn-cta', href: '#/tickets', onClick: () => $('#event-dialog').close() }, 'View my tickets'),
            h('button', { className: 'btn btn-secondary', onClick: () => $('#event-dialog').close() }, 'Keep browsing'),
          ),
        ));
        loadEvents();
        loadStats();
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
  area.replaceChildren(form);
}

async function cancelRegistration(id, after) {
  const yes = await confirmDialog({
    title: 'Cancel your registration?',
    message: 'Your seat will be released to someone else. You can register again later if seats are still available.',
    confirmText: 'Yes, cancel it',
    danger: true,
  });
  if (!yes) return;
  try {
    await api(`/api/registrations/${id}`, { method: 'DELETE' });
    toast('Registration cancelled — your seat was released');
    after?.();
    if (!$('#page-home').hidden) { loadEvents(); loadStats(); }
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

// ---------- my tickets ----------
async function loadTickets() {
  const list = $('#ticket-list');
  list.replaceChildren(h('div', { className: 'skeleton', style: { height: '96px' } }));
  try {
    const regs = await api('/api/registrations');
    const upcoming = regs.filter((r) => r.status === 'registered' && r.event.startsAt > nowIso());
    const shown = state.ticketTab === 'upcoming' ? upcoming : regs.filter((r) => !upcoming.includes(r));
    if (!shown.length) {
      list.replaceChildren(h('div', { className: 'empty card' },
        h('div', { className: 'ic', html: icon('ticket', 26) }),
        h('strong', {}, state.ticketTab === 'upcoming' ? 'No upcoming tickets' : 'Nothing here yet'),
        h('span', {}, state.ticketTab === 'upcoming' ? 'Find an event you like and save your seat.' : 'Past and cancelled registrations will show up here.'),
        state.ticketTab === 'upcoming' && h('div', { style: { marginTop: '18px' } }, h('a', { className: 'btn btn-cta', href: '#/', 'data-scroll': 'events' }, 'Browse events')),
      ));
      return;
    }
    list.replaceChildren(...shown.map((r) => {
      const active = r.status === 'registered' && r.event.startsAt > nowIso();
      return h('article', { className: `ticket ${r.status === 'cancelled' ? 'cancelled' : ''}` },
        dateBlock(r.event.startsAt),
        h('div', { className: 'grow' },
          h('h3', {}, r.event.title),
          h('div', { className: 'meta-list' },
            h('span', {}, iconEl('clock', 15), fmt.dateTime(r.event.startsAt)),
            h('span', {}, iconEl('pin', 15), r.event.location),
          ),
        ),
        r.status === 'cancelled'
          ? h('span', { className: 'badge red' }, 'Cancelled')
          : active ? h('span', { className: 'badge green' }, h('span', { className: 'dot' }), 'Confirmed') : h('span', { className: 'badge' }, 'Attended'),
        active && h('button', { className: 'btn btn-danger btn-sm', onClick: () => cancelRegistration(r.id, loadTickets) }, 'Cancel'),
      );
    }));
  } catch (err) {
    list.replaceChildren(h('div', { className: 'empty card' }, h('strong', {}, "Couldn't load your tickets"), h('span', {}, err.message)));
  }
}

$$('[data-ticket-tab]').forEach((tab) => tab.addEventListener('click', () => {
  state.ticketTab = tab.dataset.ticketTab;
  $$('[data-ticket-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  loadTickets();
}));

// ---------- organizer dashboard ----------
async function loadOrganizer() {
  const table = $('#org-events');
  try {
    const { data } = await api('/api/events?mine=true&when=all&limit=100');
    const upcoming = data.filter((e) => !e.hasStarted);
    const booked = data.reduce((sum, e) => sum + e.registeredCount, 0);
    const capacity = data.reduce((sum, e) => sum + e.capacity, 0);
    const stat = (label, value, ic) => h('div', { className: 'stat' }, h('div', { className: 'label' }, iconEl(ic, 16), label), h('div', { className: 'value' }, value));
    $('#org-stats').replaceChildren(
      stat('Events published', fmt.number(data.length), 'calendar'),
      stat('Upcoming', fmt.number(upcoming.length), 'clock'),
      stat('Seats booked', fmt.number(booked), 'ticket'),
      stat('Average fill rate', capacity ? `${Math.round((booked / capacity) * 100)}%` : '—', 'chart'),
    );

    if (!data.length) {
      table.replaceChildren(h('div', { className: 'empty' },
        h('div', { className: 'ic', html: icon('calendar', 26) }),
        h('strong', {}, 'Publish your first event'),
        h('span', {}, 'It takes about two minutes. Attendees can register right away.'),
        h('div', { style: { marginTop: '18px' } }, h('button', { className: 'btn btn-cta', onClick: () => openEventForm() }, iconEl('plus', 16), 'New event')),
      ));
      return;
    }

    table.replaceChildren(h('table', { className: 'table' },
      h('thead', {}, h('tr', {}, ['Event', 'When', 'Registrations', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, data.map((e) => {
        const pct = Math.round((e.registeredCount / e.capacity) * 100);
        return h('tr', {},
          h('td', {}, h('div', { className: 'event-title-cell' }, dateBlock(e.startsAt),
            h('div', {}, h('strong', {}, e.title), h('div', { className: 'muted small' }, e.location)))),
          h('td', { className: 'small' }, fmt.dateTime(e.startsAt), e.hasStarted && h('div', {}, h('span', { className: 'badge' }, 'Past'))),
          h('td', {}, h('div', { className: 'fill' },
            h('div', { className: `seats-bar ${pct >= 80 ? 'hot' : ''}` }, h('span', { style: { width: `${Math.min(pct, 100)}%` } })),
            h('span', { className: 'small' }, h('strong', {}, e.registeredCount), ` / ${e.capacity}`))),
          h('td', {}, h('div', { className: 'actions', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
            h('button', { className: 'btn btn-secondary btn-sm', onClick: () => openAttendees(e) }, iconEl('users', 15), 'Attendees'),
            h('button', { className: 'icon-btn', title: 'Edit', 'aria-label': 'Edit event', html: icon('pencil', 16), onClick: () => openEventForm(e) }),
            h('button', { className: 'icon-btn danger', title: 'Delete', 'aria-label': 'Delete event', html: icon('trash', 16), onClick: () => deleteEvent(e) }),
          )),
        );
      })),
    ));
  } catch (err) {
    table.replaceChildren(h('div', { className: 'empty' }, h('strong', {}, "Couldn't load your events"), h('span', {}, err.message)));
  }
}

// datetime-local works in local time without a zone.
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function openEventForm(event) {
  const form = $('#event-form');
  form.reset();
  clearFormErrors(form);
  const f = form.elements;
  f.eventId.value = event?.id ?? '';
  if (event) {
    f.title.value = event.title;
    f.description.value = event.description;
    f.location.value = event.location;
    f.capacity.value = event.capacity;
    f.startsAt.value = toLocalInput(event.startsAt);
    f.endsAt.value = toLocalInput(event.endsAt);
  }
  $('#event-form-title').textContent = event ? 'Edit event' : 'New event';
  form.querySelector('[type="submit"]').textContent = event ? 'Save changes' : 'Publish event';
  $('#event-form-dialog').showModal();
}
$('#new-event').addEventListener('click', () => openEventForm());

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const f = form.elements;
  const editing = f.eventId.value;
  clearFormErrors(form);
  const ok = validate(form, {
    title: [rules.required('Give your event a title'), rules.minLength(3)],
    location: [rules.required('Where does it happen? Use "Online" for virtual events')],
    capacity: [rules.required('How many people can attend?'), rules.min(1, 'At least 1 seat')],
    startsAt: [rules.required('When does it start?'), ...(editing ? [] : [rules.future('The start time must be in the future')])],
    endsAt: [(v) => (v && f.startsAt.value && new Date(v) <= new Date(f.startsAt.value) ? 'The end must be after the start' : null)],
  });
  if (!ok) return;
  const body = {
    title: f.title.value.trim(),
    description: f.description.value.trim(),
    location: f.location.value.trim(),
    capacity: Number(f.capacity.value),
    startsAt: new Date(f.startsAt.value).toISOString(),
    endsAt: f.endsAt.value ? new Date(f.endsAt.value).toISOString() : null,
  };
  await withLoading(form.querySelector('[type="submit"]'), async () => {
    try {
      if (editing) await api(`/api/events/${editing}`, { method: 'PATCH', body });
      else await api('/api/events', { method: 'POST', body });
      $('#event-form-dialog').close();
      toast(editing ? 'Event updated' : 'Event published — attendees can register now');
      loadOrganizer();
    } catch (err) {
      showFormError(form, err, { capacity: /capacity/i, startsAt: /startsAt|future/i, endsAt: /endsAt/i });
    }
  });
});

async function deleteEvent(event) {
  const yes = await confirmDialog({
    title: `Delete "${event.title}"?`,
    message: `${event.registeredCount} registration(s) will be removed too. This can't be undone.`,
    confirmText: 'Delete event',
    danger: true,
  });
  if (!yes) return;
  try {
    await api(`/api/events/${event.id}`, { method: 'DELETE' });
    toast('Event deleted');
    loadOrganizer();
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function openAttendees(event) {
  const bodyEl = $('#attendees-body');
  const dialog = $('#attendees-dialog');
  bodyEl.replaceChildren(h('div', { className: 'skeleton', style: { height: '120px' } }));
  dialog.showModal();
  try {
    const regs = await api(`/api/events/${event.id}/registrations`);
    const active = regs.filter((r) => r.status === 'registered');
    bodyEl.replaceChildren(
      h('div', { className: 'modal-head' },
        h('div', {}, h('h2', {}, 'Attendees'), h('p', {}, `${event.title} · ${active.length} of ${event.capacity} seats taken`)),
        h('button', { className: 'icon-btn', 'aria-label': 'Close', html: icon('x', 18), onClick: () => dialog.close() }),
      ),
      regs.length
        ? h('div', {},
            h('div', { className: 'table-wrap', style: { maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '12px' } },
              h('table', { className: 'table' },
                h('thead', {}, h('tr', {}, ['Name', 'Contact', 'Note', 'Status'].map((t) => h('th', {}, t)))),
                h('tbody', {}, regs.map((r) => h('tr', {},
                  h('td', {}, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
                    h('span', { className: 'avatar', style: { background: colorFor(r.user.email) } }, initials(r.user.name)), r.user.name)),
                  h('td', { className: 'small' }, r.user.email, r.phone && h('div', { className: 'muted' }, r.phone)),
                  h('td', { className: 'small muted' }, r.notes || '—'),
                  h('td', {}, h('span', { className: `badge ${r.status === 'registered' ? 'green' : 'red'}` }, r.status === 'registered' ? 'Going' : 'Cancelled')),
                ))),
              )),
            h('div', { className: 'actions', style: { justifyContent: 'flex-end', marginTop: '18px' } },
              h('button', {
                className: 'btn btn-secondary',
                onClick: () => downloadCsv(`${event.title.replace(/\W+/g, '-').toLowerCase()}-attendees.csv`, [
                  ['Name', 'Email', 'Phone', 'Note', 'Status', 'Registered at'],
                  ...regs.map((r) => [r.user.name, r.user.email, r.phone, r.notes, r.status, r.registeredAt]),
                ]),
              }, iconEl('download', 16), 'Export CSV'),
            ))
        : h('div', { className: 'empty' }, h('div', { className: 'ic', html: icon('users', 26) }), h('strong', {}, 'No registrations yet'), h('span', {}, 'Share the event link to get your first attendees.')),
    );
  } catch (err) {
    bodyEl.replaceChildren(h('p', { className: 'form-alert' }, err.message));
  }
}

// ---------- auth ----------
let authMode = 'login';

function openAuth(mode) {
  authMode = mode === 'register-organizer' ? 'register' : mode;
  const form = $('#auth-form');
  form.reset();
  clearFormErrors(form);
  const register = authMode === 'register';
  $$('.register-only', form).forEach((el) => (el.hidden = !register));
  form.elements.organizer.checked = mode === 'register-organizer';
  form.elements.password.autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-title').textContent = register ? (mode === 'register-organizer' ? 'Start organizing for free' : 'Create your free account') : 'Welcome back';
  $('#auth-sub').textContent = register ? 'It takes 20 seconds. No credit card.' : 'Log in to manage your tickets.';
  $('#auth-submit').textContent = register ? 'Create account' : 'Log in';
  $('#auth-switch').replaceChildren(
    register ? 'Already have an account? ' : 'New to Gatherly? ',
    h('button', { type: 'button', className: 'link-btn', onClick: () => openAuth(register ? 'login' : 'register') }, register ? 'Log in' : 'Create a free account'),
  );
  const dialog = $('#auth-dialog');
  if (!dialog.open) dialog.showModal();
  (register ? form.elements.fullName : form.elements.email).focus();
}

document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open-auth]');
  if (opener) {
    e.preventDefault();
    openAuth(opener.dataset.openAuth);
  }
  const closer = e.target.closest('[data-close]');
  if (closer) closer.closest('dialog')?.close();
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const f = form.elements;
  const register = authMode === 'register';
  clearFormErrors(form);
  const ok = validate(form, {
    ...(register && { fullName: [rules.required('Tell us your name')] }),
    email: [rules.required('Enter your email'), rules.email()],
    password: [rules.required('Enter your password'), ...(register ? [rules.minLength(6)] : [])],
  });
  if (!ok) return;
  const body = register
    ? { name: f.fullName.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.organizer.checked ? 'organizer' : 'attendee' }
    : { email: f.email.value.trim(), password: f.password.value };
  await withLoading($('#auth-submit'), async () => {
    try {
      const { token, user } = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body });
      $('#auth-dialog').close();
      signIn(token, user);
    } catch (err) {
      showFormError(form, err, { email: /already exists/i });
    }
  });
});

function signIn(token, user, { quiet = false } = {}) {
  session.token = token;
  state.user = user;
  renderHeader();
  if (!quiet) toast(`Welcome, ${firstName(user.name)}!`);
  const pending = state.pendingAction;
  state.pendingAction = null;
  if (pending) {
    if (!$('#page-home').hidden) { renderHeroCard(); loadEvents(); }
    pending();
  } else if (!quiet && isOrganizer()) {
    location.hash = '#/organizer';
  } else if (!quiet) {
    route();
  } else {
    loadEvents();
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  session.token = null;
  state.user = null;
  location.hash = '#/';
  location.reload();
}

window.addEventListener('session-expired', () => {
  state.user = null;
  renderHeader();
});

$('#cta-bottom').addEventListener('click', () => (state.user ? document.getElementById('events').scrollIntoView({ behavior: 'smooth' }) : goToSignup()));

// ---------- start ----------
(async function init() {
  $('#year').textContent = new Date().getFullYear();
  hydrateIcons();
  singleOpenFaq();
  enableBackdropClose();
  if (session.token) {
    try {
      state.user = await api('/api/auth/me');
    } catch {
      session.token = null;
    }
  }
  renderHeader();
  route();
})();
