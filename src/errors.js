// Messages are [zh, en] pairs so the same error renders in either language.
export class ValidationError extends Error {
  constructor(errors) { super('Validation failed'); this.status = 422; this.errors = errors; }
}

export class NotFoundError extends Error {
  constructor() { super('Not found'); this.status = 404; }
}

export class ConflictError extends Error {
  constructor(message) { super('Conflict'); this.status = 409; this.messagePair = message; }
}
