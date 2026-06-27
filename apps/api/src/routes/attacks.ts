import { Router } from "express";
import {
  hashText,
  createCommitment,
  createReceiptCode,
  createVoteTokenHash,
  randomHex
} from "@verivote/crypto";
import type { AttackType, AttackResponse, AggregatorReport, AttackLog } from "@verivote/shared";
import {
  votes,
  attackLogs,
  createId,
  saveAggregatorReport,
  findElection,
  getCandidatesForElection,
  findAggregatorReport
} from "../state.js";
import {
  getAttackTarget,
  isAttackTargetError,
  createAttackLog,
  now,
  appendVoteWithReceiptChain,
  cloneJson,
  createAuditHashForAggregatorReport
} from "../utils.js";

const router = Router();

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/tamper-commitment",
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

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/delete-vote",
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

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/inject-duplicate-vote",
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

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/inject-invalid-vote",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const attackType: AttackType = "inject-invalid-vote";
    const candidateCount = getCandidatesForElection(target.election.id).length;
    const voteVector = Array.from({ length: Math.max(candidateCount, 1) }, (_, index) =>
      index === 0 ? 1 : 0
    );
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

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/inject-non-one-hot-vote",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const electionCandidates = getCandidatesForElection(target.election.id);
    if (electionCandidates.length < 2) {
      response.status(409).json({
        error: "当前选举至少需要 2 个候选人，才能演示多选 non-one-hot 攻击。"
      });
      return;
    }

    const attackType: AttackType = "inject-non-one-hot-vote";
    const voteVector = electionCandidates.map((_candidate, index) =>
      index < 2 ? 1 : 0
    );
    const candidateId = electionCandidates[0].id;
    const userId = "attacker_non_one_hot";
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
      candidateId,
      voteVector,
      randomness,
      commitment,
      receiptCode,
      createdAt
    });

    const before = {
      candidateIds: electionCandidates.map((candidate) => candidate.id)
    };
    const after = {
      voteId: invalidVote.id,
      userId: invalidVote.userId,
      candidateId: invalidVote.candidateId,
      voteVector: invalidVote.voteVector,
      commitment: invalidVote.commitment,
      receiptCode: invalidVote.receiptCode
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "演示攻击：注入一张 candidateId 合法但 voteVector 多选的非 one-hot 选票。",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "演示攻击已执行：已注入非 one-hot 投票。重新运行聚合器后 diagnostics 应出现 invalid-one-hot。",
      log
    });
  }
);

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/inject-candidate-vector-mismatch",
  (request, response) => {
    const target = getAttackTarget(request.params.id);

    if (isAttackTargetError(target)) {
      response.status(target.status).json({ error: target.error });
      return;
    }

    const electionCandidates = getCandidatesForElection(target.election.id);
    if (electionCandidates.length < 2) {
      response.status(409).json({
        error: "Current election needs at least 2 candidates to demonstrate candidate-vector mismatch."
      });
      return;
    }

    const attackType: AttackType = "inject-candidate-vector-mismatch";
    const voteVector = electionCandidates.map((_candidate, index) =>
      index === 0 ? 1 : 0
    );
    const candidateId = electionCandidates[1].id;
    const userId = "attacker_candidate_vector_mismatch";
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
      candidateId,
      voteVector,
      randomness,
      commitment,
      receiptCode,
      createdAt
    });

    const before = {
      vectorSelectedCandidateId: electionCandidates[0].id,
      submittedCandidateId: candidateId
    };
    const after = {
      voteId: invalidVote.id,
      userId: invalidVote.userId,
      candidateId: invalidVote.candidateId,
      voteVector: invalidVote.voteVector,
      commitment: invalidVote.commitment,
      receiptCode: invalidVote.receiptCode
    };
    const log = createAttackLog(
      target.election.id,
      attackType,
      "Demo attack: inject a vote whose candidateId is valid but does not match the selected one-hot vector entry.",
      before,
      after
    );

    response.json({
      ok: true,
      attackType,
      message:
        "Candidate-vector mismatch attack executed. Re-running the aggregator should produce a candidate-vector-mismatch diagnostic.",
      log
    });
  }
);

router.post<{ id: string }, AttackResponse | { error: string }>(
  "/elections/:id/tamper-tally",
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

router.get<{ id: string }, { election: any; logs: AttackLog[] } | { error: string }>(
  "/elections/:id/logs",
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

export default router;
