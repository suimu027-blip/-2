from __future__ import annotations

import copy
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .crypto import (
    create_audit_hash,
    create_commitment,
    create_merkle_leaf,
    create_pedersen_commitment,
    create_pedersen_context,
    create_receipt_chain_hash,
    create_receipt_code,
    create_vote_token_hash,
    create_vote_vector,
    export_pedersen_context,
    get_merkle_proof,
    get_merkle_root,
    hash_receipt_code,
    hash_text,
    js_json_dumps,
    random_hex,
    verify_aggregate_opening,
    verify_commitment_opening,
    verify_merkle_proof,
    verify_pedersen_opening,
    verify_receipt_chain,
)
from .persistence import PersistenceAdapter, create_persistence_adapter
from .zk import (
    TALLY_BATCH_SIZE,
    TALLY_CANDIDATE_COUNT,
    create_real_zk_validity_proof,
    create_tally_correctness_proof,
    create_zk_validity_proof,
    encode_tally_solidity_calldata,
    verify_real_zk_validity_proof,
    verify_tally_correctness_proof,
    verify_zk_validity_proof,
)


app = FastAPI(title="VeriVote API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

users: list[dict[str, Any]] = []
elections: list[dict[str, Any]] = []
candidates: list[dict[str, Any]] = []
votes: list[dict[str, Any]] = []
pending_ballots: list[dict[str, Any]] = []
challenge_records: list[dict[str, Any]] = []
bulletin_boards: list[dict[str, Any]] = []
aggregator_reports: list[dict[str, Any]] = []
attack_logs: list[dict[str, Any]] = []
blockchain_audit_records: dict[str, dict[str, Any]] = {}

counters: dict[str, int] = {
    "user": 0,
    "election": 0,
    "candidate": 0,
    "vote": 0,
    "pendingBallot": 0,
    "challengeRecord": 0,
    "attack": 0,
}

MOCK_CONTRACT_ADDRESS = "local-mock:VeriVoteAudit"
MOCK_SUBMITTER = "local-mock-submit-service"

persistence: PersistenceAdapter | None = None


def json_response(content: Any, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=content, status_code=status_code)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def persist_counters() -> None:
    if persistence is not None:
        persistence.save_counters(counters.copy())


def create_id(prefix: str) -> str:
    counters[prefix] += 1
    persist_counters()
    return f"{prefix}_{counters[prefix]}"


def is_number_array(value: Any) -> bool:
    return isinstance(value, list) and all(
        isinstance(item, (int, float)) and not isinstance(item, bool) for item in value
    )


def is_integer_array(value: Any) -> bool:
    return isinstance(value, list) and all(
        isinstance(item, int) and not isinstance(item, bool) for item in value
    )


def is_integer_matrix(value: Any) -> bool:
    return isinstance(value, list) and all(is_integer_array(row) for row in value)


def is_zk_public_signals(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("electionIdHash"), str)
        and isinstance(value.get("candidateCount"), int)
        and not isinstance(value.get("candidateCount"), bool)
        and value["candidateCount"] > 0
        and isinstance(value.get("voteVectorCommitment"), str)
    )


def find_election(election_id: str) -> dict[str, Any] | None:
    return next((election for election in elections if election["id"] == election_id), None)


def get_candidates_for_election(election_id: str) -> list[dict[str, Any]]:
    return [candidate for candidate in candidates if candidate["electionId"] == election_id]


def find_bulletin_board(election_id: str) -> dict[str, Any] | None:
    return next((bulletin for bulletin in bulletin_boards if bulletin["electionId"] == election_id), None)


def find_aggregator_report(election_id: str) -> dict[str, Any] | None:
    return next((report for report in aggregator_reports if report["electionId"] == election_id), None)


def find_first_vote(election_id: str) -> dict[str, Any] | None:
    return next((vote for vote in votes if vote["electionId"] == election_id), None)


def get_unknown_error_message(error: BaseException) -> str:
    return str(error) or "unknown error"


def get_blockchain_audit_mode() -> str:
    return "hardhat" if os.environ.get("BLOCKCHAIN_AUDIT_MODE") == "hardhat" else "local-mock"


def get_audit_contract_address() -> str:
    return os.environ.get("AUDIT_CONTRACT_ADDRESS") or os.environ.get("VERIVOTE_AUDIT_CONTRACT_ADDRESS") or ""


def get_displayed_contract_address(mode: str) -> str:
    return MOCK_CONTRACT_ADDRESS if mode == "local-mock" else get_audit_contract_address()


def to_bytes32_hex(value: str) -> str:
    normalized = value.strip().lower()
    if re.fullmatch(r"0x[0-9a-f]{64}", normalized):
        return normalized
    if re.fullmatch(r"[0-9a-f]{64}", normalized):
        return f"0x{normalized}"
    return f"0x{hash_text(value)}"


def create_tally_hash(report: dict[str, Any]) -> str:
    return create_audit_hash(report["tallyResult"])


def create_blockchain_audit_fields(
    election_id: str,
    bulletin: dict[str, Any],
    report: dict[str, Any],
) -> dict[str, Any]:
    return {
        "electionId": election_id,
        "electionIdHash": to_bytes32_hex(election_id),
        "merkleRoot": to_bytes32_hex(bulletin["merkleRoot"]),
        "commitmentRoot": to_bytes32_hex(report["commitmentRoot"]),
        "receiptRoot": to_bytes32_hex(report["receiptRoot"]),
        "auditHash": to_bytes32_hex(report["auditHash"]),
        "tallyHash": to_bytes32_hex(create_tally_hash(report)),
    }


def create_mock_transaction_hash(fields: dict[str, Any], created_at: str) -> str:
    payload = {**fields, "createdAt": created_at}
    return f"0x{hash_text(js_json_dumps(payload))}"


def create_audit_record_from_chain(
    election_id: str,
    chain_record: Any,
    transaction_hash: str,
    contract_address: str,
) -> dict[str, Any]:
    if isinstance(chain_record, dict):
        created_at = int(chain_record.get("createdAt", 0))
        return {
            "electionId": election_id,
            "electionIdHash": chain_record["electionId"],
            "merkleRoot": chain_record["merkleRoot"],
            "commitmentRoot": chain_record["commitmentRoot"],
            "receiptRoot": chain_record["receiptRoot"],
            "auditHash": chain_record["auditHash"],
            "tallyHash": chain_record["tallyHash"],
            "transactionHash": transaction_hash,
            "contractAddress": contract_address,
            "auditMode": "hardhat",
            "createdAt": datetime.fromtimestamp(created_at, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            if created_at
            else now(),
            "submitter": chain_record.get("submitter", ""),
            "zkVerified": bool(chain_record.get("zkVerified", False)),
            "status": "submitted",
        }

    created_at = int(chain_record[6]) if len(chain_record) > 6 else 0
    return {
        "electionId": election_id,
        "electionIdHash": chain_record[0],
        "merkleRoot": chain_record[1],
        "commitmentRoot": chain_record[2],
        "receiptRoot": chain_record[3],
        "auditHash": chain_record[4],
        "tallyHash": chain_record[5],
        "transactionHash": transaction_hash,
        "contractAddress": contract_address,
        "auditMode": "hardhat",
        "createdAt": datetime.fromtimestamp(created_at, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if created_at
        else now(),
        "submitter": chain_record[7] if len(chain_record) > 7 else "",
        "zkVerified": bool(chain_record[8]) if len(chain_record) > 8 else False,
        "status": "submitted",
    }


def get_hardhat_contract() -> tuple[Any, str, Any, str]:
    contract_address = get_audit_contract_address()
    if not contract_address:
        raise RuntimeError("Hardhat audit mode requires AUDIT_CONTRACT_ADDRESS or VERIVOTE_AUDIT_CONTRACT_ADDRESS")

    try:
        from web3 import Web3
    except ImportError as exc:
        raise RuntimeError("Hardhat audit mode requires the Python package `web3`") from exc

    rpc_url = os.environ.get("HARDHAT_RPC_URL", "http://127.0.0.1:8545")
    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise RuntimeError(f"Could not connect to Hardhat RPC at {rpc_url}")

    abi = [
        {
            "inputs": [
                {"internalType": "bytes32", "name": "electionId", "type": "bytes32"},
                {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
                {"internalType": "bytes32", "name": "commitmentRoot", "type": "bytes32"},
                {"internalType": "bytes32", "name": "receiptRoot", "type": "bytes32"},
                {"internalType": "bytes32", "name": "auditHash", "type": "bytes32"},
                {"internalType": "bytes32", "name": "tallyHash", "type": "bytes32"},
            ],
            "name": "submitAudit",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function",
        },
        {
            "inputs": [
                {"internalType": "bytes32", "name": "electionId", "type": "bytes32"},
                {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
                {"internalType": "bytes32", "name": "commitmentRoot", "type": "bytes32"},
                {"internalType": "bytes32", "name": "receiptRoot", "type": "bytes32"},
                {"internalType": "bytes32", "name": "auditHash", "type": "bytes32"},
                {"internalType": "bytes32", "name": "tallyHash", "type": "bytes32"},
                {"internalType": "uint256[2]", "name": "a", "type": "uint256[2]"},
                {"internalType": "uint256[2][2]", "name": "b", "type": "uint256[2][2]"},
                {"internalType": "uint256[2]", "name": "c", "type": "uint256[2]"},
                {"internalType": "uint256[5]", "name": "input", "type": "uint256[5]"},
            ],
            "name": "submitAuditWithTallyProof",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function",
        },
        {
            "inputs": [{"internalType": "bytes32", "name": "electionId", "type": "bytes32"}],
            "name": "getAudit",
            "outputs": [
                {
                    "components": [
                        {"internalType": "bytes32", "name": "electionId", "type": "bytes32"},
                        {"internalType": "bytes32", "name": "merkleRoot", "type": "bytes32"},
                        {"internalType": "bytes32", "name": "commitmentRoot", "type": "bytes32"},
                        {"internalType": "bytes32", "name": "receiptRoot", "type": "bytes32"},
                        {"internalType": "bytes32", "name": "auditHash", "type": "bytes32"},
                        {"internalType": "bytes32", "name": "tallyHash", "type": "bytes32"},
                        {"internalType": "uint256", "name": "createdAt", "type": "uint256"},
                        {"internalType": "address", "name": "submitter", "type": "address"},
                        {"internalType": "bool", "name": "zkVerified", "type": "bool"},
                        {"internalType": "bool", "name": "exists", "type": "bool"},
                    ],
                    "internalType": "struct VeriVoteAudit.AuditRecord",
                    "name": "",
                    "type": "tuple",
                }
            ],
            "stateMutability": "view",
            "type": "function",
        },
        {
            "inputs": [{"internalType": "bytes32", "name": "electionId", "type": "bytes32"}],
            "name": "hasAudit",
            "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
            "stateMutability": "view",
            "type": "function",
        },
    ]
    contract = web3.eth.contract(address=web3.to_checksum_address(contract_address), abi=abi)
    private_key = os.environ.get("HARDHAT_PRIVATE_KEY")
    if private_key:
        account = web3.eth.account.from_key(private_key)
        return contract, contract_address, web3, account.address
    return contract, contract_address, web3, web3.eth.accounts[0]


def transact_contract(web3: Any, function_call: Any, from_address: str) -> Any:
    private_key = os.environ.get("HARDHAT_PRIVATE_KEY")
    if private_key:
        nonce = web3.eth.get_transaction_count(from_address)
        tx = function_call.build_transaction({"from": from_address, "nonce": nonce})
        signed = web3.eth.account.sign_transaction(tx, private_key)
        raw_transaction = getattr(signed, "rawTransaction", None) or getattr(
            signed, "raw_transaction"
        )
        tx_hash = web3.eth.send_raw_transaction(raw_transaction)
    else:
        tx_hash = function_call.transact({"from": from_address})
    return web3.eth.wait_for_transaction_receipt(tx_hash)


def save_user(user: dict[str, Any]) -> None:
    users.append(user)
    persistence and persistence.save_user(user)


def save_election(election: dict[str, Any]) -> None:
    persistence and persistence.save_election(election)


def add_election(election: dict[str, Any]) -> None:
    elections.append(election)
    persistence and persistence.save_election(election)


def add_candidate(candidate: dict[str, Any]) -> None:
    candidates.append(candidate)
    persistence and persistence.save_candidate(candidate)


def save_vote(vote: dict[str, Any]) -> None:
    persistence and persistence.save_vote(vote)


def add_vote(vote: dict[str, Any]) -> None:
    votes.append(vote)
    persistence and persistence.save_vote(vote)


def delete_vote(vote: dict[str, Any]) -> None:
    votes.remove(vote)
    persistence and persistence.delete_vote(vote["id"])


def add_pending_ballot(pending: dict[str, Any]) -> None:
    pending_ballots.append(pending)
    persistence and persistence.save_pending_ballot(pending)


def save_pending_ballot(pending: dict[str, Any]) -> None:
    persistence and persistence.save_pending_ballot(pending)


def add_challenge_record(record: dict[str, Any]) -> None:
    challenge_records.append(record)
    persistence and persistence.save_challenge_record(record)


def add_bulletin_board(board: dict[str, Any]) -> None:
    bulletin_boards.append(board)
    persistence and persistence.save_bulletin_board(board)


def create_attack_log(
    election_id: str,
    attack_type: str,
    description: str,
    before: Any,
    after: Any,
) -> dict[str, Any]:
    log = {
        "id": create_id("attack"),
        "electionId": election_id,
        "type": attack_type,
        "description": description,
        "before": before,
        "after": after,
        "createdAt": now(),
    }
    attack_logs.append(log)
    persistence and persistence.save_attack_log(log)
    return log


def save_blockchain_audit_record(election_id: str, audit: dict[str, Any]) -> None:
    blockchain_audit_records[election_id] = audit
    persistence and persistence.save_blockchain_audit_record(audit)


def create_election_result(election_id: str) -> dict[str, Any]:
    election_votes = [vote for vote in votes if vote["electionId"] == election_id]
    return create_election_result_from_votes(election_id, election_votes)


def create_election_result_from_votes(election_id: str, election_votes: list[dict[str, Any]]) -> dict[str, Any]:
    election_candidates = get_candidates_for_election(election_id)
    return {
        "electionId": election_id,
        "totalVotes": len(election_votes),
        "results": [
            {
                "candidateId": candidate["id"],
                "candidateName": candidate["name"],
                "voteCount": len([vote for vote in election_votes if vote["candidateId"] == candidate["id"]]),
            }
            for candidate in election_candidates
        ],
    }


def get_last_receipt_chain_vote(election_id: str) -> dict[str, Any] | None:
    election_votes = [vote for vote in votes if vote["electionId"] == election_id]
    if not election_votes:
        return None
    return sorted(
        election_votes,
        key=lambda vote: (
            vote.get("receiptChainIndex") if isinstance(vote.get("receiptChainIndex"), int) else -1,
            vote.get("createdAt", ""),
        ),
    )[-1]


def append_vote_with_receipt_chain(vote_without_chain: dict[str, Any]) -> dict[str, Any]:
    previous_vote = get_last_receipt_chain_vote(vote_without_chain["electionId"])
    receipt_chain_index = (
        previous_vote["receiptChainIndex"] + 1
        if previous_vote is not None and isinstance(previous_vote.get("receiptChainIndex"), int)
        else len([vote for vote in votes if vote["electionId"] == vote_without_chain["electionId"]])
    )
    previous_receipt_code_hash = hash_receipt_code(previous_vote["receiptCode"]) if previous_vote else None
    receipt_chain_hash = create_receipt_chain_hash(
        {
            "electionId": vote_without_chain["electionId"],
            "receiptCode": vote_without_chain["receiptCode"],
            "previousReceiptCodeHash": previous_receipt_code_hash,
            "receiptChainIndex": receipt_chain_index,
            "commitment": vote_without_chain["commitment"],
        }
    )
    vote = {
        **vote_without_chain,
        "receiptChainIndex": receipt_chain_index,
        "previousReceiptCodeHash": previous_receipt_code_hash,
        "receiptChainHash": receipt_chain_hash,
    }
    add_vote(vote)
    return vote


def get_receipt_chain_records(election_votes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sorted_votes = sorted(
        election_votes,
        key=lambda vote: (
            vote.get("receiptChainIndex") if isinstance(vote.get("receiptChainIndex"), int) else 9007199254740991,
            vote.get("createdAt", ""),
        ),
    )
    return [
        {
            "voteId": vote["id"],
            "receiptCodeHash": hash_receipt_code(vote["receiptCode"]),
            "commitment": vote["commitment"],
            "receiptChainIndex": vote.get("receiptChainIndex", -1),
            "previousReceiptCodeHash": vote.get("previousReceiptCodeHash"),
            "receiptChainHash": vote.get("receiptChainHash", ""),
        }
        for vote in sorted_votes
    ]


def save_aggregator_report(report: dict[str, Any]) -> None:
    for index, current_report in enumerate(aggregator_reports):
        if current_report["electionId"] == report["electionId"]:
            aggregator_reports[index] = report
            persistence and persistence.save_aggregator_report(report)
            return
    aggregator_reports.append(report)
    persistence and persistence.save_aggregator_report(report)


def create_aggregator_report(election_id: str) -> dict[str, Any]:
    election_votes = [vote for vote in votes if vote["electionId"] == election_id]
    valid_candidate_ids = {candidate["id"] for candidate in get_candidates_for_election(election_id)}
    seen_token_hashes: set[str] = set()
    duplicate_token_hashes: list[str] = []
    duplicate_token_hashes_seen: set[str] = set()
    vote_token_hashes: list[str] = []
    valid_vote_records: list[dict[str, Any]] = []
    invalid_votes = 0
    duplicate_votes = 0

    for vote in election_votes:
        vote_token_hash = create_vote_token_hash(election_id, vote["userId"])
        vote_token_hashes.append(vote_token_hash)
        is_duplicate = vote_token_hash in seen_token_hashes
        if is_duplicate:
            duplicate_votes += 1
            if vote_token_hash not in duplicate_token_hashes_seen:
                duplicate_token_hashes.append(vote_token_hash)
                duplicate_token_hashes_seen.add(vote_token_hash)
        else:
            seen_token_hashes.add(vote_token_hash)

        has_valid_candidate = vote["candidateId"] in valid_candidate_ids
        if not has_valid_candidate:
            invalid_votes += 1
        if not is_duplicate and has_valid_candidate:
            valid_vote_records.append(vote)

    tally_result = create_election_result_from_votes(election_id, valid_vote_records)
    commitment_root = get_merkle_root([vote["commitment"] for vote in valid_vote_records])
    receipt_root = get_merkle_root([vote["receiptCode"] for vote in valid_vote_records])
    receipt_chain_verification = verify_receipt_chain(election_votes)

    pedersen_tally_verified: bool | None = None
    pedersen_tally_message: str | None = None
    pedersen_context_hash: str | None = None
    try:
        candidate_count = len(get_candidates_for_election(election_id))
        if candidate_count > 0 and valid_vote_records:
            pedersen_context = create_pedersen_context(election_id, candidate_count)
            pedersen_context_hash = pedersen_context.context_hash
            verification = verify_aggregate_opening(
                pedersen_context,
                [
                    {
                        "voteVector": vote["voteVector"],
                        "randomness": vote["randomness"],
                        "commitment": vote["commitment"],
                    }
                    for vote in valid_vote_records
                ],
            )
            pedersen_tally_verified = verification["verified"]
            pedersen_tally_message = (
                "Pedersen homomorphic tally verification passed."
                if verification["verified"]
                else "Pedersen homomorphic tally verification failed; aggregate data may have been tampered."
            )
    except Exception:
        pedersen_tally_message = "Pedersen homomorphic tally verification threw an exception."

    core_fields: dict[str, Any] = {
        "electionId": election_id,
        "totalVotes": len(election_votes),
        "validVotes": len(valid_vote_records),
        "invalidVotes": invalid_votes,
        "duplicateVotes": duplicate_votes,
        "receiptChainVerified": receipt_chain_verification["verified"],
        "receiptChainBreaks": receipt_chain_verification["breaks"],
        "voteTokenHashes": vote_token_hashes,
        "duplicateTokenHashes": duplicate_token_hashes,
        "tallyResult": tally_result,
        "commitmentRoot": commitment_root,
        "receiptRoot": receipt_root,
    }
    if pedersen_tally_verified is not None:
        core_fields["pedersenTallyVerified"] = pedersen_tally_verified
    if pedersen_tally_message is not None:
        core_fields["pedersenTallyMessage"] = pedersen_tally_message
    if pedersen_context_hash is not None:
        core_fields["pedersenContextHash"] = pedersen_context_hash

    return {**core_fields, "auditHash": create_audit_hash(core_fields), "createdAt": now()}


def create_audit_hash_for_aggregator_report(report: dict[str, Any]) -> str:
    core_fields = {key: value for key, value in report.items() if key not in {"auditHash", "createdAt"}}
    return create_audit_hash(core_fields)


def get_tally_consistency(election_id: str, report: dict[str, Any]) -> dict[str, Any]:
    expected_tally = create_aggregator_report(election_id)["tallyResult"]
    tally_consistent = js_json_dumps(report["tallyResult"]) == js_json_dumps(expected_tally)
    return {
        "tallyConsistent": tally_consistent,
        "consistencyMessage": (
            "tallyResult matches a fresh aggregation from current votes."
            if tally_consistent
            else "tallyResult does not match a fresh aggregation from current votes; tally may be tampered."
        ),
    }


def create_bulletin_board(election_id: str) -> dict[str, Any]:
    election_votes = [vote for vote in votes if vote["electionId"] == election_id]
    commitments = [vote["commitment"] for vote in election_votes]
    receipt_code_hashes = [hash_receipt_code(vote["receiptCode"]) for vote in election_votes]
    receipt_chain_verification = verify_receipt_chain(election_votes)
    leaves = [create_merkle_leaf(vote["id"], vote["commitment"], vote["receiptCode"]) for vote in election_votes]
    return {
        "electionId": election_id,
        "commitments": commitments,
        "receiptCodeHashes": receipt_code_hashes,
        "receiptChain": get_receipt_chain_records(election_votes),
        "receiptChainVerified": receipt_chain_verification["verified"],
        "receiptChainBreaks": receipt_chain_verification["breaks"],
        "leaves": leaves,
        "merkleRoot": get_merkle_root(leaves),
        "tallyResult": create_election_result(election_id),
        "totalVotes": len(election_votes),
        "createdAt": now(),
    }


def get_attack_target(election_id: str) -> dict[str, Any]:
    election = find_election(election_id)
    if election is None:
        return {"status": 404, "error": "Election does not exist; attack demo cannot run."}
    first_vote = find_first_vote(election["id"])
    if first_vote is None:
        return {"status": 409, "error": "This election has no votes; attack demo cannot run."}
    return {"election": election, "firstVote": first_vote}


def build_public_inputs_artifact(election_detail: dict[str, Any], bulletin: dict[str, Any], report: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "electionId": election_detail["id"],
        "electionIdHash": to_bytes32_hex(election_detail["id"]),
        "candidateCount": len(election_detail["candidates"]),
        "totalVotes": bulletin["totalVotes"],
        "validVotes": report["validVotes"] if report else bulletin["totalVotes"],
        "merkleRoot": bulletin["merkleRoot"],
        "commitmentRoot": report["commitmentRoot"] if report else "",
        "receiptRoot": report["receiptRoot"] if report else "",
        "tallyHash": create_tally_hash(report) if report else "",
        "auditHash": report["auditHash"] if report else "",
        "zkCircuitId": "valid-vote-4",
    }


def build_artifact_context(election: dict[str, Any]) -> dict[str, Any]:
    detail = {**election, "candidates": get_candidates_for_election(election["id"])}
    bulletin = find_bulletin_board(election["id"]) or create_bulletin_board(election["id"])
    report = find_aggregator_report(election["id"])
    tally_consistency = (
        get_tally_consistency(election["id"], report)
        if report
        else {
            "tallyConsistent": False,
            "consistencyMessage": "AggregatorReport has not been generated yet.",
        }
    )
    audit_mode = get_blockchain_audit_mode()
    public_inputs = build_public_inputs_artifact(detail, bulletin, report)
    aggregator_report_artifact = (
        {**report, **tally_consistency}
        if report
        else None
    )
    return {
        "election": election,
        "detail": detail,
        "bulletin": bulletin,
        "report": report,
        "tallyConsistency": tally_consistency,
        "auditRecord": blockchain_audit_records.get(election["id"]),
        "auditMode": audit_mode,
        "challenges": [record for record in challenge_records if record["electionId"] == election["id"]],
        "publicInputs": public_inputs,
        "aggregatorReportArtifact": aggregator_report_artifact,
    }


def build_export_bundle(context: dict[str, Any]) -> dict[str, Any]:
    bundle_payload = {
        "election": context["detail"],
        "publicInputs": context["publicInputs"],
        "bulletinBoard": context["bulletin"],
        "aggregatorReport": context["aggregatorReportArtifact"],
        "zkSummary": {
            "proofMode": None,
            "circuitId": "valid-vote-4",
            "proofGenerated": False,
            "publicSignals": None,
            "message": "No ZK proof is embedded in this export bundle; generate one separately and merge it if needed.",
        },
        "chainAudit": {
            "auditMode": context["auditMode"],
            "contractAddress": get_displayed_contract_address(context["auditMode"]),
            "hasAudit": context["auditRecord"] is not None,
            "audit": context["auditRecord"],
        },
        "challengeRecords": context["challenges"],
    }
    return {
        "envelope": {
            "schemaVersion": "verivote.artifact.v1",
            "generatedAt": now(),
            "electionId": context["election"]["id"],
            "bundleHash": hash_text(js_json_dumps(bundle_payload)),
        },
        **bundle_payload,
    }


def artifact_response(filename: str, payload: Any) -> Response:
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "verivote-api"}


@app.post("/zk/prove-vote-validity")
def prove_vote_validity(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    election_id = clean(payload.get("electionId"))
    proof_mode = payload.get("proofMode", "mock")
    if not election_id:
        return json_response({"error": "electionId cannot be empty"}, 400)
    if proof_mode not in {"mock", "real"}:
        return json_response({"error": "proofMode must be mock or real"}, 400)
    if not is_number_array(payload.get("voteVector")):
        return json_response({"error": "voteVector must be number[]"}, 400)
    if (
        not isinstance(payload.get("candidateCount"), int)
        or isinstance(payload.get("candidateCount"), bool)
        or payload["candidateCount"] <= 0
    ):
        return json_response({"error": "candidateCount must be a positive integer"}, 400)
    try:
        result = (
            create_real_zk_validity_proof(
                {
                    "electionId": election_id,
                    "voteVector": payload["voteVector"],
                    "candidateCount": payload["candidateCount"],
                    "proofMode": proof_mode,
                }
            )
            if proof_mode == "real"
            else create_zk_validity_proof(
                {
                    "electionId": election_id,
                    "voteVector": payload["voteVector"],
                    "candidateCount": payload["candidateCount"],
                    "proofMode": proof_mode,
                }
            )
        )
        return json_response(result)
    except Exception as error:
        return json_response({"error": f"ZK proof generation failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/zk/verify-vote-validity")
def verify_vote_validity(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    proof_mode = payload.get("proofMode")
    if proof_mode is not None and proof_mode not in {"mock", "real"}:
        return json_response({"error": "proofMode must be mock or real"}, 400)
    if not is_zk_public_signals(payload.get("publicSignals")):
        return json_response({"error": "publicSignals shape is invalid"}, 400)
    try:
        result = (
            verify_real_zk_validity_proof(payload)
            if proof_mode == "real"
            else verify_zk_validity_proof(payload)
        )
        return json_response(result)
    except Exception as error:
        return json_response({"error": f"ZK proof verification failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/zk/prove-tally-correctness")
def prove_tally_correctness(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    election_id = clean(payload.get("electionId"))
    if not election_id:
        return json_response({"error": "electionId cannot be empty"}, 400)
    if not is_integer_matrix(payload.get("voteVectors")):
        return json_response({"error": "voteVectors must be an integer matrix"}, 400)
    if not is_integer_array(payload.get("tally")):
        return json_response({"error": "tally must be an integer array"}, 400)
    if len(payload["voteVectors"]) != TALLY_BATCH_SIZE:
        return json_response({"error": f"voteVectors must contain exactly {TALLY_BATCH_SIZE} ballots"}, 400)
    if len(payload["tally"]) != TALLY_CANDIDATE_COUNT:
        return json_response({"error": f"tally length must equal {TALLY_CANDIDATE_COUNT}"}, 400)
    try:
        return json_response(
            create_tally_correctness_proof(
                {
                    "electionId": election_id,
                    "voteVectors": payload["voteVectors"],
                    "tally": payload["tally"],
                }
            )
        )
    except Exception as error:
        return json_response({"error": f"Tally proof generation failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/zk/verify-tally-correctness")
def verify_tally_correctness(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    if not isinstance(payload.get("publicSignals"), dict):
        return json_response({"error": "publicSignals is required"}, 400)
    try:
        return json_response(verify_tally_correctness_proof(payload))
    except Exception as error:
        return json_response({"error": f"Tally proof verification failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/users/register")
def register_user(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    name = clean(payload.get("name"))
    if not name:
        return json_response({"error": "User name cannot be empty"}, 400)
    user = {"id": create_id("user"), "name": name, "createdAt": now()}
    save_user(user)
    return json_response({"user": user, "userId": user["id"]}, 201)


@app.post("/elections")
def create_election(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    title = clean(payload.get("title"))
    description = clean(payload.get("description"))
    if not title:
        return json_response({"error": "Election title cannot be empty"}, 400)
    election = {
        "id": create_id("election"),
        "title": title,
        "description": description,
        "status": "active",
        "createdAt": now(),
    }
    add_election(election)
    return json_response({"election": election}, 201)


@app.get("/elections")
def list_elections() -> dict[str, Any]:
    return {"elections": elections}


@app.get("/elections/{election_id}")
def get_election(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    return json_response({"election": {**election, "candidates": get_candidates_for_election(election["id"])}})


@app.post("/elections/{election_id}/finalize")
def finalize_election(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    existing_bulletin = find_bulletin_board(election["id"])
    election["status"] = "finalized"
    save_election(election)
    if existing_bulletin:
        return json_response({"election": election, "bulletin": existing_bulletin})
    bulletin = create_bulletin_board(election["id"])
    add_bulletin_board(bulletin)
    return json_response({"election": election, "bulletin": bulletin}, 201)


@app.get("/elections/{election_id}/bulletin")
def get_bulletin(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    bulletin = find_bulletin_board(election["id"]) or create_bulletin_board(election["id"])
    return json_response({"election": election, "bulletin": bulletin})


@app.post("/aggregator/elections/{election_id}/run")
def run_aggregator(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; aggregator cannot run"}, 404)
    had_existing_report = find_aggregator_report(election["id"]) is not None
    report = create_aggregator_report(election["id"])
    save_aggregator_report(report)
    return json_response({"election": election, "report": report}, 200 if had_existing_report else 201)


@app.get("/aggregator/elections/{election_id}/report")
def get_aggregator_report(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; aggregator report cannot be viewed"}, 404)
    report = find_aggregator_report(election["id"])
    if not report:
        return json_response({"error": "Aggregator report has not been generated"}, 404)
    return json_response({"election": election, "report": report, **get_tally_consistency(election["id"], report)})


@app.post("/challenge/elections/{election_id}/prepare")
def prepare_challenge_ballot(election_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; cannot prepare challenge ballot"}, 404)
    if election["status"] != "active":
        return json_response({"error": "Election is not active; cannot prepare challenge ballot"}, 409)
    user_id = clean(payload.get("userId"))
    candidate_id = clean(payload.get("candidateId"))
    if not user_id:
        return json_response({"error": "userId cannot be empty"}, 400)
    user = next((current_user for current_user in users if current_user["id"] == user_id), None)
    if not user:
        return json_response({"error": "User does not exist"}, 404)
    if not candidate_id:
        return json_response({"error": "candidateId cannot be empty"}, 400)
    candidate = next(
        (
            current_candidate
            for current_candidate in candidates
            if current_candidate["id"] == candidate_id and current_candidate["electionId"] == election["id"]
        ),
        None,
    )
    if not candidate:
        return json_response({"error": "Candidate does not exist or does not belong to this election"}, 404)

    candidate_ids = [current_candidate["id"] for current_candidate in get_candidates_for_election(election["id"])]
    vote_vector = create_vote_vector(candidate_ids, candidate["id"])
    randomness = random_hex()
    created_at = now()
    commitment = create_commitment(election["id"], vote_vector, randomness)
    pedersen_context_hash = create_pedersen_context(election["id"], len(vote_vector)).context_hash
    receipt_code = create_receipt_code(election["id"], commitment, user["id"], created_at)
    pending_ballot = {
        "id": create_id("pendingBallot"),
        "electionId": election["id"],
        "userId": user["id"],
        "candidateId": candidate["id"],
        "voteVector": vote_vector,
        "randomness": randomness,
        "commitment": commitment,
        "receiptCode": receipt_code,
        "createdAt": created_at,
        "status": "pending",
        "pedersenContextHash": pedersen_context_hash,
    }
    add_pending_ballot(pending_ballot)
    return json_response(
        {
            "pendingBallot": pending_ballot,
            "message": "Prepared ballot generated. Choose cast or challenge; it is not counted yet.",
        },
        201,
    )


@app.post("/challenge/ballots/{pending_ballot_id}/cast")
def cast_prepared_ballot(pending_ballot_id: str) -> JSONResponse:
    pending_ballot = next((ballot for ballot in pending_ballots if ballot["id"] == pending_ballot_id), None)
    if not pending_ballot:
        return json_response({"error": "Pending ballot does not exist"}, 404)
    if pending_ballot["status"] != "pending":
        return json_response({"error": "This pending ballot has already been processed"}, 409)
    election = find_election(pending_ballot["electionId"])
    if not election:
        return json_response({"error": "Election does not exist; cannot cast pending ballot"}, 404)
    if election["status"] != "active":
        return json_response({"error": "Election is not active; cannot cast pending ballot"}, 409)
    already_voted = any(
        vote["electionId"] == pending_ballot["electionId"] and vote["userId"] == pending_ballot["userId"]
        for vote in votes
    )
    if already_voted:
        return json_response({"error": "This user has already voted in this election"}, 409)
    vote = append_vote_with_receipt_chain(
        {
            "id": create_id("vote"),
            "electionId": pending_ballot["electionId"],
            "userId": pending_ballot["userId"],
            "candidateId": pending_ballot["candidateId"],
            "voteVector": list(pending_ballot["voteVector"]),
            "randomness": pending_ballot["randomness"],
            "commitment": pending_ballot["commitment"],
            "receiptCode": pending_ballot["receiptCode"],
            "createdAt": pending_ballot["createdAt"],
            "pedersenContextHash": pending_ballot.get("pedersenContextHash"),
        }
    )
    pending_ballot["status"] = "cast"
    save_pending_ballot(pending_ballot)
    return json_response(
        {
            "vote": vote,
            "voteId": vote["id"],
            "receiptCode": vote["receiptCode"],
            "commitment": vote["commitment"],
            "receiptChainIndex": vote.get("receiptChainIndex", -1),
            "previousReceiptCodeHash": vote.get("previousReceiptCodeHash"),
            "receiptChainHash": vote.get("receiptChainHash", ""),
            "message": "Prepared ballot has been counted.",
        },
        201,
    )


@app.post("/challenge/ballots/{pending_ballot_id}/challenge")
def challenge_prepared_ballot(pending_ballot_id: str) -> JSONResponse:
    pending_ballot = next((ballot for ballot in pending_ballots if ballot["id"] == pending_ballot_id), None)
    if not pending_ballot:
        return json_response({"error": "Pending ballot does not exist"}, 404)
    if pending_ballot["status"] != "pending":
        return json_response({"error": "This pending ballot has already been processed"}, 409)
    opening_verified = verify_commitment_opening(
        pending_ballot["electionId"],
        pending_ballot["voteVector"],
        pending_ballot["randomness"],
        pending_ballot["commitment"],
    )
    record = {
        "id": create_id("challengeRecord"),
        "electionId": pending_ballot["electionId"],
        "pendingBallotId": pending_ballot["id"],
        "voteVector": list(pending_ballot["voteVector"]),
        "randomness": pending_ballot["randomness"],
        "commitment": pending_ballot["commitment"],
        "openingVerified": opening_verified,
        "createdAt": now(),
    }
    if pending_ballot.get("pedersenContextHash"):
        record["pedersenContextHash"] = pending_ballot["pedersenContextHash"]
    add_challenge_record(record)
    pending_ballot["status"] = "challenged"
    save_pending_ballot(pending_ballot)
    return json_response(
        {
            "record": record,
            "opening": {
                "electionId": record["electionId"],
                "pendingBallotId": record["pendingBallotId"],
                "voteVector": record["voteVector"],
                "randomness": record["randomness"],
                "commitment": record["commitment"],
                "openingVerified": opening_verified,
            },
            "openingVerified": opening_verified,
            "message": "Challenge opening has been published. This ballot is audited, not counted.",
        },
        201,
    )


@app.get("/challenge/elections/{election_id}/records")
def get_challenge_records(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; challenge records cannot be viewed"}, 404)
    return json_response(
        {
            "election": election,
            "pendingBallots": [ballot for ballot in pending_ballots if ballot["electionId"] == election["id"]],
            "challengeRecords": [record for record in challenge_records if record["electionId"] == election["id"]],
        }
    )


@app.post("/blockchain/elections/{election_id}/submit-audit")
def submit_blockchain_audit(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; cannot submit chain audit"}, 404)
    bulletin = find_bulletin_board(election["id"])
    if not bulletin:
        return json_response({"error": "Generate bulletin board first"}, 409)
    report = find_aggregator_report(election["id"])
    if not report:
        return json_response({"error": "Run aggregator first"}, 409)

    fields = create_blockchain_audit_fields(election["id"], bulletin, report)
    audit_mode = get_blockchain_audit_mode()
    try:
        if audit_mode == "local-mock":
            if election["id"] in blockchain_audit_records:
                return json_response({"error": "This electionId has already submitted a chain audit; duplicates are rejected"}, 409)
            created_at = now()
            audit = {
                **fields,
                "transactionHash": create_mock_transaction_hash(fields, created_at),
                "contractAddress": MOCK_CONTRACT_ADDRESS,
                "auditMode": audit_mode,
                "createdAt": created_at,
                "mockSubmitter": MOCK_SUBMITTER,
                "status": "submitted",
            }
            save_blockchain_audit_record(election["id"], audit)
            return json_response(
                {
                    "election": election,
                    "audit": audit,
                    "submittedFields": fields,
                    "duplicatePolicy": "reject",
                    "message": "Local mock chain audit recorded.",
                },
                201,
            )

        contract, contract_address, web3, from_address = get_hardhat_contract()
        if contract.functions.hasAudit(fields["electionIdHash"]).call():
            return json_response({"error": "This electionId has already submitted a chain audit; duplicates are rejected"}, 409)
        receipt = transact_contract(
            web3,
            contract.functions.submitAudit(
                fields["electionIdHash"],
                fields["merkleRoot"],
                fields["commitmentRoot"],
                fields["receiptRoot"],
                fields["auditHash"],
                fields["tallyHash"],
            ),
            from_address,
        )
        chain_record = contract.functions.getAudit(fields["electionIdHash"]).call()
        audit = create_audit_record_from_chain(election["id"], chain_record, receipt.transactionHash.hex(), contract_address)
        save_blockchain_audit_record(election["id"], audit)
        return json_response(
            {
                "election": election,
                "audit": audit,
                "submittedFields": fields,
                "duplicatePolicy": "reject",
                "message": "Hardhat audit submitted.",
            },
            201,
        )
    except Exception as error:
        return json_response({"error": f"Chain audit submission failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/blockchain/elections/{election_id}/submit-audit-with-tally-proof")
def submit_blockchain_audit_with_tally_proof(
    election_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; cannot submit chain audit"}, 404)
    bulletin = find_bulletin_board(election["id"])
    if not bulletin:
        return json_response({"error": "Generate bulletin board first"}, 409)
    report = find_aggregator_report(election["id"])
    if not report:
        return json_response({"error": "Run aggregator first"}, 409)
    tally_proof_response = payload.get("tallyProofResponse")
    if not isinstance(tally_proof_response, dict) or not tally_proof_response.get("proof"):
        return json_response({"error": "tallyProofResponse.proof cannot be empty"}, 400)
    if not tally_proof_response.get("valid"):
        return json_response({"error": "tallyProofResponse.valid is false; generate a valid tally proof first"}, 400)
    try:
        calldata = encode_tally_solidity_calldata(tally_proof_response["proof"])
    except Exception as error:
        return json_response({"error": f"Could not encode tally proof calldata: {get_unknown_error_message(error)}"}, 400)
    if len(calldata["input"]) != 5:
        return json_response({"error": f"Expected 5 public signals, got {len(calldata['input'])}"}, 400)

    fields = create_blockchain_audit_fields(election["id"], bulletin, report)
    audit_mode = get_blockchain_audit_mode()
    try:
        if audit_mode == "local-mock":
            if election["id"] in blockchain_audit_records:
                return json_response({"error": "This electionId has already submitted a chain audit; duplicates are rejected"}, 409)
            created_at = now()
            audit = {
                **fields,
                "transactionHash": create_mock_transaction_hash(fields, created_at),
                "contractAddress": MOCK_CONTRACT_ADDRESS,
                "auditMode": audit_mode,
                "createdAt": created_at,
                "mockSubmitter": MOCK_SUBMITTER,
                "zkVerified": True,
                "status": "submitted",
            }
            save_blockchain_audit_record(election["id"], audit)
            return json_response(
                {
                    "election": election,
                    "audit": audit,
                    "submittedFields": fields,
                    "duplicatePolicy": "reject",
                    "zkVerified": True,
                    "message": "Local mock chain audit recorded with ZK verification flag.",
                },
                201,
            )

        contract, contract_address, web3, from_address = get_hardhat_contract()
        if contract.functions.hasAudit(fields["electionIdHash"]).call():
            return json_response({"error": "This electionId has already submitted a chain audit; duplicates are rejected"}, 409)
        receipt = transact_contract(
            web3,
            contract.functions.submitAuditWithTallyProof(
                fields["electionIdHash"],
                fields["merkleRoot"],
                fields["commitmentRoot"],
                fields["receiptRoot"],
                fields["auditHash"],
                fields["tallyHash"],
                [int(item) for item in calldata["a"]],
                [
                    [int(calldata["b"][0][0]), int(calldata["b"][0][1])],
                    [int(calldata["b"][1][0]), int(calldata["b"][1][1])],
                ],
                [int(item) for item in calldata["c"]],
                [int(item) for item in calldata["input"]],
            ),
            from_address,
        )
        chain_record = contract.functions.getAudit(fields["electionIdHash"]).call()
        audit = create_audit_record_from_chain(election["id"], chain_record, receipt.transactionHash.hex(), contract_address)
        save_blockchain_audit_record(election["id"], audit)
        return json_response(
            {
                "election": election,
                "audit": audit,
                "submittedFields": fields,
                "duplicatePolicy": "reject",
                "zkVerified": True,
                "message": "Hardhat audit submitted and verified by on-chain Groth16 tally verifier.",
            },
            201,
        )
    except Exception as error:
        return json_response({"error": f"Chain audit with tally proof failed: {get_unknown_error_message(error)}"}, 500)


@app.get("/blockchain/elections/{election_id}/audit")
def get_blockchain_audit(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; chain audit cannot be queried"}, 404)
    audit_mode = get_blockchain_audit_mode()
    try:
        if audit_mode == "local-mock":
            audit = blockchain_audit_records.get(election["id"])
            return json_response(
                {
                    "election": election,
                    "audit": audit,
                    "hasAudit": audit is not None,
                    "auditMode": audit_mode,
                    "contractAddress": MOCK_CONTRACT_ADDRESS,
                    "duplicatePolicy": "reject",
                }
            )
        contract, contract_address, _, _ = get_hardhat_contract()
        election_id_hash = to_bytes32_hex(election["id"])
        has_audit = contract.functions.hasAudit(election_id_hash).call()
        if not has_audit:
            return json_response(
                {
                    "election": election,
                    "audit": None,
                    "hasAudit": False,
                    "auditMode": audit_mode,
                    "contractAddress": contract_address,
                    "duplicatePolicy": "reject",
                }
            )
        chain_record = contract.functions.getAudit(election_id_hash).call()
        known_audit = blockchain_audit_records.get(election["id"])
        audit = create_audit_record_from_chain(
            election["id"],
            chain_record,
            known_audit.get("transactionHash", "") if known_audit else "",
            contract_address,
        )
        return json_response(
            {
                "election": election,
                "audit": audit,
                "hasAudit": True,
                "auditMode": audit_mode,
                "contractAddress": contract_address,
                "duplicatePolicy": "reject",
            }
        )
    except Exception as error:
        return json_response({"error": f"Chain audit query failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/attack/elections/{election_id}/tamper-commitment")
def attack_tamper_commitment(election_id: str) -> JSONResponse:
    target = get_attack_target(election_id)
    if "error" in target:
        return json_response({"error": target["error"]}, target["status"])
    first_vote = target["firstVote"]
    before = {"voteId": first_vote["id"], "commitment": first_vote["commitment"]}
    first_vote["commitment"] = hash_text(f"{first_vote['commitment']}_tampered")
    save_vote(first_vote)
    after = {"voteId": first_vote["id"], "commitment": first_vote["commitment"]}
    attack_type = "tamper-commitment"
    log = create_attack_log(target["election"]["id"], attack_type, "Tampered the first vote commitment without updating bulletin board.", before, after)
    return json_response({"ok": True, "attackType": attack_type, "message": "First vote commitment was tampered.", "log": log})


@app.post("/attack/elections/{election_id}/delete-vote")
def attack_delete_vote(election_id: str) -> JSONResponse:
    target = get_attack_target(election_id)
    if "error" in target:
        return json_response({"error": target["error"]}, target["status"])
    first_vote = target["firstVote"]
    before = {"voteId": first_vote["id"], "receiptCode": first_vote["receiptCode"], "commitment": first_vote["commitment"]}
    delete_vote(first_vote)
    after = {
        "voteId": first_vote["id"],
        "receiptCode": first_vote["receiptCode"],
        "exists": False,
        "remainingVotes": len([vote for vote in votes if vote["electionId"] == target["election"]["id"]]),
    }
    attack_type = "delete-vote"
    log = create_attack_log(target["election"]["id"], attack_type, "Deleted the first vote from the in-memory vote list.", before, after)
    return json_response({"ok": True, "attackType": attack_type, "message": "First vote was deleted.", "log": log})


@app.post("/attack/elections/{election_id}/inject-duplicate-vote")
def attack_inject_duplicate_vote(election_id: str) -> JSONResponse:
    target = get_attack_target(election_id)
    if "error" in target:
        return json_response({"error": target["error"]}, target["status"])
    first_vote = target["firstVote"]
    created_at = now()
    randomness = random_hex()
    commitment = create_commitment(target["election"]["id"], first_vote["voteVector"], randomness)
    receipt_code = create_receipt_code(target["election"]["id"], commitment, first_vote["userId"], created_at)
    duplicate_vote = append_vote_with_receipt_chain(
        {
            **copy.deepcopy(first_vote),
            "id": create_id("vote"),
            "randomness": randomness,
            "commitment": commitment,
            "receiptCode": receipt_code,
            "createdAt": created_at,
        }
    )
    vote_token_hash = create_vote_token_hash(target["election"]["id"], first_vote["userId"])
    before = {
        "sourceVoteId": first_vote["id"],
        "userId": first_vote["userId"],
        "candidateId": first_vote["candidateId"],
        "voteTokenHash": vote_token_hash,
    }
    after = {
        "duplicateVoteId": duplicate_vote["id"],
        "userId": duplicate_vote["userId"],
        "candidateId": duplicate_vote["candidateId"],
        "voteTokenHash": vote_token_hash,
    }
    attack_type = "inject-duplicate-vote"
    log = create_attack_log(target["election"]["id"], attack_type, "Injected a duplicate vote with the same userId and candidateId.", before, after)
    return json_response({"ok": True, "attackType": attack_type, "message": "Duplicate vote injected.", "log": log})


@app.post("/attack/elections/{election_id}/inject-invalid-vote")
def attack_inject_invalid_vote(election_id: str) -> JSONResponse:
    target = get_attack_target(election_id)
    if "error" in target:
        return json_response({"error": target["error"]}, target["status"])
    candidate_count = len(get_candidates_for_election(target["election"]["id"]))
    vote_vector = [0 for _ in range(max(candidate_count, 1))]
    user_id = "attacker_user"
    randomness = random_hex()
    created_at = now()
    commitment = create_commitment(target["election"]["id"], vote_vector, randomness)
    receipt_code = create_receipt_code(target["election"]["id"], commitment, user_id, created_at)
    invalid_vote = append_vote_with_receipt_chain(
        {
            "id": create_id("vote"),
            "electionId": target["election"]["id"],
            "userId": user_id,
            "candidateId": "invalid_candidate_demo",
            "voteVector": vote_vector,
            "randomness": randomness,
            "commitment": commitment,
            "receiptCode": receipt_code,
            "createdAt": created_at,
        }
    )
    before = {"validCandidateIds": [candidate["id"] for candidate in get_candidates_for_election(target["election"]["id"])]}
    after = {
        "voteId": invalid_vote["id"],
        "userId": invalid_vote["userId"],
        "candidateId": invalid_vote["candidateId"],
        "voteVector": invalid_vote["voteVector"],
        "receiptCode": invalid_vote["receiptCode"],
    }
    attack_type = "inject-invalid-vote"
    log = create_attack_log(target["election"]["id"], attack_type, "Injected a vote whose candidateId is not in the election.", before, after)
    return json_response({"ok": True, "attackType": attack_type, "message": "Invalid vote injected.", "log": log})


@app.post("/attack/elections/{election_id}/tamper-tally")
def attack_tamper_tally(election_id: str) -> JSONResponse:
    target = get_attack_target(election_id)
    if "error" in target:
        return json_response({"error": target["error"]}, target["status"])
    report = find_aggregator_report(target["election"]["id"])
    if not report:
        return json_response({"error": "AggregatorReport has not been generated; run aggregator first"}, 404)
    if not report["tallyResult"]["results"]:
        return json_response({"error": "AggregatorReport has no candidate tally to tamper"}, 409)
    before = {"tallyResult": copy.deepcopy(report["tallyResult"])}
    tampered_tally = copy.deepcopy(report["tallyResult"])
    tampered_tally["totalVotes"] += 10
    tampered_tally["results"][0]["voteCount"] += 10
    tampered_report = {**report, "tallyResult": tampered_tally, "createdAt": now()}
    tampered_report["auditHash"] = create_audit_hash_for_aggregator_report(tampered_report)
    save_aggregator_report(tampered_report)
    after = {"tallyResult": tampered_tally}
    attack_type = "tamper-tally"
    log = create_attack_log(target["election"]["id"], attack_type, "Tampered AggregatorReport.tallyResult without changing votes.", before, after)
    return json_response({"ok": True, "attackType": attack_type, "message": "AggregatorReport tallyResult was tampered.", "log": log})


@app.get("/attack/elections/{election_id}/logs")
def get_attack_logs(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; attack logs cannot be viewed"}, 404)
    return json_response({"election": election, "logs": [log for log in attack_logs if log["electionId"] == election["id"]]})


@app.post("/elections/{election_id}/candidates")
def create_candidate(election_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    if election["status"] == "finalized":
        return json_response({"error": "Election has already generated a bulletin board; cannot add candidate"}, 409)
    name = clean(payload.get("name"))
    if not name:
        return json_response({"error": "Candidate name cannot be empty"}, 400)
    candidate = {"id": create_id("candidate"), "electionId": election["id"], "name": name}
    add_candidate(candidate)
    return json_response({"candidate": candidate}, 201)


@app.post("/elections/{election_id}/vote")
def cast_vote(election_id: str, payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    if election["status"] != "active":
        return json_response({"error": "Election is not active; cannot continue voting"}, 409)
    user_id = clean(payload.get("userId"))
    candidate_id = clean(payload.get("candidateId"))
    if not user_id:
        return json_response({"error": "userId cannot be empty"}, 400)
    user = next((current_user for current_user in users if current_user["id"] == user_id), None)
    if not user:
        return json_response({"error": "User does not exist"}, 404)
    if not candidate_id:
        return json_response({"error": "candidateId cannot be empty"}, 400)
    candidate = next(
        (
            current_candidate
            for current_candidate in candidates
            if current_candidate["id"] == candidate_id and current_candidate["electionId"] == election["id"]
        ),
        None,
    )
    if not candidate:
        return json_response({"error": "Candidate does not exist or does not belong to this election"}, 404)
    if any(vote["electionId"] == election["id"] and vote["userId"] == user["id"] for vote in votes):
        return json_response({"error": "This user has already voted in this election"}, 409)

    candidate_ids = [current_candidate["id"] for current_candidate in get_candidates_for_election(election["id"])]
    vote_vector = create_vote_vector(candidate_ids, candidate["id"])
    randomness = random_hex()
    created_at = now()
    commitment = create_commitment(election["id"], vote_vector, randomness)
    pedersen_context_hash = create_pedersen_context(election["id"], len(vote_vector)).context_hash
    receipt_code = create_receipt_code(election["id"], commitment, user["id"], created_at)
    vote = append_vote_with_receipt_chain(
        {
            "id": create_id("vote"),
            "electionId": election["id"],
            "userId": user["id"],
            "candidateId": candidate["id"],
            "voteVector": vote_vector,
            "randomness": randomness,
            "commitment": commitment,
            "receiptCode": receipt_code,
            "createdAt": created_at,
            "pedersenContextHash": pedersen_context_hash,
        }
    )
    return json_response(
        {
            "voteId": vote["id"],
            "receiptCode": receipt_code,
            "commitment": commitment,
            "voteVector": vote_vector,
            "receiptChainIndex": vote.get("receiptChainIndex", -1),
            "previousReceiptCodeHash": vote.get("previousReceiptCodeHash"),
            "receiptChainHash": vote.get("receiptChainHash", ""),
            "message": "Vote cast successfully",
        },
        201,
    )


@app.get("/receipts/{receipt_code}")
def get_receipt(receipt_code: str) -> JSONResponse:
    code = clean(receipt_code)
    if not code:
        return json_response({"error": "receiptCode cannot be empty"}, 400)
    vote = next((current_vote for current_vote in votes if current_vote["receiptCode"] == code), None)
    if not vote:
        return json_response({"exists": False})
    return json_response(
        {
            "exists": True,
            "electionId": vote["electionId"],
            "voteId": vote["id"],
            "commitment": vote["commitment"],
            "receiptChainIndex": vote.get("receiptChainIndex", -1),
            "previousReceiptCodeHash": vote.get("previousReceiptCodeHash"),
            "receiptChainHash": vote.get("receiptChainHash", ""),
            "createdAt": vote["createdAt"],
            "counted": True,
        }
    )


@app.get("/receipts/{receipt_code}/proof")
def get_receipt_proof(receipt_code: str) -> JSONResponse:
    code = clean(receipt_code)
    if not code:
        return json_response({"error": "receiptCode cannot be empty"}, 400)
    vote = next((current_vote for current_vote in votes if current_vote["receiptCode"] == code), None)
    if not vote:
        return json_response({"error": "Vote for this receipt code was not found"}, 404)
    bulletin = find_bulletin_board(vote["electionId"])
    if not bulletin:
        return json_response({"error": "Bulletin board for this election has not been generated"}, 404)
    leaf = create_merkle_leaf(vote["id"], vote["commitment"], vote["receiptCode"])
    leaf_included = leaf in bulletin["leaves"]
    proof = get_merkle_proof(bulletin["leaves"], leaf) if leaf_included else []
    verify_result = leaf_included and verify_merkle_proof(leaf, proof, bulletin["merkleRoot"])
    return json_response(
        {
            "electionId": vote["electionId"],
            "voteId": vote["id"],
            "leaf": leaf,
            "proof": proof,
            "merkleRoot": bulletin["merkleRoot"],
            "verifyResult": verify_result,
        }
    )


@app.get("/elections/{election_id}/result")
def get_election_result(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    return json_response({"election": election, "result": create_election_result(election["id"])})


def validate_pedersen_common_inputs(election_id: Any, candidate_count: Any, vote_vector: Any) -> str | None:
    if not isinstance(election_id, str) or len(election_id.strip()) == 0:
        return "electionId cannot be empty"
    if not isinstance(candidate_count, int) or isinstance(candidate_count, bool) or candidate_count <= 0:
        return "candidateCount must be a positive integer"
    if not is_integer_array(vote_vector):
        return "voteVector must be an integer array"
    if len(vote_vector) != candidate_count:
        return "voteVector length must equal candidateCount"
    return None


@app.post("/crypto/pedersen/commit")
def pedersen_commit(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    validation_error = validate_pedersen_common_inputs(payload.get("electionId"), payload.get("candidateCount"), payload.get("voteVector"))
    if validation_error:
        return json_response({"error": validation_error}, 400)
    try:
        context = create_pedersen_context(
            clean(payload.get("electionId")),
            payload["candidateCount"],
            clean(payload.get("contextLabel")) or "verivote.pedersen.experiment.v1",
        )
        provided_randomness = clean(payload.get("randomness")) or None
        record = create_pedersen_commitment(context, payload["voteVector"], provided_randomness)
        return json_response(
            {
                "context": export_pedersen_context(context),
                "commitmentRecord": record,
                "message": "Pedersen-style commitment generated.",
            },
            201,
        )
    except Exception as error:
        return json_response({"error": f"Pedersen commit failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/crypto/pedersen/verify-opening")
def pedersen_verify_opening(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    validation_error = validate_pedersen_common_inputs(payload.get("electionId"), payload.get("candidateCount"), payload.get("voteVector"))
    if validation_error:
        return json_response({"error": validation_error}, 400)
    if not clean(payload.get("randomness")):
        return json_response({"error": "randomness cannot be empty"}, 400)
    if not clean(payload.get("commitment")):
        return json_response({"error": "commitment cannot be empty"}, 400)
    try:
        context = create_pedersen_context(
            clean(payload.get("electionId")),
            payload["candidateCount"],
            clean(payload.get("contextLabel")) or "verivote.pedersen.experiment.v1",
        )
        verified = verify_pedersen_opening(
            context,
            payload["voteVector"],
            clean(payload.get("randomness")),
            clean(payload.get("commitment")),
        )
        return json_response(
            {
                "context": export_pedersen_context(context),
                "verified": verified,
                "message": "Pedersen opening verification passed." if verified else "Pedersen opening verification failed.",
            }
        )
    except Exception as error:
        return json_response({"error": f"Pedersen verify-opening failed: {get_unknown_error_message(error)}"}, 500)


@app.post("/crypto/pedersen/aggregate-verify")
def pedersen_aggregate_verify(payload: dict[str, Any] = Body(default_factory=dict)) -> JSONResponse:
    if not isinstance(payload.get("electionId"), str) or len(payload["electionId"].strip()) == 0:
        return json_response({"error": "electionId cannot be empty"}, 400)
    if not isinstance(payload.get("candidateCount"), int) or isinstance(payload.get("candidateCount"), bool) or payload["candidateCount"] <= 0:
        return json_response({"error": "candidateCount must be a positive integer"}, 400)
    if not isinstance(payload.get("batch"), list) or len(payload["batch"]) == 0:
        return json_response({"error": "batch cannot be empty"}, 400)
    for entry in payload["batch"]:
        if (
            not isinstance(entry, dict)
            or not is_integer_array(entry.get("voteVector"))
            or len(entry["voteVector"]) != payload["candidateCount"]
            or not isinstance(entry.get("randomness"), str)
            or not isinstance(entry.get("commitment"), str)
        ):
            return json_response({"error": "batch contains an invalid entry"}, 400)
    try:
        context = create_pedersen_context(
            clean(payload.get("electionId")),
            payload["candidateCount"],
            clean(payload.get("contextLabel")) or "verivote.pedersen.experiment.v1",
        )
        result = verify_aggregate_opening(
            context,
            [
                {
                    "voteVector": entry["voteVector"],
                    "randomness": clean(entry["randomness"]),
                    "commitment": clean(entry["commitment"]),
                }
                for entry in payload["batch"]
            ],
        )
        return json_response(
            {
                "context": export_pedersen_context(context),
                "aggregatedCommitment": result["aggregatedCommitment"],
                "expectedCommitment": result["expectedCommitment"],
                "aggregatedRandomness": result["aggregatedRandomness"],
                "aggregatedVector": result["aggregatedVector"],
                "verified": result["verified"],
                "message": "Pedersen aggregate opening verification passed." if result["verified"] else "Pedersen aggregate opening verification failed.",
            }
        )
    except Exception as error:
        return json_response({"error": f"Pedersen aggregate-verify failed: {get_unknown_error_message(error)}"}, 500)


@app.get("/elections/{election_id}/export-bundle")
def export_bundle(election_id: str) -> JSONResponse:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist; cannot export audit bundle"}, 404)
    return json_response({"bundle": build_export_bundle(build_artifact_context(election))})


@app.get("/elections/{election_id}/export/bulletin_board.json")
def export_bulletin_board(election_id: str) -> Response:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    context = build_artifact_context(election)
    return artifact_response(f"bulletin_board_{election['id']}.json", context["bulletin"])


@app.get("/elections/{election_id}/export/aggregator_report.json")
def export_aggregator_report(election_id: str) -> Response:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    context = build_artifact_context(election)
    if not context["aggregatorReportArtifact"]:
        return json_response({"error": "AggregatorReport has not been generated; run aggregator first"}, 404)
    return artifact_response(f"aggregator_report_{election['id']}.json", context["aggregatorReportArtifact"])


@app.get("/elections/{election_id}/export/zk_summary.json")
def export_zk_summary(election_id: str) -> Response:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    context = build_artifact_context(election)
    return artifact_response(
        f"zk_summary_{election['id']}.json",
        {
            "proofMode": None,
            "circuitId": "valid-vote-4",
            "proofGenerated": False,
            "publicSignals": None,
            "electionIdHash": context["publicInputs"]["electionIdHash"],
            "candidateCount": context["publicInputs"]["candidateCount"],
            "message": "This file is a ZK summary. Generate proof through /zk/prove-vote-validity and merge it if needed.",
        },
    )


@app.get("/elections/{election_id}/export/chain_audit.json")
def export_chain_audit(election_id: str) -> Response:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    context = build_artifact_context(election)
    return artifact_response(
        f"chain_audit_{election['id']}.json",
        {
            "auditMode": context["auditMode"],
            "contractAddress": get_displayed_contract_address(context["auditMode"]),
            "hasAudit": context["auditRecord"] is not None,
            "audit": context["auditRecord"],
        },
    )


@app.get("/elections/{election_id}/export/public_inputs.json")
def export_public_inputs(election_id: str) -> Response:
    election = find_election(election_id)
    if not election:
        return json_response({"error": "Election does not exist"}, 404)
    context = build_artifact_context(election)
    return artifact_response(f"public_inputs_{election['id']}.json", context["publicInputs"])


def bootstrap_persistence() -> None:
    global persistence
    try:
        persistence = create_persistence_adapter()
        persistence.load(
            {
                "users": users,
                "elections": elections,
                "candidates": candidates,
                "votes": votes,
                "pending_ballots": pending_ballots,
                "challenge_records": challenge_records,
                "bulletin_boards": bulletin_boards,
                "aggregator_reports": aggregator_reports,
                "attack_logs": attack_logs,
                "blockchain_audit_records": blockchain_audit_records,
                "counters": counters,
            }
        )
    except Exception as error:
        print("[persistence] failed to initialize:", error)
        if os.environ.get("VERIVOTE_PERSISTENCE", "auto").lower() == "sqlite":
            raise
        persistence = None


@app.on_event("shutdown")
def shutdown() -> None:
    if persistence is not None:
        persistence.close()


bootstrap_persistence()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "verivote_api.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "3001")),
        reload=False,
    )
