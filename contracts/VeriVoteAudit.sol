// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITallyVerifier} from "./ITallyVerifier.sol";

// 保存每次选举的审计结果。如果有配置 ZK 验证器，还要检查 tally proof。
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

    // ZK验证器合约地址，如果是0就不验证
    address public tallyVerifier;

    // 部署人
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

    // 直接提交，没有zk证明（兼容老版本测试）
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

    // 提交并且要验证ZK，验证不过就报错
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
