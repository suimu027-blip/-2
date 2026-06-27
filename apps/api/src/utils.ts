import { ethers } from "ethers";
import type express from "express";
import {
  createAuditHash,
  createMerkleLeaf,
  createReceiptChainHash,
  createVoteTokenHash,
  getMerkleRoot,
  hashReceiptCode,
  hashText,
  verifyCommitmentOpening,
  verifyReceiptChain,
  verifyAggregateOpening,
  createPedersenContext
} from "@verivote/crypto";
import { createTallyElectionIdHash } from "@verivote/zk";
import type {
  Election,
  Candidate,
  Vote,
  AggregatorReport,
  AttackLog,
  AttackType,
  BlockchainAuditFields,
  BlockchainAuditMode,
  BlockchainAuditRecord,
  BulletinBoard,
  ElectionDetail,
  ElectionResult,
  ElectionExportBundle,
  ReceiptChainRecord,
  ChallengeRecord,
  CandidatePartitionBucket,
  InvalidVoteDiagnostic,
  PartitionAudit,
  PedersenAggregateAudit,
  AggregatorReportIntegrityCheck,
  TallyProofSummaryArtifact
} from "@verivote/shared";
import type { ZkValidityVerifyRequest } from "@verivote/shared";
import {
  votes,
  challengeRecords,
  blockchainAuditRecords,
  attackLogs,
  createId,
  findElection,
  getCandidatesForElection,
  findBulletinBoard,
  findAggregatorReport,
  findFirstVote
} from "./state.js";

const AUDIT_ABI = [
  "function submitAudit(bytes32 electionId, bytes32 merkleRoot, bytes32 commitmentRoot, bytes32 receiptRoot, bytes32 auditHash, bytes32 tallyHash)",
  "function submitAuditWithTallyProof(bytes32 electionId, bytes32 merkleRoot, bytes32 commitmentRoot, bytes32 receiptRoot, bytes32 auditHash, bytes32 tallyHash, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[5] input)",
  "function tallyVerifier() view returns (address)",
  "function getAudit(bytes32 electionId) view returns (tuple(bytes32 electionId, bytes32 merkleRoot, bytes32 commitmentRoot, bytes32 receiptRoot, bytes32 auditHash, bytes32 tallyHash, uint256 createdAt, address submitter, bool zkVerified, bool exists))",
  "function hasAudit(bytes32 electionId) view returns (bool)"
];

export const MOCK_CONTRACT_ADDRESS = "local-mock:VeriVoteAudit";
export const MOCK_SUBMITTER = "local-mock-submit-service";

export function now(): string {
  return new Date().toISOString();
}

export function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

export function isZkPublicSignals(
  value: unknown
): value is ZkValidityVerifyRequest["publicSignals"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const publicSignals = value as Record<string, unknown>;

  return (
    typeof publicSignals.electionIdHash === "string" &&
    typeof publicSignals.candidateCount === "number" &&
    Number.isInteger(publicSignals.candidateCount) &&
    publicSignals.candidateCount > 0 &&
    typeof publicSignals.voteVectorCommitment === "string"
  );
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function getBlockchainAuditMode(): BlockchainAuditMode {
  return process.env.BLOCKCHAIN_AUDIT_MODE === "hardhat"
    ? "hardhat"
    : "local-mock";
}

export function getAuditContractAddress(): string {
  return (
    process.env.AUDIT_CONTRACT_ADDRESS ??
    process.env.VERIVOTE_AUDIT_CONTRACT_ADDRESS ??
    ""
  );
}

export function getDisplayedContractAddress(mode: BlockchainAuditMode): string {
  if (mode === "local-mock") {
    return MOCK_CONTRACT_ADDRESS;
  }
  return getAuditContractAddress();
}

export function toBytes32Hex(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (/^0x[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }

  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return `0x${normalized}`;
  }

  return `0x${hashText(value)}`;
}

export function createTallyHash(report: AggregatorReport): string {
  return createAuditHash(report.tallyResult);
}

export function createBlockchainAuditFields(
  electionId: string,
  bulletin: BulletinBoard,
  report: AggregatorReport
): BlockchainAuditFields {
  return {
    electionId,
    electionIdHash: toBytes32Hex(electionId),
    merkleRoot: toBytes32Hex(bulletin.merkleRoot),
    commitmentRoot: toBytes32Hex(report.commitmentRoot),
    receiptRoot: toBytes32Hex(report.receiptRoot),
    auditHash: toBytes32Hex(report.auditHash),
    tallyHash: toBytes32Hex(createTallyHash(report))
  };
}

export function createMockTransactionHash(fields: BlockchainAuditFields, createdAt: string): string {
  return `0x${hashText(JSON.stringify({ ...fields, createdAt }))}`;
}

export async function getHardhatAuditContract(): Promise<{
  contract: ethers.Contract;
  contractAddress: string;
}> {
  const contractAddress = getAuditContractAddress();

  if (!contractAddress) {
    throw new Error(
      "Hardhat 审计模式需要设置 AUDIT_CONTRACT_ADDRESS 或 VERIVOTE_AUDIT_CONTRACT_ADDRESS"
    );
  }

  const provider = new ethers.JsonRpcProvider(
    process.env.HARDHAT_RPC_URL ?? "http://127.0.0.1:8545"
  );
  const signer = process.env.HARDHAT_PRIVATE_KEY
    ? new ethers.Wallet(process.env.HARDHAT_PRIVATE_KEY, provider)
    : await provider.getSigner(0);

  return {
    contract: new ethers.Contract(contractAddress, AUDIT_ABI, signer),
    contractAddress
  };
}

export function createAuditRecordFromChain(
  electionId: string,
  chainRecord: {
    electionId: string;
    merkleRoot: string;
    commitmentRoot: string;
    receiptRoot: string;
    auditHash: string;
    tallyHash: string;
    createdAt: bigint;
    submitter: string;
    zkVerified?: boolean;
  },
  transactionHash: string,
  contractAddress: string
): BlockchainAuditRecord {
  const createdAtMs = Number(chainRecord.createdAt) * 1000;

  return {
    electionId,
    electionIdHash: chainRecord.electionId,
    merkleRoot: chainRecord.merkleRoot,
    commitmentRoot: chainRecord.commitmentRoot,
    receiptRoot: chainRecord.receiptRoot,
    auditHash: chainRecord.auditHash,
    tallyHash: chainRecord.tallyHash,
    transactionHash,
    contractAddress,
    auditMode: "hardhat",
    createdAt: Number.isFinite(createdAtMs)
      ? new Date(createdAtMs).toISOString()
      : now(),
    submitter: chainRecord.submitter,
    zkVerified: chainRecord.zkVerified ?? false,
    status: "submitted"
  };
}

export function createAttackLog(
  electionId: string,
  type: AttackType,
  description: string,
  before: unknown,
  after: unknown
): AttackLog {
  const log: AttackLog = {
    id: createId("attack"),
    electionId,
    type,
    description,
    before,
    after,
    createdAt: now()
  };

  attackLogs.push(log);
  return log;
}

export type AttackTarget =
  | {
      election: Election;
      firstVote: Vote;
    }
  | {
      status: number;
      error: string;
    };

export function getAttackTarget(electionId: string): AttackTarget {
  const election = findElection(electionId);

  if (!election) {
    return { status: 404, error: "选举不存在，无法执行演示攻击。" };
  }

  const firstVote = findFirstVote(election.id);

  if (!firstVote) {
    return {
      status: 409,
      error: "当前选举没有选票，无法执行该攻击。"
    };
  }

  return { election, firstVote };
}

export function isAttackTargetError(
  target: AttackTarget
): target is { status: number; error: string } {
  return "error" in target;
}

export function createElectionResult(electionId: string): ElectionResult {
  const electionVotes = votes.filter((vote) => vote.electionId === electionId);
  return createElectionResultFromVotes(electionId, electionVotes);
}

export function createElectionResultFromVotes(
  electionId: string,
  electionVotes: Vote[]
): ElectionResult {
  const electionCandidates = getCandidatesForElection(electionId);

  return {
    electionId,
    totalVotes: electionVotes.length,
    results: electionCandidates.map((candidate) => ({
      candidateId: candidate.id,
      candidateName: candidate.name,
      voteCount: electionVotes.filter(
        (vote) => vote.candidateId === candidate.id
      ).length
    }))
  };
}

export type VoteWithoutReceiptChain = Omit<
  Vote,
  "receiptChainIndex" | "previousReceiptCodeHash" | "receiptChainHash"
>;

export function getLastReceiptChainVote(electionId: string): Vote | undefined {
  const electionVotes = votes.filter((vote) => vote.electionId === electionId);

  return electionVotes
    .slice()
    .sort((left, right) => {
      const leftIndex =
        typeof left.receiptChainIndex === "number"
          ? left.receiptChainIndex
          : -1;
      const rightIndex =
        typeof right.receiptChainIndex === "number"
          ? right.receiptChainIndex
          : -1;

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.createdAt.localeCompare(right.createdAt);
    })
    .at(-1);
}

export function appendVoteWithReceiptChain(voteWithoutChain: VoteWithoutReceiptChain): Vote {
  const previousVote = getLastReceiptChainVote(voteWithoutChain.electionId);
  const receiptChainIndex =
    typeof previousVote?.receiptChainIndex === "number"
      ? previousVote.receiptChainIndex + 1
      : votes.filter((vote) => vote.electionId === voteWithoutChain.electionId)
          .length;
  const previousReceiptCodeHash = previousVote
    ? hashReceiptCode(previousVote.receiptCode)
    : null;
  const receiptChainHash = createReceiptChainHash({
    electionId: voteWithoutChain.electionId,
    receiptCode: voteWithoutChain.receiptCode,
    previousReceiptCodeHash,
    receiptChainIndex,
    commitment: voteWithoutChain.commitment
  });
  const vote: Vote = {
    ...voteWithoutChain,
    receiptChainIndex,
    previousReceiptCodeHash,
    receiptChainHash
  };

  votes.push(vote);
  return vote;
}

export function getReceiptChainRecords(electionVotes: Vote[]): ReceiptChainRecord[] {
  return electionVotes
    .slice()
    .sort((left, right) => {
      const leftIndex =
        typeof left.receiptChainIndex === "number"
          ? left.receiptChainIndex
          : Number.MAX_SAFE_INTEGER;
      const rightIndex =
        typeof right.receiptChainIndex === "number"
          ? right.receiptChainIndex
          : Number.MAX_SAFE_INTEGER;

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.createdAt.localeCompare(right.createdAt);
    })
    .map((vote) => ({
      voteId: vote.id,
      receiptCodeHash: hashReceiptCode(vote.receiptCode),
      commitment: vote.commitment,
      receiptChainIndex: vote.receiptChainIndex ?? -1,
      previousReceiptCodeHash: vote.previousReceiptCodeHash ?? null,
      receiptChainHash: vote.receiptChainHash ?? ""
    }));
}

interface VoteAuditContext {
  electionId: string;
  electionVotes: Vote[];
  electionCandidates: Candidate[];
  validCandidateIds: Set<string>;
  candidateIndexMap: Map<string, number>;
  receiptChainVerification: ReturnType<typeof verifyReceiptChain>;
  receiptBreakReasonsByVoteId: Map<string, string[]>;
}

interface VoteAuditOutcome {
  vote: Vote;
  tokenHash: string;
  isDuplicate: boolean;
  diagnostics: InvalidVoteDiagnostic[];
}

function hashStableJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function createNotGeneratedTallyProofSummary(): TallyProofSummaryArtifact {
  return {
    proofStatus: "not-generated",
    proofId: null,
    proofMode: null,
    verifierMode: null,
    circuitId: "tally-correctness-v2",
    proofHash: null,
    publicSignals: null,
    message:
      "Tally proof has not been generated by B-track yet; A-track exports report-binding metadata only."
  };
}

export function buildVoteAuditContext(electionId: string): VoteAuditContext {
  const electionVotes = votes.filter((vote) => vote.electionId === electionId);
  const electionCandidates = getCandidatesForElection(electionId);
  const validCandidateIds = new Set(
    electionCandidates.map((candidate) => candidate.id)
  );
  const candidateIndexMap = new Map(
    electionCandidates.map((candidate, index) => [candidate.id, index])
  );
  const receiptChainVerification = verifyReceiptChain(electionVotes);
  const receiptBreakReasonsByVoteId = new Map<string, string[]>();

  for (const chainBreak of receiptChainVerification.breaks) {
    const voteId =
      chainBreak.voteId ??
      electionVotes.find((vote) => vote.receiptChainIndex === chainBreak.index)
        ?.id;

    if (!voteId) {
      continue;
    }

    const reasons = receiptBreakReasonsByVoteId.get(voteId) ?? [];
    reasons.push(chainBreak.reason);
    receiptBreakReasonsByVoteId.set(voteId, reasons);
  }

  return {
    electionId,
    electionVotes,
    electionCandidates,
    validCandidateIds,
    candidateIndexMap,
    receiptChainVerification,
    receiptBreakReasonsByVoteId
  };
}

export function isOneHotVector(vector: number[], candidateCount: number): boolean {
  return (
    Array.isArray(vector) &&
    vector.length === candidateCount &&
    vector.every((entry) => Number.isInteger(entry) && (entry === 0 || entry === 1)) &&
    vector.reduce((total, entry) => total + entry, 0) === 1
  );
}

function getOneHotDetail(vector: number[], candidateCount: number): string {
  if (!Array.isArray(vector)) {
    return "voteVector must be an array.";
  }

  if (vector.length !== candidateCount) {
    return `voteVector length ${vector.length} does not match candidateCount ${candidateCount}.`;
  }

  if (!vector.every((entry) => Number.isInteger(entry))) {
    return "voteVector entries must be integers.";
  }

  if (!vector.every((entry) => entry === 0 || entry === 1)) {
    return "voteVector entries must be binary 0/1 values.";
  }

  const sum = vector.reduce<number>((total, entry) => total + entry, 0);
  return `voteVector must contain exactly one selected candidate; observed sum=${sum}.`;
}

export function verifyVoteCommitmentOpening(vote: Vote): boolean {
  try {
    return verifyCommitmentOpening(
      vote.electionId,
      vote.voteVector,
      vote.randomness,
      vote.commitment
    );
  } catch {
    return false;
  }
}

function createInvalidVoteDiagnostic(input: {
  vote: Vote;
  tokenHash: string;
  reason: InvalidVoteDiagnostic["reason"];
  detail: string;
}): InvalidVoteDiagnostic {
  return {
    voteId: input.vote.id,
    userIdHash: hashText(input.vote.userId),
    tokenHash: input.tokenHash,
    reason: input.reason,
    detail: input.detail,
    evidenceHash: createAuditHash({
      domain: "verivote.invalid-vote-diagnostic.v1",
      voteId: input.vote.id,
      tokenHash: input.tokenHash,
      reason: input.reason,
      detail: input.detail
    })
  };
}

export function collectInvalidVoteDiagnostics(
  context: VoteAuditContext
): VoteAuditOutcome[] {
  const seenTokenHashes = new Set<string>();

  return context.electionVotes.map((vote) => {
    const tokenHash = createVoteTokenHash(context.electionId, vote.userId);
    const diagnostics: InvalidVoteDiagnostic[] = [];
    const isDuplicate = seenTokenHashes.has(tokenHash);

    if (isDuplicate) {
      diagnostics.push(
        createInvalidVoteDiagnostic({
          vote,
          tokenHash,
          reason: "duplicate-token",
          detail: "Another vote in this election already uses the same voter token hash."
        })
      );
    } else {
      seenTokenHashes.add(tokenHash);
    }

    const candidateIndex = context.candidateIndexMap.get(vote.candidateId);
    if (!context.validCandidateIds.has(vote.candidateId)) {
      diagnostics.push(
        createInvalidVoteDiagnostic({
          vote,
          tokenHash,
          reason: "invalid-candidate",
          detail: `candidateId ${vote.candidateId} is not registered for election ${context.electionId}.`
        })
      );
    }

    if (!isOneHotVector(vote.voteVector, context.electionCandidates.length)) {
      diagnostics.push(
        createInvalidVoteDiagnostic({
          vote,
          tokenHash,
          reason: "invalid-one-hot",
          detail: getOneHotDetail(vote.voteVector, context.electionCandidates.length)
        })
      );
    } else if (candidateIndex !== undefined && vote.voteVector[candidateIndex] !== 1) {
      diagnostics.push(
        createInvalidVoteDiagnostic({
          vote,
          tokenHash,
          reason: "candidate-vector-mismatch",
          detail: `candidateId ${vote.candidateId} maps to vector index ${candidateIndex}, but that entry is not selected.`
        })
      );
    }

    if (!verifyVoteCommitmentOpening(vote)) {
      diagnostics.push(
        createInvalidVoteDiagnostic({
          vote,
          tokenHash,
          reason: "commitment-opening-failed",
          detail:
            "Recomputed commitment from electionId, voteVector and randomness does not match the stored commitment."
        })
      );
    }

    const chainBreakReasons = context.receiptBreakReasonsByVoteId.get(vote.id) ?? [];
    for (const reason of chainBreakReasons) {
      diagnostics.push(
        createInvalidVoteDiagnostic({
          vote,
          tokenHash,
          reason: "receipt-chain-break",
          detail: reason
        })
      );
    }

    return {
      vote,
      tokenHash,
      isDuplicate,
      diagnostics
    };
  });
}

function createPartitionBucket(
  candidate: Candidate,
  voteRecords: Vote[],
  tokenHashesByVoteId: Map<string, string>
): CandidatePartitionBucket {
  const voteIds = voteRecords.map((vote) => vote.id);
  const tokenHashes = voteRecords.map(
    (vote) => tokenHashesByVoteId.get(vote.id) ?? ""
  );
  const tokenRoot = getMerkleRoot(
    tokenHashes
  );
  const commitmentRoot = getMerkleRoot(voteRecords.map((vote) => vote.commitment));
  const receiptRoot = getMerkleRoot(voteRecords.map((vote) => vote.receiptCode));
  const voteIdsHash = hashStableJson(voteIds);
  const bucketAuditHash = createAuditHash({
    domain: "verivote.partition-bucket.v2",
    candidateId: candidate.id,
    tokenRoot,
    commitmentRoot,
    receiptRoot,
    voteCount: voteRecords.length,
    voteIdsHash
  });

  return {
    candidateId: candidate.id,
    candidateName: candidate.name,
    voteCount: voteRecords.length,
    voteIds,
    tokenHashes,
    tokenRoot,
    commitmentRoot,
    receiptRoot,
    bucketAuditHash
  };
}

function createPartitionAudit(
  context: VoteAuditContext,
  validVoteRecords: Vote[],
  tokenHashesByVoteId: Map<string, string>
): PartitionAudit {
  const validVoteIds = validVoteRecords.map((vote) => vote.id);
  const bucketedVoteIds = new Set<string>();
  const bucketedTokenHashes: string[] = [];
  const buckets = context.electionCandidates.map((candidate) => {
    const bucketVotes = validVoteRecords.filter(
      (vote) => vote.candidateId === candidate.id
    );
    for (const vote of bucketVotes) {
      bucketedVoteIds.add(vote.id);
      bucketedTokenHashes.push(tokenHashesByVoteId.get(vote.id) ?? "");
    }
    return createPartitionBucket(candidate, bucketVotes, tokenHashesByVoteId);
  });
  const bucketedVoteIdList = buckets.flatMap((bucket) => bucket.voteIds);
  const coverComplete =
    bucketedVoteIdList.length === validVoteIds.length &&
    validVoteIds.every((voteId) => bucketedVoteIds.has(voteId));
  const disjoint = bucketedVoteIdList.length === new Set(bucketedVoteIdList).size;
  const noDuplicateValidTokenHashes =
    bucketedTokenHashes.length === new Set(bucketedTokenHashes).size;
  const allValidVotesBucketed = coverComplete && disjoint;
  const partitionCore = {
    domain: "verivote.partition-audit.v2",
    electionId: context.electionId,
    bucketAuditHashes: buckets.map((bucket) => bucket.bucketAuditHash),
    coverComplete,
    disjoint,
    noDuplicateValidTokenHashes,
    allValidVotesBucketed
  };

  return {
    buckets,
    coverComplete,
    disjoint,
    noDuplicateValidTokenHashes,
    allValidVotesBucketed,
    partitionHash: createAuditHash(partitionCore)
  };
}

function createPedersenAggregateAudit(
  electionId: string,
  candidateCount: number,
  validVoteRecords: Vote[]
): PedersenAggregateAudit | null {
  if (candidateCount <= 0 || validVoteRecords.length === 0) {
    return null;
  }

  try {
    const pedersenContext = createPedersenContext(electionId, candidateCount);
    const batch = validVoteRecords.map((vote) => ({
      voteVector: vote.voteVector,
      randomness: vote.randomness,
      commitment: vote.commitment
    }));
    const verification = verifyAggregateOpening(pedersenContext, batch);
    const aggregatedRandomnessHash = hashText(verification.aggregatedRandomness);
    const pedersenAggregateHash = createAuditHash({
      domain: "verivote.pedersen-aggregate-audit.v1",
      contextHash: pedersenContext.contextHash,
      aggregatedCommitment: verification.aggregatedCommitment,
      expectedCommitment: verification.expectedCommitment,
      aggregatedVector: verification.aggregatedVector,
      aggregatedRandomnessHash,
      castVoteCount: validVoteRecords.length,
      verified: verification.verified
    });

    return {
      contextHash: pedersenContext.contextHash,
      aggregatedCommitment: verification.aggregatedCommitment,
      expectedCommitment: verification.expectedCommitment,
      aggregatedVector: verification.aggregatedVector,
      aggregatedRandomnessHash,
      castVoteCount: validVoteRecords.length,
      verified: verification.verified,
      message: verification.verified
        ? "Pedersen aggregate audit passed: product(C_i) matches commit(sum v_i, sum r_i)."
        : "Pedersen aggregate audit failed: aggregate commitment does not match the opening.",
      pedersenAggregateHash
    };
  } catch {
    return null;
  }
}

type AggregatorReportAuditCore = Omit<AggregatorReport, "auditHash" | "createdAt">;

function getPedersenAggregateStatus(
  audit: PedersenAggregateAudit | null | undefined
): AggregatorReport["pedersenAggregateStatus"] {
  if (!audit) {
    return "pending";
  }
  return audit.verified ? "verified" : "failed";
}

function createAggregatorReportAuditCore(
  report: AggregatorReportAuditCore
): AggregatorReportAuditCore {
  return {
    electionId: report.electionId,
    totalVotes: report.totalVotes,
    validVotes: report.validVotes,
    validVoteIds: report.validVoteIds,
    invalidVotes: report.invalidVotes,
    invalidVoteIds: report.invalidVoteIds,
    duplicateVotes: report.duplicateVotes,
    proofStatus: report.proofStatus,
    tallyProofSummary: report.tallyProofSummary,
    receiptChainVerified: report.receiptChainVerified,
    receiptChainBreaks: report.receiptChainBreaks,
    voteTokenHashes: report.voteTokenHashes,
    duplicateTokenHashes: report.duplicateTokenHashes,
    tallyResult: report.tallyResult,
    commitmentRoot: report.commitmentRoot,
    receiptRoot: report.receiptRoot,
    partitionAudit: report.partitionAudit,
    partitionHash: report.partitionHash,
    invalidVoteDiagnostics: report.invalidVoteDiagnostics,
    diagnosticsHash: report.diagnosticsHash,
    publicInputHints: report.publicInputHints,
    pedersenAggregateAudit: report.pedersenAggregateAudit,
    pedersenAggregateStatus: report.pedersenAggregateStatus,
    pedersenAggregateHash: report.pedersenAggregateHash,
    pedersenTallyVerified: report.pedersenTallyVerified,
    pedersenTallyMessage: report.pedersenTallyMessage,
    pedersenContextHash: report.pedersenContextHash
  };
}

export function createAggregatorReport(electionId: string): AggregatorReport {
  const context = buildVoteAuditContext(electionId);
  const outcomes = collectInvalidVoteDiagnostics(context);
  const tokenHashesByVoteId = new Map(
    outcomes.map((outcome) => [outcome.vote.id, outcome.tokenHash])
  );
  const voteTokenHashes = outcomes.map((outcome) => outcome.tokenHash);
  const duplicateTokenHashes = Array.from(
    new Set(
      outcomes
        .filter((outcome) => outcome.isDuplicate)
        .map((outcome) => outcome.tokenHash)
    )
  );
  const duplicateVotes = outcomes.filter((outcome) => outcome.isDuplicate).length;
  const invalidOutcomes = outcomes.filter(
    (outcome) => outcome.diagnostics.length > 0
  );
  const invalidVoteDiagnostics = invalidOutcomes
    .flatMap((outcome) => outcome.diagnostics)
    .sort((left, right) =>
      `${left.voteId}:${left.reason}:${left.evidenceHash}`.localeCompare(
        `${right.voteId}:${right.reason}:${right.evidenceHash}`
      )
    );
  const validVoteRecords = outcomes
    .filter((outcome) => outcome.diagnostics.length === 0)
    .map((outcome) => outcome.vote);
  const validVoteIds = validVoteRecords.map((vote) => vote.id);
  const invalidVoteIds = Array.from(
    new Set(invalidVoteDiagnostics.map((diagnostic) => diagnostic.voteId))
  ).sort();
  const tallyResult = createElectionResultFromVotes(electionId, validVoteRecords);
  const commitmentRoot = getMerkleRoot(
    validVoteRecords.map((vote) => vote.commitment)
  );
  const receiptRoot = getMerkleRoot(
    validVoteRecords.map((vote) => vote.receiptCode)
  );
  const tallyHash = createAuditHash(tallyResult);
  const partitionAudit = createPartitionAudit(
    context,
    validVoteRecords,
    tokenHashesByVoteId
  );
  const partitionHash = partitionAudit.partitionHash;
  const diagnosticsHash = createAuditHash({
    domain: "verivote.invalid-vote-diagnostics.v2",
    diagnostics: invalidVoteDiagnostics
  });
  const pedersenAggregateAudit = createPedersenAggregateAudit(
    electionId,
    context.electionCandidates.length,
    validVoteRecords
  );
  const pedersenAggregateHash =
    pedersenAggregateAudit?.pedersenAggregateHash ?? null;
  const pedersenAggregateStatus =
    getPedersenAggregateStatus(pedersenAggregateAudit);
  const publicInputHints = {
    electionIdHash: createTallyElectionIdHash(electionId),
    candidateCount: context.electionCandidates.length,
    validVotes: validVoteRecords.length,
    tallyHash,
    commitmentRoot,
    receiptRoot,
    partitionHash,
    diagnosticsHash,
    pedersenAggregateHash
  };
  const tallyProofSummary = createNotGeneratedTallyProofSummary();

  const coreFields = {
    electionId,
    totalVotes: context.electionVotes.length,
    validVotes: validVoteRecords.length,
    validVoteIds,
    invalidVotes: invalidVoteIds.length,
    invalidVoteIds,
    duplicateVotes,
    proofStatus: tallyProofSummary.proofStatus,
    tallyProofSummary,
    receiptChainVerified: context.receiptChainVerification.verified,
    receiptChainBreaks: context.receiptChainVerification.breaks,
    voteTokenHashes,
    duplicateTokenHashes,
    tallyResult,
    commitmentRoot,
    receiptRoot,
    partitionAudit,
    partitionHash,
    invalidVoteDiagnostics,
    diagnosticsHash,
    publicInputHints,
    pedersenAggregateAudit,
    pedersenAggregateStatus,
    pedersenAggregateHash,
    pedersenTallyVerified: pedersenAggregateAudit?.verified,
    pedersenTallyMessage: pedersenAggregateAudit?.message,
    pedersenContextHash: pedersenAggregateAudit?.contextHash
  };

  return {
    ...coreFields,
    auditHash: createAuditHash(createAggregatorReportAuditCore(coreFields)),
    createdAt: now()
  };
}

export function createAuditHashForAggregatorReport(report: AggregatorReport): string {
  return createAuditHash(createAggregatorReportAuditCore(report));
}

function recomputeBucketAuditHash(bucket: CandidatePartitionBucket): string {
  return createAuditHash({
    domain: "verivote.partition-bucket.v2",
    candidateId: bucket.candidateId,
    tokenRoot: bucket.tokenRoot,
    commitmentRoot: bucket.commitmentRoot,
    receiptRoot: bucket.receiptRoot,
    voteCount: bucket.voteCount,
    voteIdsHash: hashStableJson(bucket.voteIds)
  });
}

function recomputePartitionHash(report: AggregatorReport): string {
  return createAuditHash({
    domain: "verivote.partition-audit.v2",
    electionId: report.electionId,
    bucketAuditHashes: report.partitionAudit.buckets.map(
      (bucket) => bucket.bucketAuditHash
    ),
    coverComplete: report.partitionAudit.coverComplete,
    disjoint: report.partitionAudit.disjoint,
    noDuplicateValidTokenHashes: report.partitionAudit.noDuplicateValidTokenHashes,
    allValidVotesBucketed: report.partitionAudit.allValidVotesBucketed
  });
}

function recomputeDiagnosticEvidenceHash(
  diagnostic: InvalidVoteDiagnostic
): string {
  return createAuditHash({
    domain: "verivote.invalid-vote-diagnostic.v1",
    voteId: diagnostic.voteId,
    tokenHash: diagnostic.tokenHash,
    reason: diagnostic.reason,
    detail: diagnostic.detail
  });
}

function recomputeDiagnosticsHash(report: AggregatorReport): string {
  return createAuditHash({
    domain: "verivote.invalid-vote-diagnostics.v2",
    diagnostics: report.invalidVoteDiagnostics
  });
}

function recomputePedersenAggregateHash(
  audit: PedersenAggregateAudit | null | undefined
): string | null {
  if (!audit) {
    return null;
  }

  return createAuditHash({
    domain: "verivote.pedersen-aggregate-audit.v1",
    contextHash: audit.contextHash,
    aggregatedCommitment: audit.aggregatedCommitment,
    expectedCommitment: audit.expectedCommitment,
    aggregatedVector: audit.aggregatedVector,
    aggregatedRandomnessHash: audit.aggregatedRandomnessHash,
    castVoteCount: audit.castVoteCount,
    verified: audit.verified
  });
}

function createPublicInputHintsFromReport(
  report: AggregatorReport,
  partitionHash: string,
  diagnosticsHash: string,
  pedersenAggregateHash: string | null
): AggregatorReport["publicInputHints"] {
  return {
    electionIdHash: createTallyElectionIdHash(report.electionId),
    candidateCount: report.partitionAudit.buckets.length,
    validVotes: report.validVotes,
    tallyHash: createAuditHash(report.tallyResult),
    commitmentRoot: report.commitmentRoot,
    receiptRoot: report.receiptRoot,
    partitionHash,
    diagnosticsHash,
    pedersenAggregateHash
  };
}

function publicInputHintsMatch(
  actual: AggregatorReport["publicInputHints"],
  expected: AggregatorReport["publicInputHints"]
): boolean {
  return (
    actual.electionIdHash === expected.electionIdHash &&
    actual.candidateCount === expected.candidateCount &&
    actual.validVotes === expected.validVotes &&
    actual.tallyHash === expected.tallyHash &&
    actual.commitmentRoot === expected.commitmentRoot &&
    actual.receiptRoot === expected.receiptRoot &&
    actual.partitionHash === expected.partitionHash &&
    actual.diagnosticsHash === expected.diagnosticsHash &&
    (actual.pedersenAggregateHash ?? null) ===
      (expected.pedersenAggregateHash ?? null)
  );
}

type IntegrityCheckName = keyof AggregatorReportIntegrityCheck["checks"];

const INTEGRITY_CHECK_NAMES: IntegrityCheckName[] = [
  "fieldShapeValid",
  "auditHashMatches",
  "partitionHashMatches",
  "nestedPartitionHashMatches",
  "diagnosticsHashMatches",
  "diagnosticEvidenceHashesMatch",
  "bucketAuditHashesMatch",
  "bucketVoteCountsMatch",
  "bucketTokenRootsMatchTokenHashes",
  "bucketTallyMatches",
  "bucketVoteIdsDisjoint",
  "bucketVoteCountSumMatchesValidVotes",
  "validVoteIdsMatchBuckets",
  "invalidVoteIdsMatchDiagnostics",
  "validAndInvalidVoteIdsDisjoint",
  "invalidVoteIdsExcludedFromBuckets",
  "voteIdAccountingMatchesTotalVotes",
  "partitionFlagsMatchStructure",
  "noDuplicateValidTokenHashesAsserted",
  "noDuplicateValidTokenHashesVerified",
  "publicInputHintsMatch",
  "voteTokenHashCountMatchesTotalVotes",
  "duplicateTokenHashesMatchDiagnostics",
  "receiptChainStatusMatchesBreaks",
  "candidateCountMatchesPartitions",
  "totalVoteCountMatchesValidAndInvalid",
  "tallyTotalMatchesValidVotes",
  "tallySumMatchesValidVotes",
  "invalidVoteCountMatchesDiagnostics",
  "duplicateVoteCountMatchesDiagnostics",
  "pedersenAggregateHashMatches",
  "pedersenAggregateStatusMatches"
];

function createIntegrityChecks(
  value: boolean
): AggregatorReportIntegrityCheck["checks"] {
  return Object.fromEntries(
    INTEGRITY_CHECK_NAMES.map((name) => [name, value])
  ) as AggregatorReportIntegrityCheck["checks"];
}

function createBlankPublicInputHints(): AggregatorReport["publicInputHints"] {
  return {
    electionIdHash: "",
    candidateCount: 0,
    validVotes: 0,
    tallyHash: "",
    commitmentRoot: "",
    receiptRoot: "",
    partitionHash: "",
    diagnosticsHash: "",
    pedersenAggregateHash: null
  };
}

function createInvalidShapeIntegrityCheck(): AggregatorReportIntegrityCheck {
  const checks = createIntegrityChecks(false);

  return {
    verified: false,
    checks,
    failures: INTEGRITY_CHECK_NAMES.slice(),
    recomputed: {
      auditHash: "",
      partitionHash: "",
      diagnosticsHash: "",
      pedersenAggregateHash: null,
      bucketAuditHashes: [],
      publicInputHints: createBlankPublicInputHints()
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isReceiptChainBreakArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        isInteger(item.index) &&
        typeof item.reason === "string" &&
        isOptionalString(item.voteId)
    )
  );
}

function isElectionResultShape(value: unknown): value is ElectionResult {
  if (!isRecord(value) || typeof value.electionId !== "string") {
    return false;
  }

  return (
    isNonNegativeInteger(value.totalVotes) &&
    Array.isArray(value.results) &&
    value.results.every(
      (item) =>
        isRecord(item) &&
        typeof item.candidateId === "string" &&
        typeof item.candidateName === "string" &&
        isNonNegativeInteger(item.voteCount)
    )
  );
}

function isCandidatePartitionBucketShape(
  value: unknown
): value is CandidatePartitionBucket {
  return (
    isRecord(value) &&
    typeof value.candidateId === "string" &&
    typeof value.candidateName === "string" &&
    isNonNegativeInteger(value.voteCount) &&
    isStringArray(value.voteIds) &&
    isStringArray(value.tokenHashes) &&
    typeof value.tokenRoot === "string" &&
    typeof value.commitmentRoot === "string" &&
    typeof value.receiptRoot === "string" &&
    typeof value.bucketAuditHash === "string"
  );
}

function isPartitionAuditShape(value: unknown): value is PartitionAudit {
  return (
    isRecord(value) &&
    Array.isArray(value.buckets) &&
    value.buckets.every(isCandidatePartitionBucketShape) &&
    typeof value.coverComplete === "boolean" &&
    typeof value.disjoint === "boolean" &&
    typeof value.noDuplicateValidTokenHashes === "boolean" &&
    typeof value.allValidVotesBucketed === "boolean" &&
    typeof value.partitionHash === "string"
  );
}

function isInvalidVoteDiagnosticShape(
  value: unknown
): value is InvalidVoteDiagnostic {
  const allowedReasons = new Set([
    "duplicate-token",
    "invalid-candidate",
    "invalid-one-hot",
    "candidate-vector-mismatch",
    "commitment-opening-failed",
    "receipt-chain-break"
  ]);

  return (
    isRecord(value) &&
    typeof value.voteId === "string" &&
    isOptionalString(value.userIdHash) &&
    typeof value.tokenHash === "string" &&
    typeof value.reason === "string" &&
    allowedReasons.has(value.reason) &&
    typeof value.detail === "string" &&
    typeof value.evidenceHash === "string"
  );
}

function isPedersenAggregateAuditShape(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      typeof value.contextHash === "string" &&
      typeof value.aggregatedCommitment === "string" &&
      typeof value.expectedCommitment === "string" &&
      isNumberArray(value.aggregatedVector) &&
      typeof value.aggregatedRandomnessHash === "string" &&
      isNonNegativeInteger(value.castVoteCount) &&
      typeof value.verified === "boolean" &&
      typeof value.message === "string" &&
      typeof value.pedersenAggregateHash === "string")
  );
}

function isTallyProofSummaryShape(value: unknown): value is TallyProofSummaryArtifact {
  const allowedStatuses = new Set([
    "not-generated",
    "pending",
    "generated",
    "failed"
  ]);

  return (
    isRecord(value) &&
    typeof value.proofStatus === "string" &&
    allowedStatuses.has(value.proofStatus) &&
    (value.proofId === null || typeof value.proofId === "string") &&
    (value.proofMode === null ||
      value.proofMode === "mock" ||
      value.proofMode === "real") &&
    (value.verifierMode === null ||
      value.verifierMode === "mock" ||
      value.verifierMode === "local-mock" ||
      value.verifierMode === "real-hardhat") &&
    (value.circuitId === null || typeof value.circuitId === "string") &&
    (value.proofHash === null || typeof value.proofHash === "string") &&
    (value.publicSignals === null || isRecord(value.publicSignals)) &&
    typeof value.message === "string"
  );
}

function isPublicInputHintsShape(
  value: unknown
): value is AggregatorReport["publicInputHints"] {
  return (
    isRecord(value) &&
    typeof value.electionIdHash === "string" &&
    isNonNegativeInteger(value.candidateCount) &&
    isNonNegativeInteger(value.validVotes) &&
    typeof value.tallyHash === "string" &&
    typeof value.commitmentRoot === "string" &&
    typeof value.receiptRoot === "string" &&
    typeof value.partitionHash === "string" &&
    typeof value.diagnosticsHash === "string" &&
    isOptionalNullableString(value.pedersenAggregateHash)
  );
}

function isAggregatorReportShape(value: unknown): value is AggregatorReport {
  const allowedPedersenStatuses = new Set([
    "not-generated",
    "pending",
    "verified",
    "failed"
  ]);

  return (
    isRecord(value) &&
    typeof value.electionId === "string" &&
    isNonNegativeInteger(value.totalVotes) &&
    isNonNegativeInteger(value.validVotes) &&
    isStringArray(value.validVoteIds) &&
    isNonNegativeInteger(value.invalidVotes) &&
    isStringArray(value.invalidVoteIds) &&
    isNonNegativeInteger(value.duplicateVotes) &&
    value.proofStatus === "not-generated" &&
    isTallyProofSummaryShape(value.tallyProofSummary) &&
    value.tallyProofSummary.proofStatus === value.proofStatus &&
    typeof value.receiptChainVerified === "boolean" &&
    isReceiptChainBreakArray(value.receiptChainBreaks) &&
    isStringArray(value.voteTokenHashes) &&
    isStringArray(value.duplicateTokenHashes) &&
    isElectionResultShape(value.tallyResult) &&
    typeof value.commitmentRoot === "string" &&
    typeof value.receiptRoot === "string" &&
    isPartitionAuditShape(value.partitionAudit) &&
    typeof value.partitionHash === "string" &&
    Array.isArray(value.invalidVoteDiagnostics) &&
    value.invalidVoteDiagnostics.every(isInvalidVoteDiagnosticShape) &&
    typeof value.diagnosticsHash === "string" &&
    isPublicInputHintsShape(value.publicInputHints) &&
    typeof value.auditHash === "string" &&
    typeof value.createdAt === "string" &&
    isPedersenAggregateAuditShape(value.pedersenAggregateAudit) &&
    typeof value.pedersenAggregateStatus === "string" &&
    allowedPedersenStatuses.has(value.pedersenAggregateStatus) &&
    isOptionalNullableString(value.pedersenAggregateHash) &&
    (value.pedersenTallyVerified === undefined ||
      typeof value.pedersenTallyVerified === "boolean") &&
    isOptionalString(value.pedersenTallyMessage) &&
    isOptionalString(value.pedersenContextHash)
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftUnique = uniqueStrings(left);
  const rightUnique = uniqueStrings(right);

  return (
    left.length === leftUnique.length &&
    right.length === rightUnique.length &&
    leftUnique.length === rightUnique.length &&
    leftUnique.every((value, index) => value === rightUnique[index])
  );
}

export function verifyAggregatorReportIntegrity(
  report: unknown
): AggregatorReportIntegrityCheck {
  if (!isAggregatorReportShape(report)) {
    return createInvalidShapeIntegrityCheck();
  }

  const recomputedBucketAuditHashes = report.partitionAudit.buckets.map(
    recomputeBucketAuditHash
  );
  const bucketAuditHashesMatch = report.partitionAudit.buckets.every(
    (bucket, index) => bucket.bucketAuditHash === recomputedBucketAuditHashes[index]
  );
  const partitionHash = recomputePartitionHash(report);
  const diagnosticsHash = recomputeDiagnosticsHash(report);
  const pedersenAggregateHash = recomputePedersenAggregateHash(
    report.pedersenAggregateAudit
  );
  const publicInputHints = createPublicInputHintsFromReport(
    report,
    partitionHash,
    diagnosticsHash,
    pedersenAggregateHash
  );
  const auditHash = createAuditHashForAggregatorReport(report);
  const bucketVoteIds = report.partitionAudit.buckets.flatMap(
    (bucket) => bucket.voteIds
  );
  const bucketTokenHashes = report.partitionAudit.buckets.flatMap(
    (bucket) => bucket.tokenHashes
  );
  const bucketVoteIdSet = new Set(bucketVoteIds);
  const bucketVoteCountSum = report.partitionAudit.buckets.reduce(
    (total, bucket) => total + bucket.voteCount,
    0
  );
  const bucketVoteIdsDisjoint = bucketVoteIds.length === bucketVoteIdSet.size;
  const bucketVoteCountSumMatchesValidVotes =
    bucketVoteCountSum === report.validVotes;
  const validVoteIdsMatchBuckets = sameStringSet(report.validVoteIds, bucketVoteIds);
  const structuralCoverComplete =
    bucketVoteIdsDisjoint &&
    bucketVoteCountSumMatchesValidVotes &&
    validVoteIdsMatchBuckets;
  const bucketCountsByCandidateId = new Map(
    report.partitionAudit.buckets.map((bucket) => [
      bucket.candidateId,
      bucket.voteCount
    ])
  );
  const tallySum = report.tallyResult.results.reduce(
    (total, item) => total + item.voteCount,
    0
  );
  const diagnosticVoteIds = new Set(
    report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.voteId)
  );
  const duplicateDiagnostics = report.invalidVoteDiagnostics.filter(
    (diagnostic) => diagnostic.reason === "duplicate-token"
  );
  const diagnosticVoteIdList = uniqueStrings(
    report.invalidVoteDiagnostics.map((diagnostic) => diagnostic.voteId)
  );
  const duplicateDiagnosticTokenHashes = uniqueStrings(
    duplicateDiagnostics.map((diagnostic) => diagnostic.tokenHash)
  );
  const invalidVoteIdSet = new Set(report.invalidVoteIds);
  const validAndInvalidVoteIdsDisjoint = report.validVoteIds.every(
    (voteId) => !invalidVoteIdSet.has(voteId)
  );
  const voteIdAccountingSet = new Set([
    ...report.validVoteIds,
    ...report.invalidVoteIds
  ]);
  const noDuplicateValidTokenHashesVerified =
    bucketTokenHashes.every((tokenHash) => tokenHash.length > 0) &&
    bucketTokenHashes.length === new Set(bucketTokenHashes).size;
  const expectedPedersenAggregateStatus =
    getPedersenAggregateStatus(report.pedersenAggregateAudit);

  const checks: AggregatorReportIntegrityCheck["checks"] = {
    fieldShapeValid: true,
    auditHashMatches: report.auditHash === auditHash,
    partitionHashMatches: report.partitionHash === partitionHash,
    nestedPartitionHashMatches:
      report.partitionAudit.partitionHash === partitionHash &&
      report.partitionHash === report.partitionAudit.partitionHash,
    diagnosticsHashMatches: report.diagnosticsHash === diagnosticsHash,
    diagnosticEvidenceHashesMatch: report.invalidVoteDiagnostics.every(
      (diagnostic) =>
        diagnostic.evidenceHash === recomputeDiagnosticEvidenceHash(diagnostic)
    ),
    bucketAuditHashesMatch,
    bucketVoteCountsMatch: report.partitionAudit.buckets.every(
      (bucket) =>
        bucket.voteCount === bucket.voteIds.length &&
        bucket.voteCount === bucket.tokenHashes.length
    ),
    bucketTokenRootsMatchTokenHashes: report.partitionAudit.buckets.every(
      (bucket) => bucket.tokenRoot === getMerkleRoot(bucket.tokenHashes)
    ),
    bucketTallyMatches:
      report.tallyResult.results.every(
        (item) =>
          bucketCountsByCandidateId.get(item.candidateId) === item.voteCount
      ) &&
      report.partitionAudit.buckets.every((bucket) =>
        report.tallyResult.results.some(
          (item) =>
            item.candidateId === bucket.candidateId &&
            item.voteCount === bucket.voteCount
        )
      ),
    bucketVoteIdsDisjoint,
    bucketVoteCountSumMatchesValidVotes,
    validVoteIdsMatchBuckets,
    invalidVoteIdsMatchDiagnostics: sameStringSet(
      report.invalidVoteIds,
      diagnosticVoteIdList
    ),
    validAndInvalidVoteIdsDisjoint,
    invalidVoteIdsExcludedFromBuckets: report.invalidVoteIds.every(
      (voteId) => !bucketVoteIdSet.has(voteId)
    ),
    voteIdAccountingMatchesTotalVotes:
      report.validVoteIds.length + report.invalidVoteIds.length ===
        report.totalVotes &&
      voteIdAccountingSet.size === report.totalVotes,
    partitionFlagsMatchStructure:
      report.partitionAudit.coverComplete === structuralCoverComplete &&
      report.partitionAudit.disjoint === bucketVoteIdsDisjoint &&
      report.partitionAudit.noDuplicateValidTokenHashes ===
        noDuplicateValidTokenHashesVerified &&
      report.partitionAudit.allValidVotesBucketed === structuralCoverComplete,
    noDuplicateValidTokenHashesAsserted:
      report.partitionAudit.noDuplicateValidTokenHashes === true,
    noDuplicateValidTokenHashesVerified,
    publicInputHintsMatch: publicInputHintsMatch(
      report.publicInputHints,
      publicInputHints
    ),
    voteTokenHashCountMatchesTotalVotes:
      report.voteTokenHashes.length === report.totalVotes,
    duplicateTokenHashesMatchDiagnostics: sameStringSet(
      report.duplicateTokenHashes,
      duplicateDiagnosticTokenHashes
    ),
    receiptChainStatusMatchesBreaks:
      report.receiptChainVerified === (report.receiptChainBreaks.length === 0),
    candidateCountMatchesPartitions:
      report.publicInputHints.candidateCount ===
        report.partitionAudit.buckets.length &&
      report.publicInputHints.candidateCount === report.tallyResult.results.length,
    totalVoteCountMatchesValidAndInvalid:
      report.totalVotes === report.validVotes + report.invalidVotes,
    tallyTotalMatchesValidVotes: report.tallyResult.totalVotes === report.validVotes,
    tallySumMatchesValidVotes: tallySum === report.validVotes,
    invalidVoteCountMatchesDiagnostics:
      diagnosticVoteIds.size === report.invalidVotes,
    duplicateVoteCountMatchesDiagnostics:
      duplicateDiagnostics.length === report.duplicateVotes &&
      report.duplicateVotes <= report.invalidVotes,
    pedersenAggregateHashMatches:
      (report.pedersenAggregateHash ?? null) === pedersenAggregateHash &&
      (report.pedersenAggregateAudit?.pedersenAggregateHash ?? null) ===
        pedersenAggregateHash &&
      (pedersenAggregateHash === null ||
        report.pedersenAggregateAudit?.verified === report.pedersenTallyVerified) &&
      (pedersenAggregateHash === null ||
        report.pedersenAggregateAudit?.message === report.pedersenTallyMessage) &&
      (pedersenAggregateHash === null ||
        report.pedersenAggregateAudit?.contextHash === report.pedersenContextHash),
    pedersenAggregateStatusMatches:
      report.pedersenAggregateStatus === expectedPedersenAggregateStatus &&
      (report.pedersenAggregateStatus === "pending" ||
        report.pedersenAggregateAudit !== null) &&
      (report.pedersenAggregateStatus !== "verified" ||
        report.pedersenAggregateAudit?.verified === true) &&
      (report.pedersenAggregateStatus !== "failed" ||
        report.pedersenAggregateAudit?.verified === false)
  };
  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    verified: failures.length === 0,
    checks,
    failures,
    recomputed: {
      auditHash,
      partitionHash,
      diagnosticsHash,
      pedersenAggregateHash,
      bucketAuditHashes: recomputedBucketAuditHashes,
      publicInputHints
    }
  };
}

export function getTallyConsistency(
  electionId: string,
  report: AggregatorReport
): { tallyConsistent: boolean; consistencyMessage: string } {
  const expectedTally = createAggregatorReport(electionId).tallyResult;
  const tallyConsistent =
    JSON.stringify(report.tallyResult) === JSON.stringify(expectedTally);

  return {
    tallyConsistent,
    consistencyMessage: tallyConsistent
      ? "tallyResult 与当前 votes 重新聚合结果一致。"
      : "tallyResult 与当前 votes 重新聚合结果不一致，疑似 tally 被篡改。"
  };
}

export function createBulletinBoard(electionId: string): BulletinBoard {
  const electionVotes = votes.filter((vote) => vote.electionId === electionId);
  const commitments = electionVotes.map((vote) => vote.commitment);
  const receiptCodeHashes = electionVotes.map((vote) =>
    hashReceiptCode(vote.receiptCode)
  );
  const receiptChainVerification = verifyReceiptChain(electionVotes);
  const leaves = electionVotes.map((vote) =>
    createMerkleLeaf(vote.id, vote.commitment, vote.receiptCode)
  );

  return {
    electionId,
    commitments,
    receiptCodeHashes,
    receiptChain: getReceiptChainRecords(electionVotes),
    receiptChainVerified: receiptChainVerification.verified,
    receiptChainBreaks: receiptChainVerification.breaks,
    leaves,
    merkleRoot: getMerkleRoot(leaves),
    tallyResult: createElectionResult(electionId),
    totalVotes: electionVotes.length,
    createdAt: now()
  };
}

export interface ArtifactExportContext {
  election: Election;
  detail: ElectionDetail;
  bulletin: BulletinBoard;
  report: AggregatorReport | null;
  tallyConsistency: { tallyConsistent: boolean; consistencyMessage: string };
  integrityCheck: AggregatorReportIntegrityCheck | null;
  auditRecord: BlockchainAuditRecord | null;
  auditMode: BlockchainAuditMode;
  challenges: ChallengeRecord[];
  publicInputs: ReturnType<typeof createPublicInputsArtifact>;
  aggregatorReportArtifact: (AggregatorReport & {
    tallyConsistent: boolean;
    consistencyMessage: string;
    integrityCheck: AggregatorReportIntegrityCheck;
  }) | null;
}

export function createPublicInputsArtifact(input: {
  election: ElectionDetail;
  bulletin: BulletinBoard;
  report: AggregatorReport | null;
}) {
  return {
    electionId: input.election.id,
    electionIdHash: createTallyElectionIdHash(input.election.id),
    candidateCount: input.election.candidates.length,
    totalVotes: input.bulletin.totalVotes,
    validVotes: input.report?.validVotes ?? input.bulletin.totalVotes,
    merkleRoot: input.bulletin.merkleRoot,
    commitmentRoot: input.report?.commitmentRoot ?? "",
    receiptRoot: input.report?.receiptRoot ?? "",
    tallyHash: input.report ? createTallyHash(input.report) : "",
    partitionHash: input.report?.partitionHash ?? "",
    diagnosticsHash: input.report?.diagnosticsHash ?? "",
    auditHash: input.report?.auditHash ?? "",
    zkCircuitId: "valid-vote-4"
  };
}

export function buildArtifactContext(election: Election): ArtifactExportContext {
  const detail: ElectionDetail = {
    ...election,
    candidates: getCandidatesForElection(election.id)
  };
  const bulletin =
    findBulletinBoard(election.id) ?? createBulletinBoard(election.id);
  const report = findAggregatorReport(election.id) ?? null;
  const tallyConsistency = report
    ? getTallyConsistency(election.id, report)
    : {
        tallyConsistent: false,
        consistencyMessage: "AggregatorReport 尚未生成，跳过 tally 一致性检查。"
      };
  const integrityCheck = report ? verifyAggregatorReportIntegrity(report) : null;
  const auditRecord = blockchainAuditRecords.get(election.id) ?? null;
  const auditMode = getBlockchainAuditMode();
  const challenges = challengeRecords.filter(
    (record) => record.electionId === election.id
  );
  const publicInputs = createPublicInputsArtifact({
    election: detail,
    bulletin,
    report
  });
  const aggregatorReportArtifact = report
    ? {
        ...report,
        tallyConsistent: tallyConsistency.tallyConsistent,
        consistencyMessage: tallyConsistency.consistencyMessage,
        integrityCheck: integrityCheck as AggregatorReportIntegrityCheck
      }
    : null;

  return {
    election,
    detail,
    bulletin,
    report,
    tallyConsistency,
    integrityCheck,
    auditRecord,
    auditMode,
    challenges,
    publicInputs,
    aggregatorReportArtifact
  };
}

export function buildExportBundle(
  context: ArtifactExportContext
): ElectionExportBundle {
  const bundlePayload = {
    election: context.detail,
    publicInputs: context.publicInputs,
    bulletinBoard: context.bulletin,
    aggregatorReport: context.aggregatorReportArtifact,
    zkSummary: {
      proofMode: null,
      circuitId: "valid-vote-4",
      proofGenerated: false,
      publicSignals: null,
      message:
        "ZK validity proof is not embedded in this export. Generate it separately and merge it into the bundle when available."
    },
    tallyProofSummary:
      context.report?.tallyProofSummary ?? createNotGeneratedTallyProofSummary(),
    chainAudit: {
      auditMode: context.auditMode,
      verifierMode: context.auditRecord?.zkVerified ? ("real-hardhat" as const) : null,
      contractAddress: getDisplayedContractAddress(context.auditMode),
      hasAudit: context.auditRecord !== null,
      audit: context.auditRecord,
      transactionHash: context.auditRecord?.transactionHash ?? null,
      zkVerified: context.auditRecord?.zkVerified ?? false,
      gasUsed: null,
      status: context.auditRecord?.status ?? ("not_submitted" as const)
    },
    demoMetadata: {
      demoSeedFile: "docs/contracts/demo_seed_fixture.json",
      aggregatorCasesFile: "docs/evaluation/AGGREGATOR_AUDIT_CASES.md",
      apiSmokeFile: "docs/evaluation/aggregator_reports/api_smoke.json",
      completenessMatrixFile:
        "docs/evaluation/aggregator_reports/completeness_matrix.json",
      generatedBy: "buildExportBundle",
      notes: [
        "A-track can export this bundle before B-track proof generation.",
        "tallyProofSummary.proofStatus=not-generated means proof metadata is reserved but no tally proof is embedded."
      ]
    },
    challengeRecords: context.challenges
  };

  const bundleHash = hashText(JSON.stringify(bundlePayload));

  return {
    envelope: {
      schemaVersion: "verivote.artifact.v2",
      generatedAt: now(),
      electionId: context.election.id,
      bundleHash
    },
    ...bundlePayload
  };
}

export function sendArtifactAsFile(
  response: express.Response,
  filename: string,
  payload: unknown
): void {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`
  );
  response.send(JSON.stringify(payload, null, 2));
}
