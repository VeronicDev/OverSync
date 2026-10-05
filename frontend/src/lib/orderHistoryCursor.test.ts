import { describe, test, expect } from 'vitest';
import {
  buildHistoryQuery,
  historyErrorFromResponse,
  mergeHistoryPage,
  readHistoryPage,
} from './orderHistoryCursor';

const USER = '0x1111111111111111111111111111111111111111';
const STELLAR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422';

describe('buildHistoryQuery', () => {
  test('always declares the network so a cursor can be bound to it', () => {
    const query = buildHistoryQuery({ ethAddress: USER, network: 'testnet' });
    expect(new URLSearchParams(query).get('network')).toBe('testnet');
  });

  test('sends no cursor on the first page', () => {
    const query = buildHistoryQuery({ ethAddress: USER, network: 'testnet' });
    expect(new URLSearchParams(query).has('cursor')).toBe(false);
  });

  test('echoes the coordinator cursor back unchanged', () => {
    const opaque = 'eyJ2IjoxLCJjIjoxNzAwMDAwMDAwMCwicCI6ImFhYWFhIn0';
    const query = buildHistoryQuery({ ethAddress: USER, network: 'testnet', cursor: opaque });
    expect(new URLSearchParams(query).get('cursor')).toBe(opaque);
  });

  test('ignores a null cursor', () => {
    const query = buildHistoryQuery({ ethAddress: USER, network: 'mainnet', cursor: null });
    expect(new URLSearchParams(query).has('cursor')).toBe(false);
  });

  test('carries both addresses when the user has one of each', () => {
    const params = new URLSearchParams(
      buildHistoryQuery({ ethAddress: USER, stellarAddress: STELLAR, network: 'testnet' })
    );
    expect(params.get('address')).toBe(USER);
    expect(params.get('stellar')).toBe(STELLAR);
  });
});

describe('readHistoryPage', () => {
  test('reads the next cursor as an opaque string', () => {
    const page = readHistoryPage({
      transactions: [{ id: 'a' }],
      pagination: { limit: 5, count: 1, hasMore: true, nextCursor: 'opaque-token' },
    });
    expect(page.nextCursor).toBe('opaque-token');
    expect(page.hasMore).toBe(true);
  });

  test('treats a missing nextCursor as the end of history', () => {
    const page = readHistoryPage({ transactions: [{ id: 'a' }], pagination: { hasMore: true } });
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  test('tolerates a response with no pagination block', () => {
    const page = readHistoryPage({ transactions: [{ id: 'a' }] });
    expect(page.orders).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  test('tolerates a non-array transactions field', () => {
    expect(readHistoryPage({ transactions: null }).orders).toEqual([]);
  });
});

describe('historyErrorFromResponse', () => {
  test('passes the coordinator reason through for an invalid cursor', () => {
    const err = historyErrorFromResponse(400, {
      error: 'invalid_cursor',
      reason: 'network_mismatch',
      message: 'Cursor was issued for a different network',
    });
    expect(err.status).toBe(400);
    expect(err.code).toBe('network_mismatch');
    expect(err.message).toBe('Cursor was issued for a different network');
  });

  test('falls back to a readable message for other failures', () => {
    expect(historyErrorFromResponse(500, {}).message).toBe('Coordinator returned 500');
  });

  test('handles a non-JSON body', () => {
    expect(historyErrorFromResponse(502, null).message).toBe('Coordinator returned 502');
  });
});

describe('mergeHistoryPage', () => {
  test('keys orders by id so a shifted row appears once', () => {
    const merged = mergeHistoryPage(
      [{ id: 'a', n: 1 }, { id: 'b', n: 1 }],
      [{ id: 'b', n: 1 }, { id: 'c', n: 1 }]
    );
    expect(merged.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  test('lets a later page win over an earlier one', () => {
    const merged = mergeHistoryPage([{ id: 'a', n: 1 }], [{ id: 'a', n: 2 }]);
    expect(merged).toEqual([{ id: 'a', n: 2 }]);
  });

  test('drops rows with no usable id', () => {
    const merged = mergeHistoryPage([{ id: '' }, { id: 'a' }] as Array<{ id: string }>);
    expect(merged.map((o) => o.id)).toEqual(['a']);
  });

  test('returns an empty list for no pages', () => {
    expect(mergeHistoryPage()).toEqual([]);
  });
});
