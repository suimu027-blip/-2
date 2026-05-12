import express from "express";
import { ethers } from "ethers";
import { createPersistenceAdapter, type PersistenceAdapter } from "./persistence.js";
import {
  createAuditHash,
  createCommitment,
  createMerkleLeaf,
  createPedersenCommitment,
  createPedersenContext,
  createReceiptCode,
  createReceiptChainHash,
  createVoteTokenHash,
  createVoteVector,
  exportPedersenContext,
  getMerkleProof,
  getMerkleRoot,
  hashReceiptCode,
  hashText,
  verifyPedersenOpening,
  verifyAggregateOpening,
  verifyReceiptChain,
  verifyMerkleProof,
  verifyCommitmentOpening,
  randomHex
} from "@verivote/crypto";
import {
  createRealZkValidityProof,
  createZkValidityProof,
  verifyRealZkValidityProof,
  verifyZkValidityProof,
  createTallyCorrectnessProof,
  verifyTallyCorrectnessProof,
  encodeTallySolidityCalldata,
  TALLY_BATCH_SIZE,
  TALLY_CANDIDATE_COUNT
} from "@verivote/zk";
import type {
  AggregatorReport,
  AttackLog,
  AttackResponse,
  AttackType,
  BlockchainAuditFields,
  BlockchainAuditMode,
  BlockchainAuditRecord,
  BulletinBoard,
  Candidate,
  CastPreparedBallotResponse,
  CastVoteRequest,
  CastVoteResponse,
  ChallengeRecord,
  ChallengePreparedBallotResponse,
  CreateCandidateRequest,
  CreateCandidateResponse,
  CreateElectionRequest,
  CreateElectionResponse,
  Election,
  ElectionDetail,
  ElectionResult,
  ElectionExportBundle,
  ExportBundleResponse,
  FinalizeElectionResponse,
  GetAttackLogsResponse,
  GetBulletinBoardResponse,
  GetBlockchainAuditResponse,
  GetAggregatorReportResponse,
  GetChallengeRecordsResponse,
  GetElectionResponse,
  GetElectionResultResponse,
  GetReceiptProofResponse,
  GetReceiptResponse,
  ListElectionsResponse,
  PedersenAggregateRequest,
  PedersenAggregateResponse,
  PedersenCommitRequest,
  PedersenCommitResponse,
  PedersenVerifyOpeningRequest,
  PedersenVerifyOpeningResponse,
  PendingBallot,
  PrepareBallotRequest,
  PrepareBallotResponse,
  RegisterUserRequest,
  RegisterUserResponse,
  ReceiptChainRecord,
  RunAggregatorResponse,
  SubmitBlockchainAuditResponse,
  SubmitBlockchainAuditWithTallyProofRequest,
  SubmitBlockchainAuditWithTallyProofResponse,
  TallyProofRequestShared,
  TallyProofResponseShared,
  TallyVerifyRequestShared,
  TallyVerifyResponseShared,
  User,
  Vote,
  ZkProofMode,
  ZkValidityProofRequest,
  ZkValidityProofResponse,
  ZkValidityVerifyRequest,
  ZkValidityVerifyResponse
} from "@verivote/shared";

interface ApiZkValidityProofRequest extends ZkValidityProofRequest {
  proofMode?: ZkProofMode;
}

interface ApiZkValidityVerifyRequest extends ZkValidityVerifyRequest {
  proofMode?: ZkProofMode;
}

const app = express();
const port = Number(process.env.PORT ?? 3001);

const users: User[] = [];
const elections: Election[] = [];
const candidates: Candidate[] = [];
const votes: Vote[] = [];
const pendingBallots: PendingBallot[] = [];
const challengeRecords: ChallengeRecord[] = [];
const bulletinBoards: BulletinBoard[] = [];
const aggregatorReports: AggregatorReport[] = [];
const attackLogs: AttackLog[] = [];
const blockchainAuditRecords = new Map<string, BlockchainAuditRecord>();

const AUDIT_ABI = [
  "function submitAudit(bytes32 electionId, bytes32 merkleRoot, bytes32 commitmentRoot, bytes32 receiptRoot, bytes32 auditHash, bytes32 tallyHash)",
  "function submitAuditWithTallyProof(bytes32 electionId, bytes32 merkleRoot, bytes32 commitmentRoot, bytes32 receiptRoot, bytes32 auditHash, bytes32 tallyHash, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[5] input)",
  "function tallyVerifier() view returns (address)",
  "function getAudit(bytes32 electionId) view returns (tuple(bytes32 electionId, bytes32 merkleRoot, bytes32 commitmentRoot, bytes32 receiptRoot, bytes32 auditHash, bytes32 tallyHash, uint256 createdAt, address submitter, bool zkVerified, bool exists))",
  "function hasAudit(bytes32 electionId) view returns (bool)"
];

const MOCK_CONTRACT_ADDRESS = "local-mock:VeriVoteAudit";
const MOCK_SUBMITTER = "local-mock-submit-service";

const counters = {
  user: 0,
  election: 0,
  candidate: 0,
  vote: 0,
  pendingBallot: 0,
  challengeRecord: 0,
  attack: 0
};

function createId(prefix: keyof typeof counters): string {
  counters[prefix] += 1;
  return `${prefix}_${counters[prefix]}`;
}

function now(): string {
  return new Date().toISOString();
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isZkPublicSignals(
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

function findElection(electionId: string): Election | undefined {
  return elections.find((election) => election.id === electionId);
}

function getCandidatesForElection(electionId: string): Candidate[] {
  return candidates.filter((candidate) => candidate.electionId === electionId);
}

function findBulletinBoard(electionId: string): BulletinBoard | undefined {
  return bulletinBoards.find((bulletin) => bulletin.electionId === electionId);
}

function findAggregatorReport(electionId: string): AggregatorReport | undefined {
  return aggregatorReports.find((report) => report.electionId === electionId);
}

function findFirstVote(electionId: string): Vote | undefined {
  return votes.find((vote) => vote.electionId === electionId);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function getBlockchainAuditMode(): BlockchainAuditMode {
  return process.env.BLOCKCHAIN_AUDIT_MODE === "hardhat"
    ? "hardhat"
    : "local-mock";
}

function getAuditContractAddress(): string {
  return (
    process.env.AUDIT_CONTRACT_ADDRESS ??
    process.env.VERIVOTE_AUDIT_CONTRACT_ADDRESS ??
    ""
  );
}

function getDisplayedContractAddress(mode: BlockchainAuditMode): string {
  if (mode === "local-mock") {
    return MOCK_CONTRACT_ADDRESS;
  }

  return getAuditContractAddress();
}

function toBytes32Hex(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (/^0x[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }

  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return `0x${normalized}`;
  }

  return `0x${hashText(value)}`;
}

function createTallyHash(report: AggregatorReport): string {
  return createAuditHash(report.tallyResult);
}

function createBlockchainAuditFields(
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

function createMockTransactionHash(fields: BlockchainAuditFields, createdAt: string): string {
  return `0x${hashText(JSON.stringify({ ...fields, createdAt }))}`;
}

async function getHardhatAuditContract(): Promise<{
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

function createAuditRecordFromChain(
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

function createAttackLog(
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

type AttackTarget =
  | {
      election: Election;
      firstVote: Vote;
    }
  | {
      status: number;
      error: string;
    };

function getAttackTarget(electionId: string): AttackTarget {
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

function isAttackTargetError(
  target: AttackTarget
): target is { status: number; error: string } {
  return "error" in target;
}

function createElectionResult(electionId: string): ElectionResult {
  const electionCandidates = getCandidatesForElection(electionId);
  const electionVotes = votes.filter((vote) => vote.electionId === electionId);

  return createElectionResultFromVotes(electionId, electionVotes);
}

function createElectionResultFromVotes(
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

type VoteWithoutReceiptChain = Omit<
  Vote,
  "receiptChainIndex" | "previousReceiptCodeHash" | "receiptChainHash"
>;

function getLastReceiptChainVote(electionId: string): Vote | undefined {
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

function appendVoteWithReceiptChain(voteWithoutChain: VoteWithoutReceiptChain): Vote {
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

function getReceiptChainRecords(electionVotes: Vote[]): ReceiptChainRecord[] {
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

function saveAggregatorReport(report: AggregatorReport): void {
  const existingIndex = aggregatorReports.findIndex(
    (currentReport) => currentReport.electionId === report.electionId
  );

  if (existingIndex === -1) {
    aggregatorReports.push(report);
    return;
  }

  aggregatorReports[existingIndex] = report;
}

function createAggregatorReport(electionId: string): AggregatorReport {
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

function createAuditHashForAggregatorReport(report: AggregatorReport): string {
  const { auditHash: _auditHash, createdAt: _createdAt, ...coreFields } = report;
  return createAuditHash(coreFields);
}

function getTallyConsistency(
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

function createBulletinBoard(electionId: string): BulletinBoard {
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

app.use(express.json());

app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "verivote-api"
  });
});

app.post<
  never,
  ZkValidityProofResponse | { error: string },
  ApiZkValidityProofRequest
>("/zk/prove-vote-validity", (request, response) => {
  const electionId = clean(request.body.electionId);
  const proofMode = request.body.proofMode ?? "mock";

  if (!electionId) {
    response.status(400).json({ error: "electionId 不能为空" });
    return;
  }

  if (proofMode !== "mock" && proofMode !== "real") {
    response.status(400).json({ error: "proofMode must be mock or real" });
    return;
  }

  if (!isNumberArray(request.body.voteVector)) {
    response.status(400).json({ error: "voteVector 必须是 number[]" });
    return;
  }

  if (
    typeof request.body.candidateCount !== "number" ||
    !Number.isInteger(request.body.candidateCount) ||
    request.body.candidateCount <= 0
  ) {
    response.status(400).json({ error: "candidateCount 必须是正整数" });
    return;
  }

  try {
    const result =
      proofMode === "real"
        ? createRealZkValidityProof({
            electionId,
            voteVector: request.body.voteVector,
            candidateCount: request.body.candidateCount,
            proofMode
          })
        : createZkValidityProof({
            electionId,
            voteVector: request.body.voteVector,
            candidateCount: request.body.candidateCount,
            proofMode
          });

    response.json(
      result
    );
  } catch (error) {
    response.status(500).json({
      error: `ZK proof generation failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

app.post<
  never,
  ZkValidityVerifyResponse | { error: string },
  ApiZkValidityVerifyRequest
>("/zk/verify-vote-validity", (request, response) => {
  const proofMode = request.body.proofMode;

  if (
    proofMode !== undefined &&
    proofMode !== "mock" &&
    proofMode !== "real"
  ) {
    response.status(400).json({ error: "proofMode must be mock or real" });
    return;
  }

  if (!isZkPublicSignals(request.body.publicSignals)) {
    response.status(400).json({ error: "publicSignals 格式无效" });
    return;
  }

  try {
    const result =
      proofMode === "real"
        ? verifyRealZkValidityProof({
            proof: request.body.proof,
            publicSignals: request.body.publicSignals,
            proofMode
          })
        : verifyZkValidityProof({
            proof: request.body.proof,
            publicSignals: request.body.publicSignals,
            proofMode
          });

    response.json(
      result
    );
  } catch (error) {
    response.status(500).json({
      error: `ZK proof verification failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

// --------------------------------------------------------------------------
// Tally correctness proof (batch ZK).
// --------------------------------------------------------------------------

function isIntegerMatrix(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.every((b) => typeof b === "number" && Number.isInteger(b))
    )
  );
}

function isIntegerArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((b) => typeof b === "number" && Number.isInteger(b))
  );
}

app.post<
  never,
  TallyProofResponseShared | { error: string },
  TallyProofRequestShared
>("/zk/prove-tally-correctness", (request, response) => {
  const electionId = clean(request.body.electionId);
  if (!electionId) {
    response.status(400).json({ error: "electionId 不能为空" });
    return;
  }
  if (!isIntegerMatrix(request.body.voteVectors)) {
    response.status(400).json({ error: "voteVectors 必须是整数二维数组" });
    return;
  }
  if (!isIntegerArray(request.body.tally)) {
    response.status(400).json({ error: "tally 必须是整数数组" });
    return;
  }
  if (request.body.voteVectors.length !== TALLY_BATCH_SIZE) {
    response
      .status(400)
      .json({ error: `voteVectors 必须恰好 ${TALLY_BATCH_SIZE} 张票（当前 demo 固定批次大小）` });
    return;
  }
  if (request.body.tally.length !== TALLY_CANDIDATE_COUNT) {
    response
      .status(400)
      .json({ error: `tally 长度必须等于 ${TALLY_CANDIDATE_COUNT}` });
    return;
  }

  try {
    const result = createTallyCorrectnessProof({
      electionId,
      voteVectors: request.body.voteVectors,
      tally: request.body.tally
    });
    response.json({
      proofId: result.proofId,
      publicSignals: result.publicSignals,
      proof: result.proof,
      valid: result.valid,
      message: result.message
    });
  } catch (error) {
    response.status(500).json({
      error: `Tally proof generation failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

app.post<
  never,
  TallyVerifyResponseShared | { error: string },
  TallyVerifyRequestShared
>("/zk/verify-tally-correctness", (request, response) => {
  if (
    !request.body.publicSignals ||
    typeof request.body.publicSignals !== "object"
  ) {
    response.status(400).json({ error: "publicSignals 必填" });
    return;
  }
  try {
    const result = verifyTallyCorrectnessProof({
      proof: request.body.proof,
      publicSignals: request.body.publicSignals
    });
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: `Tally proof verification failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

app.post<never, RegisterUserResponse | { error: string }, RegisterUserRequest>(
  "/users/register",
  (request, response) => {
    const name = clean(request.body.name);

    if (!name) {
      response.status(400).json({ error: "用户名不能为空" });
      return;
    }

    const user: User = {
      id: createId("user"),
      name,
      createdAt: now()
    };

    users.push(user);
    response.status(201).json({ user, userId: user.id });
  }
);

app.post<never, CreateElectionResponse | { error: string }, CreateElectionRequest>(
  "/elections",
  (request, response) => {
    const title = clean(request.body.title);
    const description = clean(request.body.description);

    if (!title) {
      response.status(400).json({ error: "投票标题不能为空" });
      return;
    }

    const election: Election = {
      id: createId("election"),
      title,
      description,
      status: "active",
      createdAt: now()
    };

    elections.push(election);
    response.status(201).json({ election });
  }
);

app.get<never, ListElectionsResponse>("/elections", (_request, response) => {
  response.json({ elections });
});

app.get<{ id: string }, GetElectionResponse | { error: string }>(
  "/elections/:id",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在" });
      return;
    }

    response.json({
      election: {
        ...election,
        candidates: getCandidatesForElection(election.id)
      }
    });
  }
);

app.post<{ id: string }, FinalizeElectionResponse | { error: string }>(
  "/elections/:id/finalize",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在" });
      return;
    }

    const existingBulletin = findBulletinBoard(election.id);

    if (existingBulletin) {
      election.status = "finalized";
      response.json({ election, bulletin: existingBulletin });
      return;
    }

    const bulletin = createBulletinBoard(election.id);
    bulletinBoards.push(bulletin);
    election.status = "finalized";

    response.status(201).json({ election, bulletin });
  }
);

app.get<{ id: string }, GetBulletinBoardResponse | { error: string }>(
  "/elections/:id/bulletin",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在" });
      return;
    }

    const bulletin = findBulletinBoard(election.id) ?? createBulletinBoard(election.id);

    response.json({ election, bulletin });
  }
);

app.post<{ id: string }, RunAggregatorResponse | { error: string }>(
  "/aggregator/elections/:id/run",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法运行聚合器" });
      return;
    }

    const hadExistingReport = Boolean(findAggregatorReport(election.id));
    const report = createAggregatorReport(election.id);
    saveAggregatorReport(report);

    response.status(hadExistingReport ? 200 : 201).json({ election, report });
  }
);

app.get<{ id: string }, GetAggregatorReportResponse | { error: string }>(
  "/aggregator/elections/:id/report",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法查看聚合器报告" });
      return;
    }

    const report = findAggregatorReport(election.id);

    if (!report) {
      response.status(404).json({ error: "聚合器审计报告尚未生成" });
      return;
    }

    response.json({
      election,
      report,
      ...getTallyConsistency(election.id, report)
    });
  }
);

app.post<
  { id: string },
  PrepareBallotResponse | { error: string },
  PrepareBallotRequest
>("/challenge/elections/:id/prepare", (request, response) => {
  const election = findElection(request.params.id);

  if (!election) {
    response.status(404).json({ error: "选举不存在，无法准备挑战审计选票。" });
    return;
  }

  if (election.status !== "active") {
    response.status(409).json({ error: "选举不是进行中状态，不能准备挑战审计选票。" });
    return;
  }

  const userId = clean(request.body.userId);
  const candidateId = clean(request.body.candidateId);

  if (!userId) {
    response.status(400).json({ error: "userId 不能为空" });
    return;
  }

  const user = users.find((currentUser) => currentUser.id === userId);

  if (!user) {
    response.status(404).json({ error: "用户不存在" });
    return;
  }

  if (!candidateId) {
    response.status(400).json({ error: "candidateId 不能为空" });
    return;
  }

  const candidate = candidates.find(
    (currentCandidate) =>
      currentCandidate.id === candidateId &&
      currentCandidate.electionId === election.id
  );

  if (!candidate) {
    response.status(404).json({ error: "候选人不存在或不属于当前选举" });
    return;
  }

  const candidateIds = getCandidatesForElection(election.id).map(
    (currentCandidate) => currentCandidate.id
  );
  const voteVector = createVoteVector(candidateIds, candidate.id);
  const randomness = randomHex();
  const createdAt = now();
  const commitment = createCommitment(election.id, voteVector, randomness);
  const pedersenContextHash = createPedersenContext(election.id, voteVector.length).contextHash;
  const receiptCode = createReceiptCode(
    election.id,
    commitment,
    user.id,
    createdAt
  );
  const pendingBallot: PendingBallot = {
    id: createId("pendingBallot"),
    electionId: election.id,
    userId: user.id,
    candidateId: candidate.id,
    voteVector,
    randomness,
    commitment,
    receiptCode,
    createdAt,
    status: "pending",
    pedersenContextHash
  };

  pendingBallots.push(pendingBallot);
  response.status(201).json({
    pendingBallot,
    message:
      "已生成待确认选票。请在 Cast 和 Challenge 之间选择；当前阶段不会写入正式 votes。"
  });
});

app.post<
  { pendingBallotId: string },
  CastPreparedBallotResponse | { error: string }
>("/challenge/ballots/:pendingBallotId/cast", (request, response) => {
  const pendingBallot = pendingBallots.find(
    (ballot) => ballot.id === request.params.pendingBallotId
  );

  if (!pendingBallot) {
    response.status(404).json({ error: "待确认选票不存在" });
    return;
  }

  if (pendingBallot.status !== "pending") {
    response.status(409).json({ error: "该待确认选票已被处理，不能再次 cast。" });
    return;
  }

  const election = findElection(pendingBallot.electionId);

  if (!election) {
    response.status(404).json({ error: "选举不存在，无法 cast 待确认选票。" });
    return;
  }

  if (election.status !== "active") {
    response.status(409).json({ error: "选举不是进行中状态，不能 cast 待确认选票。" });
    return;
  }

  const alreadyVoted = votes.some(
    (vote) =>
      vote.electionId === pendingBallot.electionId &&
      vote.userId === pendingBallot.userId
  );

  if (alreadyVoted) {
    response.status(409).json({ error: "该用户已经在本次选举中投过票" });
    return;
  }

  const vote = appendVoteWithReceiptChain({
    id: createId("vote"),
    electionId: pendingBallot.electionId,
    userId: pendingBallot.userId,
    candidateId: pendingBallot.candidateId,
    voteVector: pendingBallot.voteVector.slice(),
    randomness: pendingBallot.randomness,
    commitment: pendingBallot.commitment,
    receiptCode: pendingBallot.receiptCode,
    createdAt: pendingBallot.createdAt
  });
  pendingBallot.status = "cast";

  response.status(201).json({
    vote,
    voteId: vote.id,
    receiptCode: vote.receiptCode,
    commitment: vote.commitment,
    receiptChainIndex: vote.receiptChainIndex ?? -1,
    previousReceiptCodeHash: vote.previousReceiptCodeHash ?? null,
    receiptChainHash: vote.receiptChainHash ?? "",
    message: "该 prepared ballot 已正式计入投票。"
  });
});

app.post<
  { pendingBallotId: string },
  ChallengePreparedBallotResponse | { error: string }
>("/challenge/ballots/:pendingBallotId/challenge", (request, response) => {
  const pendingBallot = pendingBallots.find(
    (ballot) => ballot.id === request.params.pendingBallotId
  );

  if (!pendingBallot) {
    response.status(404).json({ error: "待确认选票不存在" });
    return;
  }

  if (pendingBallot.status !== "pending") {
    response.status(409).json({ error: "该待确认选票已被处理，不能再次 challenge。" });
    return;
  }

  const openingVerified = verifyCommitmentOpening(
    pendingBallot.electionId,
    pendingBallot.voteVector,
    pendingBallot.randomness,
    pendingBallot.commitment
  );
  const record: ChallengeRecord = {
    id: createId("challengeRecord"),
    electionId: pendingBallot.electionId,
    pendingBallotId: pendingBallot.id,
    voteVector: pendingBallot.voteVector.slice(),
    randomness: pendingBallot.randomness,
    commitment: pendingBallot.commitment,
    openingVerified,
    createdAt: now()
  };

  challengeRecords.push(record);
  pendingBallot.status = "challenged";

  response.status(201).json({
    record,
    opening: {
      electionId: record.electionId,
      pendingBallotId: record.pendingBallotId,
      voteVector: record.voteVector,
      randomness: record.randomness,
      commitment: record.commitment,
      openingVerified
    },
    openingVerified,
    message: "challenge opening 已公开。该选票只用于审计，不计入 tally。"
  });
});

app.get<{ id: string }, GetChallengeRecordsResponse | { error: string }>(
  "/challenge/elections/:id/records",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法查看挑战审计记录。" });
      return;
    }

    response.json({
      election,
      pendingBallots: pendingBallots.filter(
        (ballot) => ballot.electionId === election.id
      ),
      challengeRecords: challengeRecords.filter(
        (record) => record.electionId === election.id
      )
    });
  }
);

app.post<{ id: string }, SubmitBlockchainAuditResponse | { error: string }>(
  "/blockchain/elections/:id/submit-audit",
  async (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法提交链上审计摘要。" });
      return;
    }

    const bulletin = findBulletinBoard(election.id);

    if (!bulletin) {
      response.status(409).json({ error: "请先生成公告板。" });
      return;
    }

    const report = findAggregatorReport(election.id);

    if (!report) {
      response.status(409).json({ error: "请先运行聚合器。" });
      return;
    }

    const fields = createBlockchainAuditFields(election.id, bulletin, report);
    const auditMode = getBlockchainAuditMode();

    try {
      if (auditMode === "local-mock") {
        if (blockchainAuditRecords.has(election.id)) {
          response.status(409).json({
            error:
              "该 electionId 已提交链上审计摘要，本阶段策略为拒绝重复提交。"
          });
          return;
        }

        const createdAt = now();
        const audit: BlockchainAuditRecord = {
          ...fields,
          transactionHash: createMockTransactionHash(fields, createdAt),
          contractAddress: MOCK_CONTRACT_ADDRESS,
          auditMode,
          createdAt,
          mockSubmitter: MOCK_SUBMITTER,
          status: "submitted"
        };

        blockchainAuditRecords.set(election.id, audit);
        response.status(201).json({
          election,
          audit,
          submittedFields: fields,
          duplicatePolicy: "reject",
          message: "Local Mock Chain Audit 已记录审计摘要。"
        });
        return;
      }

      const { contract, contractAddress } = await getHardhatAuditContract();
      const alreadySubmitted = (await contract.hasAudit(
        fields.electionIdHash
      )) as boolean;

      if (alreadySubmitted) {
        response.status(409).json({
          error: "该 electionId 已提交链上审计摘要，合约策略为拒绝重复提交。"
        });
        return;
      }

      const transaction = await contract.submitAudit(
        fields.electionIdHash,
        fields.merkleRoot,
        fields.commitmentRoot,
        fields.receiptRoot,
        fields.auditHash,
        fields.tallyHash
      );
      const receipt = await transaction.wait();
      const chainRecord = await contract.getAudit(fields.electionIdHash);
      const audit = createAuditRecordFromChain(
        election.id,
        chainRecord,
        receipt?.hash ?? transaction.hash,
        contractAddress
      );

      blockchainAuditRecords.set(election.id, audit);
      response.status(201).json({
        election,
        audit,
        submittedFields: fields,
        duplicatePolicy: "reject",
        message: "Hardhat Audit 已提交审计摘要。"
      });
    } catch (error) {
      response.status(500).json({
        error: `链上审计提交失败：${getUnknownErrorMessage(error)}`
      });
    }
  }
);

// --------------------------------------------------------------------------
// Audit submission gated by an on-chain Groth16 tally-correctness proof.
// Accepts the response payload from `/zk/prove-tally-correctness` verbatim
// as the proof input, avoiding manual calldata wrangling on the client.
// --------------------------------------------------------------------------

app.post<
  { id: string },
  SubmitBlockchainAuditWithTallyProofResponse | { error: string },
  SubmitBlockchainAuditWithTallyProofRequest
>("/blockchain/elections/:id/submit-audit-with-tally-proof", async (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在，无法提交链上审计摘要。" });
    return;
  }
  const bulletin = findBulletinBoard(election.id);
  if (!bulletin) {
    response.status(409).json({ error: "请先生成公告板。" });
    return;
  }
  const report = findAggregatorReport(election.id);
  if (!report) {
    response.status(409).json({ error: "请先运行聚合器。" });
    return;
  }

  const tallyProofResponse = request.body?.tallyProofResponse;
  if (!tallyProofResponse || !tallyProofResponse.proof) {
    response.status(400).json({ error: "tallyProofResponse.proof 不能为空" });
    return;
  }
  if (!tallyProofResponse.valid) {
    response.status(400).json({ error: "tallyProofResponse.valid 为 false，请先重新生成一个合法的 tally proof" });
    return;
  }

  let calldata;
  try {
    calldata = encodeTallySolidityCalldata(tallyProofResponse.proof);
  } catch (error) {
    response.status(400).json({
      error: `无法编码 tally proof calldata: ${getUnknownErrorMessage(error)}`
    });
    return;
  }
  if (calldata.input.length !== 5) {
    response.status(400).json({
      error: `期望 5 个 public signals（4 个 tally + batchSize），实际 ${calldata.input.length}`
    });
    return;
  }

  const fields = createBlockchainAuditFields(election.id, bulletin, report);
  const auditMode = getBlockchainAuditMode();

  try {
    if (auditMode === "local-mock") {
      if (blockchainAuditRecords.has(election.id)) {
        response.status(409).json({
          error: "该 electionId 已提交链上审计摘要，本阶段策略为拒绝重复提交。"
        });
        return;
      }
      const createdAt = now();
      const audit: BlockchainAuditRecord = {
        ...fields,
        transactionHash: createMockTransactionHash(fields, createdAt),
        contractAddress: MOCK_CONTRACT_ADDRESS,
        auditMode,
        createdAt,
        mockSubmitter: MOCK_SUBMITTER,
        zkVerified: true,
        status: "submitted"
      };
      blockchainAuditRecords.set(election.id, audit);
      response.status(201).json({
        election,
        audit,
        submittedFields: fields,
        duplicatePolicy: "reject",
        zkVerified: true,
        message:
          "Local Mock Chain Audit 已记录带 ZK 验证标记的审计摘要（本地模式不调用链上 verifier）。"
      });
      return;
    }

    const { contract, contractAddress } = await getHardhatAuditContract();
    const alreadySubmitted = (await contract.hasAudit(
      fields.electionIdHash
    )) as boolean;
    if (alreadySubmitted) {
      response.status(409).json({
        error: "该 electionId 已提交链上审计摘要，合约策略为拒绝重复提交。"
      });
      return;
    }

    const transaction = await contract.submitAuditWithTallyProof(
      fields.electionIdHash,
      fields.merkleRoot,
      fields.commitmentRoot,
      fields.receiptRoot,
      fields.auditHash,
      fields.tallyHash,
      calldata.a,
      calldata.b,
      calldata.c,
      calldata.input
    );
    const receipt = await transaction.wait();
    const chainRecord = await contract.getAudit(fields.electionIdHash);
    const audit = createAuditRecordFromChain(
      election.id,
      chainRecord,
      receipt?.hash ?? transaction.hash,
      contractAddress
    );
    blockchainAuditRecords.set(election.id, audit);

    response.status(201).json({
      election,
      audit,
      submittedFields: fields,
      duplicatePolicy: "reject",
      zkVerified: true,
      message: "Hardhat Audit 已提交审计摘要，并通过链上 Groth16 Tally Verifier 验证。"
    });
  } catch (error) {
    response.status(500).json({
      error: `带 tally proof 的链上审计提交失败：${getUnknownErrorMessage(error)}`
    });
  }
});

app.get<{ id: string }, GetBlockchainAuditResponse | { error: string }>(
  "/blockchain/elections/:id/audit",
  async (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法查询链上审计摘要。" });
      return;
    }

    const auditMode = getBlockchainAuditMode();

    try {
      if (auditMode === "local-mock") {
        const audit = blockchainAuditRecords.get(election.id) ?? null;

        response.json({
          election,
          audit,
          hasAudit: audit !== null,
          auditMode,
          contractAddress: MOCK_CONTRACT_ADDRESS,
          duplicatePolicy: "reject"
        });
        return;
      }

      const { contract, contractAddress } = await getHardhatAuditContract();
      const electionIdHash = toBytes32Hex(election.id);
      const hasAudit = (await contract.hasAudit(electionIdHash)) as boolean;

      if (!hasAudit) {
        response.json({
          election,
          audit: null,
          hasAudit: false,
          auditMode,
          contractAddress,
          duplicatePolicy: "reject"
        });
        return;
      }

      const chainRecord = await contract.getAudit(electionIdHash);
      const knownAudit = blockchainAuditRecords.get(election.id);
      const audit = createAuditRecordFromChain(
        election.id,
        chainRecord,
        knownAudit?.transactionHash ?? "",
        contractAddress
      );

      response.json({
        election,
        audit,
        hasAudit: true,
        auditMode,
        contractAddress,
        duplicatePolicy: "reject"
      });
    } catch (error) {
      response.status(500).json({
        error: `链上审计查询失败：${getUnknownErrorMessage(error)}`
      });
    }
  }
);

app.post<{ id: string }, AttackResponse | { error: string }>(
  "/attack/elections/:id/tamper-commitment",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const attackType: AttackType = "tamper-commitment";
    const before = {
      voteId: target.firstVote.id,
      commitment: target.firstVote.commitment
    };
    const tamperedCommitment = hashText(`${target.firstVote.commitment}_tampered`);

    target.firstVote.commitment = tamperedCommitment;

    const after = {
      voteId: target.firstVote.id,
      commitment: target.firstVote.commitment
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "演示攻击：篡改第一张选票的 commitment，不同步更新公告板。",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "演示攻击已执行：第一张选票的 commitment 已被篡改。若公告板已生成，重新做 Merkle 验证应失败或出现 Root 不一致。",
      log
    });
  }
);

app.post<{ id: string }, AttackResponse | { error: string }>(
  "/attack/elections/:id/delete-vote",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const attackType: AttackType = "delete-vote";
    const voteIndex = votes.findIndex((vote) => vote.id === target.firstVote.id);
    const [deletedVote] = votes.splice(voteIndex, 1);
    const before = {
      voteId: deletedVote.id,
      receiptCode: deletedVote.receiptCode,
      commitment: deletedVote.commitment
    };
    const after = {
      voteId: deletedVote.id,
      receiptCode: deletedVote.receiptCode,
      exists: false,
      remainingVotes: votes.filter((vote) => vote.electionId === target.election.id)
        .length
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "演示攻击：从内存 votes 中删除第一张选票。",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "演示攻击已执行：第一张选票已从内存 votes 中删除。重新运行聚合器或查看实时公告板时，receipt chain 应显示连续性异常。",
      log
    });
  }
);

app.post<{ id: string }, AttackResponse | { error: string }>(
  "/attack/elections/:id/inject-duplicate-vote",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const attackType: AttackType = "inject-duplicate-vote";
    const createdAt = now();
    const randomness = randomHex();
    const commitment = createCommitment(
      target.election.id,
      target.firstVote.voteVector,
      randomness
    );
    const receiptCode = createReceiptCode(
      target.election.id,
      commitment,
      target.firstVote.userId,
      createdAt
    );
    const duplicateVote = appendVoteWithReceiptChain({
      ...target.firstVote,
      id: createId("vote"),
      randomness,
      commitment,
      receiptCode,
      createdAt
    });

    const voteTokenHash = createVoteTokenHash(
      target.election.id,
      target.firstVote.userId
    );
    const before = {
      sourceVoteId: target.firstVote.id,
      userId: target.firstVote.userId,
      candidateId: target.firstVote.candidateId,
      voteTokenHash
    };
    const after = {
      duplicateVoteId: duplicateVote.id,
      userId: duplicateVote.userId,
      candidateId: duplicateVote.candidateId,
      voteTokenHash
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "演示攻击：注入一张相同 userId 和 candidateId 的重复选票。",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "演示攻击已执行：已注入重复投票。重新运行聚合器后 duplicateVotes 应大于 0，并出现 duplicateTokenHashes。",
      log
    });
  }
);

app.post<{ id: string }, AttackResponse | { error: string }>(
  "/attack/elections/:id/inject-invalid-vote",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const attackType: AttackType = "inject-invalid-vote";
    const candidateCount = getCandidatesForElection(target.election.id).length;
    const voteVector = Array.from({ length: Math.max(candidateCount, 1) }, () => 0);
    const invalidCandidateId = "invalid_candidate_demo";
    const userId = "attacker_user";
    const randomness = randomHex();
    const createdAt = now();
    const commitment = createCommitment(target.election.id, voteVector, randomness);
    const receiptCode = createReceiptCode(
      target.election.id,
      commitment,
      userId,
      createdAt
    );
    const invalidVote = appendVoteWithReceiptChain({
      id: createId("vote"),
      electionId: target.election.id,
      userId,
      candidateId: invalidCandidateId,
      voteVector,
      randomness,
      commitment,
      receiptCode,
      createdAt
    });

    const before = {
      validCandidateIds: getCandidatesForElection(target.election.id).map(
        (candidate) => candidate.id
      )
    };
    const after = {
      voteId: invalidVote.id,
      userId: invalidVote.userId,
      candidateId: invalidVote.candidateId,
      voteVector: invalidVote.voteVector,
      receiptCode: invalidVote.receiptCode
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "演示攻击：注入一张 candidateId 不属于当前选举的非法选票。",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "演示攻击已执行：已注入非法投票。重新运行聚合器后 invalidVotes 应大于 0。",
      log
    });
  }
);

app.post<{ id: string }, AttackResponse | { error: string }>(
  "/attack/elections/:id/tamper-tally",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const report = findAggregatorReport(target.election.id);

    if (!report) {
      response.status(404).json({
        error: "当前选举尚未生成 AggregatorReport，无法执行 tally 篡改演示。请先运行聚合器。"
      });
      return;
    }

    if (report.tallyResult.results.length === 0) {
      response.status(409).json({
        error: "当前 AggregatorReport 没有候选人 tallyResult，无法执行 tally 篡改演示。"
      });
      return;
    }

    const attackType: AttackType = "tamper-tally";
    const before = {
      tallyResult: cloneJson(report.tallyResult)
    };
    const tamperedTally = cloneJson(report.tallyResult);
    tamperedTally.totalVotes += 10;
    tamperedTally.results[0] = {
      ...tamperedTally.results[0],
      voteCount: tamperedTally.results[0].voteCount + 10
    };

    const tamperedReport: AggregatorReport = {
      ...report,
      tallyResult: tamperedTally,
      createdAt: now()
    };
    tamperedReport.auditHash = createAuditHashForAggregatorReport(tamperedReport);
    saveAggregatorReport(tamperedReport);

    const after = {
      tallyResult: tamperedTally
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "演示攻击：篡改 AggregatorReport.tallyResult，不同步修改 votes。",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "演示攻击已执行：AggregatorReport.tallyResult 已被篡改。审计报告应显示 tallyConsistent=false。",
      log
    });
  }
);

app.get<{ id: string }, GetAttackLogsResponse | { error: string }>(
  "/attack/elections/:id/logs",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法查看攻击日志。" });
      return;
    }

    response.json({
      election,
      logs: attackLogs.filter((log) => log.electionId === election.id)
    });
  }
);

app.post<
  { id: string },
  CreateCandidateResponse | { error: string },
  CreateCandidateRequest
>("/elections/:id/candidates", (request, response) => {
  const election = findElection(request.params.id);

  if (!election) {
    response.status(404).json({ error: "选举不存在" });
    return;
  }

  if (election.status === "finalized") {
    response.status(409).json({ error: "选举已生成公告板，不能再添加候选人" });
    return;
  }

  const name = clean(request.body.name);

  if (!name) {
    response.status(400).json({ error: "候选人名称不能为空" });
    return;
  }

  const candidate: Candidate = {
    id: createId("candidate"),
    electionId: election.id,
    name
  };

  candidates.push(candidate);
  response.status(201).json({ candidate });
});

app.post<{ id: string }, CastVoteResponse | { error: string }, CastVoteRequest>(
  "/elections/:id/vote",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在" });
      return;
    }

    if (election.status !== "active") {
      response.status(409).json({ error: "选举不是进行中状态，不能继续投票" });
      return;
    }

    const userId = clean(request.body.userId);
    const candidateId = clean(request.body.candidateId);

    if (!userId) {
      response.status(400).json({ error: "userId 不能为空" });
      return;
    }

    const user = users.find((currentUser) => currentUser.id === userId);

    if (!user) {
      response.status(404).json({ error: "用户不存在" });
      return;
    }

    if (!candidateId) {
      response.status(400).json({ error: "candidateId 不能为空" });
      return;
    }

    const candidate = candidates.find(
      (currentCandidate) =>
        currentCandidate.id === candidateId &&
        currentCandidate.electionId === election.id
    );

    if (!candidate) {
      response.status(404).json({ error: "候选人不存在或不属于当前选举" });
      return;
    }

    const alreadyVoted = votes.some(
      (vote) => vote.electionId === election.id && vote.userId === user.id
    );

    if (alreadyVoted) {
      response.status(409).json({ error: "该用户已经在本次选举中投过票" });
      return;
    }

    const candidateIds = getCandidatesForElection(election.id).map(
      (currentCandidate) => currentCandidate.id
    );
    const voteVector = createVoteVector(candidateIds, candidate.id);
    const randomness = randomHex();
    const createdAt = now();
    const commitment = createCommitment(election.id, voteVector, randomness);
    const pedersenContextHash = createPedersenContext(election.id, voteVector.length).contextHash;
    const receiptCode = createReceiptCode(
      election.id,
      commitment,
      user.id,
      createdAt
    );

    const vote = appendVoteWithReceiptChain({
      id: createId("vote"),
      electionId: election.id,
      userId: user.id,
      candidateId: candidate.id,
      voteVector,
      randomness,
      commitment,
      receiptCode,
      createdAt,
      pedersenContextHash
    });

    response.status(201).json({
      voteId: vote.id,
      receiptCode,
      commitment,
      voteVector,
      receiptChainIndex: vote.receiptChainIndex ?? -1,
      previousReceiptCodeHash: vote.previousReceiptCodeHash ?? null,
      receiptChainHash: vote.receiptChainHash ?? "",
      message: "投票成功"
    });
  }
);

app.get<{ receiptCode: string }, GetReceiptResponse | { error: string }>(
  "/receipts/:receiptCode",
  (request, response) => {
    const receiptCode = clean(request.params.receiptCode);

    if (!receiptCode) {
      response.status(400).json({ error: "receiptCode 不能为空" });
      return;
    }

    const vote = votes.find(
      (currentVote) => currentVote.receiptCode === receiptCode
    );

    if (!vote) {
      response.json({ exists: false });
      return;
    }

    response.json({
      exists: true,
      electionId: vote.electionId,
      voteId: vote.id,
      commitment: vote.commitment,
      receiptChainIndex: vote.receiptChainIndex ?? -1,
      previousReceiptCodeHash: vote.previousReceiptCodeHash ?? null,
      receiptChainHash: vote.receiptChainHash ?? "",
      createdAt: vote.createdAt,
      counted: true
    });
  }
);

app.get<{ receiptCode: string }, GetReceiptProofResponse | { error: string }>(
  "/receipts/:receiptCode/proof",
  (request, response) => {
    const receiptCode = clean(request.params.receiptCode);

    if (!receiptCode) {
      response.status(400).json({ error: "receiptCode 不能为空" });
      return;
    }

    const vote = votes.find(
      (currentVote) => currentVote.receiptCode === receiptCode
    );

    if (!vote) {
      response.status(404).json({ error: "未找到该回执码对应的选票" });
      return;
    }

    const bulletin = findBulletinBoard(vote.electionId);

    if (!bulletin) {
      response.status(404).json({ error: "该选举公告板尚未生成" });
      return;
    }

    const leaf = createMerkleLeaf(vote.id, vote.commitment, vote.receiptCode);
    const leafIncluded = bulletin.leaves.includes(leaf);
    const proof = leafIncluded ? getMerkleProof(bulletin.leaves, leaf) : [];
    const verifyResult =
      leafIncluded && verifyMerkleProof(leaf, proof, bulletin.merkleRoot);

    response.json({
      electionId: vote.electionId,
      voteId: vote.id,
      leaf,
      proof,
      merkleRoot: bulletin.merkleRoot,
      verifyResult
    });
  }
);

app.get<{ id: string }, GetElectionResultResponse | { error: string }>(
  "/elections/:id/result",
  (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在" });
      return;
    }

    response.json({
      election,
      result: createElectionResult(election.id)
    });
  }
);

// --------------------------------------------------------------------------
// Pedersen experimental API (Haechi-inspired vector commitment).
// This module is an experiment. The main voting flow still uses SHA-256
// commitments; these endpoints are isolated under /crypto/pedersen/* and do
// not touch votes, receipts, Merkle roots, or chain audit state.
// --------------------------------------------------------------------------

function isIntegerVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isInteger(entry))
  );
}

function validatePedersenCommonInputs(
  electionId: unknown,
  candidateCount: unknown,
  voteVector: unknown
): string | null {
  if (typeof electionId !== "string" || electionId.trim().length === 0) {
    return "electionId 不能为空";
  }
  if (
    typeof candidateCount !== "number" ||
    !Number.isInteger(candidateCount) ||
    candidateCount <= 0
  ) {
    return "candidateCount 必须是正整数";
  }
  if (!isIntegerVector(voteVector)) {
    return "voteVector 必须是整数数组";
  }
  if (voteVector.length !== candidateCount) {
    return "voteVector 长度必须等于 candidateCount";
  }
  return null;
}

app.post<never, PedersenCommitResponse | { error: string }, PedersenCommitRequest>(
  "/crypto/pedersen/commit",
  (request, response) => {
    const validationError = validatePedersenCommonInputs(
      request.body.electionId,
      request.body.candidateCount,
      request.body.voteVector
    );
    if (validationError) {
      response.status(400).json({ error: validationError });
      return;
    }

    try {
      const context = createPedersenContext(
        clean(request.body.electionId),
        request.body.candidateCount,
        clean(request.body.contextLabel) || undefined
      );
      const providedRandomness =
        typeof request.body.randomness === "string" && request.body.randomness.trim().length > 0
          ? clean(request.body.randomness)
          : undefined;
      const record = createPedersenCommitment(
        context,
        request.body.voteVector,
        providedRandomness
      );

      response.status(201).json({
        context: exportPedersenContext(context),
        commitmentRecord: record,
        message:
          "Pedersen-style commitment 已生成。该模块为实验路径，不会写入正式 votes 或公告板。"
      });
    } catch (error) {
      response.status(500).json({
        error: `Pedersen commit failed: ${getUnknownErrorMessage(error)}`
      });
    }
  }
);

app.post<
  never,
  PedersenVerifyOpeningResponse | { error: string },
  PedersenVerifyOpeningRequest
>("/crypto/pedersen/verify-opening", (request, response) => {
  const validationError = validatePedersenCommonInputs(
    request.body.electionId,
    request.body.candidateCount,
    request.body.voteVector
  );
  if (validationError) {
    response.status(400).json({ error: validationError });
    return;
  }
  if (
    typeof request.body.randomness !== "string" ||
    request.body.randomness.trim().length === 0
  ) {
    response.status(400).json({ error: "randomness 不能为空" });
    return;
  }
  if (
    typeof request.body.commitment !== "string" ||
    request.body.commitment.trim().length === 0
  ) {
    response.status(400).json({ error: "commitment 不能为空" });
    return;
  }

  try {
    const context = createPedersenContext(
      clean(request.body.electionId),
      request.body.candidateCount,
      clean(request.body.contextLabel) || undefined
    );
    const verified = verifyPedersenOpening(
      context,
      request.body.voteVector,
      clean(request.body.randomness),
      clean(request.body.commitment)
    );

    response.json({
      context: exportPedersenContext(context),
      verified,
      message: verified
        ? "Pedersen opening 验证通过：commitment == g^r * prod h_i^{v_i} (mod p)"
        : "Pedersen opening 验证失败：随机数、向量或 commitment 不一致。"
    });
  } catch (error) {
    response.status(500).json({
      error: `Pedersen verify-opening failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

app.post<
  never,
  PedersenAggregateResponse | { error: string },
  PedersenAggregateRequest
>("/crypto/pedersen/aggregate-verify", (request, response) => {
  if (
    typeof request.body.electionId !== "string" ||
    request.body.electionId.trim().length === 0
  ) {
    response.status(400).json({ error: "electionId 不能为空" });
    return;
  }
  if (
    typeof request.body.candidateCount !== "number" ||
    !Number.isInteger(request.body.candidateCount) ||
    request.body.candidateCount <= 0
  ) {
    response.status(400).json({ error: "candidateCount 必须是正整数" });
    return;
  }
  if (!Array.isArray(request.body.batch) || request.body.batch.length === 0) {
    response.status(400).json({ error: "batch 不能为空" });
    return;
  }
  for (const entry of request.body.batch) {
    if (
      !entry ||
      !isIntegerVector(entry.voteVector) ||
      entry.voteVector.length !== request.body.candidateCount ||
      typeof entry.randomness !== "string" ||
      typeof entry.commitment !== "string"
    ) {
      response.status(400).json({ error: "batch 中存在格式无效的条目" });
      return;
    }
  }

  try {
    const context = createPedersenContext(
      clean(request.body.electionId),
      request.body.candidateCount,
      clean(request.body.contextLabel) || undefined
    );
    const result = verifyAggregateOpening(
      context,
      request.body.batch.map((entry) => ({
        voteVector: entry.voteVector,
        randomness: clean(entry.randomness),
        commitment: clean(entry.commitment)
      }))
    );

    response.json({
      context: exportPedersenContext(context),
      aggregatedCommitment: result.aggregatedCommitment,
      expectedCommitment: result.expectedCommitment,
      aggregatedRandomness: result.aggregatedRandomness,
      aggregatedVector: result.aggregatedVector,
      verified: result.verified,
      message: result.verified
        ? "Pedersen 聚合承诺核查通过：prod(C_i) 与 commit(sum v_i, sum r_i) 一致。"
        : "Pedersen 聚合承诺核查失败：聚合后的 commitment 与开封不一致。"
    });
  } catch (error) {
    response.status(500).json({
      error: `Pedersen aggregate-verify failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

// --------------------------------------------------------------------------
// Zeeperio-style artifact export bundle.
// --------------------------------------------------------------------------

interface ArtifactExportContext {
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

function createPublicInputsArtifact(input: {
  election: ElectionDetail;
  bulletin: BulletinBoard;
  report: AggregatorReport | null;
}) {
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
    zkCircuitId: "valid-vote-4"
  };
}

function buildArtifactContext(election: Election): ArtifactExportContext {
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

function buildExportBundle(
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
        "导出时未内联 ZK proof。可单独调用 /zk/prove-vote-validity 生成，再合并到 bundle。"
    },
    chainAudit: {
      auditMode: context.auditMode,
      contractAddress: getDisplayedContractAddress(context.auditMode),
      hasAudit: context.auditRecord !== null,
      audit: context.auditRecord
    },
    challengeRecords: context.challenges
  };

  const bundleHash = hashText(JSON.stringify(bundlePayload));

  return {
    envelope: {
      schemaVersion: "verivote.artifact.v1",
      generatedAt: now(),
      electionId: context.election.id,
      bundleHash
    },
    ...bundlePayload
  };
}

function sendArtifactAsFile(
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

app.get<{ id: string }, ExportBundleResponse | { error: string }>(
  "/elections/:id/export-bundle",
  async (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "选举不存在，无法导出审计包。" });
      return;
    }

    const bundle = buildExportBundle(buildArtifactContext(election));
    response.json({ bundle });
  }
);

// ---- per-artifact endpoints (Zeeperio-style split files) -----------------

app.get<{ id: string }>("/elections/:id/export/bulletin_board.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  sendArtifactAsFile(response, `bulletin_board_${election.id}.json`, context.bulletin);
});

app.get<{ id: string }>("/elections/:id/export/aggregator_report.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  if (!context.aggregatorReportArtifact) {
    response.status(404).json({
      error: "AggregatorReport 尚未生成，请先调用聚合器。"
    });
    return;
  }
  sendArtifactAsFile(
    response,
    `aggregator_report_${election.id}.json`,
    context.aggregatorReportArtifact
  );
});

app.get<{ id: string }>("/elections/:id/export/zk_summary.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  sendArtifactAsFile(response, `zk_summary_${election.id}.json`, {
    proofMode: null,
    circuitId: "valid-vote-4",
    proofGenerated: false,
    publicSignals: null,
    electionIdHash: context.publicInputs.electionIdHash,
    candidateCount: context.publicInputs.candidateCount,
    message:
      "该文件是 ZK 摘要。请单独调用 /zk/prove-vote-validity 生成 proof 后合并到 bundle。"
  });
});

app.get<{ id: string }>("/elections/:id/export/chain_audit.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  sendArtifactAsFile(response, `chain_audit_${election.id}.json`, {
    auditMode: context.auditMode,
    contractAddress: getDisplayedContractAddress(context.auditMode),
    hasAudit: context.auditRecord !== null,
    audit: context.auditRecord
  });
});

app.get<{ id: string }>("/elections/:id/export/public_inputs.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  sendArtifactAsFile(
    response,
    `public_inputs_${election.id}.json`,
    context.publicInputs
  );
});

// --------------------------------------------------------------------------
// Persistence wiring (SQLite or in-memory fallback).
// We install save hooks on the write-heavy helpers after state is loaded so
// that handlers don't need to know about the adapter directly.
// --------------------------------------------------------------------------

let persistence: PersistenceAdapter | null = null;

function persistCounters(): void {
  persistence?.saveCounters({ ...counters });
}

function installPersistenceHooks(adapter: PersistenceAdapter): void {
  persistence = adapter;

  const hydrated = {
    users,
    elections,
    candidates,
    votes,
    pendingBallots,
    challengeRecords,
    bulletinBoards,
    aggregatorReports,
    attackLogs,
    blockchainAuditRecords,
    counters
  };
  adapter.load(hydrated);

  // Wrap array push methods so inserts are persisted transparently.
  function wrapPush<T>(
    arr: T[],
    save: (item: T) => void,
    onAllAfterPush?: () => void
  ): void {
    const originalPush = arr.push.bind(arr);
    arr.push = ((...items: T[]) => {
      const result = originalPush(...items);
      for (const item of items) save(item);
      onAllAfterPush?.();
      return result;
    }) as typeof arr.push;
  }

  wrapPush(users, (item) => adapter.saveUser(item), persistCounters);
  wrapPush(elections, (item) => adapter.saveElection(item), persistCounters);
  wrapPush(candidates, (item) => adapter.saveCandidate(item), persistCounters);
  wrapPush(votes, (item) => adapter.saveVote(item), persistCounters);
  wrapPush(pendingBallots, (item) => adapter.savePendingBallot(item), persistCounters);
  wrapPush(challengeRecords, (item) => adapter.saveChallengeRecord(item), persistCounters);
  wrapPush(bulletinBoards, (item) => adapter.saveBulletinBoard(item));
  wrapPush(aggregatorReports, (item) => adapter.saveAggregatorReport(item));
  wrapPush(attackLogs, (item) => adapter.saveAttackLog(item), persistCounters);

  // Map persistence
  const originalSet = blockchainAuditRecords.set.bind(blockchainAuditRecords);
  blockchainAuditRecords.set = ((key: string, value: BlockchainAuditRecord) => {
    adapter.saveBlockchainAuditRecord(value);
    return originalSet(key, value);
  }) as typeof blockchainAuditRecords.set;

  // Wrap splice so that votes deletions (used by the attack lab) propagate.
  const originalSplice = votes.splice.bind(votes);
  votes.splice = ((start: number, deleteCount?: number, ...inserted: Vote[]) => {
    const deleted = originalSplice(
      start,
      deleteCount as number,
      ...(inserted as Vote[])
    );
    for (const vote of deleted) adapter.deleteVote(vote.id);
    for (const vote of inserted) adapter.saveVote(vote);
    return deleted;
  }) as typeof votes.splice;

  // Wrap saveAggregatorReport because it mutates in place instead of push.
  const originalSaveAggregator = saveAggregatorReport;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (saveAggregatorReport as any) = (report: AggregatorReport) => {
    originalSaveAggregator(report);
    adapter.saveAggregatorReport(report);
  };
}

async function bootstrap(): Promise<void> {
  try {
    const adapter = await createPersistenceAdapter();
    installPersistenceHooks(adapter);
  } catch (error) {
    console.error("[persistence] failed to initialize:", error);
    if ((process.env.VERIVOTE_PERSISTENCE ?? "auto").toLowerCase() === "sqlite") {
      process.exit(1);
    }
  }

  app.listen(port, () => {
    console.log(
      `VeriVote API listening on http://localhost:${port} (persistence: ${persistence?.mode ?? "memory"})`
    );
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
