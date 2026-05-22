import { Router, type Response } from "express";
import {
  createZkValidityProof,
  createRealZkValidityProof,
  verifyZkValidityProof,
  verifyRealZkValidityProof,
  createTallyCorrectnessProof,
  verifyTallyCorrectnessProof,
  TALLY_BATCH_SIZE,
  TALLY_CANDIDATE_COUNT
} from "@verivote/zk";
import type {
  ZkProofMode,
  ZkValidityProofRequest,
  ZkValidityProofResponse,
  ZkValidityVerifyRequest,
  ZkValidityVerifyResponse,
  TallyProofRequestShared,
  TallyProofResponseShared,
  TallyVerifyRequestShared,
  TallyVerifyResponseShared
} from "@verivote/shared";
import {
  clean,
  isNumberArray,
  isZkPublicSignals,
  getUnknownErrorMessage
} from "../utils.js";

const router = Router();

interface ApiZkValidityProofRequest extends ZkValidityProofRequest {
  proofMode?: ZkProofMode;
}

interface ApiZkValidityVerifyRequest extends ZkValidityVerifyRequest {
  proofMode?: ZkProofMode;
}

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

router.post<
  never,
  ZkValidityProofResponse | { error: string },
  ApiZkValidityProofRequest
>("/prove-vote-validity", (request, response) => {
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

    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: `ZK proof generation failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

router.post<
  never,
  ZkValidityVerifyResponse | { error: string },
  ApiZkValidityVerifyRequest
>("/verify-vote-validity", (request, response) => {
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

    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: `ZK proof verification failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

router.post<
  never,
  TallyProofResponseShared | { error: string },
  TallyProofRequestShared
>("/prove-tally-correctness", (request, response) => {
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

router.post<
  never,
  TallyVerifyResponseShared | { error: string },
  TallyVerifyRequestShared
>("/verify-tally-correctness", (request, response) => {
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

export default router;
