import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DiligenceSnapshot } from './DiligenceSnapshot';
import { DeploymentContext } from '../context/DeploymentContext';
import { ETHEREUM_NETWORKS } from '../config/networks';

const REGISTRY = '0x2222222222222222222222222222222222222222';
const ESCROW = '0x1111111111111111111111111111111111111111';
const ESCROW_HASH = '0x' + 'a'.repeat(64);

function record(overrides: Partial<{
  registryAddress: string;
  escrowAddress: string;
  networkId: string;
}> = {}) {
  return {
    registryAddress: overrides.registryAddress ?? REGISTRY,
    escrowAddress: overrides.escrowAddress ?? ESCROW,
    networkId: overrides.networkId ?? '11155111',
    bytecodeHashes: { HTLCEscrow: ESCROW_HASH },
  };
}

function renderWith(deploymentRecord: ReturnType<typeof record>) {
  return render(
    <DeploymentContext.Provider value={{ deploymentRecord }}>
      <DiligenceSnapshot selfCheckRecord={record()} />
    </DeploymentContext.Provider>
  );
}

describe('DiligenceSnapshot', () => {
  it('renders the deployment when it matches the self-check', () => {
    renderWith(record());

    expect(screen.getByTestId('dil-snapshot-visible')).toBeInTheDocument();
    expect(screen.getByTestId('dil-snapshot-network')).toHaveTextContent('11155111');
  });

  it('names the Ethereum network for the recorded chain id', () => {
    renderWith(record());

    const expected = Object.values(ETHEREUM_NETWORKS).find((n) => String(n.id) === '11155111');
    expect(screen.getByText(expected?.displayName ?? expected?.name ?? '11155111')).toBeInTheDocument();
  });

  it('lists the registry, escrow, and truncated escrow bytecode hash', () => {
    renderWith(record());

    expect(screen.getByTestId('dil-snapshot-registry')).toHaveTextContent(REGISTRY);
    expect(screen.getByTestId('dil-snapshot-escrow')).toHaveTextContent(ESCROW);
    expect(screen.getByTestId('dil-snapshot-bytecode-hashes')).toHaveTextContent(
      `HTLCEscrow: ${ESCROW_HASH.slice(0, 6)}...${ESCROW_HASH.slice(-4)}`
    );
  });

  it('hides the snapshot and names the mismatch when the registry differs', () => {
    renderWith(record({ registryAddress: '0x3333333333333333333333333333333333333333' }));

    expect(screen.getByTestId('dil-snapshot-hidden')).toBeInTheDocument();
    expect(screen.getByTestId('dil-snapshot-mismatch')).toHaveTextContent('ethereum.registry');
  });

  it('hides the snapshot and names the mismatch when the escrow differs', () => {
    renderWith(record({ escrowAddress: '0x4444444444444444444444444444444444444444' }));

    expect(screen.getByTestId('dil-snapshot-hidden')).toBeInTheDocument();
    expect(screen.getByTestId('dil-snapshot-mismatch')).toHaveTextContent('ethereum.escrow');
  });

  it('hides the snapshot and names the mismatch when the chain id differs', () => {
    renderWith(record({ networkId: '1' }));

    expect(screen.getByTestId('dil-snapshot-hidden')).toBeInTheDocument();
    expect(screen.getByTestId('dil-snapshot-mismatch')).toHaveTextContent('ethereumChainId');
  });

  it('hides the snapshot when the bytecode hash differs', () => {
    render(
      <DeploymentContext.Provider
        value={{
          deploymentRecord: {
            ...record(),
            bytecodeHashes: { HTLCEscrow: '0x' + 'c'.repeat(64) },
          },
        }}
      >
        <DiligenceSnapshot selfCheckRecord={record()} />
      </DeploymentContext.Provider>
    );

    expect(screen.getByTestId('dil-snapshot-hidden')).toBeInTheDocument();
    expect(screen.getByTestId('dil-snapshot-mismatch')).toHaveTextContent(
      'ethereum.escrowCodeHash'
    );
  });

  it('says so when no deployment record is available', () => {
    render(
      <DeploymentContext.Provider value={{ deploymentRecord: null }}>
        <DiligenceSnapshot selfCheckRecord={record()} />
      </DeploymentContext.Provider>
    );

    expect(screen.getByTestId('dil-snapshot-missing')).toBeInTheDocument();
  });
});
