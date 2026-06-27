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

export interface AggregatorReport {
  electionId: string;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  duplicateVotes: number;
  receiptChainVerified: boolean;
  receiptChainBreaks: ReceiptChainBreak[];
  voteTokenHashes: string[];
  duplicateTokenHashes: string[];
  tallyResult: ElectionResult;
  commitmentRoot: string;
  receiptRoot: string;
  auditHash: string;
  createdAt: string;
  
  pedersenTallyVerified?: boolean;
  pedersenTallyMessage?: string;
  
  pedersenContextHash?: string;
}

export interface CandidatePartitionBucket {
  candidateId: string;
  candidateName: string;
  voteCount: number;
  voteIds: string[];
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

export interface InvalidVoteDiagnostic {
  voteId: string;
  userIdHash?: string;
  tokenHash: string;
  reason: string;
  detail: string;
  evidenceHash: string;
}

export interface PublicInputHints {
  electionIdHash: string;
  candidateCount: number;
  validVotes: number;
  tallyHash: string;
  commitmentRoot: string;
  receiptRoot: string;
  partitionHash?: string | null;
  pedersenAggregateHash?: string | null;
}

export type PedersenAggregateStatus = "pending" | "ok" | "failed";

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
  status?: PedersenAggregateStatus;
}

export interface AggregatorReportV2 extends AggregatorReport {
  partitionAudit?: PartitionAudit | null;
  invalidVoteDiagnostics?: InvalidVoteDiagnostic[];
  diagnosticsHash?: string;
  pedersenAggregateAudit?: PedersenAggregateAudit | null;
  pedersenAggregateHash?: string | null;
  publicInputHints?: PublicInputHints;
}

export type BlockchainAuditMode = "local-mock" | "hardhat";

export type TallyVerifierMode = "mock" | "local-mock" | "real-hardhat";

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
  verifierMode?: TallyVerifierMode;
  createdAt: string;
  submitter?: string;
  mockSubmitter?: string;
  
  zkVerified?: boolean;
  gasUsed?: number;
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
}

export interface GetAggregatorReportResponse {
  election: Election;
  report: AggregatorReport;
  tallyConsistent: boolean;
  consistencyMessage: string;
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

export interface PedersenAggregateResponse extends PedersenAggregateAudit {
  context: PedersenContextSnapshot;
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
  auditHash: string;
  partitionHash?: string;
  diagnosticsHash?: string;
  pedersenAggregateHash?: string | null;
  zkCircuitId?: string;
}

export interface BulletinBoardArtifact extends BulletinBoard {}

export interface AggregatorReportArtifact extends AggregatorReportV2 {
  tallyConsistent: boolean;
  consistencyMessage: string;
}

export interface ZkSummaryArtifact {
  proofMode: ZkProofMode | null;
  verifierMode?: TallyVerifierMode;
  circuitId: string | null;
  proofGenerated: boolean;
  proofHash?: string | null;
  publicSignals: ZkValidityPublicSignals | TallyPublicSignalsShared | null;
  message: string;
}

export interface ChainAuditArtifact {
  auditMode: BlockchainAuditMode;
  verifierMode?: TallyVerifierMode;
  contractAddress: string;
  transactionHash?: string | null;
  zkVerified?: boolean;
  gasUsed?: number;
  status?: string;
  hasAudit: boolean;
  audit: BlockchainAuditRecord | null;
}

export interface TallyProofSummaryArtifact {
  proofId: string;
  proofMode?: ZkProofMode | "mock" | "real";
  verifierMode?: TallyVerifierMode;
  circuitId?: string;
  publicSignals: TallyPublicSignalsShared;
  proofHash?: string;
  valid: boolean;
  message: string;
}

export interface DemoMetadataArtifact {
  seedName?: string;
  seedVersion?: string;
  fixtureMode?: "fixture" | "api";
  generatedAt?: string;
  electionId?: string;
  candidateCount?: number;
  userCount?: number;
  castVotes?: number;
  challengeBallots?: number;
  normalFlow?: string;
  attackMatrix?: string[];
}

export interface ElectionExportBundle {
  envelope: ArtifactEnvelope;
  election: ElectionDetail;
  publicInputs: PublicInputsArtifact;
  bulletinBoard: BulletinBoardArtifact | null;
  aggregatorReport: AggregatorReportArtifact | null;
  zkSummary: ZkSummaryArtifact;
  tallyProofSummary?: TallyProofSummaryArtifact | null;
  chainAudit: ChainAuditArtifact;
  
  challengeRecords: ChallengeRecord[];
  demoMetadata?: DemoMetadataArtifact;
}

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

export interface TallyProofRequestShared {
  electionId: string;
  voteVectors: number[][];
  realRows?: number[];
  tally: number[];
  batchId?: string;
  proofMode?: "mock" | "real";
  verifierMode?: TallyVerifierMode;
  metadata?: {
    batchId?: string;
    validVoteCount?: number;
    tallyHash?: string;
    commitmentRoot?: string;
    partitionHash?: string;
  };
}

export interface TallyProofResponseShared {
  proofId: string;
  proofMode: "mock" | "real";
  verifierMode: TallyVerifierMode;
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
