/**
 * Client half of the transaction-history pagination contract.
 *
 * The cursor is minted and validated by the coordinator
 * (`coordinator/src/server/routes/cursor-utils.ts`) and is opaque here: this
 * module never decodes, rebuilds, or increments it. It only echoes back the
 * exact `nextCursor` string the coordinator returned, and only *after* that
 * page has been folded into the list.
 *
 * If this file ever grows its own idea of what "the next page" is, the two
 * halves disagree and orders start disappearing or repeating.
 */

export interface HistoryPage {
  orders: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
  count: number;
}

export class HistoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'HistoryRequestError';
  }
}

/**
 * Build the history query string. `cursor` must be a token the coordinator
 * previously issued for this same user and network.
 */
export function buildHistoryQuery(input: {
  ethAddress?: string;
  stellarAddress?: string;
  network: 'testnet' | 'mainnet';
  limit?: number;
  cursor?: string | null;
}): string {
  const params = new URLSearchParams();
    // A cross-chain user holds both an EVM and a Stellar address, and the
    // coordinator matches one address per request. `address` is therefore sent
    // for the EVM side and `stellar` for the other, so both halves of the
    // user's history are reachable with the query this module builds.
    if (input.ethAddress) params.set('address', input.ethAddress);
    if (input.stellarAddress) params.set('stellar', input.stellarAddress);
  params.set('network', input.network);
  params.set('limit', String(input.limit ?? 20));
  if (input.cursor) params.set('cursor', input.cursor);
  return params.toString();
}

/**
 * Read a history response, or throw a `HistoryRequestError` carrying the
 * coordinator's own reason so the UI can show it instead of a short list.
 */
export function readHistoryPage(body: unknown): HistoryPage {
  const orders = Array.isArray((body as any)?.transactions) ? (body as any).transactions : [];
  const pagination = (body as any)?.pagination ?? {};
  const nextCursor = typeof pagination.nextCursor === 'string' ? pagination.nextCursor : null;
  return {
    orders,
    nextCursor,
    hasMore: Boolean(pagination.hasMore) && nextCursor !== null,
    count: typeof pagination.count === 'number' ? pagination.count : orders.length,
  };
}

/** Turn a non-OK response into an error the UI can render verbatim. */
export function historyErrorFromResponse(status: number, body: unknown): HistoryRequestError {
  const payload = (body ?? {}) as { error?: string; message?: string; reason?: string };
  if (payload.error === 'invalid_cursor') {
    return new HistoryRequestError(
      payload.message ?? 'The pagination cursor was rejected by the coordinator.',
      status,
      payload.reason ?? 'invalid_cursor'
    );
  }
  return new HistoryRequestError(
    payload.message ?? `Coordinator returned ${status}`,
    status,
    payload.error
  );
}

type Identified = { id: string };

/**
 * Fold a freshly fetched page into everything already on screen.
 *
 * Keyed by order id, so a row that shifted between pages appears once. Later
 * pages win: the coordinator's copy is fresher than the local cache.
 */
export function mergeHistoryPage<T extends Identified>(...pages: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const page of pages) {
    for (const order of page) {
      if (order && typeof order.id === 'string' && order.id) byId.set(order.id, order);
    }
  }
  return Array.from(byId.values());
}
