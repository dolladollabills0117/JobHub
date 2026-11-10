'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (message) => new HttpError(400, message);

function str(value, field, { required = false, max = 200, min = 0 } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${field} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw bad(`${field} is required.`);
  if (trimmed.length < min) throw bad(`${field} must be at least ${min} characters.`);
  if (trimmed.length > max) throw bad(`${field} must be at most ${max} characters.`);
  return trimmed;
}

function int(value, field, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw bad(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

function oneOf(value, field, allowed, { required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (!allowed.includes(value)) throw bad(`${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found.');
  return n;
}

module.exports = { HttpError, bad, str, int, oneOf, bool, id };
