/**
 * Share one in-flight execution between identical concurrent tool calls.
 *
 * A model can issue the same call twice in one step. Observed with
 * `fetchTranscript`: two identical calls for the same video, fired together,
 * each independently downloading a 52,000 character transcript. That doubles
 * the load on exactly the request most likely to be rate limited, and the
 * second result is discarded anyway because it is identical to the first.
 *
 * Calls are keyed by tool name plus arguments, so this only ever joins calls
 * that would produce the same answer. It is strictly in-flight: the entry is
 * dropped the moment the promise settles, so nothing is cached between steps
 * or between turns, and a tool asked the same question a second later still
 * runs. Caching results would be a different feature with different risks -
 * `searchContent` must see writes that happened since.
 *
 * Failures are shared too. A joined caller gets the same rejection, which is
 * correct: it asked the same question at the same moment and the answer was
 * an error.
 */

/** Scoped per request, so concurrent users never share an execution. */
export function createCallCoalescer() {
  const inFlight = new Map<string, Promise<unknown>>();

  function keyFor(toolName: string, args: unknown): string | null {
    try {
      // Sorted keys so {a,b} and {b,a} are the same call.
      return `${toolName}:${JSON.stringify(args, Object.keys(args ?? {}).sort())}`;
    } catch {
      // Arguments that will not serialise cannot be compared, so never join.
      return null;
    }
  }

  return {
    /** Run `work`, or join an identical call already running. */
    async run<T>(toolName: string, args: unknown, work: () => Promise<T>): Promise<T> {
      const key = keyFor(toolName, args);
      if (key === null) return work();

      const existing = inFlight.get(key);
      if (existing) return existing as Promise<T>;

      const promise = work().finally(() => {
        inFlight.delete(key);
      });

      inFlight.set(key, promise);
      return promise;
    },

    /** How many distinct calls are running. Exposed for tests. */
    get size() {
      return inFlight.size;
    },
  };
}

export type CallCoalescer = ReturnType<typeof createCallCoalescer>;
