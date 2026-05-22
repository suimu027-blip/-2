import { Router } from "express";
import { encodeTallySolidityCalldata } from "@verivote/zk";
import type {
  SubmitBlockchainAuditResponse,
  SubmitBlockchainAuditWithTallyProofRequest,
  SubmitBlockchainAuditWithTallyProofResponse,
  GetBlockchainAuditResponse,
  BlockchainAuditRecord
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
  getDisplayedContractAddress,
  getUnknownErrorMessage
} from "../utils.js";

const router = Router();

router.post<{ id: string }, SubmitBlockchainAuditResponse | { error: string }>(
  "/elections/:id/submit-audit",
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

router.post<
  { id: string },
  SubmitBlockchainAuditWithTallyProofResponse | { error: string },
  SubmitBlockchainAuditWithTallyProofRequest
>("/elections/:id/submit-audit-with-tally-proof", async (request, response) => {
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
          "Local Mock Chain Audit 已记录带 ZK 验证标记 of 审计摘要（本地模式不调用链上 verifier）。"
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

router.get<{ id: string }, GetBlockchainAuditResponse | { error: string }>(
  "/elections/:id/audit",
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

export default router;
