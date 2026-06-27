import { Router } from "express";
import {
  createVoteVector,
  randomHex,
  createCommitment,
  createPedersenContext,
  createReceiptCode,
  verifyCommitmentOpening
} from "@verivote/crypto";
import type {
  PrepareBallotResponse,
  PrepareBallotRequest,
  CastPreparedBallotResponse,
  ChallengePreparedBallotResponse,
  GetChallengeRecordsResponse,
  PendingBallot,
  ChallengeRecord
} from "@verivote/shared";
import {
  users,
  candidates,
  pendingBallots,
  challengeRecords,
  votes,
  createId,
  findElection,
  getCandidatesForElection
} from "../state.js";
import {
  clean,
  now,
  appendVoteWithReceiptChain
} from "../utils.js";

const router = Router();

router.post<
  { id: string },
  PrepareBallotResponse | { error: string },
  PrepareBallotRequest
>("/elections/:id/prepare", (request, response) => {
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

router.post<
  { pendingBallotId: string },
  CastPreparedBallotResponse | { error: string }
>("/ballots/:pendingBallotId/cast", (request, response) => {
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
    voteId: vote.id,
    receiptCode: vote.receiptCode,
    commitment: vote.commitment,
    receiptChainIndex: vote.receiptChainIndex ?? -1,
    previousReceiptCodeHash: vote.previousReceiptCodeHash ?? null,
    receiptChainHash: vote.receiptChainHash ?? "",
    message: "该 prepared ballot 已正式计入投票。"
  });
});

router.post<
  { pendingBallotId: string },
  ChallengePreparedBallotResponse | { error: string }
>("/ballots/:pendingBallotId/challenge", (request, response) => {
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
    createdAt: now(),
    pedersenContextHash: pendingBallot.pedersenContextHash
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

router.get<{ id: string }, GetChallengeRecordsResponse | { error: string }>(
  "/elections/:id/records",
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

export default router;
