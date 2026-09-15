import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumeAnonConversion,
  peekAnonAllowance,
  resetAnonAllowance,
  ANON_TOKEN_KEY,
  ANON_DAILY_LIMIT,
} from '@/app/lib/conversion-limiter';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});

const DAY = 24 * 60 * 60 * 1000;

describe('anon conversion limiter', () => {
  it('allows exactly the daily limit then blocks', () => {
    const t = 1_000_000;
    expect(consumeAnonConversion(t).allowed).toBe(true);
    expect(consumeAnonConversion(t + 1000).allowed).toBe(true);
    const third = consumeAnonConversion(t + 2000);
    expect(third.allowed).toBe(false);
    expect(third.used).toBe(ANON_DAILY_LIMIT);
    expect(third.remaining).toBe(0);
  });

  it('peek does not consume', () => {
    const t = 1_000_000;
    consumeAnonConversion(t);
    expect(peekAnonAllowance(t).used).toBe(1);
    expect(peekAnonAllowance(t).used).toBe(1);
    expect(peekAnonAllowance(t).remaining).toBe(1);
  });

  it('rolls the window 24h after the FIRST conversion, not a calendar day', () => {
    const t = 1_000_000;
    consumeAnonConversion(t);
    consumeAnonConversion(t + 1000);
    expect(consumeAnonConversion(t + DAY - 1).allowed).toBe(false);
    expect(consumeAnonConversion(t + DAY).allowed).toBe(true);
  });

  it('treats a backwards clock as a fresh window rather than locking out', () => {
    const t = 1_000_000;
    consumeAnonConversion(t);
    consumeAnonConversion(t + 1000);
    expect(consumeAnonConversion(t - DAY).allowed).toBe(true);
  });

  it('fails open on corrupt storage', () => {
    store.set(ANON_TOKEN_KEY, '{not json');
    expect(consumeAnonConversion(1_000_000).allowed).toBe(true);
  });

  it('fails open when storage throws entirely', () => {
    (globalThis as any).window = {
      localStorage: {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
        removeItem() { throw new Error('denied'); },
      },
    };
    expect(consumeAnonConversion().allowed).toBe(true);
    expect(consumeAnonConversion().allowed).toBe(true);
    expect(consumeAnonConversion().allowed).toBe(true);
  });

  it('reset restores the allowance', () => {
    const t = 1_000_000;
    consumeAnonConversion(t);
    consumeAnonConversion(t + 1);
    resetAnonAllowance();
    expect(consumeAnonConversion(t + 2).allowed).toBe(true);
  });
});
