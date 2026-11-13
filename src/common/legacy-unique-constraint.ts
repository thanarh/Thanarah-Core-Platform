/** Recognize historical adapter errors without loading a SQL client in the application. */
export function isLegacyUniqueConstraintError(
  error: unknown,
): error is Error & { code: 'P2002'; meta?: { target?: unknown } } {
  return error instanceof Error && 'code' in error && error.code === 'P2002';
}
