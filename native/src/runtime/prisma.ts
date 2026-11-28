// Native code must never silently connect to a remote PostgreSQL database.
export const prisma = new Proxy({}, { get() { throw new Error("PostgreSQL is not available in the local client."); } });
