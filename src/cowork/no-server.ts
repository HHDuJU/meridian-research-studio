/*
 * Meridian on Cowork has no app server. If any module still reaches for a server function, the
 * build keeps working and the call fails with a readable message instead of posting to a server
 * that does not exist.
 */
type Handler = (...args: unknown[]) => unknown;

export function createServerFn(_opts?: unknown) {
  const refuse = () => async () => {
    throw new Error("This action needs Meridian's server, which the Cowork edition does not have.");
  };
  const builder = {
    validator: (_v: unknown) => builder,
    inputValidator: (_v: unknown) => builder,
    middleware: (_m: unknown) => builder,
    handler: (_h: Handler) => refuse(),
  };
  return builder;
}

export function createMiddleware() {
  const m = { server: () => m, client: () => m, validator: () => m };
  return m;
}
