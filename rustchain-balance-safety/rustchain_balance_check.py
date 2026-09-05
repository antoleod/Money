#!/usr/bin/env python3
"""Read-only RustChain wallet balance checker with strict unit validation.

Uses only the Python standard library. It can read a captured JSON fixture or query
RustChain's public GET /wallet/balance endpoint. It never submits transactions.
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

MICRO_RTC = Decimal("1000000")
DEFAULT_NODE = "https://rustchain.org"


class BalanceError(ValueError):
    pass


@dataclass(frozen=True)
class Balance:
    miner_id: str
    amount_i64: int
    amount_rtc: Decimal

    @property
    def expected_i64(self) -> int:
        scaled = self.amount_rtc * MICRO_RTC
        if scaled != scaled.to_integral_value():
            raise BalanceError(
                f"amount_rtc has more than 6 decimal places: {self.amount_rtc}"
            )
        return int(scaled)

    @property
    def units_match(self) -> bool:
        return self.amount_i64 == self.expected_i64


def parse_balance(payload: Any) -> Balance:
    if not isinstance(payload, dict):
        raise BalanceError("response must be a JSON object")

    miner_id = payload.get("miner_id")
    amount_i64 = payload.get("amount_i64")
    amount_rtc_raw = payload.get("amount_rtc")

    if not isinstance(miner_id, str) or not miner_id.strip():
        raise BalanceError("miner_id must be a non-empty string")
    if isinstance(amount_i64, bool) or not isinstance(amount_i64, int):
        raise BalanceError("amount_i64 must be an integer")

    try:
        amount_rtc = Decimal(str(amount_rtc_raw))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BalanceError("amount_rtc must be a decimal-compatible number") from exc

    if amount_i64 < 0 or amount_rtc < 0:
        raise BalanceError("negative balances are rejected by this checker")

    return Balance(miner_id=miner_id, amount_i64=amount_i64, amount_rtc=amount_rtc)


def read_fixture(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def fetch_balance(node: str, wallet: str, insecure: bool, timeout: float) -> Any:
    url = f"{node.rstrip('/')}/wallet/balance?{urlencode({'miner_id': wallet})}"
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "rtc-balance-check/1.0"})
    context = ssl._create_unverified_context() if insecure else ssl.create_default_context()
    with urlopen(request, timeout=timeout, context=context) as response:
        if response.status != 200:
            raise BalanceError(f"HTTP {response.status} from balance endpoint")
        return json.loads(response.read().decode("utf-8"))


def render(balance: Balance) -> str:
    status = "OK" if balance.units_match else "MISMATCH"
    return "\n".join(
        [
            f"wallet: {balance.miner_id}",
            f"amount_rtc: {balance.amount_rtc}",
            f"amount_i64: {balance.amount_i64}",
            f"expected_i64: {balance.expected_i64}",
            f"unit_check: {status}",
        ]
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only RustChain balance checker with micro-RTC consistency validation."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--fixture", type=Path, help="read a saved wallet/balance JSON response")
    source.add_argument("--wallet", help="query this miner_id/RTC wallet on the public node")
    parser.add_argument("--node", default=DEFAULT_NODE, help=f"node base URL (default: {DEFAULT_NODE})")
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="disable TLS certificate verification only when the node uses its documented self-signed certificate",
    )
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP timeout in seconds")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.fixture:
            payload = read_fixture(args.fixture)
        else:
            payload = fetch_balance(args.node, args.wallet, args.insecure, args.timeout)
        balance = parse_balance(payload)
        print(render(balance))
        return 0 if balance.units_match else 2
    except (BalanceError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
