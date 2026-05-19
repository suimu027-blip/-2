pragma circom 2.0.0;

template ValidVote4() {
    signal input voteVector[4];
    signal output voteSum;
    signal output valid;
    signal acc[5];

    acc[0] <== 0;

    for (var i = 0; i < 4; i++) {
        voteVector[i] * (voteVector[i] - 1) === 0;
        acc[i + 1] <== acc[i] + voteVector[i];
    }

    acc[4] === 1;
    voteSum <== acc[4];
    valid <== 1;
}

component main { public [voteVector] } = ValidVote4();
