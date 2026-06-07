// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITallyVerifier} from "./ITallyVerifier.sol";

/// @notice Test-only verifier that returns a configurable boolean. Used by
///         the Hardhat test suite and by local-mock demos when the real
///         snarkjs-generated `TallyVerifier.sol` has not been built yet.
///
///         NEVER use this in production.
contract MockTallyVerifier is ITallyVerifier {
    bool public shouldVerify;

    constructor(bool _initial) {
        shouldVerify = _initial;
    }

    function setShouldVerify(bool value) external {
        shouldVerify = value;
    }

    function verifyProof(
        uint256[2] calldata /*a*/,
        uint256[2][2] calldata /*b*/,
        uint256[2] calldata /*c*/,
        uint256[5] calldata /*input*/
    ) external view override returns (bool) {
        return shouldVerify;
    }
}
