import { HttpError } from './errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const missing = (value) => value === undefined || value === null || value === '';

export function string(value, field, { required = true, min = 1, max = 255 } = {}) {
  if (missing(value)) {
    if (required) throw new HttpError(400, `"${field}" is required`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `"${field}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, `"${field}" must be between ${min} and ${max} characters`);
  }
  return trimmed;
}

export function email(value, field = 'email') {
  const v = string(value, field, { max: 254 }).toLowerCase();
  if (!EMAIL.test(v)) throw new HttpError(400, `"${field}" must be a valid email`);
  return v;
}

export function integer(value, field, { required = true, min = -Infinity, max = Infinity } = {}) {
  if (missing(value)) {
    if (required) throw new HttpError(400, `"${field}" is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `"${field}" must be an integer between ${min} and ${max}`);
  }
  return n;
}

// Returns an ISO-8601 UTC string so dates sort and compare correctly as text in SQLite.
export function date(value, field, { required = true } = {}) {
  if (missing(value)) {
    if (required) throw new HttpError(400, `"${field}" is required`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `"${field}" must be a valid date`);
  return d.toISOString();
}

export function oneOf(value, field, allowed, { required = true, fallback = null } = {}) {
  if (missing(value)) {
    if (required && fallback === null) throw new HttpError(400, `"${field}" is required`);
    return fallback;
  }
  if (!allowed.includes(value)) throw new HttpError(400, `"${field}" must be one of: ${allowed.join(', ')}`);
  return value;
}

export function id(value, field = 'id') {
  return integer(value, field, { min: 1 });
}
