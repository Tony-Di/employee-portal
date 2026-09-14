// Messages are [zh, en] pairs so the same error renders in either language.
export class ValidationError extends Error {
  // The English messages double as the error message for the command line and logs.
  constructor(errors) { super(Object.values(errors).map(pair => pair[1]).join(' ')); this.status = 422; this.errors = errors; }
}

export class NotFoundError extends Error {
  constructor() { super('Not found'); this.status = 404; }
}

export class ConflictError extends Error {
  constructor(message) { super(message?.[1] ?? 'Conflict'); this.status = 409; this.messagePair = message; }
}
