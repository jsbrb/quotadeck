// Clock double: records every sleep, never waits (AD-2).
//
// `sleep(ms)` pushes the duration onto `sleeps` and advances the virtual `now`
// by `ms`, so tests assert "N-1 sleeps for N pages, each within [min, max]"
// without wall-clock delay, and `fetchedAt` ordering stays deterministic.
import type { Clock } from '../core/clock';

export class FakeClock implements Clock {
  readonly sleeps: number[] = [];
  private current: number;

  constructor(startEpochMs = 1_700_000_000_000) {
    this.current = startEpochMs;
  }

  now(): number {
    return this.current;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
  }
}
