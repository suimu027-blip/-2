// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITallyVerifier} from "./ITallyVerifier.sol";

/// @title VeriVoteAudit
/// @notice Stores per-election audit summaries. Optionally gates new audit
///         submissions behind a Groth16 tally-correctness proof verified on
///         chain, via an external `ITallyVerifier` contract.
contract VeriVoteAudit {
    struct AuditRecord {
        bytes32 electionId;
        bytes32 merkleRoot;
        bytes32 commitmentRoot;
        bytes32 receiptRoot;
        bytes32 auditHash;
        bytes32 tallyHash;
        uint256 createdAt;
        address submitter;
        bool zkVerified;
        bool exists;
    }

    /// @notice Verifier contract implementing Groth16 verification for
    ///         `tally_correctness.circom`. Zero means "not configured" and
    ///         disables proof-gated submissions.
    address public tallyVerifier;

    /// @notice Contract deployer. Allowed to rotate the verifier address.
    address public immutable admin;

    mapping(bytes32 => AuditRecord) private auditRecords;

    event AuditSubmitted(
        bytes32 indexed electionId,
        bytes32 merkleRoot,
        bytes32 commitmentRoot,
        bytes32 receiptRoot,
        bytes32 auditHash,
        bytes32 tallyHash,
        uint256 createdAt,
        address indexed submitter,
        bool zkVerified
    );

    event TallyVerifierUpdated(address indexed previousVerifier, address indexed newVerifier);

    error OnlyAdmin();
    error AlreadySubmitted();
    error VerifierNotConfigured();
    error TallyProofRejected();

    constructor(address initialTallyVerifier) {
        admin = msg.sender;
        tallyVerifier = initialTallyVerifier;
        emit TallyVerifierUpdated(address(0), initialTallyVerifier);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    function setTallyVerifier(address newVerifier) external onlyAdmin {
        address previous = tallyVerifier;
        tallyVerifier = newVerifier;
        emit TallyVerifierUpdated(previous, newVerifier);
    }

    /// @notice Submit a plain audit summary without a tally proof. Preserved
    ///         for backwards compatibility with the original demo flow.
    function submitAudit(
        bytes32 electionId,
        bytes32 merkleRoot,
        bytes32 commitmentRoot,
        bytes32 receiptRoot,
        bytes32 auditHash,
        bytes32 tallyHash
    ) external {
        _writeAudit(
            electionId,
            merkleRoot,
            commitmentRoot,
            receiptRoot,
            auditHash,
            tallyHash,
            false
        );
    }

    /// @notice Submit an audit summary together with a Groth16 tally-correctness
    ///         proof. Reverts if the configured `tallyVerifier` rejects the proof.
    /// @dev    Public signal layout enforced by `tally_correctness.circom`:
    ///         [tally[0], tally[1], tally[2], tally[3], batchSize]
    function submitAuditWithTallyProof(
        bytes32 electionId,
        bytes32 merkleRoot,
        bytes32 commitmentRoot,
        bytes32 receiptRoot,
        bytes32 auditHash,
        bytes32 tallyHash,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata input
    ) external {
        address verifier = tallyVerifier;
        if (verifier == address(0)) revert VerifierNotConfigured();

        bool ok = ITallyVerifier(verifier).verifyProof(a, b, c, input);
        if (!ok) revert TallyProofRejected();

        _writeAudit(
            electionId,
            merkleRoot,
            commitmentRoot,
            receiptRoot,
            auditHash,
            tallyHash,
            true
        );
    }

    function _writeAudit(
        bytes32 electionId,
        bytes32 merkleRoot,
        bytes32 commitmentRoot,
        bytes32 receiptRoot,
        bytes32 auditHash,
        bytes32 tallyHash,
        bool zkVerified
    ) private {
        if (auditRecords[electionId].exists) revert AlreadySubmitted();

        AuditRecord memory record = AuditRecord({
            electionId: electionId,
            merkleRoot: merkleRoot,
            commitmentRoot: commitmentRoot,
            receiptRoot: receiptRoot,
            auditHash: auditHash,
            tallyHash: tallyHash,
            createdAt: block.timestamp,
            submitter: msg.sender,
            zkVerified: zkVerified,
            exists: true
        });

        auditRecords[electionId] = record;

        emit AuditSubmitted(
            electionId,
            merkleRoot,
            commitmentRoot,
            receiptRoot,
            auditHash,
            tallyHash,
            record.createdAt,
            msg.sender,
            zkVerified
        );
    }

    function getAudit(bytes32 electionId) external view returns (AuditRecord memory) {
        return auditRecords[electionId];
    }

    function hasAudit(bytes32 electionId) external view returns (bool) {
        return auditRecords[electionId].exists;
    }
}
