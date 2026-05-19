from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

from .crypto import hash_text


MOCK_PROTOCOL = "verivote-one-hot-validity-mock-v1"
REAL_PROTOCOL = "verivote-one-hot-validity-groth16-v1"
REAL_CIRCUIT_ID = "valid-vote-4"
REAL_CANDIDATE_COUNT = 4

TALLY_CIRCUIT_ID = "tally-correctness-8x4"
TALLY_BATCH_SIZE = 8
TALLY_CANDIDATE_COUNT = 4

PROJECT_ROOT = Path(__file__).resolve().parents[4]
API_ROOT = Path(__file__).resolve().parents[2]
REAL_ARTIFACT_DIRECTORY = Path(
    os.environ.get("VERIVOTE_ZK_ARTIFACT_DIR", PROJECT_ROOT / "zk-artifacts" / "valid-vote")
)
TALLY_ARTIFACT_DIRECTORY = Path(
    os.environ.get(
        "VERIVOTE_ZK_TALLY_ARTIFACT_DIR",
        PROJECT_ROOT / "zk-artifacts" / "tally-correctness",
    )
)


def _compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def stable_stringify(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(item) for item in value) + "]"
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(
                f"{_compact_json(key)}:{stable_stringify(value[key])}"
                for key in sorted(value.keys())
            )
            + "}"
        )
    return _compact_json(value)


def _create_election_id_hash(election_id: str) -> str:
    return hash_text(f"verivote.zk.election-id.v1:{election_id}")


def _create_tally_election_id_hash(election_id: str) -> str:
    return hash_text(f"verivote.zk.tally.election-id.v1:{election_id}")


def _create_vote_vector_commitment(input_value: dict[str, Any]) -> str:
    return hash_text(
        stable_stringify(
            {
                "domain": "verivote.zk.vote-vector-commitment.v1",
                "electionIdHash": input_value["electionIdHash"],
                "candidateCount": input_value["candidateCount"],
                "voteVector": input_value["voteVector"],
            }
        )
    )


def _create_proof_hash(proof_without_hash: dict[str, Any]) -> str:
    return hash_text(
        stable_stringify(
            {
                "domain": "verivote.zk.mock-proof-hash.v1",
                "proof": proof_without_hash,
            }
        )
    )


def create_public_signals(input_value: dict[str, Any]) -> dict[str, Any]:
    election_id_hash = _create_election_id_hash(input_value["electionId"])
    return {
        "electionIdHash": election_id_hash,
        "candidateCount": input_value["candidateCount"],
        "voteVectorCommitment": _create_vote_vector_commitment(
            {
                "electionIdHash": election_id_hash,
                "candidateCount": input_value["candidateCount"],
                "voteVector": input_value["voteVector"],
            }
        ),
    }


def _is_number_array(value: Any) -> bool:
    return isinstance(value, list) and all(
        (isinstance(item, (int, float)) and not isinstance(item, bool)) for item in value
    )


def _is_string_array(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_positive_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def is_one_hot_vector(vote_vector: list[Any]) -> bool:
    if not isinstance(vote_vector, list) or not vote_vector:
        return False
    bits_are_boolean = all(
        isinstance(value, int) and not isinstance(value, bool) and value in (0, 1)
        for value in vote_vector
    )
    return bits_are_boolean and sum(vote_vector) == 1


def _get_constraint_result(input_value: dict[str, Any]) -> dict[str, bool]:
    vote_vector = input_value["voteVector"]
    bits_are_boolean = all(
        isinstance(value, int) and not isinstance(value, bool) and value in (0, 1)
        for value in vote_vector
    )
    return {
        "bitsAreBoolean": bits_are_boolean,
        "sumEqualsOne": sum(vote_vector) == 1,
        "lengthMatchesCandidateCount": len(vote_vector) == input_value["candidateCount"],
    }


def _validity_message(valid: bool) -> str:
    return (
        "voteVector is a valid one-hot vector"
        if valid
        else "voteVector is invalid: every entry must be 0/1, length must match candidateCount, and the sum must equal 1"
    )


def _read_mock_proof(proof: Any) -> dict[str, Any] | None:
    if not isinstance(proof, dict):
        return None
    constraints = proof.get("constraints")
    if not isinstance(constraints, dict):
        return None
    if (
        proof.get("protocol") != MOCK_PROTOCOL
        or proof.get("proofMode") != "mock"
        or not isinstance(proof.get("proofId"), str)
        or not isinstance(proof.get("electionIdHash"), str)
        or not _is_positive_integer(proof.get("candidateCount"))
        or not _is_number_array(proof.get("voteVector"))
        or not isinstance(proof.get("voteVectorCommitment"), str)
        or not isinstance(constraints.get("bitsAreBoolean"), bool)
        or not isinstance(constraints.get("sumEqualsOne"), bool)
        or not isinstance(constraints.get("lengthMatchesCandidateCount"), bool)
        or not isinstance(proof.get("valid"), bool)
        or not isinstance(proof.get("generatedAt"), str)
        or not isinstance(proof.get("proofHash"), str)
    ):
        return None
    return proof


def create_zk_validity_proof(input_value: dict[str, Any]) -> dict[str, Any]:
    if input_value.get("proofMode") == "real":
        return create_real_zk_validity_proof(input_value)

    public_signals = create_public_signals(input_value)
    constraints = _get_constraint_result(input_value)
    valid = all(constraints.values())
    proof_without_hash = {
        "protocol": MOCK_PROTOCOL,
        "proofMode": "mock",
        "proofId": f"zkp_{uuid.uuid4()}",
        "electionIdHash": public_signals["electionIdHash"],
        "candidateCount": public_signals["candidateCount"],
        "voteVector": list(input_value["voteVector"]),
        "voteVectorCommitment": public_signals["voteVectorCommitment"],
        "constraints": constraints,
        "valid": valid,
        "generatedAt": _iso_now(),
    }
    proof = {**proof_without_hash, "proofHash": _create_proof_hash(proof_without_hash)}
    return {
        "proofId": proof["proofId"],
        "proofMode": "mock",
        "publicSignals": public_signals,
        "proof": proof,
        "valid": valid,
        "message": _validity_message(valid),
    }


def verify_zk_validity_proof(input_value: dict[str, Any]) -> dict[str, Any]:
    proof = input_value.get("proof")
    if input_value.get("proofMode") == "real" or (
        isinstance(proof, dict) and proof.get("proofMode") == "real"
    ):
        return verify_real_zk_validity_proof(input_value)

    parsed = _read_mock_proof(proof)
    if parsed is None:
        return {
            "proofMode": "mock",
            "verified": False,
            "message": "Mock ZK validity proof verification failed: invalid proof shape",
        }

    public_signals = input_value["publicSignals"]
    constraints = _get_constraint_result(
        {
            "voteVector": parsed["voteVector"],
            "candidateCount": parsed["candidateCount"],
        }
    )
    recomputed_commitment = _create_vote_vector_commitment(
        {
            "electionIdHash": public_signals["electionIdHash"],
            "candidateCount": public_signals["candidateCount"],
            "voteVector": parsed["voteVector"],
        }
    )
    proof_without_hash = {key: value for key, value in parsed.items() if key != "proofHash"}
    recomputed_proof_hash = _create_proof_hash(proof_without_hash)
    valid = all(constraints.values())
    public_signals_match = (
        parsed["electionIdHash"] == public_signals["electionIdHash"]
        and parsed["candidateCount"] == public_signals["candidateCount"]
        and parsed["voteVectorCommitment"] == public_signals["voteVectorCommitment"]
        and recomputed_commitment == public_signals["voteVectorCommitment"]
    )
    constraints_match = (
        parsed["constraints"]["bitsAreBoolean"] == constraints["bitsAreBoolean"]
        and parsed["constraints"]["sumEqualsOne"] == constraints["sumEqualsOne"]
        and parsed["constraints"]["lengthMatchesCandidateCount"]
        == constraints["lengthMatchesCandidateCount"]
        and parsed["valid"] == valid
    )
    verified = valid and public_signals_match and constraints_match and parsed["proofHash"] == recomputed_proof_hash
    return {
        "proofMode": "mock",
        "verified": verified,
        "message": (
            "Mock ZK validity proof verification passed"
            if verified
            else "Mock ZK validity proof verification failed: one-hot constraints, publicSignals, or proofHash do not match"
        ),
    }


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _get_snarkjs_cli_path() -> Path | None:
    candidates = [
        API_ROOT / "node_modules" / "snarkjs" / "build" / "cli.cjs",
        PROJECT_ROOT / "node_modules" / "snarkjs" / "build" / "cli.cjs",
    ]
    return next((candidate for candidate in candidates if candidate.exists()), None)


def _get_real_artifacts() -> dict[str, Path]:
    return {
        "directory": REAL_ARTIFACT_DIRECTORY,
        "wasmPath": REAL_ARTIFACT_DIRECTORY / "valid_vote_js" / "valid_vote.wasm",
        "witnessGeneratorPath": REAL_ARTIFACT_DIRECTORY / "valid_vote_js" / "generate_witness.js",
        "zkeyPath": REAL_ARTIFACT_DIRECTORY / "valid_vote_final.zkey",
        "verificationKeyPath": REAL_ARTIFACT_DIRECTORY / "verification_key.json",
    }


def get_real_zk_artifact_status() -> dict[str, Any]:
    artifacts = _get_real_artifacts()
    required = [
        artifacts["wasmPath"],
        artifacts["witnessGeneratorPath"],
        artifacts["zkeyPath"],
        artifacts["verificationKeyPath"],
    ]
    missing = [str(path) for path in required if not path.exists()]
    return {"ready": not missing, "directory": str(artifacts["directory"]), "missing": missing}


def _artifact_missing_message(missing: list[str]) -> str:
    suffix = f" Missing: {', '.join(missing)}" if missing else ""
    return f"Real ZK artifacts not found. Please run pnpm zk:setup first.{suffix}"


def _run_command(command: str, args: list[str], allow_failure: bool = False) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [command, *args],
            cwd=PROJECT_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as exc:
        if not allow_failure:
            raise
        return {"exitCode": None, "stdout": "", "stderr": str(exc), "errorMessage": str(exc)}

    if result.returncode != 0 and not allow_failure:
        raise RuntimeError(
            f"{command} {' '.join(args)} exited with {result.returncode}\n{result.stdout}{result.stderr}"
        )
    return {
        "exitCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "errorMessage": None,
    }


def _run_snarkjs(args: list[str], allow_failure: bool = False) -> dict[str, Any]:
    cli = _get_snarkjs_cli_path()
    node = shutil.which("node")
    if cli is None or node is None:
        return {
            "exitCode": None,
            "stdout": "",
            "stderr": "snarkjs CLI or node runtime not found",
            "errorMessage": "snarkjs CLI or node runtime not found",
        }
    return _run_command(node, [str(cli), *args], allow_failure=allow_failure)


def _read_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_file(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def _create_real_proof_shell(input_value: dict[str, Any]) -> dict[str, Any]:
    proof: dict[str, Any] = {
        "protocol": REAL_PROTOCOL,
        "proofMode": "real",
        "proofId": input_value.get("proofId") or f"zkp_{uuid.uuid4()}",
        "circuitId": REAL_CIRCUIT_ID,
        "generatedAt": _iso_now(),
        "electionIdHash": input_value["publicSignals"]["electionIdHash"],
        "candidateCount": input_value["publicSignals"]["candidateCount"],
        "voteVector": list(input_value["voteVector"]),
        "voteVectorCommitment": input_value["publicSignals"]["voteVectorCommitment"],
        "snarkjsProof": input_value.get("snarkjsProof"),
        "snarkjsPublicSignals": input_value.get("snarkjsPublicSignals") or [],
        "artifactDirectory": str(REAL_ARTIFACT_DIRECTORY),
        "valid": input_value["valid"],
    }
    if input_value.get("error"):
        proof["error"] = input_value["error"]
    return proof


def _normalize_signal(value: Any) -> str:
    try:
        return str(int(str(value)))
    except Exception:
        return str(value)


def _signal_arrays_equal(left: list[str], right: list[str]) -> bool:
    return len(left) == len(right) and all(_normalize_signal(value) == _normalize_signal(right[index]) for index, value in enumerate(left))


def _real_public_signals_match_vote_vector(snarkjs_public_signals: list[str], vote_vector: list[int]) -> bool:
    vector_signals = [str(value) for value in vote_vector]
    normalized_signals = [_normalize_signal(value) for value in snarkjs_public_signals]
    expected_layouts = [
        ["1", "1", *vector_signals],
        [*vector_signals, "1", "1"],
        vector_signals,
    ]
    return any(_signal_arrays_equal(normalized_signals, layout) for layout in expected_layouts)


def _verify_snark_proof(input_value: dict[str, Any]) -> bool:
    artifacts = _get_real_artifacts()
    with tempfile.TemporaryDirectory(prefix="verivote-zk-verify-") as temp_dir:
        temp_path = Path(temp_dir)
        proof_path = temp_path / "proof.json"
        public_path = temp_path / "public.json"
        _write_json_file(proof_path, input_value["snarkjsProof"])
        _write_json_file(public_path, input_value["snarkjsPublicSignals"])
        result = _run_snarkjs(
            [
                "groth16",
                "verify",
                str(artifacts["verificationKeyPath"]),
                str(public_path),
                str(proof_path),
            ],
            allow_failure=True,
        )
        return result["exitCode"] == 0


def create_real_zk_validity_proof(input_value: dict[str, Any]) -> dict[str, Any]:
    public_signals = create_public_signals(input_value)
    proof_id = f"zkp_{uuid.uuid4()}"

    if (
        input_value["candidateCount"] != REAL_CANDIDATE_COUNT
        or len(input_value["voteVector"]) != REAL_CANDIDATE_COUNT
    ):
        error = "Real Groth16 circuit currently supports exactly 4 candidates and a voteVector length of 4"
        proof = _create_real_proof_shell(
            {
                "publicSignals": public_signals,
                "voteVector": input_value["voteVector"],
                "proofId": proof_id,
                "valid": False,
                "error": error,
            }
        )
        return {"proofId": proof_id, "proofMode": "real", "publicSignals": public_signals, "proof": proof, "valid": False, "message": error}

    artifact_status = get_real_zk_artifact_status()
    if not artifact_status["ready"]:
        error = _artifact_missing_message(artifact_status["missing"])
        proof = _create_real_proof_shell(
            {
                "publicSignals": public_signals,
                "voteVector": input_value["voteVector"],
                "proofId": proof_id,
                "valid": False,
                "error": error,
            }
        )
        return {"proofId": proof_id, "proofMode": "real", "publicSignals": public_signals, "proof": proof, "valid": False, "message": error}

    artifacts = _get_real_artifacts()
    node = shutil.which("node")
    if node is None:
        error = "node runtime not found; real ZK proof generation cannot run"
        proof = _create_real_proof_shell(
            {
                "publicSignals": public_signals,
                "voteVector": input_value["voteVector"],
                "proofId": proof_id,
                "valid": False,
                "error": error,
            }
        )
        return {"proofId": proof_id, "proofMode": "real", "publicSignals": public_signals, "proof": proof, "valid": False, "message": error}

    with tempfile.TemporaryDirectory(prefix="verivote-zk-prove-") as temp_dir:
        temp_path = Path(temp_dir)
        input_path = temp_path / "input.json"
        witness_path = temp_path / "witness.wtns"
        proof_path = temp_path / "proof.json"
        public_path = temp_path / "public.json"
        _write_json_file(input_path, {"voteVector": input_value["voteVector"]})

        witness_result = _run_command(
            node,
            [
                str(artifacts["witnessGeneratorPath"]),
                str(artifacts["wasmPath"]),
                str(input_path),
                str(witness_path),
            ],
            allow_failure=True,
        )
        if witness_result["exitCode"] != 0:
            error = "Real Groth16 witness generation failed; the voteVector does not satisfy valid_vote.circom one-hot constraints"
            proof = _create_real_proof_shell({"publicSignals": public_signals, "voteVector": input_value["voteVector"], "proofId": proof_id, "valid": False, "error": error})
            return {"proofId": proof_id, "proofMode": "real", "publicSignals": public_signals, "proof": proof, "valid": False, "message": error}

        prove_result = _run_snarkjs(
            ["groth16", "prove", str(artifacts["zkeyPath"]), str(witness_path), str(proof_path), str(public_path)],
            allow_failure=True,
        )
        if prove_result["exitCode"] != 0:
            error = "Real Groth16 proof generation failed"
            proof = _create_real_proof_shell({"publicSignals": public_signals, "voteVector": input_value["voteVector"], "proofId": proof_id, "valid": False, "error": error})
            return {"proofId": proof_id, "proofMode": "real", "publicSignals": public_signals, "proof": proof, "valid": False, "message": error}

        snarkjs_proof = _read_json_file(proof_path)
        snarkjs_public_signals = _read_json_file(public_path)
        if not _is_string_array(snarkjs_public_signals):
            error = "Real Groth16 proof generated invalid public signal output"
            proof = _create_real_proof_shell({"publicSignals": public_signals, "voteVector": input_value["voteVector"], "proofId": proof_id, "snarkjsProof": snarkjs_proof, "valid": False, "error": error})
            return {"proofId": proof_id, "proofMode": "real", "publicSignals": public_signals, "proof": proof, "valid": False, "message": error}

        snark_verified = _verify_snark_proof({"snarkjsProof": snarkjs_proof, "snarkjsPublicSignals": snarkjs_public_signals})
        public_signals_match = _real_public_signals_match_vote_vector(snarkjs_public_signals, input_value["voteVector"])
        valid = snark_verified and public_signals_match
        proof = _create_real_proof_shell(
            {
                "publicSignals": public_signals,
                "voteVector": input_value["voteVector"],
                "proofId": proof_id,
                "snarkjsProof": snarkjs_proof,
                "snarkjsPublicSignals": snarkjs_public_signals,
                "valid": valid,
                "error": None if valid else "Real Groth16 proof did not verify",
            }
        )
        return {
            "proofId": proof_id,
            "proofMode": "real",
            "publicSignals": public_signals,
            "proof": proof,
            "valid": valid,
            "message": (
                "Real Groth16 ZK proof generated and verified"
                if valid
                else "Real Groth16 ZK proof generation completed, but verification failed"
            ),
        }


def _read_real_proof(proof: Any) -> dict[str, Any] | None:
    if not isinstance(proof, dict):
        return None
    if (
        proof.get("protocol") != REAL_PROTOCOL
        or proof.get("proofMode") != "real"
        or not isinstance(proof.get("proofId"), str)
        or proof.get("circuitId") != REAL_CIRCUIT_ID
        or not isinstance(proof.get("generatedAt"), str)
        or not isinstance(proof.get("electionIdHash"), str)
        or proof.get("candidateCount") != REAL_CANDIDATE_COUNT
        or not _is_number_array(proof.get("voteVector"))
        or not isinstance(proof.get("voteVectorCommitment"), str)
        or "snarkjsProof" not in proof
        or not _is_string_array(proof.get("snarkjsPublicSignals"))
        or not isinstance(proof.get("artifactDirectory"), str)
        or not isinstance(proof.get("valid"), bool)
    ):
        return None
    return proof


def verify_real_zk_validity_proof(input_value: dict[str, Any]) -> dict[str, Any]:
    proof = _read_real_proof(input_value.get("proof"))
    if proof is None:
        return {"proofMode": "real", "verified": False, "message": "Real Groth16 ZK proof verification failed: invalid proof shape"}

    if not proof.get("snarkjsProof") or len(proof["snarkjsPublicSignals"]) == 0:
        return {
            "proofMode": "real",
            "verified": False,
            "message": proof.get("error") or "Real Groth16 ZK proof verification failed: proof was not generated",
        }

    artifact_status = get_real_zk_artifact_status()
    if not artifact_status["ready"]:
        return {"proofMode": "real", "verified": False, "message": _artifact_missing_message(artifact_status["missing"])}

    public_signals = input_value["publicSignals"]
    recomputed_commitment = _create_vote_vector_commitment(
        {
            "electionIdHash": public_signals["electionIdHash"],
            "candidateCount": public_signals["candidateCount"],
            "voteVector": proof["voteVector"],
        }
    )
    metadata_matches = (
        proof["electionIdHash"] == public_signals["electionIdHash"]
        and proof["candidateCount"] == public_signals["candidateCount"]
        and proof["voteVectorCommitment"] == public_signals["voteVectorCommitment"]
        and recomputed_commitment == public_signals["voteVectorCommitment"]
    )
    public_signals_match = _real_public_signals_match_vote_vector(proof["snarkjsPublicSignals"], proof["voteVector"])
    snark_verified = _verify_snark_proof({"snarkjsProof": proof["snarkjsProof"], "snarkjsPublicSignals": proof["snarkjsPublicSignals"]})
    verified = metadata_matches and public_signals_match and snark_verified
    return {
        "proofMode": "real",
        "verified": verified,
        "message": (
            "Real Groth16 ZK proof verification passed"
            if verified
            else "Real Groth16 ZK proof verification failed: proof, publicSignals, or metadata do not match"
        ),
    }


def _get_tally_artifacts() -> dict[str, Path]:
    return {
        "directory": TALLY_ARTIFACT_DIRECTORY,
        "wasmPath": TALLY_ARTIFACT_DIRECTORY / "tally_correctness_js" / "tally_correctness.wasm",
        "witnessGeneratorPath": TALLY_ARTIFACT_DIRECTORY / "tally_correctness_js" / "generate_witness.js",
        "zkeyPath": TALLY_ARTIFACT_DIRECTORY / "tally_correctness_final.zkey",
        "verificationKeyPath": TALLY_ARTIFACT_DIRECTORY / "verification_key.json",
    }


def get_tally_artifact_status() -> dict[str, Any]:
    artifacts = _get_tally_artifacts()
    required = [
        artifacts["wasmPath"],
        artifacts["witnessGeneratorPath"],
        artifacts["zkeyPath"],
        artifacts["verificationKeyPath"],
    ]
    missing = [str(path) for path in required if not path.exists()]
    return {"ready": not missing, "directory": str(artifacts["directory"]), "missing": missing}


def _validate_tally_request(input_value: dict[str, Any]) -> str | None:
    vote_vectors = input_value.get("voteVectors")
    tally = input_value.get("tally")
    if not isinstance(vote_vectors, list) or len(vote_vectors) != TALLY_BATCH_SIZE:
        return f"voteVectors must be an array of length {TALLY_BATCH_SIZE}"
    for row in vote_vectors:
        if not isinstance(row, list) or len(row) != TALLY_CANDIDATE_COUNT:
            return f"each ballot row must have {TALLY_CANDIDATE_COUNT} entries"
        if not all(isinstance(value, int) and not isinstance(value, bool) and value in (0, 1) for value in row):
            return "ballot entries must be 0 or 1"
        if sum(row) != 1:
            return "each ballot row must be one-hot (sum == 1)"
    if (
        not isinstance(tally, list)
        or len(tally) != TALLY_CANDIDATE_COUNT
        or not all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in tally)
    ):
        return f"tally must be {TALLY_CANDIDATE_COUNT} non-negative integers"
    column_sums = [0] * TALLY_CANDIDATE_COUNT
    for row in vote_vectors:
        for index, value in enumerate(row):
            column_sums[index] += value
    for index, value in enumerate(column_sums):
        if value != tally[index]:
            return f"tally[{index}] ({tally[index]}) does not match column sum ({value})"
    return None


def _create_tally_proof_shell(input_value: dict[str, Any]) -> dict[str, Any]:
    proof: dict[str, Any] = {
        "protocol": "verivote-tally-correctness-groth16-v1",
        "proofId": input_value["proofId"],
        "circuitId": TALLY_CIRCUIT_ID,
        "generatedAt": _iso_now(),
        "electionIdHash": input_value["publicSignals"]["electionIdHash"],
        "snarkjsProof": input_value.get("snarkjsProof"),
        "snarkjsPublicSignals": input_value.get("snarkjsPublicSignals") or [],
        "artifactDirectory": str(TALLY_ARTIFACT_DIRECTORY),
        "valid": input_value["valid"],
    }
    if input_value.get("error"):
        proof["error"] = input_value["error"]
    return proof


def create_tally_correctness_proof(input_value: dict[str, Any]) -> dict[str, Any]:
    public_signals = {
        "electionIdHash": _create_tally_election_id_hash(input_value["electionId"]),
        "tally": list(input_value["tally"]),
        "batchSize": TALLY_BATCH_SIZE,
        "circuitId": TALLY_CIRCUIT_ID,
    }
    proof_id = f"zkp_tally_{uuid.uuid4()}"
    validation_error = _validate_tally_request(input_value)
    if validation_error:
        proof = _create_tally_proof_shell(
            {
                "publicSignals": public_signals,
                "proofId": proof_id,
                "valid": False,
                "error": validation_error,
            }
        )
        return {"proofId": proof_id, "publicSignals": public_signals, "proof": proof, "valid": False, "message": validation_error}

    artifact_status = get_tally_artifact_status()
    if not artifact_status["ready"]:
        message = "Tally correctness artifacts not found. Run `pnpm zk:setup` to generate them."
        if artifact_status["missing"]:
            message += f" Missing: {', '.join(artifact_status['missing'])}"
        proof = _create_tally_proof_shell({"publicSignals": public_signals, "proofId": proof_id, "valid": False, "error": message})
        return {"proofId": proof_id, "publicSignals": public_signals, "proof": proof, "valid": False, "message": message}

    node = shutil.which("node")
    if node is None:
        message = "node runtime not found; tally correctness proof generation cannot run"
        proof = _create_tally_proof_shell({"publicSignals": public_signals, "proofId": proof_id, "valid": False, "error": message})
        return {"proofId": proof_id, "publicSignals": public_signals, "proof": proof, "valid": False, "message": message}

    artifacts = _get_tally_artifacts()
    with tempfile.TemporaryDirectory(prefix="verivote-zk-tally-") as temp_dir:
        temp_path = Path(temp_dir)
        input_path = temp_path / "input.json"
        witness_path = temp_path / "witness.wtns"
        proof_path = temp_path / "proof.json"
        public_path = temp_path / "public.json"
        _write_json_file(
            input_path,
            {
                "voteVector": input_value["voteVectors"],
                "tally": input_value["tally"],
                "batchSize": TALLY_BATCH_SIZE,
            },
        )
        witness_res = _run_command(
            node,
            [
                str(artifacts["witnessGeneratorPath"]),
                str(artifacts["wasmPath"]),
                str(input_path),
                str(witness_path),
            ],
            allow_failure=True,
        )
        if witness_res["exitCode"] != 0:
            error = "Tally correctness witness generation failed: voteVectors do not satisfy tally_correctness.circom constraints"
            return {
                "proofId": proof_id,
                "publicSignals": public_signals,
                "proof": _create_tally_proof_shell({"publicSignals": public_signals, "proofId": proof_id, "valid": False, "error": error}),
                "valid": False,
                "message": error,
            }

        prove_res = _run_snarkjs(
            ["groth16", "prove", str(artifacts["zkeyPath"]), str(witness_path), str(proof_path), str(public_path)],
            allow_failure=True,
        )
        if prove_res["exitCode"] != 0:
            error = "Tally correctness Groth16 prove failed"
            return {
                "proofId": proof_id,
                "publicSignals": public_signals,
                "proof": _create_tally_proof_shell({"publicSignals": public_signals, "proofId": proof_id, "valid": False, "error": error}),
                "valid": False,
                "message": error,
            }

        snarkjs_proof = _read_json_file(proof_path)
        snarkjs_public_signals = _read_json_file(public_path)
        if not _is_string_array(snarkjs_public_signals):
            error = "Tally correctness prove produced invalid public signals"
            return {
                "proofId": proof_id,
                "publicSignals": public_signals,
                "proof": _create_tally_proof_shell({"publicSignals": public_signals, "proofId": proof_id, "snarkjsProof": snarkjs_proof, "valid": False, "error": error}),
                "valid": False,
                "message": error,
            }

        verify_res = _run_snarkjs(
            ["groth16", "verify", str(artifacts["verificationKeyPath"]), str(public_path), str(proof_path)],
            allow_failure=True,
        )
        verified = verify_res["exitCode"] == 0
        return {
            "proofId": proof_id,
            "publicSignals": public_signals,
            "proof": _create_tally_proof_shell(
                {
                    "publicSignals": public_signals,
                    "proofId": proof_id,
                    "snarkjsProof": snarkjs_proof,
                    "snarkjsPublicSignals": snarkjs_public_signals,
                    "valid": verified,
                    "error": None if verified else "Self-verification failed",
                }
            ),
            "valid": verified,
            "message": (
                "Tally correctness proof generated and verified."
                if verified
                else "Tally correctness proof generation completed, but verification failed."
            ),
        }


def verify_tally_correctness_proof(input_value: dict[str, Any]) -> dict[str, Any]:
    proof = input_value.get("proof")
    if not isinstance(proof, dict):
        return {"verified": False, "message": "invalid proof shape"}
    if (
        proof.get("protocol") != "verivote-tally-correctness-groth16-v1"
        or proof.get("circuitId") != TALLY_CIRCUIT_ID
        or not proof.get("snarkjsProof")
        or not _is_string_array(proof.get("snarkjsPublicSignals"))
        or not isinstance(proof.get("electionIdHash"), str)
    ):
        return {"verified": False, "message": "invalid proof payload"}
    if proof["electionIdHash"] != input_value["publicSignals"].get("electionIdHash"):
        return {"verified": False, "message": "publicSignals.electionIdHash does not match the proof's electionIdHash"}

    artifact_status = get_tally_artifact_status()
    if not artifact_status["ready"]:
        return {
            "verified": False,
            "message": f"Tally correctness artifacts not found. Missing: {', '.join(artifact_status['missing'])}",
        }

    artifacts = _get_tally_artifacts()
    with tempfile.TemporaryDirectory(prefix="verivote-zk-tally-verify-") as temp_dir:
        temp_path = Path(temp_dir)
        proof_path = temp_path / "proof.json"
        public_path = temp_path / "public.json"
        _write_json_file(proof_path, proof["snarkjsProof"])
        _write_json_file(public_path, proof["snarkjsPublicSignals"])
        verify_res = _run_snarkjs(
            ["groth16", "verify", str(artifacts["verificationKeyPath"]), str(public_path), str(proof_path)],
            allow_failure=True,
        )
        verified = verify_res["exitCode"] == 0
        return {
            "verified": verified,
            "message": "Tally correctness proof verified." if verified else "Tally correctness proof verification failed.",
        }


def encode_tally_solidity_calldata(proof: Any) -> dict[str, Any]:
    if (
        not isinstance(proof, dict)
        or proof.get("protocol") != "verivote-tally-correctness-groth16-v1"
        or proof.get("circuitId") != TALLY_CIRCUIT_ID
        or not isinstance(proof.get("snarkjsProof"), dict)
        or not _is_string_array(proof.get("snarkjsPublicSignals"))
    ):
        raise ValueError("encodeTallySolidityCalldata: invalid tally proof payload")

    snarkjs_proof = proof["snarkjsProof"]

    def to_scalar(value: Any) -> str:
        if isinstance(value, bool):
            raise ValueError("encodeTallySolidityCalldata: expected numeric scalar")
        if isinstance(value, (str, int, float)):
            return str(int(value))
        raise ValueError("encodeTallySolidityCalldata: expected numeric scalar")

    pi_a = snarkjs_proof.get("pi_a")
    pi_b = snarkjs_proof.get("pi_b")
    pi_c = snarkjs_proof.get("pi_c")
    if not isinstance(pi_a, list) or len(pi_a) < 2 or not isinstance(pi_b, list) or len(pi_b) < 2 or not isinstance(pi_c, list) or len(pi_c) < 2:
        raise ValueError("encodeTallySolidityCalldata: snarkjs proof shape invalid")
    if not isinstance(pi_b[0], list) or len(pi_b[0]) < 2 or not isinstance(pi_b[1], list) or len(pi_b[1]) < 2:
        raise ValueError("encodeTallySolidityCalldata: pi_b shape invalid")

    input_signals = [str(int(signal)) for signal in proof["snarkjsPublicSignals"]]
    if len(input_signals) != TALLY_CANDIDATE_COUNT + 1:
        raise ValueError(
            f"encodeTallySolidityCalldata: expected {TALLY_CANDIDATE_COUNT + 1} public signals, got {len(input_signals)}"
        )

    return {
        "a": [to_scalar(pi_a[0]), to_scalar(pi_a[1])],
        "b": [[to_scalar(pi_b[0][1]), to_scalar(pi_b[0][0])], [to_scalar(pi_b[1][1]), to_scalar(pi_b[1][0])]],
        "c": [to_scalar(pi_c[0]), to_scalar(pi_c[1])],
        "input": input_signals,
    }
