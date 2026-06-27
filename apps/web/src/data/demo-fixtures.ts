import tallyProofV2ValidSample from "../../../../docs/contracts/tally_proof_v2.valid.sample.json";
import aggregatorReportV2Sample from "../../../../docs/contracts/aggregator_report_v2.sample.json";
import exportBundleV2Sample from "../../../../docs/contracts/export_bundle_v2.sample.json";
import chainAuditV2Sample from "../../../../docs/contracts/chain_audit.real.sample.json";
import pedersenAggregateAuditSample from "../../../../docs/contracts/pedersen_aggregate_audit.sample.json";

export const demoTallyProofV2Sample = tallyProofV2ValidSample;
export const demoAggregatorReportV2Sample = aggregatorReportV2Sample;
export const demoExportBundleV2Sample = {
  ...exportBundleV2Sample,
  zkSummary: {
    ...exportBundleV2Sample.zkSummary,
    publicSignals: exportBundleV2Sample.zkSummary.publicSignals
      ? {
          candidateCount: 4,
          ...exportBundleV2Sample.zkSummary.publicSignals
        }
      : null
  },
  tallyProofSummary: exportBundleV2Sample.tallyProofSummary
    ? {
        ...exportBundleV2Sample.tallyProofSummary,
        publicSignals: {
          candidateCount: 4,
          ...exportBundleV2Sample.tallyProofSummary.publicSignals
        }
      }
    : null
};

type ChainAuditSampleShape = {
  auditMode?: string;
  verifierMode?: string;
  contractAddress?: string;
  transactionHash?: string;
  zkVerified?: boolean;
  gasUsed?: number | string;
  status?: string;
  electionId?: string;
  electionIdHash?: string;
  merkleRoot?: string;
  commitmentRoot?: string;
  receiptRoot?: string;
  auditHash?: string;
  tallyHash?: string;
  createdAt?: string;
  submitter?: string;
  submittedFields?: {
    electionId?: string;
    electionIdHash?: string;
    merkleRoot?: string;
    commitmentRoot?: string;
    receiptRoot?: string;
    auditHash?: string;
    tallyHash?: string;
  };
  transaction?: {
    hash?: string;
    gasUsed?: number | string;
  };
  contracts?: {
    veriVoteAudit?: string;
  };
  auditRecord?: {
    zkVerified?: boolean;
  };
};

const chainAuditSample = chainAuditV2Sample as ChainAuditSampleShape;
const chainAuditSubmittedFields = chainAuditSample.submittedFields ?? chainAuditSample;

export const demoChainAuditV2Sample = {
  electionId: chainAuditSubmittedFields.electionId ?? "demo-election-v2",
  electionIdHash: chainAuditSubmittedFields.electionIdHash ?? "pending",
  merkleRoot: chainAuditSubmittedFields.merkleRoot ?? "pending",
  commitmentRoot: chainAuditSubmittedFields.commitmentRoot ?? "pending",
  receiptRoot: chainAuditSubmittedFields.receiptRoot ?? "pending",
  auditHash: chainAuditSubmittedFields.auditHash ?? "pending",
  tallyHash: chainAuditSubmittedFields.tallyHash ?? "pending",
  transactionHash: chainAuditSample.transaction?.hash ?? chainAuditSample.transactionHash ?? "pending",
  contractAddress:
    chainAuditSample.contracts?.veriVoteAudit ??
    chainAuditSample.contractAddress ??
    "pending",
  auditMode: "hardhat",
  verifierMode: chainAuditSample.verifierMode ?? "real-hardhat",
  createdAt: chainAuditSample.createdAt ?? "2026-06-27T00:00:00.000Z",
  submitter: chainAuditSample.submitter ?? "hardhat-demo",
  zkVerified: chainAuditSample.auditRecord?.zkVerified ?? chainAuditSample.zkVerified ?? true,
  gasUsed: Number(chainAuditSample.transaction?.gasUsed ?? chainAuditSample.gasUsed ?? 0),
  status: chainAuditSample.status ?? "submitted"
};
export const demoPedersenAggregateAuditSample = pedersenAggregateAuditSample;

export const demoAttackMatrix: Array<{
  action: string;
  label: string;
  artifact: string;
  expected: string;
  nextView: string;
}> = [
  {
    action: "tamper-commitment",
    label: "Tamper commitment",
    artifact: "bulletin board / commitmentRoot",
    expected: "Merkle or binding check rejects the changed commitment root.",
    nextView: "Audit Report"
  },
  {
    action: "delete-vote",
    label: "Delete vote",
    artifact: "receipt chain / tally",
    expected: "Receipt chain continuity or tally consistency fails.",
    nextView: "Bulletin Board"
  },
  {
    action: "inject-duplicate-vote",
    label: "Inject duplicate",
    artifact: "voteTokenHashes",
    expected: "Aggregator duplicate detection flags repeated token hashes.",
    nextView: "Aggregator"
  },
  {
    action: "tamper-tally",
    label: "Tamper tally",
    artifact: "TallyProof v2",
    expected: "verifyTallyProofAgainstReport rejects the mismatched tally.",
    nextView: "Tally ZK"
  }
];
