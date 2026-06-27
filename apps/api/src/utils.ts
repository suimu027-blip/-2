import { ethers } from "ethers";
import type express from "express";
import {
  createAuditHash,
  createCommitment,
  createMerkleLeaf,
  createReceiptChainHash,
  createVoteTokenHash,
  getMerkleProof,
  getMerkleRoot,
  hashReceiptCode,
  hashText,
  verifyReceiptChain,
  verifyAggregateOpening,
  verifyMerkleProof,
  createPedersenContext,
  exportPedersenContext
} from "@verivote/crypto";
import type {
  Election,
  Candidate,
  Vote,
  AggregatorReport,
  AggregatorReportV2,
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
  ChallengeRecord
} from "@verivote/shared";
import type { ZkValidityVerifyRequest } from "@verivote/shared";
import {
  users,
  elections,
  candidates,
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

export function createAggregatorReport(electionId: string): AggregatorReport {
  const electionVotes = votes.filter((vote) => vote.electionId === electionId);
  const validCandidateIds = new Set(
    getCandidatesForElection(electionId).map((candidate) => candidate.id)
  );
  const seenTokenHashes = new Set<string>();
  const duplicateTokenHashSet = new Set<string>();
  const voteTokenHashes: string[] = [];
  const validVoteRecords: Vote[] = [];
  let invalidVotes = 0;
  let duplicateVotes = 0;

  for (const vote of electionVotes) {
    const voteTokenHash = createVoteTokenHash(electionId, vote.userId);
    voteTokenHashes.push(voteTokenHash);

    const isDuplicate = seenTokenHashes.has(voteTokenHash);
    if (isDuplicate) {
      duplicateVotes += 1;
      duplicateTokenHashSet.add(voteTokenHash);
    } else {
      seenTokenHashes.add(voteTokenHash);
    }

    const hasValidCandidate = validCandidateIds.has(vote.candidateId);
    if (!hasValidCandidate) {
      invalidVotes += 1;
    }

    if (!isDuplicate && hasValidCandidate) {
      validVoteRecords.push(vote);
    }
  }

  const duplicateTokenHashes = Array.from(duplicateTokenHashSet);
  const tallyResult = createElectionResultFromVotes(electionId, validVoteRecords);
  const commitmentRoot = getMerkleRoot(
    validVoteRecords.map((vote) => vote.commitment)
  );
  const receiptRoot = getMerkleRoot(
    validVoteRecords.map((vote) => vote.receiptCode)
  );
  const receiptChainVerification = verifyReceiptChain(electionVotes);

  // --- Pedersen homomorphic tally verification ---
  let pedersenTallyVerified: boolean | undefined;
  let pedersenTallyMessage: string | undefined;
  let pedersenContextHash: string | undefined;
  try {
    const candidateCount = getCandidatesForElection(electionId).length;
    if (candidateCount > 0 && validVoteRecords.length > 0) {
      const pedersenContext = createPedersenContext(electionId, candidateCount);
      pedersenContextHash = pedersenContext.contextHash;
      const batch = validVoteRecords.map((vote) => ({
        voteVector: vote.voteVector,
        randomness: vote.randomness,
        commitment: vote.commitment
      }));
      const verification = verifyAggregateOpening(pedersenContext, batch);
      pedersenTallyVerified = verification.verified;
      pedersenTallyMessage = verification.verified
        ? "Pedersen 同态计票验证通过：∏C_i == commit(Σv_i, Σr_i)。"
        : "Pedersen 同态计票验证失败：∏C_i ≠ commit(Σv_i, Σr_i)，聚合数据可能被篡改。";
    }
  } catch {
    pedersenTallyMessage = "Pedersen 同态计票验证异常。";
  }

  const coreFields = {
    electionId,
    totalVotes: electionVotes.length,
    validVotes: validVoteRecords.length,
    invalidVotes,
    duplicateVotes,
    receiptChainVerified: receiptChainVerification.verified,
    receiptChainBreaks: receiptChainVerification.breaks,
    voteTokenHashes,
    duplicateTokenHashes,
    tallyResult,
    commitmentRoot,
    receiptRoot,
    pedersenTallyVerified,
    pedersenTallyMessage,
    pedersenContextHash
  };

  return {
    ...coreFields,
    auditHash: createAuditHash(coreFields),
    createdAt: now()
  };
}

export function createAuditHashForAggregatorReport(report: AggregatorReport): string {
  const { auditHash: _auditHash, createdAt: _createdAt, ...coreFields } = report;
  return createAuditHash(coreFields);
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
  auditRecord: BlockchainAuditRecord | null;
  auditMode: BlockchainAuditMode;
  challenges: ChallengeRecord[];
  publicInputs: ReturnType<typeof createPublicInputsArtifact>;
  aggregatorReportArtifact: (AggregatorReport & {
    tallyConsistent: boolean;
    consistencyMessage: string;
  }) | null;
}

export function createPublicInputsArtifact(input: {
  election: ElectionDetail;
  bulletin: BulletinBoard;
  report: AggregatorReport | null;
}) {
  const reportV2 = input.report as AggregatorReportV2 | null;

  return {
    electionId: input.election.id,
    electionIdHash: toBytes32Hex(input.election.id),
    candidateCount: input.election.candidates.length,
    totalVotes: input.bulletin.totalVotes,
    validVotes: input.report?.validVotes ?? input.bulletin.totalVotes,
    merkleRoot: input.bulletin.merkleRoot,
    commitmentRoot: input.report?.commitmentRoot ?? "",
    receiptRoot: input.report?.receiptRoot ?? "",
    tallyHash: input.report ? createTallyHash(input.report) : "",
    auditHash: input.report?.auditHash ?? "",
    partitionHash: reportV2?.partitionAudit?.partitionHash ?? "",
    diagnosticsHash: reportV2?.diagnosticsHash ?? "",
    pedersenAggregateHash: reportV2?.pedersenAggregateHash ?? null,
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
        consistencyMessage: tallyConsistency.consistencyMessage
      }
    : null;

  return {
    election,
    detail,
    bulletin,
    report,
    tallyConsistency,
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
      verifierMode:
        context.auditMode === "hardhat"
          ? ("real-hardhat" as const)
          : ("local-mock" as const),
      circuitId: "valid-vote-4",
      proofGenerated: false,
      proofHash: null,
      publicSignals: null,
      message:
        "导出时未内联 ZK proof。可单独调用 /zk/prove-vote-validity生成，再合并到 bundle。"
    },
    tallyProofSummary: null,
    chainAudit: {
      auditMode: context.auditMode,
      verifierMode:
        context.auditRecord?.verifierMode ??
        (context.auditRecord?.zkVerified
          ? context.auditMode === "hardhat"
            ? ("real-hardhat" as const)
            : ("local-mock" as const)
          : undefined),
      contractAddress: getDisplayedContractAddress(context.auditMode),
      transactionHash: context.auditRecord?.transactionHash ?? null,
      zkVerified: context.auditRecord?.zkVerified ?? false,
      gasUsed: context.auditRecord?.gasUsed,
      status: context.auditRecord?.status ?? "not_found",
      hasAudit: context.auditRecord !== null,
      audit: context.auditRecord
    },
    challengeRecords: context.challenges,
    demoMetadata: {
      fixtureMode: "api" as const,
      generatedAt: now(),
      electionId: context.election.id,
      candidateCount: context.detail.candidates.length,
      castVotes: context.bulletin.totalVotes,
      challengeBallots: context.challenges.length,
      normalFlow:
        "create election -> register users -> cast votes -> finalize bulletin -> run aggregator -> export bundle"
    }
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
