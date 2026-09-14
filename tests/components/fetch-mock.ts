/**
 * Deterministic fetch mock for component tests. Routes are matched by exact
 * pathname; unhandled routes fail loudly so tests never pass by accident.
 * Handlers may return a promise so loading states can be observed.
 */

import { vi } from 'vitest';

export interface MockResult {
  status: number;
  body: unknown;
}

export type RouteHandler = (init: RequestInit) => MockResult | Promise<MockResult>;

export function installFetchMock(routes: Record<string, RouteHandler>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? new URL(input, 'https://portal.test')
          : input instanceof URL
            ? input
            : new URL(input.url);
      const key = `${url.pathname}${url.search}`;
      const route = routes[key];
      if (!route) {
        throw new Error(`No fetch mock registered for ${key}`);
      }
      const result = await route(init ?? {});
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

export const ok = <T>(body: T): RouteHandler => () => ({ status: 200, body });
export const created = <T>(body: T): RouteHandler => () => ({ status: 201, body });
export const failed = (status: number, code: string, message: string): RouteHandler => () => ({
  status,
  body: { error: code, message },
});

/** A route whose response is held open until the test resolves it. */
export function deferred<T>(): {
  handler: RouteHandler;
  resolve: (result: { status: number; body: T }) => void;
} {
  let resolve!: (result: { status: number; body: T }) => void;
  const promise = new Promise<{ status: number; body: T }>((res) => {
    resolve = res;
  });
  return { handler: () => promise, resolve };
}