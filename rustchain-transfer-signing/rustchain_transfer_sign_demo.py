#!/usr/bin/env python3
"""Offline RustChain signed-transfer canonicalization demo.

Builds and verifies the exact canonical bytes documented by RustChain, then emits
an example request payload. It never performs network I/O or broadcasts a transfer.
The built-in private key is deterministic TEST MATERIAL only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

CHAIN_ID = "rustchain-mainnet-v2"
DEMO_PRIVATE_KEY_HEX = "11" * 32  # test-only, intentionally public


def raw_public_key(private_key: Ed25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def rtc_address(public_key_bytes: bytes) -> str:
    return "RTC" + hashlib.sha256(public_key_bytes).hexdigest()[:40]


def canonical_message(from_address: str, to_address: str, amount_rtc: str, memo: str, nonce: int) -> bytes:
    amount = Decimal(amount_rtc)
    if amount <= 0:
        raise ValueError("amount must be positive")
    canonical = {
        "from": from_address,
        "to": to_address,
        "amount": float(amount),
        "memo": memo,
        "nonce": str(nonce),
    }
    return json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")


def build_demo_payload(to_address: str, amount_rtc: str, memo: str, nonce: int) -> tuple[dict, bytes]:
    private_key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(DEMO_PRIVATE_KEY_HEX))
    public_key_bytes = raw_public_key(private_key)
    from_address = rtc_address(public_key_bytes)
    message = canonical_message(from_address, to_address, amount_rtc, memo, nonce)
    signature = private_key.sign(message)
    payload = {
        "from_address": from_address,
        "to_address": to_address,
        "amount_rtc": float(Decimal(amount_rtc)),
        "memo": memo,
        "nonce": nonce,
        "chain_id": CHAIN_ID,
        "public_key": public_key_bytes.hex(),
        "signature": signature.hex(),
    }
    return payload, message


def verify_payload(payload: dict) -> bool:
    public_key_bytes = bytes.fromhex(payload["public_key"])
    expected_from = rtc_address(public_key_bytes)
    if expected_from != payload["from_address"]:
        return False
    message = canonical_message(
        payload["from_address"],
        payload["to_address"],
        str(payload["amount_rtc"]),
        payload.get("memo", ""),
        int(payload["nonce"]),
    )
    try:
        Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(
            bytes.fromhex(payload["signature"]), message
        )
        return True
    except (InvalidSignature, ValueError):
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and verify a RustChain signed-transfer payload offline")
    parser.add_argument("--to", default="RTC" + "22" * 20, help="demo recipient RTC address")
    parser.add_argument("--amount", default="1.25", help="demo amount in RTC")
    parser.add_argument("--memo", default="offline-demo", help="demo memo")
    parser.add_argument("--nonce", type=int, default=1770000000, help="demo nonce")
    args = parser.parse_args()

    payload, message = build_demo_payload(args.to, args.amount, args.memo, args.nonce)
    print("canonical_utf8:", message.decode("utf-8"))
    print("from_address:", payload["from_address"])
    print("signature_valid:", verify_payload(payload))
    print("payload:")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if verify_payload(payload) else 2


if __name__ == "__main__":
    raise SystemExit(main())
