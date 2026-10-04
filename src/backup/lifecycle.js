/** Timers are opportunistic. Startup, visibility and resume all coalesce through the same durable scheduler. */
export function startAutomaticBackup(service, { events = globalThis, document = globalThis.document, interval = 60000 } = {}) {
  const check = () => { if (!document || document.visibilityState !== 'hidden') service.run().catch(() => {}); };
  const timer = setInterval(check, interval);
  events.addEventListener('focus', check); events.addEventListener('pageshow', check);
  document?.addEventListener('visibilitychange', check); check();
  return () => {
    clearInterval(timer); service.cancel(); events.removeEventListener('focus', check); events.removeEventListener('pageshow', check);
    document?.removeEventListener('visibilitychange', check);
  };
}
