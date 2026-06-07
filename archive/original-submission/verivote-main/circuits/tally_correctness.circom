pragma circom 2.0.0;

// TallyCorrectness proves that a batch of N one-hot votes tallies to a
// public per-candidate vector `tally[C]`, without revealing any individual
// ballot.
//
// Public inputs:
//   - tally[C]: the claimed per-candidate vote counts.
//   - batchSize: claimed count of valid one-hot ballots in the batch.
//                Must equal sum(tally). Anchored publicly so the verifier
//                cannot be tricked into accepting a smaller / larger batch.
//
// Private witness:
//   - voteVector[N][C]: the full batch of ballots.
//
// Constraints:
//   (1) Every bit voteVector[i][j] is 0 or 1.
//   (2) Every row sums to 1 (exactly one candidate selected per ballot).
//   (3) For each candidate j: sum over i of voteVector[i][j] == tally[j].
//   (4) sum over j of tally[j] == batchSize == N (batch is fully packed).
//
// To keep the circuit compact the batch size N and candidate count C are
// compile-time constants. For smaller actual batches, pad the private input
// with ghost rows equal to a reserved candidate slot (or re-compile with a
// smaller N).

template TallyCorrectness(N, C) {
    signal input voteVector[N][C];
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
        rowAcc[i][0] <== 0;
        for (var j = 0; j < C; j++) {
            // Boolean: b * (b - 1) == 0
            voteVector[i][j] * (voteVector[i][j] - 1) === 0;
            rowAcc[i][j + 1] <== rowAcc[i][j] + voteVector[i][j];
            colAcc[j][i + 1] <== colAcc[j][i] + voteVector[i][j];
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

    // (4) sum(tally) == batchSize == N.
    tallySum[C] === batchSize;
    batchSize === N;
}

// Default demo parameters: N = 8 ballots, C = 4 candidates.
component main { public [tally, batchSize] } = TallyCorrectness(8, 4);
