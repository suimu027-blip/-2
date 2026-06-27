import { Router } from "express";
import {
  encodeTallySolidityCalldata,
  verifyTallyCorrectnessProof,
  verifyTallyProofAgainstReport,
  type TallyVerifierMode
} from "@verivote/zk";
import type {
  SubmitBlockchainAuditResponse,
  SubmitBlockchainAuditWithTallyProofRequest,
  SubmitBlockchainAuditWithTallyProofResponse,
  GetBlockchainAuditResponse,
  BlockchainAuditRecord,
  BlockchainAuditMode
} from "@verivote/shared";
import {
  blockchainAuditRecords,
  findElection,
  findBulletinBoard,
  findAggregatorReport
} from "../state.js";
import {
  createBlockchainAuditFields,
  getBlockchainAuditMode,
  now,
  createMockTransactionHash,
  MOCK_CONTRACT_ADDRESS,
  MOCK_SUBMITTER,
  getHardhatAuditContract,
  createAuditRecordFromChain,
  toBytes32Hex,
  getUnknownErrorMessage
} from "../utils.js";

const router = Router();

interface TallyProofBindingErrorResponse {
  error: string;
  checks?: Record<string, boolean>;
  expected?: unknown;
}

function expectedVerifierModes(auditMode: BlockchainAuditMode): TallyVerifierMode[] {
  return auditMode === "hardhat" ? ["real-hardhat"] : ["local-mock"];
}

router.post<{ id: string }, SubmitBlockchainAuditResponse | { error: string }>(
  "/elections/:id/submit-audit",
  async (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "election not found" });
      return;
    }

    const bulletin = findBulletinBoard(election.id);

    if (!bulletin) {
      response.status(409).json({ error: "create the bulletin board first" });
      return;
    }

    const report = findAggregatorReport(election.id);

    if (!report) {
      response.status(409).json({ error: "run the aggregator first" });
      return;
    }

    const fields = createBlockchainAuditFields(election.id, bulletin, report);
    const auditMode = getBlockchainAuditMode();

    try {
      if (auditMode === "local-mock") {
        if (blockchainAuditRecords.has(election.id)) {
          response.status(409).json({
            error: "audit already submitted for this electionId"
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
          message: "Local mock chain audit recorded."
        });
        return;
      }

      const { contract, contractAddress } = await getHardhatAuditContract();
      const alreadySubmitted = (await contract.hasAudit(
        fields.electionIdHash
      )) as boolean;

      if (alreadySubmitted) {
        response.status(409).json({
          error: "audit already submitted for this electionId"
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
        message: "Hardhat audit submitted."
      });
    } catch (error) {
      response.status(500).json({
        error: `chain audit submission failed: ${getUnknownErrorMessage(error)}`
      });
    }
  }
);

router.post<
  { id: string },
  SubmitBlockchainAuditWithTallyProofResponse | TallyProofBindingErrorResponse,
  SubmitBlockchainAuditWithTallyProofRequest
>("/elections/:id/submit-audit-with-tally-proof", async (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "election not found" });
    return;
  }
  const bulletin = findBulletinBoard(election.id);
  if (!bulletin) {
    response.status(409).json({ error: "create the bulletin board first" });
    return;
  }
  const report = findAggregatorReport(election.id);
  if (!report) {
    response.status(409).json({ error: "run the aggregator first" });
    return;
  }

  const auditMode = getBlockchainAuditMode();
  const tallyProofResponse = request.body?.tallyProofResponse;
  if (!tallyProofResponse || !tallyProofResponse.proof) {
    response.status(400).json({ error: "tallyProofResponse.proof is required" });
    return;
  }

  const binding = verifyTallyProofAgainstReport({
    proofResponse: tallyProofResponse,
    report,
    expectedElectionId: election.id,
    expectedVerifierModes: expectedVerifierModes(auditMode),
    requireRealProof: true
  });
  if (!binding.verified) {
    response.status(400).json({
      error: binding.message,
      checks: binding.checks,
      expected: binding.expected
    });
    return;
  }

  const localProofVerification = verifyTallyCorrectnessProof({
    proof: tallyProofResponse.proof,
    publicSignals: tallyProofResponse.publicSignals
  });
  if (!localProofVerification.verified) {
    response.status(400).json({
      error: localProofVerification.message
    });
    return;
  }

  const fields = createBlockchainAuditFields(election.id, bulletin, report);

  try {
    if (auditMode === "local-mock") {
      if (blockchainAuditRecords.has(election.id)) {
        response.status(409).json({
          error: "audit already submitted for this electionId"
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
          "Local mock chain audit recorded after TallyProof v2 binding checks."
      });
      return;
    }

    let calldata;
    try {
      calldata = encodeTallySolidityCalldata(tallyProofResponse.proof);
    } catch (error) {
      response.status(400).json({
        error: `cannot encode tally proof calldata: ${getUnknownErrorMessage(error)}`
      });
      return;
    }
    if (calldata.input.length !== 5) {
      response.status(400).json({
        error: `expected 5 public signals (4 tally values + batchSize), got ${calldata.input.length}`
      });
      return;
    }

    const { contract, contractAddress } = await getHardhatAuditContract();
    const alreadySubmitted = (await contract.hasAudit(
      fields.electionIdHash
    )) as boolean;
    if (alreadySubmitted) {
      response.status(409).json({
        error: "audit already submitted for this electionId"
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
      message:
        "Hardhat audit submitted and verified by the configured Groth16 tally verifier."
    });
  } catch (error) {
    response.status(500).json({
      error: `chain audit with tally proof failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

router.get<{ id: string }, GetBlockchainAuditResponse | { error: string }>(
  "/elections/:id/audit",
  async (request, response) => {
    const election = findElection(request.params.id);

    if (!election) {
      response.status(404).json({ error: "election not found" });
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
        error: `chain audit query failed: ${getUnknownErrorMessage(error)}`
      });
    }
  }
);

export default router;
