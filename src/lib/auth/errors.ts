export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "AuthenticationRequiredError";
  }
}

export function isLocalEmailAuthEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "local-email";
}

export class AuthError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AuthError";
  }
}
