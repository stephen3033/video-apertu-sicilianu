from __future__ import annotations

import hashlib
import hmac
import secrets


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_digest(secret: str, challenge_id: str, code: str) -> str:
    message = f"code:{challenge_id}:{code}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def requester_ip_digest(secret: str, address: str) -> str:
    message = f"ip:{address}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def valid_code_format(code: str) -> bool:
    return len(code) == 6 and code.isascii() and code.isdigit()
