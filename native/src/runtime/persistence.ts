// Shared repository algorithms run inside an encrypted, durable transaction in api.ts.
export const shouldUseMemoryFallback = () => true;
export const shouldFallbackToMemoryOnPrismaError = () => false;
