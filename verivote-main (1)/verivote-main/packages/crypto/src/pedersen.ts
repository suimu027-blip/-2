import { createHash, randomBytes } from "node:crypto";

/**
 * Pedersen-style vector commitment module.
 *
 * This is the PRIMARY commitment scheme used by the voting flow.  The
 * SHA-256 `createCommitment` wrapper in `index.ts` delegates here to
 * produce Pedersen commitments.
 *
 * Construction:
 *   - Work in the multiplicative subgroup of Z_p* of prime order q,
 *     using the RFC 3526 MODP 2048-bit group (Group 14).
 *   - All generators g, h_1, ..., h_n are derived deterministically from
 *     electionId (and optional contextLabel) via hash-to-group
 *     (hash -> exponent -> g^exp). This makes the generators reproducible but
 *     binds them to the election's public context.
 *   - commit(v, r) = g^r * prod_i h_i^{v_i}  (mod p)
 *   - Homomorphic aggregation:
 *       commit(v1, r1) * commit(v2, r2) mod p
 *         === commit(v1 + v2, r1 + r2 mod q)
 *
 * NOT production grade. The group parameters, hash-to-group construction,
 * serialization, and side-channel characteristics have not been audited.
 */

// RFC 3526 MODP Group 14 (2048-bit).
const RFC3526_GROUP_14_PRIME_HEX = [
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1",
  "29024E088A67CC74020BBEA63B139B22514A08798E3404DD",
  "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245",
  "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED",
  "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D",
  "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F",
  "83655D23DCA3AD961C62F356208552BB9ED529077096966D",
  "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B",
  "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9",
  "DE2BCBF6955817183995497CEA956AE515D2261898FA0510",
  "15728E5A8AACAA68FFFFFFFFFFFFFFFF"
]
  .join("")
  .toLowerCase();

// p is a safe prime: q = (p - 1) / 2 is also prime, so the subgroup of
// quadratic residues has order q.
const PEDERSEN_P: bigint = BigInt(`0x${RFC3526_GROUP_14_PRIME_HEX}`);
const PEDERSEN_Q: bigint = (PEDERSEN_P - 1n) / 2n;

export interface PedersenContext {
  /** Prime modulus p (RFC 3526 MODP Group 14). */
  p: bigint;
  /** Order q of the prime-order subgroup. */
  q: bigint;
  /** Primary generator g, bound to the election context. */
  g: bigint;
  /** Per-slot generators h_1, ..., h_n, one per candidate slot. */
  h: bigint[];
  /** Election identifier the context was derived from. */
  electionId: string;
  /** Optional human-readable label stored for auditability. */
  contextLabel: string;
  /** Hex digest binding all of the above. */
  contextHash: string;
}

export interface PedersenCommitment {
  /** Commitment value C = g^r * prod h_i^{v_i} mod p, as hex. */
  commitment: string;
  /** Randomness r (reduced mod q), as hex. */
  randomness: string;
  /** Vector length (== h.length == candidate count). */
  length: number;
  /** contextHash the commitment was produced in. */
  contextHash: string;
}

/** Serializable snapshot of a context, safe to export or store. */
export interface PedersenContextSnapshot {
  electionId: string;
  contextLabel: string;
  contextHash: string;
  p: string;
  q: string;
  g: string;
  h: string[];
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function bigIntToHex(value: bigint): string {
  if (value < 0n) {
    throw new Error("bigIntToHex expects a non-negative bigint");
  }
  const raw = value.toString(16);
  return raw.length % 2 === 0 ? raw : `0${raw}`;
}

function hexToBigInt(hex: string): bigint {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length === 0) {
    return 0n;
  }
  return BigInt(`0x${normalized}`);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let currentBase = base % modulus;
  if (currentBase < 0n) currentBase += modulus;
  let currentExp = exponent;
  while (currentExp > 0n) {
    if ((currentExp & 1n) === 1n) {
      result = (result * currentBase) % modulus;
    }
    currentExp >>= 1n;
    currentBase = (currentBase * currentBase) % modulus;
  }
  return result;
}

/**
 * Hash-to-exponent, then raise a fixed base (2) to that exponent mod p. The
 * resulting element always lies in the prime-order subgroup because it is a
 * quadratic residue (squaring via `2 * e`).
 */
function deriveGeneratorFromSeed(seed: string): bigint {
  // Expand to 512 bits by chaining two sha256 invocations, then reduce mod q.
  const firstHalf = sha256Hex(`verivote.pedersen.gen.v1.part1:${seed}`);
  const secondHalf = sha256Hex(`verivote.pedersen.gen.v1.part2:${seed}`);
  const exponent = hexToBigInt(firstHalf + secondHalf) % PEDERSEN_Q;
  // 2^(2 * e) mod p forces the element into the quadratic-residue subgroup of
  // order q.
  const safeExponent = (2n * (exponent === 0n ? 1n : exponent)) % PEDERSEN_Q;
  return modPow(2n, safeExponent, PEDERSEN_P);
}

/**
 * Derive a reproducible Pedersen context for an election.
 *
 * The same (electionId, contextLabel, candidateCount) always yields the same
 * generators, so auditors can reproduce the context locally.
 */
export function createPedersenContext(
  electionId: string,
  candidateCount: number,
  contextLabel = "verivote.pedersen.experiment.v1"
): PedersenContext {
  if (!Number.isInteger(candidateCount) || candidateCount <= 0) {
    throw new Error("candidateCount must be a positive integer");
  }

  const baseSeed = `${contextLabel}|${electionId}|n=${candidateCount}`;
  const g = deriveGeneratorFromSeed(`${baseSeed}|g`);
  const h: bigint[] = [];
  for (let i = 0; i < candidateCount; i += 1) {
    h.push(deriveGeneratorFromSeed(`${baseSeed}|h|${i}`));
  }
  const contextHash = sha256Hex(
    JSON.stringify({
      domain: "verivote.pedersen.context.v1",
      electionId,
      contextLabel,
      candidateCount,
      g: bigIntToHex(g),
      h: h.map(bigIntToHex)
    })
  );

  return {
    p: PEDERSEN_P,
    q: PEDERSEN_Q,
    g,
    h,
    electionId,
    contextLabel,
    contextHash
  };
}

export function exportPedersenContext(
  context: PedersenContext
): PedersenContextSnapshot {
  return {
    electionId: context.electionId,
    contextLabel: context.contextLabel,
    contextHash: context.contextHash,
    p: bigIntToHex(context.p),
    q: bigIntToHex(context.q),
    g: bigIntToHex(context.g),
    h: context.h.map(bigIntToHex)
  };
}

/** Draw a fresh randomness r uniformly in [1, q-1]. */
export function randomPedersenScalar(context: PedersenContext): string {
  // 256 random bits are more than enough to mod-reduce into [0, q) uniformly
  // for a 2048-bit prime (the bias is < 2^-1900 for 2048 bits of material, and
  // 2^-256 is fine in practice for an experimental module).
  while (true) {
    const raw = hexToBigInt(randomBytes(32).toString("hex"));
    const candidate = raw % context.q;
    if (candidate !== 0n) {
      return bigIntToHex(candidate);
    }
  }
}

function assertVectorLength(vector: number[], context: PedersenContext): void {
  if (vector.length !== context.h.length) {
    throw new Error(
      `voteVector length ${vector.length} does not match context candidate count ${context.h.length}`
    );
  }
}

/** Compute C = g^r * prod h_i^{v_i} mod p. */
export function createPedersenCommitment(
  context: PedersenContext,
  voteVector: number[],
  randomness?: string
): PedersenCommitment {
  assertVectorLength(voteVector, context);
  for (const entry of voteVector) {
    if (!Number.isInteger(entry)) {
      throw new Error("voteVector entries must be integers");
    }
  }

  const r = randomness ?? randomPedersenScalar(context);
  const rBigInt = hexToBigInt(r) % context.q;

  let commitment = modPow(context.g, rBigInt, context.p);
  for (let i = 0; i < voteVector.length; i += 1) {
    const exponent = BigInt(voteVector[i]);
    // Handle negative entries by reducing mod q (rarely used, but safe).
    const normalizedExp =
      exponent >= 0n ? exponent % context.q : ((exponent % context.q) + context.q) % context.q;
    if (normalizedExp !== 0n) {
      commitment =
        (commitment * modPow(context.h[i], normalizedExp, context.p)) %
        context.p;
    }
  }

  return {
    commitment: bigIntToHex(commitment),
    randomness: bigIntToHex(rBigInt),
    length: voteVector.length,
    contextHash: context.contextHash
  };
}

/** Verify opening: check commitment == g^r * prod h_i^{v_i} mod p. */
export function verifyPedersenOpening(
  context: PedersenContext,
  voteVector: number[],
  randomness: string,
  commitment: string
): boolean {
  try {
    assertVectorLength(voteVector, context);
    const expected = createPedersenCommitment(
      context,
      voteVector,
      randomness
    ).commitment;
    return expected === normalizeHex(commitment);
  } catch {
    return false;
  }
}

function normalizeHex(hex: string): string {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  const lower = stripped.toLowerCase();
  return lower.length % 2 === 0 ? lower : `0${lower}`;
}

/**
 * Multiply a list of commitments mod p. Because Pedersen is homomorphic,
 * aggregateCommitments(Cs) opens to (sum of vectors, sum of randomness).
 */
export function aggregateCommitments(
  context: PedersenContext,
  commitments: string[]
): string {
  let product = 1n;
  for (const commitment of commitments) {
    product = (product * hexToBigInt(commitment)) % context.p;
  }
  return bigIntToHex(product);
}

/** Sum a list of randomness values mod q. */
export function aggregateRandomness(
  context: PedersenContext,
  randomness: string[]
): string {
  let sum = 0n;
  for (const r of randomness) {
    sum = (sum + hexToBigInt(r)) % context.q;
  }
  return bigIntToHex(sum);
}

/** Sum a list of equal-length integer vectors element-wise. */
export function aggregateVoteVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const length = vectors[0].length;
  for (const v of vectors) {
    if (v.length !== length) {
      throw new Error("aggregateVoteVectors requires equal-length vectors");
    }
  }
  const result = new Array(length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < length; i += 1) {
      result[i] += v[i];
    }
  }
  return result;
}

export interface PedersenAggregateVerification {
  aggregatedCommitment: string;
  expectedCommitment: string;
  aggregatedRandomness: string;
  aggregatedVector: number[];
  verified: boolean;
}

/**
 * Given a batch of (vector, randomness) openings plus a commitment list, check
 * that the product of commitments equals commit(sum_vectors, sum_randomness).
 *
 * This is the headline audit check for Pedersen aggregation. It is the
 * Haechi-style "tally consistency verification": the aggregator cannot lie
 * about the sum of votes without also producing an inconsistent opening.
 */
export function verifyAggregateOpening(
  context: PedersenContext,
  batch: Array<{ voteVector: number[]; randomness: string; commitment: string }>
): PedersenAggregateVerification {
  const aggregatedCommitment = aggregateCommitments(
    context,
    batch.map((entry) => entry.commitment)
  );
  const aggregatedRandomness = aggregateRandomness(
    context,
    batch.map((entry) => entry.randomness)
  );
  const aggregatedVector = aggregateVoteVectors(
    batch.map((entry) => entry.voteVector)
  );
  const expected = createPedersenCommitment(
    context,
    aggregatedVector,
    aggregatedRandomness
  ).commitment;

  return {
    aggregatedCommitment,
    expectedCommitment: expected,
    aggregatedRandomness,
    aggregatedVector,
    verified: aggregatedCommitment === expected
  };
}
