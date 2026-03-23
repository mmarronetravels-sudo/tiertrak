/**
 * Safe error logger.
 * Only logs in development. Never logs the full error object,
 * which could contain student or staff PII in the response body.
 */
export function logError(context, error) {
  if (process.env.NODE_ENV === 'production') return;

  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'unknown error';

  console.error(`[${context}]`, message);
}