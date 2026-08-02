/** Injectable clock for routing budget / backoff tests (no real waits). */
export type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
