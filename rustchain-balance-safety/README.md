# Read-only RustChain balance checks: verify RTC and micro-RTC before you trust a number

RustChain exposes a public wallet balance endpoint that is delightfully small: give it a `miner_id`, and it returns the wallet identifier plus the balance in two units. That simplicity is useful, but it also creates a subtle integration trap. A client may display the human-readable `amount_rtc` field while another part of the program uses `amount_i64`, the integer micro-RTC value. If parsing, rounding, or a stale API adapter makes those two values disagree, a wallet dashboard can show a plausible number that is internally inconsistent.

This tutorial builds a **read-only, standard-library Python checker** that treats the two balance fields as a contract. It can query the public RustChain node or replay a captured JSON response offline, rejects malformed or negative values, and verifies that `amount_i64 == amount_rtc × 1,000,000` exactly. It never signs or submits a transaction.

The upstream sources used here are the RustChain repository and its wallet/API documentation:

- RustChain: https://github.com/Scottcjn/Rustchain
- Wallet API docs: https://github.com/Scottcjn/Rustchain/blob/main/docs/API.md
- Wallet setup guide: https://github.com/Scottcjn/Rustchain/blob/main/docs/WALLET_SETUP.md

## 1. Understand the API contract

The current RustChain API documentation describes `GET /wallet/balance?miner_id=...` with a response like this:

```json
{
  "amount_i64": 118357193,
  "amount_rtc": 118.357193,
  "miner_id": "eafc6f14eab6d5c5362fe651e5e6c23581892a37RTC"
}
```

The important detail is the unit relationship. RustChain documents `amount_i64` as micro-RTC with six decimal places, while `amount_rtc` is the human-readable balance. Therefore the documented response should satisfy:

```text
118.357193 × 1,000,000 = 118,357,193
```

A robust client should check that relationship rather than assuming both fields are trustworthy merely because they are present.

## 2. Run the checker offline first

The runnable file in this folder is [`rustchain_balance_check.py`](./rustchain_balance_check.py). It uses only Python's standard library. Start with the captured response in [`sample-balance.json`](./sample-balance.json):

```bash
python rustchain_balance_check.py --fixture sample-balance.json
```

Expected output:

```text
wallet: eafc6f14eab6d5c5362fe651e5e6c23581892a37RTC
amount_rtc: 118.357193
amount_i64: 118357193
expected_i64: 118357193
unit_check: OK
```

The code converts `amount_rtc` through `Decimal(str(value))`, not binary floating-point multiplication. That matters because decimal currency-like units should not depend on the approximation behavior of IEEE floats. It also rejects more than six decimal places when converting back to micro-RTC.

## 3. Query the public node without sending anything

For a live balance lookup, pass a miner or wallet identifier:

```bash
python rustchain_balance_check.py --wallet YOUR_WALLET --insecure
```

The `--insecure` flag is explicit rather than automatic. RustChain's public documentation notes that its node may present a self-signed TLS certificate, so the client only disables certificate verification when the operator deliberately asks for the documented compatibility behavior. If the node later uses a normally trusted certificate, omit `--insecure`.

The live code constructs the query parameter with `urllib.parse.urlencode`, sends only an HTTP `GET`, requires HTTP 200, parses JSON, and then runs the same contract validation as fixture mode. There is no private key, signing code, POST request, or transfer endpoint in this utility.

## 4. Make failures loud

A balance checker is more useful when it refuses suspicious data instead of quietly formatting it. This implementation rejects:

- a non-object JSON response;
- a missing or blank `miner_id`;
- a non-integer `amount_i64`;
- a non-numeric `amount_rtc`;
- negative balances;
- human-readable balances that cannot map exactly to six-decimal micro-RTC units.

If both fields are individually valid but disagree, the program prints `unit_check: MISMATCH` and exits with status 2. That makes it suitable for CI or a monitoring script: a caller can distinguish a contract mismatch from an ordinary parsing/network error.

## 5. Test the edge cases

Run the included tests:

```bash
python -m unittest -v test_balance_check.py
```

The tests cover the documented happy path, a one-micro-RTC mismatch, rejection of negative balances, and rejection of over-precision. This is deliberately small; the goal is not to recreate a wallet. It is to put a hard read-only boundary around one public endpoint and make unit drift obvious.

A useful production extension would be to archive periodic balance snapshots and alert only when the validated integer amount changes. Another would be to apply the same contract-checking approach to RustChain's wallet history endpoint, comparing integer and human-readable transfer amounts before rendering them in a dashboard.

## Why this pattern is worth using

The interesting lesson is broader than RustChain: whenever an API returns the same value in a display unit and an integer base unit, treat the relationship as an invariant. Integer base units are great for deterministic accounting, while decimals are great for people. Checking one against the other at the API boundary gives you a cheap defense against schema drift, accidental rounding, and adapter bugs.

For RustChain specifically, this checker stays on the safest side of the wallet surface: public data in, validated text out. No funds move, no key material exists, and the runnable example can be tested entirely offline before a live request is ever attempted.

## Reproduction evidence

The fixture run and unit tests were actually executed against the files in this folder. The captured terminal output is in [`evidence.txt`](./evidence.txt). The fixture shape comes from the current upstream API documentation linked above.

AI disclosure: this tutorial and utility were produced by an OpenAI coding agent under operator authorization; the code was executed and its tests were checked before publication.
