import { createHash, randomBytes } from "node:crypto";
import {
  createPedersenContext,
  createPedersenCommitment,
  verifyPedersenOpening
} from "./pedersen.js";

export * from "./pedersen.js";

export interface MerkleProofItem {
  sibling: string;
  position: "left" | "right";
}

export interface ReceiptChainVote {
  voteId?: string;
  id?: string;
  electionId: string;
  receiptCode: string;
  commitment: string;
  receiptChainIndex?: number;
  previousReceiptCodeHash?: string | null;
  receiptChainHash?: string;
}

export interface ReceiptChainBreak {
  voteId?: string;
  index: number;
  reason: string;
}

export interface ReceiptChainVerificationResult {
  verified: boolean;
  breaks: ReceiptChainBreak[];
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function createVoteTokenHash(electionId: string, userId: string): string {
  return hashText(`${electionId}${userId}`);
}

export function createAuditHash(input: unknown): string {
  const serialized = JSON.stringify(input);
  return hashText(serialized === undefined ? String(input) : serialized);
}

export function randomHex(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error("bytes must be a positive integer");
  }

  return randomBytes(bytes).toString("hex");
}

export function createVoteVector(
  candidateIds: string[],
  selectedCandidateId: string
): number[] {
  if (!candidateIds.includes(selectedCandidateId)) {
    throw new Error("selectedCandidateId must be in candidateIds");
  }

  return candidateIds.map((candidateId) =>
    candidateId === selectedCandidateId ? 1 : 0
  );
}

/**
 * Create a Pedersen commitment for a vote vector.
 *
 * Internally derives a deterministic PedersenContext from the electionId and
 * the vote vector length (= candidate count), then computes
 *   C = g^r · ∏ h_i^{v_i}  (mod p)
 *
 * The function signature is intentionally kept identical to the former SHA-256
 * version so that all existing callers (API, benchmark, attacks) continue to
 * work without modification.
 */
export function createCommitment(
  electionId: string,
  voteVector: number[],
  randomness: string
): string {
  const context = createPedersenContext(electionId, voteVector.length);
  const result = createPedersenCommitment(context, voteVector, randomness);
  return result.commitment;
}

/**
 * Verify that a (voteVector, randomness) pair opens to the given Pedersen
 * commitment.  Recomputes the deterministic context and delegates to
 * verifyPedersenOpening.
 */
export function verifyCommitmentOpening(
  electionId: string,
  voteVector: number[],
  randomness: string,
  commitment: string
): boolean {
  const context = createPedersenContext(electionId, voteVector.length);
  return verifyPedersenOpening(context, voteVector, randomness, commitment);
}

export function createReceiptCode(
  electionId: string,
  commitment: string,
  userId: string,
  createdAt: string
): string {
  return hashText(`${electionId}${commitment}${userId}${createdAt}`);
}

export function hashReceiptCode(receiptCode: string): string {
  return hashText(receiptCode);
}

export function createReceiptChainHash(input: {
  electionId: string;
  receiptCode: string;
  previousReceiptCodeHash: string | null;
  receiptChainIndex: number;
  commitment: string;
}): string {
  return hashText(
    JSON.stringify({
      domain: "verivote-receipt-chain-v1",
      electionId: input.electionId,
      receiptCode: input.receiptCode,
      previousReceiptCodeHash: input.previousReceiptCodeHash,
      receiptChainIndex: input.receiptChainIndex,
      commitment: input.commitment
    })
  );
}

function getReceiptChainVoteId(vote: ReceiptChainVote): string | undefined {
  return vote.voteId ?? vote.id;
}

function getReceiptChainBreakIndex(
  vote: ReceiptChainVote,
  fallbackIndex: number
): number {
  return typeof vote.receiptChainIndex === "number"
    ? vote.receiptChainIndex
    : fallbackIndex;
}

export function verifyReceiptChain(
  votes: ReceiptChainVote[]
): ReceiptChainVerificationResult {
  const breaks: ReceiptChainBreak[] = [];

  const completeVotes = votes.filter((vote, originalIndex) => {
    let complete = true;
    const voteId = getReceiptChainVoteId(vote);
    const index = getReceiptChainBreakIndex(vote, originalIndex);

    if (
      typeof vote.receiptChainIndex !== "number" ||
      !Number.isInteger(vote.receiptChainIndex) ||
      vote.receiptChainIndex < 0
    ) {
      breaks.push({
        voteId,
        index,
        reason: "missing or invalid receiptChainIndex"
      });
      complete = false;
    }

    if (vote.previousReceiptCodeHash === undefined) {
      breaks.push({
        voteId,
        index,
        reason: "missing previousReceiptCodeHash"
      });
      complete = false;
    }

    if (typeof vote.receiptChainHash !== "string" || !vote.receiptChainHash) {
      breaks.push({
        voteId,
        index,
        reason: "missing receiptChainHash"
      });
      complete = false;
    }

    return complete;
  });

  const seenIndexes = new Set<number>();
  for (const vote of completeVotes) {
    const receiptChainIndex = vote.receiptChainIndex as number;
    if (seenIndexes.has(receiptChainIndex)) {
      breaks.push({
        voteId: getReceiptChainVoteId(vote),
        index: receiptChainIndex,
        reason: "duplicate receiptChainIndex"
      });
      continue;
    }

    seenIndexes.add(receiptChainIndex);
  }

  const sortedVotes = completeVotes
    .filter(
      (vote, index, allVotes) =>
        allVotes.findIndex(
          (currentVote) =>
            currentVote.receiptChainIndex === vote.receiptChainIndex
        ) === index
    )
    .sort(
      (left, right) =>
        (left.receiptChainIndex as number) -
        (right.receiptChainIndex as number)
    );

  for (let sortedIndex = 0; sortedIndex < sortedVotes.length; sortedIndex += 1) {
    const vote = sortedVotes[sortedIndex];
    const receiptChainIndex = vote.receiptChainIndex as number;
    const voteId = getReceiptChainVoteId(vote);

    if (receiptChainIndex !== sortedIndex) {
      breaks.push({
        voteId,
        index: receiptChainIndex,
        reason: `receiptChainIndex sequence break: expected ${sortedIndex}, got ${receiptChainIndex}`
      });
    }

    const previousVote = sortedVotes[sortedIndex - 1];
    const expectedPreviousReceiptCodeHash =
      sortedIndex === 0 ? null : hashReceiptCode(previousVote.receiptCode);

    if (vote.previousReceiptCodeHash !== expectedPreviousReceiptCodeHash) {
      breaks.push({
        voteId,
        index: receiptChainIndex,
        reason:
          sortedIndex === 0
            ? "first formal vote must have previousReceiptCodeHash = null"
            : "previousReceiptCodeHash does not match previous formal vote receiptCode hash"
      });
    }

    const expectedReceiptChainHash = createReceiptChainHash({
      electionId: vote.electionId,
      receiptCode: vote.receiptCode,
      previousReceiptCodeHash: expectedPreviousReceiptCodeHash,
      receiptChainIndex,
      commitment: vote.commitment
    });

    if (vote.receiptChainHash !== expectedReceiptChainHash) {
      breaks.push({
        voteId,
        index: receiptChainIndex,
        reason: "receiptChainHash does not match recomputed chain hash"
      });
    }
  }

  return {
    verified: breaks.length === 0,
    breaks
  };
}

export function createMerkleLeaf(
  voteId: string,
  commitment: string,
  receiptCode: string
): string {
  return hashText(`${voteId}${commitment}${receiptCode}`);
}

function hashMerklePair(left: string, right: string): string {
  return hashText(`${left}${right}`);
}

export function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    return [];
  }

  const tree: string[][] = [leaves.slice()];

  while (tree[tree.length - 1].length > 1) {
    const level = tree[tree.length - 1];
    const nextLevel: string[] = [];

    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      nextLevel.push(hashMerklePair(left, right));
    }

    tree.push(nextLevel);
  }

  return tree;
}

export function getMerkleRoot(leaves: string[]): string {
  const tree = buildMerkleTree(leaves);

  if (tree.length === 0) {
    return hashText("");
  }

  return tree[tree.length - 1][0];
}

export function getMerkleProof(
  leaves: string[],
  targetLeaf: string
): MerkleProofItem[] {
  const tree = buildMerkleTree(leaves);
  let targetIndex = leaves.indexOf(targetLeaf);

  if (targetIndex === -1) {
    throw new Error("targetLeaf must be included in leaves");
  }

  const proof: MerkleProofItem[] = [];

  for (let levelIndex = 0; levelIndex < tree.length - 1; levelIndex += 1) {
    const level = tree[levelIndex];
    const isRightNode = targetIndex % 2 === 1;
    const siblingIndex = isRightNode ? targetIndex - 1 : targetIndex + 1;
    const sibling = level[siblingIndex] ?? level[targetIndex];

    proof.push({
      sibling,
      position: isRightNode ? "left" : "right"
    });

    targetIndex = Math.floor(targetIndex / 2);
  }

  return proof;
}

export function verifyMerkleProof(
  leaf: string,
  proof: MerkleProofItem[],
  root: string
): boolean {
  const computedRoot = proof.reduce((currentHash, proofItem) => {
    if (proofItem.position === "left") {
      return hashMerklePair(proofItem.sibling, currentHash);
    }

    return hashMerklePair(currentHash, proofItem.sibling);
  }, leaf);

  return computedRoot === root;
}
