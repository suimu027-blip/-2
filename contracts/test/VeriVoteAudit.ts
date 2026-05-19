import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const ZERO_PROOF_A: [bigint, bigint] = [0n, 0n];
const ZERO_PROOF_B: [[bigint, bigint], [bigint, bigint]] = [
  [0n, 0n],
  [0n, 0n]
];
const ZERO_PROOF_C: [bigint, bigint] = [0n, 0n];
const PUBLIC_INPUT: [bigint, bigint, bigint, bigint, bigint] = [2n, 2n, 2n, 2n, 8n];

describe("VeriVoteAudit", function () {
  async function deployFixture(verifierAccepts: boolean) {
    const verifier = await ethers.deployContract("MockTallyVerifier", [verifierAccepts]);
    await verifier.waitForDeployment();

    const audit = await ethers.deployContract("VeriVoteAudit", [
      await verifier.getAddress()
    ]);
    await audit.waitForDeployment();

    return { verifier, audit };
  }

  it("stores and returns a submitted audit record", async function () {
    const { audit } = await deployFixture(true);

    const electionId = ethers.id("election_1");
    const merkleRoot = ethers.id("merkleRoot");
    const commitmentRoot = ethers.id("commitmentRoot");
    const receiptRoot = ethers.id("receiptRoot");
    const auditHash = ethers.id("auditHash");
    const tallyHash = ethers.id("tallyHash");

    await audit.submitAudit(
      electionId,
      merkleRoot,
      commitmentRoot,
      receiptRoot,
      auditHash,
      tallyHash
    );

    const record = await audit.getAudit(electionId);

    expect(await audit.hasAudit(electionId)).to.equal(true);
    expect(record.electionId).to.equal(electionId);
    expect(record.merkleRoot).to.equal(merkleRoot);
    expect(record.commitmentRoot).to.equal(commitmentRoot);
    expect(record.receiptRoot).to.equal(receiptRoot);
    expect(record.auditHash).to.equal(auditHash);
    expect(record.tallyHash).to.equal(tallyHash);
    expect(record.exists).to.equal(true);
    expect(record.zkVerified).to.equal(false);
  });

  it("accepts submitAuditWithTallyProof when the verifier returns true", async function () {
    const { audit } = await deployFixture(true);

    const electionId = ethers.id("election_with_proof");
    const merkleRoot = ethers.id("merkleRoot");
    const commitmentRoot = ethers.id("commitmentRoot");
    const receiptRoot = ethers.id("receiptRoot");
    const auditHash = ethers.id("auditHash");
    const tallyHash = ethers.id("tallyHash");

    await audit.submitAuditWithTallyProof(
      electionId,
      merkleRoot,
      commitmentRoot,
      receiptRoot,
      auditHash,
      tallyHash,
      ZERO_PROOF_A,
      ZERO_PROOF_B,
      ZERO_PROOF_C,
      PUBLIC_INPUT
    );

    const record = await audit.getAudit(electionId);
    expect(record.exists).to.equal(true);
    expect(record.zkVerified).to.equal(true);
  });

  it("reverts submitAuditWithTallyProof when the verifier rejects", async function () {
    const { audit } = await deployFixture(false);

    const electionId = ethers.id("election_rejected");
    const merkleRoot = ethers.id("merkleRoot");
    const commitmentRoot = ethers.id("commitmentRoot");
    const receiptRoot = ethers.id("receiptRoot");
    const auditHash = ethers.id("auditHash");
    const tallyHash = ethers.id("tallyHash");

    await expect(
      audit.submitAuditWithTallyProof(
        electionId,
        merkleRoot,
        commitmentRoot,
        receiptRoot,
        auditHash,
        tallyHash,
        ZERO_PROOF_A,
        ZERO_PROOF_B,
        ZERO_PROOF_C,
        PUBLIC_INPUT
      )
    ).to.be.revertedWithCustomError(audit, "TallyProofRejected");

    expect(await audit.hasAudit(electionId)).to.equal(false);
  });

  it("reverts submitAuditWithTallyProof when the verifier is not configured", async function () {
    const audit = await ethers.deployContract("VeriVoteAudit", [ethers.ZeroAddress]);
    await audit.waitForDeployment();

    const electionId = ethers.id("election_no_verifier");

    await expect(
      audit.submitAuditWithTallyProof(
        electionId,
        ethers.id("m"),
        ethers.id("c"),
        ethers.id("r"),
        ethers.id("a"),
        ethers.id("t"),
        ZERO_PROOF_A,
        ZERO_PROOF_B,
        ZERO_PROOF_C,
        PUBLIC_INPUT
      )
    ).to.be.revertedWithCustomError(audit, "VerifierNotConfigured");
  });

  it("admin can rotate the tally verifier", async function () {
    const { audit } = await deployFixture(true);
    const newVerifier = await ethers.deployContract("MockTallyVerifier", [false]);
    await newVerifier.waitForDeployment();

    await expect(audit.setTallyVerifier(await newVerifier.getAddress()))
      .to.emit(audit, "TallyVerifierUpdated");

    // After rotation a submission should now be rejected.
    await expect(
      audit.submitAuditWithTallyProof(
        ethers.id("election_rotated"),
        ethers.id("m"),
        ethers.id("c"),
        ethers.id("r"),
        ethers.id("a"),
        ethers.id("t"),
        ZERO_PROOF_A,
        ZERO_PROOF_B,
        ZERO_PROOF_C,
        PUBLIC_INPUT
      )
    ).to.be.revertedWithCustomError(audit, "TallyProofRejected");
  });

  it("rejects duplicate submissions", async function () {
    const { audit } = await deployFixture(true);

    const electionId = ethers.id("election_dup");
    const args: [string, string, string, string, string, string] = [
      electionId,
      ethers.id("m"),
      ethers.id("c"),
      ethers.id("r"),
      ethers.id("a"),
      ethers.id("t")
    ];

    await audit.submitAudit(...args);
    await expect(audit.submitAudit(...args)).to.be.revertedWithCustomError(
      audit,
      "AlreadySubmitted"
    );
  });
});
