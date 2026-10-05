import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { sepolia, mainnet } from "viem/chains";
import type { Logger } from "pino";
import type { CoordinatorConfig } from "../config.js";
import type { OrderService } from "../services/order-service.js";
import { listenerLastBlock } from "../metrics.js";
import { OrderEventApplier, type BridgeOrderEvent } from "./order-events.js";

const ORDER_CREATED = parseAbiItem(
  "event OrderCreated(uint256 indexed orderId, address indexed sender, address indexed beneficiary, address token, uint256 amount, uint256 safetyDeposit, bytes32 hashlock, uint64 timelock)"
);
const ORDER_CLAIMED = parseAbiItem(
  "event OrderClaimed(uint256 indexed orderId, address indexed claimer, bytes32 preimage, uint256 amount, uint256 safetyDeposit)"
);
const ORDER_REFUNDED = parseAbiItem(
  "event OrderRefunded(uint256 indexed orderId, address indexed caller, uint256 amount, uint256 safetyDeposit)"
);

export class EthereumListener {
  private readonly client: PublicClient;
  private readonly log: Logger;
  private readonly applier: OrderEventApplier;
  private unwatchers: Array<() => void> = [];

  constructor(
    private readonly cfg: CoordinatorConfig,
    orders: OrderService,
    log: Logger
  ) {
    this.log = log.child({ component: "EthereumListener" });
    this.applier = new OrderEventApplier(orders, this.log, "ethereum-listener");
    this.client = createPublicClient({
      chain: cfg.ethereum.chainId === 1 ? mainnet : sepolia,
      transport: http(cfg.ethereum.rpcUrl)
    });
  }

  /** Log the block we are following and hand the event to the applier. */
  private async handle(blockNumber: number, event: BridgeOrderEvent): Promise<void> {
    listenerLastBlock.set({ chain: "ethereum" }, blockNumber);
    const outcome = await this.applier.apply(event);
    this.applier.logOutcome(event, outcome);
  }

  start(): void {
    if (!this.cfg.ethereum.htlcEscrow) {
      this.log.warn("ETH_HTLC_ESCROW not configured - Ethereum listener disabled");
      return;
    }
    const address = this.cfg.ethereum.htlcEscrow;
    this.log.info({ contract: address }, "starting");

    this.unwatchers.push(
      this.client.watchEvent({
        address,
        event: ORDER_CREATED,
        onLogs: (logs) => {
          void (async () => {
            for (const log of logs) {
              if (log.blockNumber == null || log.transactionHash == null) continue;
              try {
                await this.handle(Number(log.blockNumber), {
                  kind: "lock",
                  chain: "ethereum",
                  txHash: log.transactionHash,
                  blockNumber: Number(log.blockNumber),
                  orderId: log.args.orderId?.toString() ?? null,
                  hashlock: log.args.hashlock ?? null,
                  timelock: log.args.timelock != null ? Number(log.args.timelock) : null
                });
              } catch (err) {
                this.log.warn({ err, hashlock: log.args.hashlock }, "could not record src lock");
              }
            }
          })();
        }
      })
    );

    this.unwatchers.push(
      this.client.watchEvent({
        address,
        event: ORDER_CLAIMED,
        onLogs: (logs) => {
          void (async () => {
            for (const log of logs) {
              if (log.blockNumber == null || log.transactionHash == null) continue;
              try {
                await this.handle(Number(log.blockNumber), {
                  kind: "claim",
                  chain: "ethereum",
                  txHash: log.transactionHash,
                  blockNumber: Number(log.blockNumber),
                  orderId: log.args.orderId?.toString() ?? null,
                  preimage: log.args.preimage ?? null
                });
              } catch (err) {
                this.log.warn({ err, orderId: log.args.orderId?.toString() }, "could not record claim");
              }
            }
          })();
        }
      })
    );

    this.unwatchers.push(
      this.client.watchEvent({
        address,
        event: ORDER_REFUNDED,
        onLogs: (logs) => {
          void (async () => {
            for (const log of logs) {
              if (log.blockNumber == null || log.transactionHash == null) continue;
              try {
                await this.handle(Number(log.blockNumber), {
                  kind: "refund",
                  chain: "ethereum",
                  txHash: log.transactionHash,
                  blockNumber: Number(log.blockNumber),
                  orderId: log.args.orderId?.toString() ?? null
                });
              } catch (err) {
                this.log.warn({ err, orderId: log.args.orderId?.toString() }, "could not record refund");
              }
            }
          })();
        }
      })
    );
  }

  stop(): void {
    for (const u of this.unwatchers) u();
    this.unwatchers = [];
  }
}
