from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any, Literal, TypedDict


def js_json_dumps(value: Any) -> str:
    """Compact JSON close to JavaScript's JSON.stringify output."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def create_vote_token_hash(election_id: str, user_id: str) -> str:
    return hash_text(f"{election_id}{user_id}")


def create_audit_hash(value: Any) -> str:
    return hash_text(js_json_dumps(value))


def random_hex(byte_count: int = 32) -> str:
    if not isinstance(byte_count, int) or byte_count <= 0:
        raise ValueError("bytes must be a positive integer")
    return secrets.token_hex(byte_count)


def create_vote_vector(candidate_ids: list[str], selected_candidate_id: str) -> list[int]:
    if selected_candidate_id not in candidate_ids:
        raise ValueError("selectedCandidateId must be in candidateIds")
    return [1 if candidate_id == selected_candidate_id else 0 for candidate_id in candidate_ids]


RFC3526_GROUP_14_PRIME_HEX = (
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1"
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245"
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D"
    "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D"
    "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9"
    "DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
    "15728E5A8AACAA68FFFFFFFFFFFFFFFF"
).lower()

PEDERSEN_P = int(RFC3526_GROUP_14_PRIME_HEX, 16)
PEDERSEN_Q = (PEDERSEN_P - 1) // 2


@dataclass(frozen=True)
class PedersenContext:
    p: int
    q: int
    g: int
    h: list[int]
    election_id: str
    context_label: str
    context_hash: str


def _big_int_to_hex(value: int) -> str:
    if value < 0:
        raise ValueError("big_int_to_hex expects a non-negative integer")
    raw = f"{value:x}"
    return raw if len(raw) % 2 == 0 else f"0{raw}"


def _hex_to_int(value: str) -> int:
    normalized = value[2:] if value.startswith("0x") else value
    return int(normalized or "0", 16)


def _normalize_hex(value: str) -> str:
    stripped = value[2:] if value.startswith("0x") else value
    lowered = stripped.lower()
    return lowered if len(lowered) % 2 == 0 else f"0{lowered}"


def _derive_generator_from_seed(seed: str) -> int:
    first_half = hash_text(f"verivote.pedersen.gen.v1.part1:{seed}")
    second_half = hash_text(f"verivote.pedersen.gen.v1.part2:{seed}")
    exponent = int(first_half + second_half, 16) % PEDERSEN_Q
    safe_exponent = (2 * (1 if exponent == 0 else exponent)) % PEDERSEN_Q
    return pow(2, safe_exponent, PEDERSEN_P)


def create_pedersen_context(
    election_id: str,
    candidate_count: int,
    context_label: str = "verivote.pedersen.experiment.v1",
) -> PedersenContext:
    if not isinstance(candidate_count, int) or candidate_count <= 0:
        raise ValueError("candidateCount must be a positive integer")

    base_seed = f"{context_label}|{election_id}|n={candidate_count}"
    g = _derive_generator_from_seed(f"{base_seed}|g")
    h = [_derive_generator_from_seed(f"{base_seed}|h|{index}") for index in range(candidate_count)]
    context_hash = hash_text(
        js_json_dumps(
            {
                "domain": "verivote.pedersen.context.v1",
                "electionId": election_id,
                "contextLabel": context_label,
                "candidateCount": candidate_count,
                "g": _big_int_to_hex(g),
                "h": [_big_int_to_hex(item) for item in h],
            }
        )
    )

    return PedersenContext(
        p=PEDERSEN_P,
        q=PEDERSEN_Q,
        g=g,
        h=h,
        election_id=election_id,
        context_label=context_label,
        context_hash=context_hash,
    )


def export_pedersen_context(context: PedersenContext) -> dict[str, Any]:
    return {
        "electionId": context.election_id,
        "contextLabel": context.context_label,
        "contextHash": context.context_hash,
        "p": _big_int_to_hex(context.p),
        "q": _big_int_to_hex(context.q),
        "g": _big_int_to_hex(context.g),
        "h": [_big_int_to_hex(item) for item in context.h],
    }


def _random_pedersen_scalar(context: PedersenContext) -> str:
    while True:
        candidate = int(secrets.token_hex(32), 16) % context.q
        if candidate != 0:
            return _big_int_to_hex(candidate)


def _assert_vector_length(vote_vector: list[int], context: PedersenContext) -> None:
    if len(vote_vector) != len(context.h):
        raise ValueError(
            f"voteVector length {len(vote_vector)} does not match context candidate count {len(context.h)}"
        )


def create_pedersen_commitment(
    context: PedersenContext,
    vote_vector: list[int],
    randomness: str | None = None,
) -> dict[str, Any]:
    _assert_vector_length(vote_vector, context)
    if any(not isinstance(entry, int) for entry in vote_vector):
        raise ValueError("voteVector entries must be integers")

    r = randomness or _random_pedersen_scalar(context)
    r_int = _hex_to_int(r) % context.q

    commitment = pow(context.g, r_int, context.p)
    for index, value in enumerate(vote_vector):
        normalized_exp = value % context.q
        if normalized_exp != 0:
            commitment = (commitment * pow(context.h[index], normalized_exp, context.p)) % context.p

    return {
        "commitment": _big_int_to_hex(commitment),
        "randomness": _big_int_to_hex(r_int),
        "length": len(vote_vector),
        "contextHash": context.context_hash,
    }


def verify_pedersen_opening(
    context: PedersenContext,
    vote_vector: list[int],
    randomness: str,
    commitment: str,
) -> bool:
    try:
        expected = create_pedersen_commitment(context, vote_vector, randomness)["commitment"]
        return expected == _normalize_hex(commitment)
    except Exception:
        return False


def create_commitment(election_id: str, vote_vector: list[int], randomness: str) -> str:
    context = create_pedersen_context(election_id, len(vote_vector))
    return str(create_pedersen_commitment(context, vote_vector, randomness)["commitment"])


def verify_commitment_opening(
    election_id: str,
    vote_vector: list[int],
    randomness: str,
    commitment: str,
) -> bool:
    context = create_pedersen_context(election_id, len(vote_vector))
    return verify_pedersen_opening(context, vote_vector, randomness, commitment)


def aggregate_commitments(context: PedersenContext, commitments: list[str]) -> str:
    product = 1
    for commitment in commitments:
        product = (product * _hex_to_int(commitment)) % context.p
    return _big_int_to_hex(product)


def aggregate_randomness(context: PedersenContext, randomness_values: list[str]) -> str:
    total = 0
    for randomness in randomness_values:
        total = (total + _hex_to_int(randomness)) % context.q
    return _big_int_to_hex(total)


def aggregate_vote_vectors(vectors: list[list[int]]) -> list[int]:
    if not vectors:
        return []
    length = len(vectors[0])
    if any(len(vector) != length for vector in vectors):
        raise ValueError("aggregateVoteVectors requires equal-length vectors")
    return [sum(vector[index] for vector in vectors) for index in range(length)]


def verify_aggregate_opening(context: PedersenContext, batch: list[dict[str, Any]]) -> dict[str, Any]:
    aggregated_commitment = aggregate_commitments(context, [str(entry["commitment"]) for entry in batch])
    aggregated_randomness = aggregate_randomness(context, [str(entry["randomness"]) for entry in batch])
    aggregated_vector = aggregate_vote_vectors([list(entry["voteVector"]) for entry in batch])
    expected = create_pedersen_commitment(context, aggregated_vector, aggregated_randomness)["commitment"]

    return {
        "aggregatedCommitment": aggregated_commitment,
        "expectedCommitment": expected,
        "aggregatedRandomness": aggregated_randomness,
        "aggregatedVector": aggregated_vector,
        "verified": aggregated_commitment == expected,
    }


def create_receipt_code(election_id: str, commitment: str, user_id: str, created_at: str) -> str:
    return hash_text(f"{election_id}{commitment}{user_id}{created_at}")


def hash_receipt_code(receipt_code: str) -> str:
    return hash_text(receipt_code)


def create_receipt_chain_hash(input_value: dict[str, Any]) -> str:
    return hash_text(
        js_json_dumps(
            {
                "domain": "verivote-receipt-chain-v1",
                "electionId": input_value["electionId"],
                "receiptCode": input_value["receiptCode"],
                "previousReceiptCodeHash": input_value["previousReceiptCodeHash"],
                "receiptChainIndex": input_value["receiptChainIndex"],
                "commitment": input_value["commitment"],
            }
        )
    )


class MerkleProofItem(TypedDict):
    sibling: str
    position: Literal["left", "right"]


def verify_receipt_chain(receipts: list[dict[str, Any]]) -> dict[str, Any]:
    breaks: list[dict[str, Any]] = []

    def vote_id(vote: dict[str, Any]) -> str | None:
        return vote.get("voteId") or vote.get("id")

    def vote_index(vote: dict[str, Any], fallback: int) -> int:
        index = vote.get("receiptChainIndex")
        return index if isinstance(index, int) else fallback

    complete_votes: list[dict[str, Any]] = []
    for original_index, vote in enumerate(receipts):
        complete = True
        current_vote_id = vote_id(vote)
        current_index = vote_index(vote, original_index)

        if (
            not isinstance(vote.get("receiptChainIndex"), int)
            or vote["receiptChainIndex"] < 0
        ):
            breaks.append(
                {
                    "voteId": current_vote_id,
                    "index": current_index,
                    "reason": "missing or invalid receiptChainIndex",
                }
            )
            complete = False

        if "previousReceiptCodeHash" not in vote:
            breaks.append(
                {
                    "voteId": current_vote_id,
                    "index": current_index,
                    "reason": "missing previousReceiptCodeHash",
                }
            )
            complete = False

        if not isinstance(vote.get("receiptChainHash"), str) or not vote.get("receiptChainHash"):
            breaks.append(
                {
                    "voteId": current_vote_id,
                    "index": current_index,
                    "reason": "missing receiptChainHash",
                }
            )
            complete = False

        if complete:
            complete_votes.append(vote)

    seen_indexes: set[int] = set()
    for vote in complete_votes:
        receipt_chain_index = int(vote["receiptChainIndex"])
        if receipt_chain_index in seen_indexes:
            breaks.append(
                {
                    "voteId": vote_id(vote),
                    "index": receipt_chain_index,
                    "reason": "duplicate receiptChainIndex",
                }
            )
        else:
            seen_indexes.add(receipt_chain_index)

    unique_votes: list[dict[str, Any]] = []
    seen_unique: set[int] = set()
    for vote in complete_votes:
        receipt_chain_index = int(vote["receiptChainIndex"])
        if receipt_chain_index not in seen_unique:
            seen_unique.add(receipt_chain_index)
            unique_votes.append(vote)

    sorted_votes = sorted(unique_votes, key=lambda vote: int(vote["receiptChainIndex"]))
    for sorted_index, vote in enumerate(sorted_votes):
        receipt_chain_index = int(vote["receiptChainIndex"])
        current_vote_id = vote_id(vote)

        if receipt_chain_index != sorted_index:
            breaks.append(
                {
                    "voteId": current_vote_id,
                    "index": receipt_chain_index,
                    "reason": f"receiptChainIndex sequence break: expected {sorted_index}, got {receipt_chain_index}",
                }
            )

        previous_vote = sorted_votes[sorted_index - 1] if sorted_index > 0 else None
        expected_previous_hash = None if previous_vote is None else hash_receipt_code(previous_vote["receiptCode"])
        if vote.get("previousReceiptCodeHash") != expected_previous_hash:
            breaks.append(
                {
                    "voteId": current_vote_id,
                    "index": receipt_chain_index,
                    "reason": (
                        "first formal vote must have previousReceiptCodeHash = null"
                        if sorted_index == 0
                        else "previousReceiptCodeHash does not match previous formal vote receiptCode hash"
                    ),
                }
            )

        expected_chain_hash = create_receipt_chain_hash(
            {
                "electionId": vote["electionId"],
                "receiptCode": vote["receiptCode"],
                "previousReceiptCodeHash": expected_previous_hash,
                "receiptChainIndex": receipt_chain_index,
                "commitment": vote["commitment"],
            }
        )
        if vote.get("receiptChainHash") != expected_chain_hash:
            breaks.append(
                {
                    "voteId": current_vote_id,
                    "index": receipt_chain_index,
                    "reason": "receiptChainHash does not match recomputed chain hash",
                }
            )

    return {"verified": len(breaks) == 0, "breaks": breaks}


def create_merkle_leaf(vote_id: str, commitment: str, receipt_code: str) -> str:
    return hash_text(f"{vote_id}{commitment}{receipt_code}")


def _hash_merkle_pair(left: str, right: str) -> str:
    return hash_text(f"{left}{right}")


def build_merkle_tree(leaves: list[str]) -> list[list[str]]:
    if not leaves:
        return []

    tree = [leaves.copy()]
    while len(tree[-1]) > 1:
        level = tree[-1]
        next_level: list[str] = []
        for index in range(0, len(level), 2):
            left = level[index]
            right = level[index + 1] if index + 1 < len(level) else left
            next_level.append(_hash_merkle_pair(left, right))
        tree.append(next_level)
    return tree


def get_merkle_root(leaves: list[str]) -> str:
    tree = build_merkle_tree(leaves)
    return hash_text("") if not tree else tree[-1][0]


def get_merkle_proof(leaves: list[str], target_leaf: str) -> list[MerkleProofItem]:
    tree = build_merkle_tree(leaves)
    try:
        target_index = leaves.index(target_leaf)
    except ValueError as exc:
        raise ValueError("targetLeaf must be included in leaves") from exc

    proof: list[MerkleProofItem] = []
    for level_index in range(len(tree) - 1):
        level = tree[level_index]
        is_right_node = target_index % 2 == 1
        sibling_index = target_index - 1 if is_right_node else target_index + 1
        sibling = level[sibling_index] if sibling_index < len(level) else level[target_index]
        proof.append({"sibling": sibling, "position": "left" if is_right_node else "right"})
        target_index //= 2

    return proof


def verify_merkle_proof(leaf: str, proof: list[dict[str, str]], root: str) -> bool:
    current_hash = leaf
    for proof_item in proof:
        if proof_item.get("position") == "left":
            current_hash = _hash_merkle_pair(proof_item["sibling"], current_hash)
        else:
            current_hash = _hash_merkle_pair(current_hash, proof_item["sibling"])
    return current_hash == root
