import { Router } from "express";
import {
  createPedersenContext,
  createPedersenCommitment,
  verifyPedersenOpening,
  verifyAggregateOpening,
  exportPedersenContext
} from "@verivote/crypto";
import type {
  PedersenCommitRequest,
  PedersenCommitResponse,
  PedersenVerifyOpeningRequest,
  PedersenVerifyOpeningResponse,
  PedersenAggregateRequest,
  PedersenAggregateResponse
} from "@verivote/shared";
import { clean, getUnknownErrorMessage } from "../utils.js";

const router = Router();

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

router.post<never, PedersenCommitResponse | { error: string }, PedersenCommitRequest>(
  "/commit",
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

router.post<
  never,
  PedersenVerifyOpeningResponse | { error: string },
  PedersenVerifyOpeningRequest
>("/verify-opening", (request, response) => {
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

router.post<
  never,
  PedersenAggregateResponse | { error: string },
  PedersenAggregateRequest
>("/aggregate-verify", (request, response) => {
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

export default router;
