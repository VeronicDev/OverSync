import { randomBytes } from "node:crypto";
import type { Logger } from "pino";

export interface QuoteTerms {
  srcChain: "ethereum" | "stellar";
  srcAsset: string;
  srcAmount: string;
  dstChain: "ethereum" | "stellar";
  dstAsset: string;
  dstAmount: string;
}

export interface PriceQuote {
  /** Stable opaque id that callers can reference back to this exact quote. */
  quoteId: string;
  pair: string;
  srcChain: QuoteTerms["srcChain"];
  srcAsset: string;
  srcAmount: string;
  dstChain: QuoteTerms["dstChain"];
  dstAsset: string;
  dstAmount: string;
  /** Decimal string. `srcUsd` and `dstUsd` are USD per unit of src/dst. */
  srcUsd: string | null;
  dstUsd: string | null;
  /** Source: coingecko, oneinch, cache, etc. */
  source: "coingecko" | "oneinch" | "cache" | "unknown";
  /** Unix ms when the quote was first issued. */
  issuedAt: number;
  /** Unix ms after which this quote must not be used to fill an order. */
  expiresAt: number;
  /** Order terms accepted with this quote, when it has been used to announce an order. */
  terms?: {
    fromAsset: string;
    toAsset: string;
    amount: string;
    fromNetwork: string;
    toNetwork: string;
  };
  /** Base-unit integer the quote was bound to, when the caller supplied one. */
  amountBaseUnits?: string;
  /**
   * Which order terms the caller actually quoted. A quote issued for an amount
   * alone carries none of them, so `assertMatches` must not compare defaults
   * it invented against the order's real terms.
   */
  quotedTerms?: QuoteTerms;
}

export class AmountParseError extends Error {
  constructor(public readonly raw: string) {
    super(`Invalid amount: ${JSON.stringify(raw)}`);
    this.name = "AmountParseError";
  }
}

export class QuoteAmountMismatchError extends Error {
  constructor(
    public readonly quoteId: string,
    public readonly expected: string,
    public readonly actual: string | bigint
  ) {
    super(`Order amount ${String(actual)} does not match quote ${quoteId} amount ${expected}`);
    this.name = "QuoteAmountMismatchError";
  }
}

const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;
const BASE_UNIT_INTEGER = /^(0|[1-9]\d*)$/;

/**
 * Parse a decimal amount into token base units using only string/BigInt
 * arithmetic (no floating point). Throws `AmountParseError` for empty
 * input, signs, exponents, non-digits, or more fractional digits than
 * `decimals` allows. Mirrors `frontend/src/lib/sanitizeAmountInput.ts`.
 */
export function parseAmountToBaseUnits(raw: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new AmountParseError(raw);
  const match = DECIMAL_AMOUNT.exec(raw.trim());
  if (!match) throw new AmountParseError(raw);
  const whole = match[1] ?? "0";
  const frac = match[2] ?? match[3] ?? "";
  if (frac.length > decimals) throw new AmountParseError(raw);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Parse an already-base-unit integer string. Throws `AmountParseError` when malformed. */
export function parseBaseUnitInteger(raw: string): bigint {
  if (!BASE_UNIT_INTEGER.test(raw.trim())) throw new AmountParseError(raw);
  return BigInt(raw.trim());
}

export class QuoteExpiredError extends Error {
  constructor(
    public readonly quoteId: string,
    public readonly expiredMs: number
  ) {
    const staleMs = Date.now() - expiredMs;
    super(`Quote ${quoteId} expired ${staleMs} ms ago`);
    this.name = "QuoteExpiredError";
  }
}

export class QuoteNotFoundError extends Error {
  constructor(public readonly quoteId: string) {
    super(`Quote ${quoteId} not found or already evicted`);
    this.name = "QuoteNotFoundError";
  }
}

export class QuoteTermsMismatchError extends Error {
  constructor(public readonly quoteId: string) {
    super(`Order terms do not match quote ${quoteId}`);
    this.name = "QuoteTermsMismatchError";
  }
}

/**
 * Minimal real-data price service. Reads from CoinGecko's free
 * (no-API-key) endpoint; if the call fails we surface a `null` price
 * instead of a fabricated number, so callers can decide to render
 * "price unavailable" rather than misleading data.
 *
 * Every response carries a `quoteId` that resolvers (and the order
 * announce endpoint) can reference.  `assertFresh(quoteId)` rejects
 * fills that reference stale quotes before any chain action is
 * attempted, satisfying the quote-freshness enforcement requirement.
 */
export class QuoteService {
  /** In-flight / recently-issued quotes, keyed by quoteId. */
  private readonly quotes = new Map<string, PriceQuote>();
  /** Cached CoinGecko response, keyed by pair name. */
  private readonly priceCache = new Map<string, { srcUsd: string | null; dstUsd: string | null; expiresAt: number }>();
  private readonly cacheTtlMs = 30_000;

  constructor(
    private readonly log: Logger,
    /** Injected for testing — defaults to Date.now(). */
    private readonly now: () => number = Date.now
  ) {}

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Fetch (or return a cached) ETH/XLM price quote.
   * The returned object always has a unique `quoteId` so callers
   * can reference it when announcing an order.
   */
  async quoteEthXlm(
    terms?: Partial<QuoteTerms> & { amountBaseUnits?: string }
  ): Promise<PriceQuote> {
    if (terms?.amountBaseUnits !== undefined) {
      // Validate eagerly so a malformed amount never becomes a quote.
      parseBaseUnitInteger(terms.amountBaseUnits);
    }
    // Only remember the terms the caller actually quoted. Filling in defaults
    // for the rest would make `assertMatches` compare terms the caller never
    // asked to be quoted against.
    const quotedTerms: QuoteTerms | undefined =
      terms?.srcChain !== undefined &&
      terms?.srcAsset !== undefined &&
      terms?.srcAmount !== undefined &&
      terms?.dstChain !== undefined &&
      terms?.dstAsset !== undefined &&
      terms?.dstAmount !== undefined
        ? {
            srcChain: terms.srcChain,
            srcAsset: terms.srcAsset,
            srcAmount: terms.srcAmount,
            dstChain: terms.dstChain,
            dstAsset: terms.dstAsset,
            dstAmount: terms.dstAmount,
          }
        : undefined;
    const fullTerms: QuoteTerms = quotedTerms ?? {
      srcChain: "ethereum",
      srcAsset: "native",
      srcAmount: terms?.amountBaseUnits ?? "0",
      dstChain: "stellar",
      dstAsset: "native",
      dstAmount: "0",
    };
    const cached = this.priceCache.get("ETH-XLM");
    if (cached && this.now() < cached.expiresAt) {
      return this.issueQuote(
        fullTerms,
        cached.srcUsd,
        cached.dstUsd,
        "cache",
        cached.expiresAt,
        undefined,
        terms?.amountBaseUnits,
        quotedTerms
      );
    }

    let ethUsd: string | null = null;
    let xlmUsd: string | null = null;
    let source: PriceQuote["source"] = "unknown";

    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,stellar&vs_currencies=usd",
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const body = (await res.json()) as Record<string, { usd?: number }>;
      ethUsd = body.ethereum?.usd?.toString() ?? null;
      xlmUsd = body.stellar?.usd?.toString() ?? null;
      source = "coingecko";
    } catch (err) {
      this.log.warn({ err }, "coingecko quote failed — returning null prices");
    }

    const issuedAt = this.now();
    const expiresAt = issuedAt + this.cacheTtlMs;
    this.priceCache.set("ETH-XLM", { srcUsd: ethUsd, dstUsd: xlmUsd, expiresAt });
    return this.issueQuote(
      fullTerms,
      ethUsd,
      xlmUsd,
      source,
      expiresAt,
      issuedAt,
      terms?.amountBaseUnits,
      quotedTerms
    );
  }

  /**
   * Look up a previously issued quote by its id.
   * Returns `null` when the quote has been evicted (too old) or
   * was never known.
   */
  getById(quoteId: string): PriceQuote | null {
    return this.quotes.get(quoteId) ?? null;
  }

  bindOrderTerms(
    quoteId: string,
    terms: NonNullable<PriceQuote["terms"]>
  ): PriceQuote {
    const quote = this.assertFresh(quoteId);
    quote.terms = terms;
    return quote;
  }

  /**
   * Assert that a quote exists **and** has not expired.
   *
   * Throws `QuoteNotFoundError` when the id is unknown.
   * Throws `QuoteExpiredError` when `now > expiresAt`.
   *
   * Resolvers and the order-announce handler call this before
   * attempting any on-chain action so fills using stale prices
   * are rejected deterministically before gas is spent.
   *
   * When `orderAmountBaseUnits` is given and the quote was issued for an
   * amount, the two integers must be identical, otherwise
   * `QuoteAmountMismatchError` is thrown.
   */
  assertFresh(quoteId: string, orderAmountBaseUnits?: string): PriceQuote {
    const quote = this.quotes.get(quoteId);
    if (!quote) {
      throw new QuoteNotFoundError(quoteId);
    }
    if (this.now() > quote.expiresAt) {
      this.log.warn(
        { quoteId, expiredMs: quote.expiresAt, nowMs: this.now() },
        "stale quote rejected"
      );
      throw new QuoteExpiredError(quoteId, quote.expiresAt);
    }
    if (quote.amountBaseUnits !== undefined && orderAmountBaseUnits !== undefined) {
      const orderAmount = parseBaseUnitInteger(orderAmountBaseUnits);
      if (orderAmount.toString() !== quote.amountBaseUnits) {
        throw new QuoteAmountMismatchError(quoteId, quote.amountBaseUnits, orderAmount);
      }
    }
    return quote;
  }

  /**
   * Assert the order's terms are the ones that were quoted.
   *
   * Only compares the terms the quote actually carries: a quote issued for an
   * amount alone has no terms to check, and the amount gate in `assertFresh`
   * already covers it.
   */
  assertMatches(quoteId: string, terms: QuoteTerms): PriceQuote {
    const quote = this.assertFresh(quoteId);
    const quoted = quote.quotedTerms;
    if (
      quoted &&
      (quoted.srcChain !== terms.srcChain ||
        quoted.srcAsset !== terms.srcAsset ||
        quoted.srcAmount !== terms.srcAmount ||
        quoted.dstChain !== terms.dstChain ||
        quoted.dstAsset !== terms.dstAsset ||
        quoted.dstAmount !== terms.dstAmount)
    ) {
      throw new QuoteTermsMismatchError(quoteId);
    }
    return quote;
  }

  /**
   * Remove all quotes whose `expiresAt` is in the past.
   * Called periodically to prevent unbounded memory growth.
   */
  evictExpired(): number {
    const now = this.now();
    let count = 0;
    for (const [id, q] of this.quotes) {
      if (now > q.expiresAt) {
        this.quotes.delete(id);
        count++;
      }
    }
    if (count > 0) {
      this.log.debug({ evicted: count }, "expired quotes evicted");
    }
    return count;
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  private newQuoteId(): string {
    return randomBytes(16).toString("hex");
  }

  private issueQuote(
    terms: QuoteTerms,
    srcUsd: string | null,
    dstUsd: string | null,
    source: PriceQuote["source"],
    expiresAt: number,
    issuedAt = this.now(),
    amountBaseUnits?: string,
    quotedTerms?: QuoteTerms
  ): PriceQuote {
    const quote: PriceQuote = {
      ...terms,
      quoteId: this.newQuoteId(),
      pair: "ETH-XLM",
      srcUsd,
      dstUsd,
      source,
      issuedAt,
      expiresAt,
      ...(amountBaseUnits !== undefined ? { amountBaseUnits } : {}),
      ...(quotedTerms !== undefined ? { quotedTerms } : {}),
    };
    this.quotes.set(quote.quoteId, quote);
    this.log.debug({ quoteId: quote.quoteId, source }, "quote issued");
    return quote;
  }
}
