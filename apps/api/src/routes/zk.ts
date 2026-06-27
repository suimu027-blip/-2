import { Router } from "express";
import { createVoteTokenHash } from "@verivote/crypto";
import {
  createZkValidityProof,
  createRealZkValidityProof,
  verifyZkValidityProof,
  verifyRealZkValidityProof,
  createTallyCorrectnessProof,
  createTallyProofMetadataFromReport,
  verifyTallyCorrectnessProof,
  TALLY_BATCH_SIZE,
  TALLY_CANDIDATE_COUNT,
  type TallyProofMetadata,
  type TallyProofMode,
  type TallyVerifierMode
} from "@verivote/zk";
import type {
  Candidate,
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
  getUnknownErrorMessage,
  getBlockchainAuditMode
} from "../utils.js";
import {
  findElection,
  findAggregatorReport,
  getCandidatesForElection,
  votes
} from "../state.js";

const router = Router();

interface ApiZkValidityProofRequest extends ZkValidityProofRequest {
  proofMode?: ZkProofMode;
}

interface ApiZkValidityVerifyRequest extends ZkValidityVerifyRequest {
  proofMode?: ZkProofMode;
}

interface ElectionTallyProofRequest {
  proofMode?: TallyProofMode;
  verifierMode?: TallyVerifierMode;
  batchId?: string;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readProofMode(value: unknown): TallyProofMode | undefined {
  return value === "mock" || value === "real" ? value : undefined;
}

function readVerifierMode(value: unknown): TallyVerifierMode | undefined {
  return value === "mock" || value === "local-mock" || value === "real-hardhat"
    ? value
    : undefined;
}

function defaultVerifierMode(proofMode: TallyProofMode): TallyVerifierMode {
  if (proofMode === "mock") {
    return "mock";
  }
  return getBlockchainAuditMode() === "hardhat" ? "real-hardhat" : "local-mock";
}

function readMetadata(value: unknown): Partial<TallyProofMetadata> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const metadata: Partial<TallyProofMetadata> = {};
  if (typeof value.batchId === "string") metadata.batchId = value.batchId;
  if (typeof value.validVoteCount === "number") {
    metadata.validVoteCount = value.validVoteCount;
  }
  if (typeof value.tallyHash === "string") metadata.tallyHash = value.tallyHash;
  if (typeof value.commitmentRoot === "string") {
    metadata.commitmentRoot = value.commitmentRoot;
  }
  if (typeof value.partitionHash === "string") {
    metadata.partitionHash = value.partitionHash;
  }
  return metadata;
}

function getEffectiveVoteVectors(electionId: string): {
  voteVectors: number[][];
  invalidReason?: string;
} {
  const electionCandidates = getCandidatesForElection(electionId);
  const candidateIds = electionCandidates.map((candidate) => candidate.id);
  const validCandidateIds = new Set(candidateIds);
  const seenTokenHashes = new Set<string>();
  const effectiveVectors: number[][] = [];

  for (const vote of votes.filter((currentVote) => currentVote.electionId === electionId)) {
    const tokenHash = createVoteTokenHash(electionId, vote.userId);
    const isDuplicate = seenTokenHashes.has(tokenHash);
    if (!isDuplicate) {
      seenTokenHashes.add(tokenHash);
    }

    if (isDuplicate || !validCandidateIds.has(vote.candidateId)) {
      continue;
    }

    if (
      !Array.isArray(vote.voteVector) ||
      vote.voteVector.length !== TALLY_CANDIDATE_COUNT ||
      !vote.voteVector.every((entry) => Number.isInteger(entry) && (entry === 0 || entry === 1))
    ) {
      return {
        voteVectors: [],
        invalidReason: `vote ${vote.id} does not have a ${TALLY_CANDIDATE_COUNT}-entry binary voteVector`
      };
    }

    const selectedCount = vote.voteVector.reduce((total, entry) => total + entry, 0);
    if (selectedCount !== 1) {
      return {
        voteVectors: [],
        invalidReason: `vote ${vote.id} voteVector is not one-hot`
      };
    }

    const selectedIndex = vote.voteVector.findIndex((entry) => entry === 1);
    if (candidateIds[selectedIndex] !== vote.candidateId) {
      return {
        voteVectors: [],
        invalidReason: `vote ${vote.id} voteVector does not match candidateId ${vote.candidateId}`
      };
    }

    effectiveVectors.push(vote.voteVector.slice());
  }

  return { voteVectors: effectiveVectors };
}

function getTallyFromReport(
  report: unknown,
  electionCandidates: Candidate[]
): { tally: number[]; invalidReason?: string } {
  if (!isPlainObject(report) || !isPlainObject(report.tallyResult)) {
    return {
      tally: [],
      invalidReason: "aggregator report is missing tallyResult"
    };
  }

  const results = report.tallyResult.results;
  if (!Array.isArray(results) || results.length !== TALLY_CANDIDATE_COUNT) {
    return {
      tally: [],
      invalidReason: `aggregator report tallyResult.results must contain exactly ${TALLY_CANDIDATE_COUNT} candidates`
    };
  }

  const tally: number[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const voteCount = isPlainObject(item) ? item.voteCount : undefined;
    if (!Number.isInteger(voteCount) || (voteCount as number) < 0) {
      return {
        tally: [],
        invalidReason: `aggregator report tallyResult.results[${index}].voteCount must be a non-negative integer`
      };
    }

    if (item.candidateId !== electionCandidates[index]?.id) {
      return {
        tally: [],
        invalidReason: `aggregator report tallyResult.results[${index}].candidateId does not match current candidate order`
      };
    }

    tally.push(voteCount as number);
  }

  return { tally };
}

function padVoteVectorsForTallyCircuit(voteVectors: number[][]): {
  paddedVoteVectors: number[][];
  realRows: number[];
} {
  const paddedVoteVectors = voteVectors.slice(0, TALLY_BATCH_SIZE).map((row) => row.slice());
  const realRows = paddedVoteVectors.map(() => 1);
  const ghostRow = Array.from({ length: TALLY_CANDIDATE_COUNT }, (_, index) =>
    index === 0 ? 1 : 0
  );

  while (paddedVoteVectors.length < TALLY_BATCH_SIZE) {
    paddedVoteVectors.push(ghostRow.slice());
    realRows.push(0);
  }

  return { paddedVoteVectors, realRows };
}

router.post<
  never,
  ZkValidityProofResponse | { error: string },
  ApiZkValidityProofRequest
>("/prove-vote-validity", (request, response) => {
  const electionId = clean(request.body.electionId);
  const proofMode = request.body.proofMode ?? "mock";

  if (!electionId) {
    response.status(400).json({ error: "electionId cannot be empty" });
    return;
  }

  if (proofMode !== "mock" && proofMode !== "real") {
    response.status(400).json({ error: "proofMode must be mock or real" });
    return;
  }

  if (!isNumberArray(request.body.voteVector)) {
    response.status(400).json({ error: "voteVector must be number[]" });
    return;
  }

  if (
    typeof request.body.candidateCount !== "number" ||
    !Number.isInteger(request.body.candidateCount) ||
    request.body.candidateCount <= 0
  ) {
    response.status(400).json({ error: "candidateCount must be a positive integer" });
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
    response.status(400).json({ error: "publicSignals is invalid" });
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
    response.status(400).json({ error: "electionId cannot be empty" });
    return;
  }
  if (!isIntegerMatrix(request.body.voteVectors)) {
    response.status(400).json({ error: "voteVectors must be an integer matrix" });
    return;
  }
  if (!isIntegerArray(request.body.tally)) {
    response.status(400).json({ error: "tally must be an integer array" });
    return;
  }
  if (request.body.voteVectors.length !== TALLY_BATCH_SIZE) {
    response
      .status(400)
      .json({ error: `voteVectors must contain exactly ${TALLY_BATCH_SIZE} ballots` });
    return;
  }
  if (request.body.tally.length !== TALLY_CANDIDATE_COUNT) {
    response
      .status(400)
      .json({ error: `tally length must be ${TALLY_CANDIDATE_COUNT}` });
    return;
  }

  const proofMode = readProofMode(request.body.proofMode) ?? "real";
  const verifierMode =
    readVerifierMode(request.body.verifierMode) ?? defaultVerifierMode(proofMode);

  try {
    const result = createTallyCorrectnessProof({
      electionId,
      voteVectors: request.body.voteVectors,
      realRows: request.body.realRows,
      tally: request.body.tally,
      batchId: request.body.batchId,
      proofMode,
      verifierMode,
      metadata: readMetadata(request.body.metadata)
    });
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: `Tally proof generation failed: ${getUnknownErrorMessage(error)}`
    });
  }
});

router.post<
  { id: string },
  TallyProofResponseShared | { error: string },
  ElectionTallyProofRequest
>("/elections/:id/prove-tally-correctness", (request, response) => {
  const election = findElection(request.params.id);
  if (!election) {
    response.status(404).json({ error: "election not found" });
    return;
  }

  const report = findAggregatorReport(election.id);
  if (!report) {
    response.status(409).json({ error: "run the aggregator before creating a tally proof" });
    return;
  }

  const electionCandidates = getCandidatesForElection(election.id);
  if (electionCandidates.length !== TALLY_CANDIDATE_COUNT) {
    response.status(409).json({
      error: `tally_correctness demo circuit requires exactly ${TALLY_CANDIDATE_COUNT} candidates`
    });
    return;
  }

  const { voteVectors, invalidReason } = getEffectiveVoteVectors(election.id);
  if (invalidReason) {
    response.status(409).json({ error: invalidReason });
    return;
  }

  if (voteVectors.length > TALLY_BATCH_SIZE) {
    response.status(409).json({
      error: `tally_correctness demo circuit supports at most ${TALLY_BATCH_SIZE} effective votes per proof; current report has ${voteVectors.length}. Split into batches before proving.`
    });
    return;
  }

  const { tally, invalidReason: tallyInvalidReason } = getTallyFromReport(
    report,
    electionCandidates
  );
  if (tallyInvalidReason) {
    response.status(409).json({ error: tallyInvalidReason });
    return;
  }

  const { paddedVoteVectors, realRows } = padVoteVectorsForTallyCircuit(voteVectors);
  const proofMode = readProofMode(request.body?.proofMode) ?? "real";
  const verifierMode =
    readVerifierMode(request.body?.verifierMode) ?? defaultVerifierMode(proofMode);

  try {
    const result = createTallyCorrectnessProof({
      electionId: election.id,
      voteVectors: paddedVoteVectors,
      realRows,
      tally,
      batchId: request.body?.batchId,
      proofMode,
      verifierMode,
      metadata: createTallyProofMetadataFromReport(report, {
        batchId: request.body?.batchId
      })
    });
    response.json(result);
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
    response.status(400).json({ error: "publicSignals is required" });
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
