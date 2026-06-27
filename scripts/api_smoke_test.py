from __future__ import annotations

import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any
import json


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_SRC = PROJECT_ROOT / "apps" / "api" / "src"
REPORT_DIR = PROJECT_ROOT / "docs" / "evaluation" / "aggregator_reports"

os.environ.setdefault("VERIVOTE_PERSISTENCE", "memory")
sys.path.insert(0, str(API_SRC))

from fastapi.testclient import TestClient  # noqa: E402
from verivote_api.main import app  # noqa: E402


client = TestClient(app)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def tamper_hex(value: str) -> str:
    if not value:
        return "0"
    replacement = "0" if value[0] != "0" else "1"
    return f"{replacement}{value[1:]}"


def expect(response: Any, *statuses: int) -> dict[str, Any]:
    if response.status_code not in statuses:
        raise AssertionError(
            f"{response.request.method} {response.request.url.path} -> "
            f"{response.status_code}: {response.text}"
        )
    return response.json()


def assert_aggregator_v2(report: dict[str, Any], integrity_check: dict[str, Any] | None = None) -> None:
    assert report["proofStatus"] == "not-generated"
    assert report["tallyProofSummary"]["proofStatus"] == "not-generated"
    assert report["tallyProofSummary"]["proofId"] is None
    assert report["pedersenAggregateStatus"] in {"pending", "verified", "failed"}
    assert isinstance(report["validVoteIds"], list)
    assert isinstance(report["invalidVoteIds"], list)
    assert isinstance(report["invalidVoteDiagnostics"], list)
    assert isinstance(report["diagnosticsHash"], str) and report["diagnosticsHash"]
    assert isinstance(report["partitionHash"], str) and report["partitionHash"]
    assert report["partitionAudit"]["partitionHash"] == report["partitionHash"]
    assert all(isinstance(bucket["tokenHashes"], list) for bucket in report["partitionAudit"]["buckets"])
    assert report["publicInputHints"]["partitionHash"] == report["partitionHash"]
    assert report["publicInputHints"]["diagnosticsHash"] == report["diagnosticsHash"]
    assert report["publicInputHints"].get("pedersenAggregateHash") == report.get("pedersenAggregateHash")
    assert sorted(report["validVoteIds"]) == sorted(
        vote_id
        for bucket in report["partitionAudit"]["buckets"]
        for vote_id in bucket["voteIds"]
    )
    assert sorted(report["invalidVoteIds"]) == sorted(
        {diagnostic["voteId"] for diagnostic in report["invalidVoteDiagnostics"]}
    )
    if integrity_check is not None:
        assert integrity_check["verified"] is True


def create_election_with_candidates(title: str) -> dict[str, Any]:
    election = expect(
        client.post("/elections", json={"title": title, "description": "api smoke test"}),
        201,
    )["election"]
    for name in ["Alice", "Bob", "Carol", "Dave"]:
        expect(client.post(f"/elections/{election['id']}/candidates", json={"name": name}), 201)
    return expect(client.get(f"/elections/{election['id']}"), 200)["election"]


def register_users(*names: str) -> list[dict[str, Any]]:
    return [
        expect(client.post("/users/register", json={"name": name}), 201)["user"]
        for name in names
    ]


def create_balanced_tally_batch() -> list[list[int]]:
    return [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ]


def column_sums(rows: list[list[int]]) -> list[int]:
    return [sum(row[index] for row in rows) for index in range(len(rows[0]))]


def test_main_flow() -> dict[str, Any]:
    health = expect(client.get("/health"), 200)
    assert health["ok"] is True

    detail = create_election_with_candidates("Smoke Election")
    users = register_users("u1", "u2", "auditor")

    vote = expect(
        client.post(
            f"/elections/{detail['id']}/vote",
            json={"userId": users[0]["id"], "candidateId": detail["candidates"][0]["id"]},
        ),
        201,
    )

    pending = expect(
        client.post(
            f"/challenge/elections/{detail['id']}/prepare",
            json={"userId": users[2]["id"], "candidateId": detail["candidates"][1]["id"]},
        ),
        201,
    )["pendingBallot"]
    challenge = expect(client.post(f"/challenge/ballots/{pending['id']}/challenge"), 201)
    assert challenge["openingVerified"] is True
    expect(client.post(f"/challenge/ballots/{pending['id']}/cast"), 409)

    pending_cast = expect(
        client.post(
            f"/challenge/elections/{detail['id']}/prepare",
            json={"userId": users[1]["id"], "candidateId": detail["candidates"][1]["id"]},
        ),
        201,
    )["pendingBallot"]
    expect(client.post(f"/challenge/ballots/{pending_cast['id']}/cast"), 201)
    expect(client.post(f"/challenge/ballots/{pending_cast['id']}/challenge"), 409)

    expect(
        client.post(
            f"/elections/{detail['id']}/vote",
            json={"userId": users[0]["id"], "candidateId": detail["candidates"][2]["id"]},
        ),
        409,
    )

    bulletin = expect(client.post(f"/elections/{detail['id']}/finalize"), 201)["bulletin"]
    assert bulletin["totalVotes"] == 2
    assert bulletin["receiptChainVerified"] is True
    expect(client.post(f"/elections/{detail['id']}/candidates", json={"name": "Late candidate"}), 409)
    late_user = register_users("late-user")[0]
    expect(
        client.post(
            f"/elections/{detail['id']}/vote",
            json={"userId": late_user["id"], "candidateId": detail["candidates"][2]["id"]},
        ),
        409,
    )

    run_response = expect(client.post(f"/aggregator/elections/{detail['id']}/run"), 201)
    report = run_response["report"]
    assert report["validVotes"] == 2
    assert report["duplicateVotes"] == 0
    assert report["invalidVotes"] == 0
    assert report["receiptChainVerified"] is True
    assert_aggregator_v2(report, run_response["integrityCheck"])

    report_view = expect(client.get(f"/aggregator/elections/{detail['id']}/report"), 200)
    assert report_view["tallyConsistent"] is True
    assert_aggregator_v2(report_view["report"], report_view["integrityCheck"])

    receipt = expect(client.get(f"/receipts/{vote['receiptCode']}"), 200)
    assert receipt["exists"] is True
    proof = expect(client.get(f"/receipts/{vote['receiptCode']}/proof"), 200)
    assert proof["verifyResult"] is True

    zk = expect(
        client.post(
            "/zk/prove-vote-validity",
            json={"electionId": detail["id"], "candidateCount": 4, "voteVector": [1, 0, 0, 0]},
        ),
        200,
    )
    assert zk["valid"] is True
    verify = expect(
        client.post(
            "/zk/verify-vote-validity",
            json={"proof": zk["proof"], "publicSignals": zk["publicSignals"]},
        ),
        200,
    )
    assert verify["verified"] is True
    tampered_public_signals = deepcopy(zk["publicSignals"])
    tampered_public_signals["voteVectorCommitment"] = tamper_hex(
        tampered_public_signals["voteVectorCommitment"]
    )
    tampered_verify = expect(
        client.post(
            "/zk/verify-vote-validity",
            json={"proof": zk["proof"], "publicSignals": tampered_public_signals},
        ),
        200,
    )
    assert tampered_verify["verified"] is False
    invalid_zk = expect(
        client.post(
            "/zk/prove-vote-validity",
            json={"electionId": detail["id"], "candidateCount": 4, "voteVector": [1, 1, 0, 0]},
        ),
        200,
    )
    assert invalid_zk["valid"] is False

    tally_batch = create_balanced_tally_batch()
    bad_tally = column_sums(tally_batch)
    bad_tally[0] += 1
    invalid_tally_proof = expect(
        client.post(
            "/zk/prove-tally-correctness",
            json={"electionId": detail["id"], "voteVectors": tally_batch, "tally": bad_tally},
        ),
        200,
    )
    assert invalid_tally_proof["valid"] is False

    pedersen = expect(
        client.post(
            "/crypto/pedersen/commit",
            json={"electionId": detail["id"], "candidateCount": 4, "voteVector": [1, 0, 0, 0]},
        ),
        201,
    )
    pedersen_verify = expect(
        client.post(
            "/crypto/pedersen/verify-opening",
            json={
                "electionId": detail["id"],
                "candidateCount": 4,
                "voteVector": [1, 0, 0, 0],
                "randomness": pedersen["commitmentRecord"]["randomness"],
                "commitment": pedersen["commitmentRecord"]["commitment"],
            },
        ),
        200,
    )
    assert pedersen_verify["verified"] is True
    aggregate_batch = []
    for vote_vector in ([1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]):
        commitment = expect(
            client.post(
                "/crypto/pedersen/commit",
                json={"electionId": detail["id"], "candidateCount": 4, "voteVector": vote_vector},
            ),
            201,
        )["commitmentRecord"]
        aggregate_batch.append(
            {
                "voteVector": list(vote_vector),
                "randomness": commitment["randomness"],
                "commitment": commitment["commitment"],
            }
        )
    aggregate = expect(
        client.post(
            "/crypto/pedersen/aggregate-verify",
            json={"electionId": detail["id"], "candidateCount": 4, "batch": aggregate_batch},
        ),
        200,
    )
    assert aggregate["verified"] is True
    tampered_batch = deepcopy(aggregate_batch)
    tampered_batch[0]["randomness"] = tamper_hex(tampered_batch[0]["randomness"])
    tampered_aggregate = expect(
        client.post(
            "/crypto/pedersen/aggregate-verify",
            json={"electionId": detail["id"], "candidateCount": 4, "batch": tampered_batch},
        ),
        200,
    )
    assert tampered_aggregate["verified"] is False

    audit = expect(client.post(f"/blockchain/elections/{detail['id']}/submit-audit"), 201)["audit"]
    assert audit["status"] == "submitted"
    bundle = expect(client.get(f"/elections/{detail['id']}/export-bundle"), 200)["bundle"]
    assert bundle["publicInputs"]["totalVotes"] == 2
    assert bundle["envelope"]["schemaVersion"] == "verivote.artifact.v2"
    assert bundle["aggregatorReport"]["integrityCheck"]["verified"] is True
    assert bundle["tallyProofSummary"]["proofStatus"] == "not-generated"
    assert bundle["demoMetadata"]["apiSmokeFile"] == "docs/evaluation/aggregator_reports/python_api_smoke.json"
    raw_public_inputs = expect(client.get(f"/elections/{detail['id']}/export/public_inputs.json"), 200)
    assert raw_public_inputs["partitionHash"] == report["partitionHash"]
    assert raw_public_inputs["diagnosticsHash"] == report["diagnosticsHash"]
    write_json(REPORT_DIR / "python_api_aggregator_report.json", report_view)
    write_json(REPORT_DIR / "python_api_public_inputs.json", raw_public_inputs)
    write_json(REPORT_DIR / "python_api_export_bundle.json", bundle)
    return {
        "electionId": detail["id"],
        "receiptCode": vote["receiptCode"],
        "aggregatorAuditHash": report["auditHash"],
        "partitionHash": report["partitionHash"],
        "diagnosticsHash": report["diagnosticsHash"],
        "bundleSchemaVersion": bundle["envelope"]["schemaVersion"],
    }


def test_attack_detection() -> dict[str, Any]:
    detail = create_election_with_candidates("Attack Matrix Election")
    users = register_users("red-a", "red-b")
    first_vote = expect(
        client.post(
            f"/elections/{detail['id']}/vote",
            json={"userId": users[0]["id"], "candidateId": detail["candidates"][0]["id"]},
        ),
        201,
    )
    expect(
        client.post(
            f"/elections/{detail['id']}/vote",
            json={"userId": users[1]["id"], "candidateId": detail["candidates"][1]["id"]},
        ),
        201,
    )
    expect(client.post(f"/elections/{detail['id']}/finalize"), 201)
    expect(client.post(f"/aggregator/elections/{detail['id']}/run"), 201)
    clean_audit = expect(client.post(f"/blockchain/elections/{detail['id']}/submit-audit"), 201)["audit"]
    assert clean_audit["status"] == "submitted"
    expect(client.post(f"/blockchain/elections/{detail['id']}/submit-audit"), 409)

    duplicate = expect(client.post(f"/attack/elections/{detail['id']}/inject-duplicate-vote"), 200)
    assert duplicate["ok"] is True
    invalid = expect(client.post(f"/attack/elections/{detail['id']}/inject-invalid-vote"), 200)
    assert invalid["ok"] is True
    non_one_hot = expect(client.post(f"/attack/elections/{detail['id']}/inject-non-one-hot-vote"), 200)
    assert non_one_hot["ok"] is True
    vector_mismatch = expect(client.post(f"/attack/elections/{detail['id']}/inject-candidate-vector-mismatch"), 200)
    assert vector_mismatch["ok"] is True

    attack_run_response = expect(client.post(f"/aggregator/elections/{detail['id']}/run"), 200)
    report = attack_run_response["report"]
    assert_aggregator_v2(report, attack_run_response["integrityCheck"])
    assert report["duplicateVotes"] >= 1
    assert report["invalidVotes"] >= 1
    assert "duplicate-token" in {diagnostic["reason"] for diagnostic in report["invalidVoteDiagnostics"]}
    assert "invalid-candidate" in {diagnostic["reason"] for diagnostic in report["invalidVoteDiagnostics"]}
    assert "invalid-one-hot" in {diagnostic["reason"] for diagnostic in report["invalidVoteDiagnostics"]}
    assert "candidate-vector-mismatch" in {diagnostic["reason"] for diagnostic in report["invalidVoteDiagnostics"]}
    pre_tamper_diagnostic_reasons = sorted({diagnostic["reason"] for diagnostic in report["invalidVoteDiagnostics"]})

    tampered_tally = expect(client.post(f"/attack/elections/{detail['id']}/tamper-tally"), 200)
    assert tampered_tally["ok"] is True
    report_view = expect(client.get(f"/aggregator/elections/{detail['id']}/report"), 200)
    assert report_view["tallyConsistent"] is False
    bundle = expect(client.get(f"/elections/{detail['id']}/export-bundle"), 200)["bundle"]
    assert bundle["chainAudit"]["audit"]["tallyHash"] != bundle["publicInputs"]["tallyHash"]

    tampered_commitment = expect(client.post(f"/attack/elections/{detail['id']}/tamper-commitment"), 200)
    assert tampered_commitment["ok"] is True
    proof = expect(client.get(f"/receipts/{first_vote['receiptCode']}/proof"), 200)
    assert proof["verifyResult"] is False
    deleted = expect(client.post(f"/attack/elections/{detail['id']}/delete-vote"), 200)
    assert deleted["ok"] is True
    deleted_receipt = expect(client.get(f"/receipts/{first_vote['receiptCode']}"), 200)
    assert deleted_receipt["exists"] is False
    broken_run_response = expect(client.post(f"/aggregator/elections/{detail['id']}/run"), 200)
    broken_report = broken_run_response["report"]
    assert_aggregator_v2(broken_report, broken_run_response["integrityCheck"])
    assert broken_report["receiptChainVerified"] is False
    assert len(broken_report["receiptChainBreaks"]) > 0

    logs = expect(client.get(f"/attack/elections/{detail['id']}/logs"), 200)["logs"]
    assert len(logs) >= 5
    write_json(REPORT_DIR / "python_api_attack_report.json", broken_run_response)
    return {
        "electionId": detail["id"],
        "attacks": [log["type"] for log in logs],
        "preTamperDiagnosticReasons": pre_tamper_diagnostic_reasons,
        "diagnosticReasons": sorted({diagnostic["reason"] for diagnostic in broken_report["invalidVoteDiagnostics"]}),
        "receiptChainVerified": broken_report["receiptChainVerified"],
    }


def main() -> None:
    main_flow = test_main_flow()
    attack_flow = test_attack_detection()
    output = {
        "schemaVersion": "verivote.python-api-smoke.v1",
        "generatedBy": "python scripts/api_smoke_test.py",
        "passed": True,
        "mainFlow": main_flow,
        "attackFlow": attack_flow,
        "rawFiles": {
            "aggregatorReport": "docs/evaluation/aggregator_reports/python_api_aggregator_report.json",
            "publicInputs": "docs/evaluation/aggregator_reports/python_api_public_inputs.json",
            "exportBundle": "docs/evaluation/aggregator_reports/python_api_export_bundle.json",
            "attackReport": "docs/evaluation/aggregator_reports/python_api_attack_report.json",
        },
    }
    write_json(REPORT_DIR / "python_api_smoke.json", output)
    print(
        "api smoke ok",
        {
            "mainElectionId": main_flow["electionId"],
            "attackElectionId": attack_flow["electionId"],
            "attackTypes": attack_flow["attacks"],
            "pythonApiSmoke": "docs/evaluation/aggregator_reports/python_api_smoke.json",
        },
    )


if __name__ == "__main__":
    main()
