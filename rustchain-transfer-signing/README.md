# RustChain signed transfers, explained safely: build and verify the canonical bytes offline

A signed wallet request can fail even when the keypair is correct. The usual reason is not Ed25519 itself; it is **canonicalization**. The sender signs one exact byte string, while the server reconstructs another. A different field name, number representation, key order, whitespace choice, or nonce type changes the bytes and invalidates the signature.

RustChain's current wallet documentation defines both the HTTP payload for `POST /wallet/transfer/signed` and the smaller canonical object that must be signed. This tutorial turns that contract into a runnable **offline** Python demo. It derives a test RTC address, constructs the canonical JSON bytes, signs them with Ed25519, rebuilds the HTTP-shaped payload, and verifies the signature again. It deliberately performs **zero network I/O** and cannot broadcast a transfer.

Upstream references:

- RustChain repository: https://github.com/Scottcjn/Rustchain
- Wallet setup and signed-transfer example: https://github.com/Scottcjn/Rustchain/blob/main/docs/WALLET_SETUP.md
- Wallet API documentation: https://github.com/Scottcjn/Rustchain/blob/main/docs/API.md
- Rust wallet implementation: https://github.com/Scottcjn/Rustchain/tree/main/rustchain-wallet

## 1. Two objects matter, not one

The HTTP request and the signed message are related, but they are not identical.

The documented HTTP payload uses fields such as:

```json
{
  "from_address": "RTC...",
  "to_address": "RTC...",
  "amount_rtc": 1.25,
  "memo": "offline-demo",
  "nonce": 1770000000,
  "chain_id": "rustchain-mainnet-v2",
  "public_key": "...",
  "signature": "..."
}
```

Before that request can exist, the signature is created over a canonical object with the shorter keys `from`, `to`, `amount`, `memo`, and `nonce`. The current wallet guide serializes that object with sorted keys and compact JSON separators. It also signs the nonce as a **string** inside the canonical object even though the outer HTTP payload carries the nonce as an integer.

Those details are easy to miss. Signing the pretty-printed request body, signing `from_address` instead of `from`, or serializing the nonce as a JSON number will produce different bytes.

## 2. Run a deterministic demo

The runnable file is [`rustchain_transfer_sign_demo.py`](./rustchain_transfer_sign_demo.py). It needs Python plus the widely used `cryptography` package:

```bash
python -m pip install cryptography
python rustchain_transfer_sign_demo.py
```

The script contains a deterministic private key consisting of repeated `0x11` bytes. That key is **test material on purpose**: it is public, reproducible, and must never hold funds. The demo derives the corresponding raw Ed25519 public key, then derives the RustChain address using the rule documented upstream:

```text
RTC + first 40 hex characters of SHA-256(raw Ed25519 public key)
```

For the built-in key, the resulting address is:

```text
RTC10ba682c8ad13513971e8b56881aab8bd702bb80
```

The script then produces this canonical byte string:

```json
{"amount":1.25,"from":"RTC10ba682c8ad13513971e8b56881aab8bd702bb80","memo":"offline-demo","nonce":"1770000000","to":"RTC2222222222222222222222222222222222222222"}
```

Notice three things: the keys are alphabetically sorted, there is no optional whitespace, and the nonce is quoted. Those bytes are what Ed25519 signs.

## 3. Verify before you ever think about broadcasting

`verify_payload()` does the reverse operation. It takes the public key from the payload, derives the expected RTC address, rejects an address/public-key mismatch, reconstructs the canonical bytes, and calls Ed25519 verification.

That creates a useful local preflight. You can prove that your serializer, address derivation, public key, and signature agree with each other without touching a live node.

This demo intentionally stops there. It does not import `requests`, `urllib`, `socket`, or any transfer client. There is no POST request and no code path capable of sending RTC. The goal is to understand and test the wire contract, not move funds.

## 4. Tampering should fail

The included [`test_transfer_sign_demo.py`](./test_transfer_sign_demo.py) runs five checks:

```bash
python -m unittest -v test_transfer_sign_demo.py
```

It verifies the untouched payload, checks the address derivation, confirms the exact canonical JSON representation, then changes the amount and recipient independently. Both mutations must fail signature verification.

That is the property a signed-transfer protocol is supposed to give you: a valid signature is tied to the exact intended recipient, amount, memo, nonce, and sender identity. Changing any signed field after signing invalidates the request.

## 5. Why float handling deserves attention

The upstream API currently exposes `amount_rtc` as a human-readable numeric field. The demo accepts the amount as text first and parses it with `Decimal` before placing the documented numeric value into the canonical object. This makes the input step explicit and avoids accidental arithmetic on a binary float before serialization.

For a production integration, the most important rule is simpler: **match the server's canonicalization contract exactly**. If the protocol changes, update both the signing and verification sides together and add a regression vector that freezes the expected bytes and signature.

## 6. A practical integration pattern

Before enabling any code that can send a transfer, keep an offline test vector in CI containing:

1. a test-only private key;
2. the expected public key and derived RTC address;
3. one canonical JSON byte string;
4. its expected signature;
5. negative tests that mutate each signed field.

That catches accidental serializer changes early. It is especially useful when one client is written in Python and another in Rust, JavaScript, or a mobile language: every implementation can compare itself against the same neutral vector.

RustChain's repository already has multiple wallet implementations and documentation layers, so a tiny canonical test vector is a cheap way to prevent clients from drifting apart.

## Reproduction evidence

The demo and tests in this folder were actually executed before publication. The exact terminal output is saved in [`evidence.txt`](./evidence.txt). Five tests passed, including amount and recipient tamper rejection.

The code uses a deliberately public test key and performs no network operation. **Do not replace the demo key with a real private key in a public repository.** Real wallet secrets belong in protected local storage or an encrypted keystore.

AI disclosure: this tutorial, demo, and tests were produced and executed by an OpenAI coding agent under operator authorization. No live transfer was attempted and no user funds were spent or deposited.
