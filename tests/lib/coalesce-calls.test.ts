import { describe, it, expect } from 'vitest';
import { createCallCoalescer } from '../../server/src/lib/coalesce-calls';

const deferred = () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createCallCoalescer', () => {
  it('runs identical concurrent calls once', async () => {
    // The observed case: a model issuing fetchTranscript twice for one video,
    // each independently downloading 52,000 characters.
    const coalescer = createCallCoalescer();
    let runs = 0;
    const d = deferred();
    const work = () => { runs += 1; return d.promise as Promise<string>; };

    const a = coalescer.run('fetchTranscript', { videoId: 'x' }, work);
    const b = coalescer.run('fetchTranscript', { videoId: 'x' }, work);

    d.resolve('transcript');

    expect(await a).toBe('transcript');
    expect(await b).toBe('transcript');
    expect(runs).toBe(1);
  });

  it('keeps different arguments separate', async () => {
    const coalescer = createCallCoalescer();
    let runs = 0;
    const work = async () => { runs += 1; return runs; };

    await Promise.all([
      coalescer.run('fetchTranscript', { videoId: 'a' }, work),
      coalescer.run('fetchTranscript', { videoId: 'b' }, work),
    ]);

    expect(runs).toBe(2);
  });

  it('keeps different tools separate even with identical arguments', async () => {
    const coalescer = createCallCoalescer();
    let runs = 0;
    const work = async () => { runs += 1; return runs; };

    await Promise.all([
      coalescer.run('getTranscript', { videoId: 'a' }, work),
      coalescer.run('searchTranscript', { videoId: 'a' }, work),
    ]);

    expect(runs).toBe(2);
  });

  it('treats argument order as irrelevant', async () => {
    const coalescer = createCallCoalescer();
    let runs = 0;
    const d = deferred();
    const work = () => { runs += 1; return d.promise as Promise<string>; };

    const a = coalescer.run('t', { a: 1, b: 2 }, work);
    const b = coalescer.run('t', { b: 2, a: 1 }, work);
    d.resolve('ok');
    await Promise.all([a, b]);

    expect(runs).toBe(1);
  });

  it('does not cache: a later identical call runs again', async () => {
    // Strictly in-flight. searchContent must see writes that happened since,
    // so results are never held between steps.
    const coalescer = createCallCoalescer();
    let runs = 0;
    const work = async () => { runs += 1; return runs; };

    await coalescer.run('searchContent', { q: 'x' }, work);
    await coalescer.run('searchContent', { q: 'x' }, work);

    expect(runs).toBe(2);
  });

  it('shares a failure with the joined caller', async () => {
    const coalescer = createCallCoalescer();
    let runs = 0;
    const d = deferred();
    const work = () => { runs += 1; return d.promise as Promise<string>; };

    const a = coalescer.run('t', { x: 1 }, work);
    const b = coalescer.run('t', { x: 1 }, work);
    d.reject(new Error('YouTube refused'));

    await expect(a).rejects.toThrow('YouTube refused');
    await expect(b).rejects.toThrow('YouTube refused');
    expect(runs).toBe(1);
  });

  it('releases the entry once settled, so nothing leaks', async () => {
    const coalescer = createCallCoalescer();
    await coalescer.run('t', { x: 1 }, async () => 'done');

    expect(coalescer.size).toBe(0);
  });

  it('releases the entry after a failure too', async () => {
    const coalescer = createCallCoalescer();
    await coalescer.run('t', { x: 1 }, async () => { throw new Error('nope'); }).catch(() => {});

    expect(coalescer.size).toBe(0);
  });

  it('never joins arguments that will not serialise', async () => {
    const coalescer = createCallCoalescer();
    const circular: any = {}; circular.self = circular;
    let runs = 0;
    const work = async () => { runs += 1; return runs; };

    await Promise.all([
      coalescer.run('t', circular, work),
      coalescer.run('t', circular, work),
    ]);

    expect(runs).toBe(2);
  });
});
