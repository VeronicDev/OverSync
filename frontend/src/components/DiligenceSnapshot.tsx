import React from 'react';
import { useDeploymentContext } from '../context/DeploymentContext';
import {
  diffDeploymentRecords,
  type DeploymentRecord,
} from '../config/deployment';
import { ETHEREUM_NETWORKS } from '../config/networks';

interface DiligenceSnapshotProps {
  selfCheckRecord: {
    registryAddress: string;
    escrowAddress: string;
    networkId: string;
    bytecodeHashes: Record<string, string>;
  };
}

/** Lift the flat context / self-check shape onto the shared record shape. */
function toDeploymentRecord(input: {
  registryAddress: string;
  escrowAddress: string;
  networkId: string;
  bytecodeHashes: Record<string, string>;
}): DeploymentRecord {
  const chainId = Number(input.networkId);
  return {
    network: null,
    ethereumChainId: Number.isFinite(chainId) && input.networkId !== '' ? chainId : null,
    ethereum: {
      escrow: input.escrowAddress,
      registry: input.registryAddress,
      escrowCodeHash: input.bytecodeHashes.HTLCEscrow ?? null,
      registryCodeHash: input.bytecodeHashes.ResolverRegistry ?? null,
    },
    stellar: { escrow: null, registry: null, escrowCodeHash: null, registryCodeHash: null },
  };
}

/**
 * Renders what a reviewer can check without trusting this app's own UI: which
 * deployment the build is configured with, and where that disagrees with the
 * addresses the running self-check reports.
 *
 * The snapshot is hidden — never quietly re-labelled — whenever the two
 * disagree, so a mismatched deployment cannot be presented as verified.
 */
export const DiligenceSnapshot: React.FC<DiligenceSnapshotProps> = ({ selfCheckRecord }) => {
  const { deploymentRecord } = useDeploymentContext();

  if (!deploymentRecord) {
    return (
      <div className="dil-snapshot" data-testid="dil-snapshot-missing">
        No deployment record available
      </div>
    );
  }

  const configured = toDeploymentRecord(deploymentRecord);
  const differingFields = diffDeploymentRecords(configured, toDeploymentRecord(selfCheckRecord));

  if (differingFields.length > 0) {
    return (
      <div className="dil-snapshot dil-snapshot--hidden" data-testid="dil-snapshot-hidden">
        <div className="dil-snapshot__warning">
          Snapshot hidden due to mismatched deployment record
        </div>
        <ul className="dil-snapshot__differences" data-testid="dil-snapshot-mismatch">
          {differingFields.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </div>
    );
  }

  const networkConfig = Object.values(ETHEREUM_NETWORKS).find(
    (n) => String(n.id) === String(configured.ethereumChainId)
  );
  const escrowHash = configured.ethereum.escrowCodeHash;

  return (
    <div className="dil-snapshot" data-testid="dil-snapshot-visible">
      <h3>Diligence Snapshot</h3>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Network:</span>
        <span className="dil-snapshot__value" data-testid="dil-snapshot-network">
          {deploymentRecord.networkId}
        </span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Ethereum:</span>
        <span className="dil-snapshot__value">
          {networkConfig?.displayName ?? networkConfig?.name ?? configured.ethereumChainId}
        </span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Registry:</span>
        <span className="dil-snapshot__value" data-testid="dil-snapshot-registry">
          {configured.ethereum.registry}
        </span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Escrow:</span>
        <span className="dil-snapshot__value" data-testid="dil-snapshot-escrow">
          {configured.ethereum.escrow}
        </span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Bytecode Hashes:</span>
        <div className="dil-snapshot__hashes" data-testid="dil-snapshot-bytecode-hashes">
          {escrowHash
            ? `HTLCEscrow: ${escrowHash.slice(0, 6)}...${escrowHash.slice(-4)}`
            : 'HTLCEscrow: not recorded'}
        </div>
      </div>
    </div>
  );
};
