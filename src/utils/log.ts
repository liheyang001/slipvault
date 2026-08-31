/**
 * Recording a failure that is deliberately not surfaced to the user.
 *
 * Startup is fail-open by design: a broken database or notification service
 * should not stop the app from opening. But swallowing those failures in
 * silence is how a token bug once ran for six days with an empty ledger and no
 * indication anything was wrong. Failing open and saying nothing at all are
 * separate decisions; this is how to do the first without the second.
 *
 * Visible in `npx expo start` and in `adb logcat` on a release build.
 */
export function logSwallowed(context: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[vesta] ${context} failed (continuing): ${detail}`);
}

/** Wraps a fail-open startup step so one broken subsystem cannot stop boot. */
export function tryStartup(context: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logSwallowed(context, err);
  }
}
