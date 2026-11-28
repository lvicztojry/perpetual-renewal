// No HTTP listener exists. Trust is granted only to requests created by the local dispatcher.
const dispatched = new WeakSet<Request>();
export function markLocalRequest(request: Request) { dispatched.add(request); }
export const isTrustedMutationOrigin = (request: Request) => dispatched.has(request);
