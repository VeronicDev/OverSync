import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OrderStaleBanner from './OrderStaleBanner';
import type { FreshnessResult } from '../lib/orderFreshness';

function freshness(label: FreshnessResult['label'], hint = ''): FreshnessResult {
  return { label, hint };
}

describe('OrderStaleBanner', () => {
  it('does not render when order is fresh', () => {
    const { container } = render(
      <OrderStaleBanner freshness={freshness('fresh')} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a status hint when the order is stale', () => {
    render(
      <OrderStaleBanner freshness={freshness('stale', 'This order is taking longer than usual')} />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
  });

  it('renders the pending hint while an order is still progressing', () => {
    render(
      <OrderStaleBanner freshness={freshness('pending', 'Still processing')} />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/still processing/i)).toBeInTheDocument();
  });

  it('renders a refund hint when the refund window is close', () => {
    render(
      <OrderStaleBanner freshness={freshness('refund-soon', 'The refund window opens soon')} />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/refund window opens soon/i)).toBeInTheDocument();
  });

  it('renders the refund-eligible hint once the timelock has passed', () => {
    render(
      <OrderStaleBanner freshness={freshness('refund-eligible', 'You can refund this order now')} />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/refund this order now/i)).toBeInTheDocument();
  });
});
