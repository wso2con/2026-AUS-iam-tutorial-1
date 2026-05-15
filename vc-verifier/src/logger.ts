export function logEvent(event: string, details: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...details
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
