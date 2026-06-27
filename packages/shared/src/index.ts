export type ElectionStatus = "draft" | "active" | "closed" | "finalized";

export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface Election {
  id: string;
  title: string;
  description: string;
  status: ElectionStatus;
  createdAt: string;
}

export interface Candidate {
  id: string;
  electionId: string;
  name: string;
}

export interface Vote {
  id: string;
  electionId: string;
  userId: string;
  candidateId: string;
  voteVector: number[];
  randomness: string;
  commitment: string;
  receiptCode: string;
  receiptChainIndex?: number;
  previousReceiptCodeHash?: string | null;
  receiptChainHash?: string;
  createdAt: string;
  
  pedersenContextHash?: string;
}

export interface ReceiptChainBreak {
  voteId?: string;
  index: number;
  reason: string;
}

export interface ReceiptChainRecord {
  voteId: string;
  receiptCodeHash: string;
  commitment: string;
  receiptChainIndex: number;
  previousReceiptCodeHash: string | null;
  receiptChainHash: string;
}

export type PendingBallotStatus = "pending" | "cast" | "challenged";

export interface PendingBallot {
  id: string;
  electionId: string;
  userId: string;
  candidateId: string;
  voteVector: number[];
  randomness: string;
  commitment: string;
  receiptCode: string;
  createdAt: string;
  status: PendingBallotStatus;
  
  pedersenContextHash?: string;
}

export interface ChallengeRecord {
  id: string;
  electionId: string;
  pendingBallotId: string;
  voteVector: number[];
  randomness: string;
  commitment: string;
  openingVerified: boolean;
  createdAt: string;
  
  pedersenContextHash?: string;
}

export interface ChallengeOpeningVerification {
  electionId: string;
  pendingBallotId: string;
  voteVector: number[];
  randomness: string;
  commitment: string;
  openingVerified: boolean;
}

export interface ElectionDetail extends Election {
  candidates: Candidate[];
}

export interface ElectionResultItem {
  candidateId: string;
  candidateName: string;
  voteCount: number;
}

export interface ElectionResult {
  electionId: string;
  totalVotes: number;
  results: ElectionResultItem[];
}

export interface MerkleProofItem {
  sibling: string;
  position: "left" | "right";
}

export interface BulletinBoard {
  electionId: string;
  commitments: string[];
  receiptCodeHashes: string[];
  receiptChain: ReceiptChainRecord[];
  receiptChainVerified: boolean;
  receiptChainBreaks: ReceiptChainBreak[];
  leaves: string[];
  merkleRoot: string;
  tallyResult: ElectionResult;
  totalVotes: number;
  createdAt: string;
}

export interface CandidatePartitionBucket {
  candidateId: string;
  candidateName: string;
  voteCount: number;
  voteIds: string[];
  tokenHashes: string[];
  tokenRoot: string;
  commitmentRoot: string;
  receiptRoot: string;
  bucketAuditHash: string;
}

export interface PartitionAudit {
  buckets: CandidatePartitionBucket[];
  coverComplete: boolean;
  disjoint: boolean;
  noDuplicateValidTokenHashes: boolean;
  allValidVotesBucketed: boolean;
  partitionHash: string;
}

export type InvalidVoteReason =
  | "duplicate-token"
  | "invalid-candidate"
  | "invalid-one-hot"
  | "candidate-vector-mismatch"
  | "commitment-opening-failed"
  | "receipt-chain-break";

export interface InvalidVoteDiagnostic {
  voteId: string;
  userIdHash?: string;
  tokenHash: string;
  reason: InvalidVoteReason;
  detail: string;
  evidenceHash: string;
}

export interface PedersenAggregateAudit {
  contextHash: string;
  aggregatedCommitment: string;
  expectedCommitment: string;
  aggregatedVector: number[];
  aggregatedRandomnessHash: string;
  castVoteCount: number;
  verified: boolean;
  message: string;
  pedersenAggregateHash: string;
}

export type PedersenAggregateStatus =
  | "not-generated"
  | "pending"
  | "verified"
  | "failed";

export type TallyProofStatus = "not-generated" | "pending" | "generated" | "failed";

export interface TallyProofSummaryArtifact {
  proofStatus: TallyProofStatus;
  proofId: string | null;
  proofMode: TallyProofModeShared | null;
  verifierMode: TallyVerifierModeShared | null;
  circuitId: string | null;
  proofHash: string | null;
  publicSignals: TallyPublicSignalsShared | null;
  message: string;
}

export interface AggregatorReportIntegrityCheck {
  verified: boolean;
  checks: {
    fieldShapeValid: boolean;
    auditHashMatches: boolean;
    partitionHashMatches: boolean;
    nestedPartitionHashMatches: boolean;
    diagnosticsHashMatches: boolean;
    diagnosticEvidenceHashesMatch: boolean;
    bucketAuditHashesMatch: boolean;
    bucketVoteCountsMatch: boolean;
    bucketTokenRootsMatchTokenHashes: boolean;
    bucketTallyMatches: boolean;
    bucketVoteIdsDisjoint: boolean;
    bucketVoteCountSumMatchesValidVotes: boolean;
    validVoteIdsMatchBuckets: boolean;
    invalidVoteIdsMatchDiagnostics: boolean;
    validAndInvalidVoteIdsDisjoint: boolean;
    invalidVoteIdsExcludedFromBuckets: boolean;
    voteIdAccountingMatchesTotalVotes: boolean;
    partitionFlagsMatchStructure: boolean;
    noDuplicateValidTokenHashesAsserted: boolean;
    noDuplicateValidTokenHashesVerified: boolean;
    publicInputHintsMatch: boolean;
    voteTokenHashCountMatchesTotalVotes: boolean;
    duplicateTokenHashesMatchDiagnostics: boolean;
    receiptChainStatusMatchesBreaks: boolean;
    candidateCountMatchesPartitions: boolean;
    totalVoteCountMatchesValidAndInvalid: boolean;
    tallyTotalMatchesValidVotes: boolean;
    tallySumMatchesValidVotes: boolean;
    invalidVoteCountMatchesDiagnostics: boolean;
    duplicateVoteCountMatchesDiagnostics: boolean;
    pedersenAggregateHashMatches: boolean;
    pedersenAggregateStatusMatches: boolean;
  };
  failures: string[];
  recomputed: {
    auditHash: string;
    partitionHash: string;
    diagnosticsHash: string;
    pedersenAggregateHash: string | null;
    bucketAuditHashes: string[];
    publicInputHints: AggregatorReport["publicInputHints"];
  };
}

export interface AggregatorReport {
  electionId: string;
  totalVotes: number;
  validVotes: number;
  validVoteIds: string[];
  invalidVotes: number;
  invalidVoteIds: string[];
  duplicateVotes: number;
  proofStatus: TallyProofStatus;
  tallyProofSummary: TallyProofSummaryArtifact | null;
  receiptChainVerified: boolean;
  receiptChainBreaks: ReceiptChainBreak[];
  voteTokenHashes: string[];
  duplicateTokenHashes: string[];
  tallyResult: ElectionResult;
  commitmentRoot: string;
  receiptRoot: string;
  partitionAudit: PartitionAudit;
  partitionHash: string;
  invalidVoteDiagnostics: InvalidVoteDiagnostic[];
  diagnosticsHash: string;
  publicInputHints: {
    electionIdHash: string;
    candidateCount: number;
    validVotes: number;
    tallyHash: string;
    commitmentRoot: string;
    receiptRoot: string;
    partitionHash: string;
    diagnosticsHash: string;
    pedersenAggregateHash?: string | null;
  };
  auditHash: string;
  createdAt: string;
  
  pedersenAggregateAudit?: PedersenAggregateAudit | null;
  pedersenAggregateStatus: PedersenAggregateStatus;
  pedersenAggregateHash?: string | null;
  
  pedersenTallyVerified?: boolean;
  pedersenTallyMessage?: string;
  
  pedersenContextHash?: string;
}

export type BlockchainAuditMode = "local-mock" | "hardhat";

export type BlockchainAuditStatus = "submitted" | "not_found";

export interface BlockchainAuditFields {
  electionId: string;
  electionIdHash: string;
  merkleRoot: string;
  commitmentRoot: string;
  receiptRoot: string;
  auditHash: string;
  tallyHash: string;
}

export interface BlockchainAuditRecord extends BlockchainAuditFields {
  transactionHash: string;
  contractAddress: string;
  auditMode: BlockchainAuditMode;
  createdAt: string;
  submitter?: string;
  mockSubmitter?: string;
  
  zkVerified?: boolean;
  status: BlockchainAuditStatus;
}

export type ZkProofMode = "mock" | "real";

export interface ZkValidityPublicSignals {
  electionIdHash: string;
  candidateCount: number;
  voteVectorCommitment: string;
}

export interface ZkValidityProofRequest {
  electionId: string;
  voteVector: number[];
  candidateCount: number;
  proofMode?: ZkProofMode;
}

export interface ZkValidityProofResponse {
  proofId: string;
  proofMode: ZkProofMode;
  publicSignals: ZkValidityPublicSignals;
  proof: unknown;
  valid: boolean;
  message: string;
}

export interface ZkValidityVerifyRequest {
  proof: unknown;
  publicSignals: ZkValidityPublicSignals;
  proofMode?: ZkProofMode;
}

export interface ZkValidityVerifyResponse {
  proofMode: ZkProofMode;
  verified: boolean;
  message: string;
}

export type AttackType =
  | "tamper-commitment"
  | "delete-vote"
  | "inject-duplicate-vote"
  | "inject-invalid-vote"
  | "inject-non-one-hot-vote"
  | "inject-candidate-vector-mismatch"
  | "tamper-tally";

export interface AttackLog {
  id: string;
  electionId: string;
  type: AttackType;
  description: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export type AggregatorReportV2 = AggregatorReport;

export interface ApiErrorResponse {
  error: string;
}

export interface RegisterUserRequest {
  name: string;
}

export interface RegisterUserResponse {
  user: User;
  userId: string;
}

export interface CreateElectionRequest {
  title: string;
  description: string;
}

export interface CreateElectionResponse {
  election: Election;
}

export interface ListElectionsResponse {
  elections: Election[];
}

export interface GetElectionResponse {
  election: ElectionDetail;
}

export interface CreateCandidateRequest {
  name: string;
}

export interface CreateCandidateResponse {
  candidate: Candidate;
}

export interface CastVoteRequest {
  userId: string;
  candidateId: string;
}

export interface CastVoteResponse {
  voteId: string;
  receiptCode: string;
  commitment: string;
  voteVector: number[];
  receiptChainIndex: number;
  previousReceiptCodeHash: string | null;
  receiptChainHash: string;
  message: string;
  
  pedersenContextHash?: string;
}

export interface PrepareBallotRequest {
  userId: string;
  candidateId: string;
}

export interface PrepareBallotResponse {
  pendingBallot: PendingBallot;
  message: string;
}

export interface CastPreparedBallotResponse {
  vote: Vote;
  voteId: string;
  receiptCode: string;
  commitment: string;
  receiptChainIndex: number;
  previousReceiptCodeHash: string | null;
  receiptChainHash: string;
  message: string;
}

export interface ChallengePreparedBallotResponse {
  record: ChallengeRecord;
  opening: ChallengeOpeningVerification;
  openingVerified: boolean;
  message: string;
}

export interface GetChallengeRecordsResponse {
  election: Election;
  pendingBallots: PendingBallot[];
  challengeRecords: ChallengeRecord[];
}

export interface GetElectionResultResponse {
  election: Election;
  result: ElectionResult;
}

export interface FinalizeElectionResponse {
  election: Election;
  bulletin: BulletinBoard;
}

export interface GetBulletinBoardResponse {
  election: Election;
  bulletin: BulletinBoard;
}

export interface GetReceiptProofResponse {
  electionId: string;
  voteId: string;
  leaf: string;
  proof: MerkleProofItem[];
  merkleRoot: string;
  verifyResult: boolean;
}

export interface RunAggregatorResponse {
  election: Election;
  report: AggregatorReport;
  integrityCheck: AggregatorReportIntegrityCheck;
}

export interface GetAggregatorReportResponse {
  election: Election;
  report: AggregatorReport;
  tallyConsistent: boolean;
  consistencyMessage: string;
  integrityCheck: AggregatorReportIntegrityCheck;
}

export interface SubmitBlockchainAuditResponse {
  election: Election;
  audit: BlockchainAuditRecord;
  submittedFields: BlockchainAuditFields;
  duplicatePolicy: "reject";
  message: string;
}

// --- on-chain tally-proof gated audit submission ---

export interface SubmitBlockchainAuditWithTallyProofRequest {
  
  tallyProofResponse: TallyProofResponseShared;
}

export interface SubmitBlockchainAuditWithTallyProofResponse extends SubmitBlockchainAuditResponse {
  zkVerified: true;
}

export interface GetBlockchainAuditResponse {
  election: Election;
  audit: BlockchainAuditRecord | null;
  hasAudit: boolean;
  auditMode: BlockchainAuditMode;
  contractAddress: string;
  duplicatePolicy: "reject";
}

export interface AttackResponse {
  ok: true;
  attackType: AttackType;
  message: string;
  log: AttackLog;
}

export interface GetAttackLogsResponse {
  election: Election;
  logs: AttackLog[];
}

export type GetReceiptResponse =
  | {
      exists: true;
      electionId: string;
      voteId: string;
      commitment: string;
      receiptChainIndex: number;
      previousReceiptCodeHash: string | null;
      receiptChainHash: string;
      createdAt: string;
      counted: true;
    }
  | {
      exists: false;
    };

// --------------------------------------------------------------------------
// Pedersen experiment module (Haechi-inspired vector commitment).
// Not wired into the main voting flow; exposed through experimental APIs.
// --------------------------------------------------------------------------

export interface PedersenContextSnapshot {
  electionId: string;
  contextLabel: string;
  contextHash: string;
  p: string;
  q: string;
  g: string;
  h: string[];
}

export interface PedersenCommitmentRecord {
  commitment: string;
  randomness: string;
  length: number;
  contextHash: string;
}

export interface PedersenCommitRequest {
  electionId: string;
  voteVector: number[];
  candidateCount: number;
  randomness?: string;
  contextLabel?: string;
}

export interface PedersenCommitResponse {
  context: PedersenContextSnapshot;
  commitmentRecord: PedersenCommitmentRecord;
  message: string;
}

export interface PedersenVerifyOpeningRequest {
  electionId: string;
  voteVector: number[];
  candidateCount: number;
  randomness: string;
  commitment: string;
  contextLabel?: string;
}

export interface PedersenVerifyOpeningResponse {
  context: PedersenContextSnapshot;
  verified: boolean;
  message: string;
}

export interface PedersenAggregateBatchEntry {
  voteVector: number[];
  randomness: string;
  commitment: string;
}

export interface PedersenAggregateRequest {
  electionId: string;
  candidateCount: number;
  batch: PedersenAggregateBatchEntry[];
  contextLabel?: string;
}

export interface PedersenAggregateResponse {
  context: PedersenContextSnapshot;
  aggregatedCommitment: string;
  expectedCommitment: string;
  aggregatedRandomness: string;
  aggregatedVector: number[];
  verified: boolean;
  message: string;
}

// --------------------------------------------------------------------------
// Zeeperio-style artifact export bundle.
// --------------------------------------------------------------------------

export interface ArtifactEnvelope {
  
  schemaVersion: "verivote.artifact.v1" | "verivote.artifact.v2";
  
  generatedAt: string;
  
  electionId: string;
  
  bundleHash: string;
}

export interface PublicInputsArtifact {
  electionId: string;
  electionIdHash: string;
  candidateCount: number;
  totalVotes: number;
  validVotes: number;
  merkleRoot: string;
  commitmentRoot: string;
  receiptRoot: string;
  tallyHash: string;
  partitionHash: string;
  diagnosticsHash: string;
  auditHash: string;
  zkCircuitId?: string;
}

export interface BulletinBoardArtifact extends BulletinBoard {}

export interface AggregatorReportArtifact extends AggregatorReport {
  tallyConsistent: boolean;
  consistencyMessage: string;
  integrityCheck: AggregatorReportIntegrityCheck;
}

export interface ZkSummaryArtifact {
  proofMode: ZkProofMode | null;
  circuitId: string | null;
  proofGenerated: boolean;
  publicSignals: ZkValidityPublicSignals | null;
  message: string;
}

export interface ChainAuditArtifact {
  auditMode: BlockchainAuditMode;
  verifierMode: TallyVerifierModeShared | null;
  contractAddress: string;
  hasAudit: boolean;
  audit: BlockchainAuditRecord | null;
  transactionHash: string | null;
  zkVerified: boolean;
  gasUsed?: string | null;
  status: BlockchainAuditStatus | "not_submitted";
}

export interface DemoMetadataArtifact {
  demoSeedFile: string;
  aggregatorCasesFile: string;
  apiSmokeFile: string;
  completenessMatrixFile: string;
  generatedBy: string;
  notes: string[];
}

export interface ElectionExportBundle {
  envelope: ArtifactEnvelope;
  election: ElectionDetail;
  publicInputs: PublicInputsArtifact;
  bulletinBoard: BulletinBoardArtifact | null;
  aggregatorReport: AggregatorReportArtifact | null;
  zkSummary: ZkSummaryArtifact;
  tallyProofSummary: TallyProofSummaryArtifact;
  chainAudit: ChainAuditArtifact;
  demoMetadata: DemoMetadataArtifact;
  
  challengeRecords: ChallengeRecord[];
}

export type ExportBundleV2 = ElectionExportBundle;

export interface ExportBundleResponse {
  bundle: ElectionExportBundle;
}

// --------------------------------------------------------------------------
// Tally correctness ZK proof (batch-level).
// --------------------------------------------------------------------------

export interface TallyPublicSignalsShared {
  electionIdHash: string;
  batchId: string;
  tally: number[];
  batchSize: number;
  validVoteCount: number;
  candidateCount: number;
  tallyHash: string;
  commitmentRoot: string;
  partitionHash: string;
  circuitId: string;
}

export type TallyProofModeShared = "mock" | "real";
export type TallyVerifierModeShared = "mock" | "local-mock" | "real-hardhat";

export interface TallyProofMetadataShared {
  batchId: string;
  validVoteCount: number;
  tallyHash: string;
  commitmentRoot: string;
  partitionHash: string;
}

export interface TallyProofRequestShared {
  electionId: string;
  voteVectors: number[][];
  realRows?: number[];
  tally: number[];
  batchId?: string;
  proofMode?: TallyProofModeShared;
  verifierMode?: TallyVerifierModeShared;
  metadata?: Partial<TallyProofMetadataShared>;
}

export interface TallyProofResponseShared {
  proofId: string;
  proofMode: TallyProofModeShared;
  verifierMode: TallyVerifierModeShared;
  circuitId: string;
  publicSignals: TallyPublicSignalsShared;
  proof: unknown;
  proofHash: string;
  valid: boolean;
  message: string;
}

export interface TallyVerifyRequestShared {
  proof: unknown;
  publicSignals: TallyPublicSignalsShared;
}

export interface TallyVerifyResponseShared {
  verified: boolean;
  message: string;
}
