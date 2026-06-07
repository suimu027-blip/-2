// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interface that matches the Groth16 verifier emitted by
///         `snarkjs zkey export solidityverifier` for the
///         `tally_correctness.circom` circuit (N=8, C=4).
///
///         Public signals layout: [tally[0], tally[1], tally[2], tally[3], batchSize]
///
/// The snarkjs-generated contract exposes `verifyProof` with the exact same
/// signature; we only rename the expected function symbol by using this
/// interface. If the circuit public-signal count changes, update the
/// `uint[5]` argument to match.
interface ITallyVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata input
    ) external view returns (bool);
}
