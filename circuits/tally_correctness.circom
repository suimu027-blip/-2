pragma circom 2.0.0;

// TallyCorrectness proves that a batch of N one-hot votes tallies to a
// public per-candidate vector `tally[C]`, without revealing any individual
// ballot.
//
// Public inputs:
//   - tally[C]: the claimed per-candidate vote counts.
//   - batchSize: claimed count of real valid ballots in the batch.
//                Must equal sum(tally) and sum(realRows).
//
// Short-term metadata binding:
//   The Solidity verifier interface is intentionally kept at uint256[5]
//   ([tally[0..3], batchSize]) for the demo circuit. ElectionId/report
//   metadata such as tallyHash, commitmentRoot and partitionHash is strongly
//   checked in the API before submitAuditWithTallyProof. If these fields are
//   moved into the circuit later, update ITallyVerifier and TallyVerifier
//   calldata length together.
//
// Private witness:
//   - voteVector[N][C]: the padded batch of one-hot rows.
//   - realRows[N]: 1 for a real ballot, 0 for a padding row.
//
// Constraints:
//   (1) Every bit voteVector[i][j] is 0 or 1.
//   (2) Every row sums to 1 (exactly one candidate selected per ballot).
//   (3) realRows[i] is 0/1.
//   (4) For each candidate j: sum over i of voteVector[i][j] * realRows[i] == tally[j].
//   (5) sum over j of tally[j] == batchSize == sum(realRows).
//
// To keep the circuit compact the batch size N and candidate count C are
// compile-time constants. For smaller actual batches, pad the private input
// with ghost rows equal to any one-hot candidate row and set realRows[i] = 0.
// The ghost rows satisfy one-hot constraints but do not contribute to tally.

template TallyCorrectness(N, C) {
    signal input voteVector[N][C];
    signal input realRows[N];
    signal input tally[C];
    signal input batchSize;

    // (1) + (2) per-ballot one-hot constraints.
    //
    // For each row i we accumulate the sum and assert the boolean constraint
    // on each bit. We also accumulate per-candidate totals as we go.
    signal rowAcc[N][C + 1];
    signal colAcc[C][N + 1];

    for (var j = 0; j < C; j++) {
        colAcc[j][0] <== 0;
    }

    for (var i = 0; i < N; i++) {
        realRows[i] * (realRows[i] - 1) === 0;
        rowAcc[i][0] <== 0;
        for (var j = 0; j < C; j++) {
            // Boolean: b * (b - 1) == 0
            voteVector[i][j] * (voteVector[i][j] - 1) === 0;
            rowAcc[i][j + 1] <== rowAcc[i][j] + voteVector[i][j];
            colAcc[j][i + 1] <== colAcc[j][i] + voteVector[i][j] * realRows[i];
        }
        // Exactly one candidate selected per ballot.
        rowAcc[i][C] === 1;
    }

    // (3) Column sums equal public tally[j].
    signal tallySum[C + 1];
    tallySum[0] <== 0;
    for (var j = 0; j < C; j++) {
        colAcc[j][N] === tally[j];
        tallySum[j + 1] <== tallySum[j] + tally[j];
    }

    signal realCount[N + 1];
    realCount[0] <== 0;
    for (var i = 0; i < N; i++) {
        realCount[i + 1] <== realCount[i] + realRows[i];
    }

    // (5) sum(tally) == batchSize == sum(realRows).
    tallySum[C] === batchSize;
    realCount[N] === batchSize;
}

// Default demo parameters: N = 8 ballots, C = 4 candidates.
component main { public [tally, batchSize] } = TallyCorrectness(8, 4);
