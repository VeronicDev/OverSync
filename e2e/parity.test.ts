import { describe, expect, it } from "vitest";
import { MATRIX_ROWS, runMatrix } from "./authorization-matrix.js";
import { EvmHtlcSim, SorobanHtlcSim, type HtlcSim } from "./sim.js";

const CHAINS: Array<{ label: string; factory: () => HtlcSim }> = [
  { label: "EVM HTLCEscrow", factory: () => new EvmHtlcSim() },
  { label: "Soroban oversync-htlc", factory: () => new SorobanHtlcSim() }
];

/**
 * Parity check: the two contracts are one authorization matrix. If a
 * row succeeds on one chain and reverts on the other, this test fails.
 * No RPC or mainnet keys are required — the simulators re-encode the
 * contracts' claim/refund/create branch logic locally.
 */
describe("HTLC authorization parity (EVM ↔ Soroban)", () => {
  it("produces the same outcome class for every row on both chains", () => {
    const [evm, soroban] = CHAINS.map((c) => runMatrix(c.factory));
    expect(evm).toEqual(soroban);
  });

  it("keeps a single shared matrix with no gaps", () => {
    const evm = runMatrix(CHAINS[0].factory);
    const soroban = runMatrix(CHAINS[1].factory);
    const rowIds = MATRIX_ROWS.map((r) => r.id);

    expect(Object.keys(evm).sort()).toEqual([...rowIds].sort());
    expect(Object.keys(soroban).sort()).toEqual([...rowIds].sort());
  });

  for (const { label, factory } of CHAINS) {
    describe(label, () => {
      it.each(MATRIX_ROWS.map((row) => [row.id, row] as const))(
        "row %s matches the shared expectation",
        (_id, row) => {
          expect(row.run(factory())).toBe(row.expected);
        }
      );

      it("rejects an unregistered resolver trying to create", () => {
        expect(runMatrix(factory)["unregistered-resolver-creates"]).toBe("ResolverNotAuthorised");
      });

      it("rejects a second claim", () => {
        expect(runMatrix(factory)["second-claim"]).toBe("OrderNotClaimable");
      });

      it("gates claims on the registry but leaves refunds permissionless", () => {
        const results = runMatrix(factory);
        // A bound registry refuses a claim from a non-resolver...
        expect(results["unregistered-resolver-claims"]).toBe("ClaimResolverNotRegistered");
        // ...while an active resolver can still claim...
        expect(results["active-resolver-claims"]).toBe("ok");
        // ...and refunds stay permissionless.
        expect(results["unregistered-resolver-refunds"]).toBe("ok");
      });
    });
  }
});
