'use strict';

/**
 * Error HTTP con código de estado, manejado por errorHandler.
 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Atajo para lanzar errores HTTP. */
function httpError(status, message) {
  return new HttpError(status, message);
}

module.exports = { HttpError, httpError };
