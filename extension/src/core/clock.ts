// Clock port (AD-1: core depends on injected ports, never on ambient time).
//
// The engine uses `now()` for `NormalizedUsage.fetchedAt` and `sleep()` for
// inter-page jitter. Tests inject FakeClock (src/testing/fake-clock.ts) which
// records sleeps and never waits, so jitter behavior is asserted without
// wall-clock delays.

/** Monotonic-enough time source plus an awaitable delay. */
export interface Clock {
  /** Current epoch time in milliseconds. */
  now(): number;
  /** Resolves after at least `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

/** Production clock over the ambient `Date`/`setTimeout`. Never used in tests. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
