import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const verifierSource = join(projectRoot, "contracts", "TallyVerifier.sol");
const defaultCalldataFixture = join(projectRoot, "docs", "contracts", "calldata.sample.json");

const ZERO_PROOF_A: [bigint, bigint] = [0n, 0n];
const ZERO_PROOF_B: [[bigint, bigint], [bigint, bigint]] = [
  [0n, 0n],
  [0n, 0n]
];
const ZERO_PROOF_C: [bigint, bigint] = [0n, 0n];
const PUBLIC_INPUT: [bigint, bigint, bigint, bigint, bigint] = [2n, 2n, 2n, 2n, 8n];

interface RealCalldataFixture {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  input: [string, string, string, string, string];
}

function readRealCalldataFixture(): RealCalldataFixture | null {
  const fixturePath =
    process.env.VERIVOTE_REAL_TALLY_CALLDATA_JSON ?? defaultCalldataFixture;
  if (!existsSync(fixturePath)) {
    return null;
  }

  return JSON.parse(readFileSync(fixturePath, "utf8")) as RealCalldataFixture;
}

describe("VeriVoteAudit with real TallyVerifier", function () {
  before(function () {
    if (!existsSync(verifierSource)) {
      this.skip();
    }
  });

  async function deployRealVerifierFixture() {
    const verifier = await ethers.deployContract("TallyVerifier");
    await verifier.waitForDeployment();

    const audit = await ethers.deployContract("VeriVoteAudit", [
      await verifier.getAddress()
    ]);
    await audit.waitForDeployment();

    return { verifier, audit };
  }

  it("rejects a tampered all-zero proof", async function () {
    const { audit } = await deployRealVerifierFixture();

    await expect(
      audit.submitAuditWithTallyProof(
        ethers.id("real_verifier_zero"),
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

  it("accepts a valid fixture calldata", async function () {
    const fixture = readRealCalldataFixture();
    if (!fixture) {
      this.skip();
    }

    const { verifier, audit } = await deployRealVerifierFixture();
    const electionId = ethers.id("real_verifier_valid_fixture");

    const verifyGas = await verifier.verifyProof.estimateGas(
      fixture.a,
      fixture.b,
      fixture.c,
      fixture.input
    );
    console.log("gas TallyVerifier.verifyProof real:", verifyGas.toString());

    const tx = await audit.submitAuditWithTallyProof(
      electionId,
      ethers.id("m"),
      ethers.id("c"),
      ethers.id("r"),
      ethers.id("a"),
      ethers.id("t"),
      fixture.a,
      fixture.b,
      fixture.c,
      fixture.input
    );
    const receipt = await tx.wait();
    console.log("gas submitAuditWithTallyProof real:", receipt?.gasUsed?.toString() ?? "unknown");

    const record = await audit.getAudit(electionId);
    expect(record.exists).to.equal(true);
    expect(record.zkVerified).to.equal(true);
  });

  it("rejects a valid proof with tampered public input", async function () {
    const fixture = readRealCalldataFixture();
    if (!fixture) {
      this.skip();
    }

    const { audit } = await deployRealVerifierFixture();
    const tamperedInput = fixture.input.slice() as [string, string, string, string, string];
    tamperedInput[0] = (BigInt(tamperedInput[0]) + 1n).toString();

    await expect(
      audit.submitAuditWithTallyProof(
        ethers.id("real_verifier_tampered_input"),
        ethers.id("m"),
        ethers.id("c"),
        ethers.id("r"),
        ethers.id("a"),
        ethers.id("t"),
        fixture.a,
        fixture.b,
        fixture.c,
        tamperedInput
      )
    ).to.be.revertedWithCustomError(audit, "TallyProofRejected");
  });

  it("rejects a valid public input with tampered proof", async function () {
    const fixture = readRealCalldataFixture();
    if (!fixture) {
      this.skip();
    }

    const { audit } = await deployRealVerifierFixture();
    const tamperedA: [string, string] = [
      (BigInt(fixture.a[0]) + 1n).toString(),
      fixture.a[1]
    ];

    await expect(
      audit.submitAuditWithTallyProof(
        ethers.id("real_verifier_tampered_proof"),
        ethers.id("m"),
        ethers.id("c"),
        ethers.id("r"),
        ethers.id("a"),
        ethers.id("t"),
        tamperedA,
        fixture.b,
        fixture.c,
        fixture.input
      )
    ).to.be.revertedWithCustomError(audit, "TallyProofRejected");
  });
});
