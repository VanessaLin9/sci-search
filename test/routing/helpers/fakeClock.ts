import type { Clock } from "../../../src/routing/clock.js";

export type FakeClock = Clock & {
  readonly sleeps: number[];
  advance(ms: number): void;
};

export function createFakeClock(startMs = 1_000_000): FakeClock {
  let now = startMs;
  const sleeps: number[] = [];

  return {
    get sleeps() {
      return sleeps;
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    async sleep(ms: number) {
      sleeps.push(ms);
      now += ms;
    },
  };
}
