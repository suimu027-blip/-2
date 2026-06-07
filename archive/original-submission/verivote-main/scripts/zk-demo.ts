import {
  createRealZkValidityProof,
  getRealZkArtifactStatus,
  verifyRealZkValidityProof,
  createTallyCorrectnessProof,
  getTallyArtifactStatus,
  verifyTallyCorrectnessProof,
  TALLY_BATCH_SIZE,
  TALLY_CANDIDATE_COUNT
} from "../packages/zk/src/index.ts";

interface VoteCase {
  label: string;
  voteVector: number[];
  expectedVerified: boolean;
}

const voteCases: VoteCase[] = [
  { label: "valid vote A", voteVector: [1, 0, 0, 0], expectedVerified: true },
  { label: "valid vote B", voteVector: [0, 1, 0, 0], expectedVerified: true },
  { label: "invalid multi-select", voteVector: [1, 1, 0, 0], expectedVerified: false },
  { label: "invalid empty vote", voteVector: [0, 0, 0, 0], expectedVerified: false },
  { label: "invalid non-bit value", voteVector: [2, 0, 0, 0], expectedVerified: false }
];

interface TallyCase {
  label: string;
  voteVectors: number[][];
  tally: number[];
  expectedVerified: boolean;
  expectedValid: boolean;
}

function oneHot(n: number, idx: number): number[] {
  return Array.from({ length: n }, (_, i) => (i === idx ? 1 : 0));
}

const validBatch = Array.from({ length: TALLY_BATCH_SIZE }, (_, i) =>
  oneHot(TALLY_CANDIDATE_COUNT, i % TALLY_CANDIDATE_COUNT)
);
const validTally = new Array(TALLY_CANDIDATE_COUNT).fill(0);
for (const row of validBatch) {
  for (let j = 0; j < TALLY_CANDIDATE_COUNT; j++) validTally[j] += row[j];
}

const tamperedTally = validTally.slice();
tamperedTally[0] += 1;
tamperedTally[1] -= 1;

const tallyCases: TallyCase[] = [
  {
    label: "correct tally of a valid batch",
    voteVectors: validBatch,
    tally: validTally,
    expectedVerified: true,
    expectedValid: true
  },
  {
    label: "tampered tally (T0 +1 / T1 -1)",
    voteVectors: validBatch,
    tally: tamperedTally,
    expectedVerified: false,
    expectedValid: false
  }
];

function main(): void {
  console.log("VeriVote real ZK proof demo");

  const validityStatus = getRealZkArtifactStatus();
  console.log(`valid_vote artifacts: ${validityStatus.directory}`);
  if (!validityStatus.ready) {
    console.log("Skipped: valid_vote artifacts are missing.");
    console.log("Run pnpm zk:setup first.");
    console.log(`Missing: ${validityStatus.missing.join(", ")}`);
    return;
  }

  let ok = true;
  for (const voteCase of voteCases) {
    const proofResult = createRealZkValidityProof({
      electionId: "election_1",
      voteVector: voteCase.voteVector,
      candidateCount: 4,
      proofMode: "real"
    });
    const verifyResult = verifyRealZkValidityProof({
      proof: proofResult.proof,
      publicSignals: proofResult.publicSignals
    });
    const matched = verifyResult.verified === voteCase.expectedVerified;
    const status = matched ? "PASS" : "UNEXPECTED";
    const vector = `[${voteCase.voteVector.join(",")}]`;
    ok = ok && matched;
    console.log(
      `${status} valid_vote ${voteCase.label} ${vector} -> verified = ${verifyResult.verified}`
    );
  }

  const tallyStatus = getTallyArtifactStatus();
  console.log(`\ntally_correctness artifacts: ${tallyStatus.directory}`);
  if (!tallyStatus.ready) {
    console.log("Skipped: tally_correctness artifacts are missing.");
    console.log("Run pnpm zk:setup to generate the tally circuit.");
    console.log(`Missing: ${tallyStatus.missing.join(", ")}`);
  } else {
    for (const tallyCase of tallyCases) {
      const proofResult = createTallyCorrectnessProof({
        electionId: "election_tally_demo",
        voteVectors: tallyCase.voteVectors,
        tally: tallyCase.tally
      });
      const verifyResult = verifyTallyCorrectnessProof({
        proof: proofResult.proof,
        publicSignals: proofResult.publicSignals
      });
      const matchedValid = proofResult.valid === tallyCase.expectedValid;
      const matchedVerified = verifyResult.verified === tallyCase.expectedVerified;
      const status = matchedValid && matchedVerified ? "PASS" : "UNEXPECTED";
      ok = ok && matchedValid && matchedVerified;
      console.log(
        `${status} tally_correctness ${tallyCase.label} -> valid=${proofResult.valid} verified=${verifyResult.verified}`
      );
    }
  }

  if (!ok) {
    throw new Error("At least one ZK demo case did not match expectation.");
  }
}

main();
