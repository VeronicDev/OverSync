import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuditGateTimeline, {
  AUDIT_GATES,
  COORDINATOR_STATUS_TO_STEP,
  ORDER_TIMELINE_STEPS,
  initialOrderTimeline,
  orderTimelineReducer,
  OrderStatusTimeline,
  type CoordinatorOrderResponse,
} from '../AuditGateTimeline';

const order = (publicId: string, status: string): CoordinatorOrderResponse => ({
  publicId,
  status,
});

describe('AuditGateTimeline (launch gates)', () => {
  it('renders every gate with an honest status label', () => {
    render(<AuditGateTimeline />);

    for (const gate of AUDIT_GATES) {
      expect(screen.getByTestId(`audit-gate-${gate.id}`)).toHaveAttribute(
        'data-status',
        gate.status
      );
      expect(screen.getByTestId(`audit-gate-status-${gate.id}`)).toHaveTextContent(
        gate.status === 'in_progress' ? 'In progress' : gate.status === 'complete' ? 'Complete' : gate.status === 'blocked' ? 'Blocked' : 'Planned'
      );
    }
  });

  it('shows TBD rather than an invented date when a gate has no target', () => {
    render(<AuditGateTimeline />);

    const untargeted = AUDIT_GATES.find((gate) => !gate.target);
    expect(untargeted).toBeDefined();
    expect(screen.getByTestId(`audit-gate-target-${untargeted!.id}`)).toHaveTextContent('TBD');
  });

  it('shows the target quarter for gates that have one', () => {
    render(<AuditGateTimeline />);

    const targeted = AUDIT_GATES.find((gate) => gate.target);
    expect(targeted).toBeDefined();
    expect(screen.getByTestId(`audit-gate-target-${targeted!.id}`)).toHaveTextContent(
      targeted!.target as string
    );
  });

  it('never implies mainnet v2 is live before the audit gate closes', () => {
    const externalAudit = AUDIT_GATES.find((gate) => gate.id === 'external-audit');
    const mainnet = AUDIT_GATES.find((gate) => gate.id === 'mainnet-v2-enablement');
    expect(externalAudit?.status).toBe('planned');
    expect(mainnet?.status).toBe('planned');
  });

  it('links the artifact for gates that record one', () => {
    render(<AuditGateTimeline />);

    const withArtifact = AUDIT_GATES.find((gate) => gate.artifactHref);
    expect(withArtifact).toBeDefined();
    expect(screen.getByRole('link', { name: withArtifact!.artifactLabel as string })).toHaveAttribute(
      'href',
      withArtifact!.artifactHref as string
    );
  });

  it('renders an override gate list and hides the intro when asked', () => {
    render(<AuditGateTimeline showIntro={false} gates={AUDIT_GATES.slice(0, 1)} />);

    expect(screen.queryByText('Audit-gate timeline')).not.toBeInTheDocument();
    expect(screen.getByTestId(`audit-gate-${AUDIT_GATES[0]!.id}`)).toBeInTheDocument();
    expect(
      screen.queryByTestId(`audit-gate-${AUDIT_GATES[1]!.id}`)
    ).not.toBeInTheDocument();
  });
});

describe('orderTimelineReducer', () => {
  it('starts empty for a tracked order', () => {
    const state = initialOrderTimeline('order-1');
    expect(state).toEqual({
      orderId: 'order-1',
      completed: [],
      pending: [],
      error: null,
    });
  });

  it('completes a step only on a coordinator status for that same order', () => {
    const tracked = orderTimelineReducer(initialOrderTimeline('order-1'), {
      type: 'track',
      orderId: 'order-1',
    });
    const locked = orderTimelineReducer(tracked, {
      type: 'order',
      orderId: 'order-1',
      status: 'src_locked',
    });
    expect(locked.completed).toEqual(['escrow']);

    const revealed = orderTimelineReducer(locked, {
      type: 'order',
      orderId: 'order-1',
      status: 'secret_revealed',
    });
    expect(revealed.completed).toEqual(['escrow', 'secret']);
  });

  it('ignores a late response for a different order', () => {
    const tracked = orderTimelineReducer(initialOrderTimeline('order-1'), {
      type: 'track',
      orderId: 'order-1',
    });
    const locked = orderTimelineReducer(tracked, {
      type: 'order',
      orderId: 'order-1',
      status: 'src_locked',
    });
    const afterOther = orderTimelineReducer(locked, {
      type: 'order',
      orderId: 'order-2',
      status: 'secret_revealed',
    });
    expect(afterOther.completed).toEqual(['escrow']);
  });

  it('never treats a local click as a completed step', () => {
    const tracked = orderTimelineReducer(initialOrderTimeline('order-1'), {
      type: 'track',
      orderId: 'order-1',
    });
    const local = orderTimelineReducer(tracked, { type: 'local', step: 'claim' });
    expect(local.completed).toEqual([]);
    expect(local.pending).toEqual(['claim']);
  });

  it('clears a pending step once the coordinator confirms it', () => {
    const tracked = orderTimelineReducer(initialOrderTimeline('order-1'), {
      type: 'track',
      orderId: 'order-1',
    });
    const local = orderTimelineReducer(tracked, { type: 'local', step: 'secret' });
    const confirmed = orderTimelineReducer(local, {
      type: 'order',
      orderId: 'order-1',
      status: 'secret_revealed',
    });
    expect(confirmed.pending).toEqual([]);
    expect(confirmed.completed).toEqual(['secret']);
  });

  it('halts on a terminal coordinator status', () => {
    const tracked = orderTimelineReducer(initialOrderTimeline('order-1'), {
      type: 'track',
      orderId: 'order-1',
    });
    const refunded = orderTimelineReducer(tracked, {
      type: 'order',
      orderId: 'order-1',
      status: 'refunded',
    });
    expect(refunded.error).toBe('Order refunded');
  });

  it('reports an unknown coordinator status instead of keeping the last success', () => {
    const tracked = orderTimelineReducer(initialOrderTimeline('order-1'), {
      type: 'track',
      orderId: 'order-1',
    });
    const locked = orderTimelineReducer(tracked, {
      type: 'order',
      orderId: 'order-1',
      status: 'src_locked',
    });
    const unknown = orderTimelineReducer(locked, {
      type: 'order',
      orderId: 'order-1',
      status: 'not_a_status',
    });
    expect(unknown.error).toMatch(/not_a_status/);
    expect(unknown.completed).toEqual([]);
  });

  it('resets when tracking a different order', () => {
    const locked = orderTimelineReducer(
      orderTimelineReducer(initialOrderTimeline('order-1'), { type: 'track', orderId: 'order-1' }),
      { type: 'order', orderId: 'order-1', status: 'src_locked' }
    );
    const switched = orderTimelineReducer(locked, { type: 'track', orderId: 'order-2' });
    expect(switched.completed).toEqual([]);
    expect(switched.orderId).toBe('order-2');
  });

  it('maps every coordinator status to a known effect', () => {
    for (const status of [
      'announced',
      'src_locked',
      'dst_locked',
      'secret_revealed',
      'completed',
      'refunded',
      'failed',
      'expired',
    ]) {
      expect(COORDINATOR_STATUS_TO_STEP[status]).toBeDefined();
    }
  });
});

describe('OrderStatusTimeline', () => {
  it('renders one row per step, none confirmed before the coordinator answers', async () => {
    render(
      <OrderStatusTimeline
        orderId="order-1"
        fetchOrder={() => Promise.resolve(order('order-1', 'announced'))}
      />
    );

    for (const step of ORDER_TIMELINE_STEPS) {
      const row = await screen.findByTestId(`order-step-${step.id}`);
      expect(row).toHaveAttribute('data-status', 'not_started');
    }
  });

  it('confirms a step from the coordinator response for the tracked order', async () => {
    render(
      <OrderStatusTimeline
        orderId="order-1"
        fetchOrder={() => Promise.resolve(order('order-1', 'src_locked'))}
      />
    );

    expect(await screen.findByTestId('order-step-escrow')).toHaveAttribute(
      'data-status',
      'complete'
    );
  });

  it('keeps a local click awaiting confirmation rather than complete', async () => {
    render(
      <OrderStatusTimeline
        orderId="order-1"
        fetchOrder={() => Promise.resolve(order('order-1', 'announced'))}
      />
    );

    const row = await screen.findByTestId('order-step-escrow');
    const button = within(row).getByRole('button', { name: 'I did this' });
    button.click();
    expect(await screen.findByTestId('order-step-escrow')).toHaveAttribute(
      'data-status',
      'awaiting_coordinator'
    );
  });

  it('shows a halted order as an error row', async () => {
    render(
      <OrderStatusTimeline
        orderId="order-1"
        fetchOrder={() => Promise.resolve(order('order-1', 'failed'))}
      />
    );

    expect(await screen.findByTestId('order-step-error')).toHaveTextContent('Order failed');
  });
});
