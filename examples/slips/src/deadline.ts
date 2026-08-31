/** Core's `Instant` is UTC to the second, and `toISOString` writes milliseconds. */
export const inMinutes = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.[0-9]{3}Z$/, "Z")
