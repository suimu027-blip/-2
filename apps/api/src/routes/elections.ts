import { Router } from "express";
import {
  createVoteVector,
  randomHex,
  createCommitment,
  createPedersenContext,
  createReceiptCode,
  hashReceiptCode,
  createMerkleLeaf,
  getMerkleProof,
  verifyMerkleProof
} from "@verivote/crypto";
import type {
  RegisterUserRequest,
  RegisterUserResponse,
  CreateElectionRequest,
  CreateElectionResponse,
  ListElectionsResponse,
  GetElectionResponse,
  FinalizeElectionResponse,
  GetBulletinBoardResponse,
  RunAggregatorResponse,
  GetAggregatorReportResponse,
  CreateCandidateRequest,
  CreateCandidateResponse,
  CastVoteRequest,
  CastVoteResponse,
  GetReceiptResponse,
  GetReceiptProofResponse,
  GetElectionResultResponse,
  ExportBundleResponse,
  User,
  Election,
  Candidate
} from "@verivote/shared";
import {
  users,
  elections,
  candidates,
  votes,
  bulletinBoards,
  aggregatorReports,
  createId,
  findElection,
  getCandidatesForElection,
  findBulletinBoard,
  findAggregatorReport,
  saveAggregatorReport
} from "../state.js";
import {
  clean,
  now,
  createBulletinBoard,
  createAggregatorReport,
  getTallyConsistency,
  createElectionResult,
  appendVoteWithReceiptChain,
  buildArtifactContext,
  buildExportBundle,
  sendArtifactAsFile
} from "../utils.js";

const router = Router();

router.post<never, RegisterUserResponse | { error: string }, RegisterUserRequest>(
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

router.post<never, CreateElectionResponse | { error: string }, CreateElectionRequest>(
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

router.get<never, ListElectionsResponse>("/elections", (_request, response) => {
  response.json({ elections });
});

router.get<{ id: string }, GetElectionResponse | { error: string }>(
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

router.post<{ id: string }, FinalizeElectionResponse | { error: string }>(
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

router.get<{ id: string }, GetBulletinBoardResponse | { error: string }>(
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

router.post<{ id: string }, RunAggregatorResponse | { error: string }>(
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

router.get<{ id: string }, GetAggregatorReportResponse | { error: string }>(
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

router.post<
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

router.post<{ id: string }, CastVoteResponse | { error: string }, CastVoteRequest>(
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

router.get<{ receiptCode: string }, GetReceiptResponse | { error: string }>(
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

router.get<{ receiptCode: string }, GetReceiptProofResponse | { error: string }>(
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

router.get<{ id: string }, GetElectionResultResponse | { error: string }>(
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

router.get<{ id: string }, ExportBundleResponse | { error: string }>(
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

router.get<{ id: string }>("/elections/:id/export/bulletin_board.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  sendArtifactAsFile(response, `bulletin_board_${election.id}.json`, context.bulletin);
});

router.get<{ id: string }>("/elections/:id/export/aggregator_report.json", (request, response) => {
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

router.get<{ id: string }>("/elections/:id/export/zk_summary.json", (request, response) => {
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

router.get<{ id: string }>("/elections/:id/export/chain_audit.json", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "选举不存在。" });
    return;
  }
  const context = buildArtifactContext(election);
  sendArtifactAsFile(response, `chain_audit_${election.id}.json`, {
    auditMode: context.auditMode,
    contractAddress: context.auditRecord ? context.auditRecord.contractAddress : "",
    hasAudit: context.auditRecord !== null,
    audit: context.auditRecord
  });
});

router.get<{ id: string }>("/elections/:id/export/public_inputs.json", (request, response) => {
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

export default router;
