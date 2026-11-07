"""Sign Google/Apple-style ID tokens with a throwaway RSA key and serve a matching JWKS."""

import time
from typing import Any

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

GOOGLE_AUDIENCE = "test-google-client.apps.googleusercontent.com"
APPLE_AUDIENCE = "app.repforge.mobile"


class RsaSigner:
    def __init__(self, kid: str = "test-key") -> None:
        self.kid = kid
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def jwk(self) -> dict[str, Any]:
        public: dict[str, Any] = dict(
            RSAAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        )
        public.update(kid=self.kid, alg="RS256", use="sig")
        return public

    def sign(self, claims: dict[str, Any], kid: str | None = None) -> str:
        return jwt.encode(
            claims, self.private_key, algorithm="RS256", headers={"kid": kid or self.kid}
        )


class FakeJwksFetcher:
    """Async stand-in for the HTTP JWKS fetch; counts calls and can simulate an outage."""

    def __init__(self, *signers: RsaSigner) -> None:
        self.keys = [signer.jwk() for signer in signers]
        self.calls = 0
        self.fail = False

    async def __call__(self, url: str) -> dict[str, Any]:
        self.calls += 1
        if self.fail:
            raise httpx.ConnectError("provider down")
        return {"keys": list(self.keys)}


def google_claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": GOOGLE_AUDIENCE,
        "sub": "google-sub-123",
        "email": "Lifter@Example.com",
        "email_verified": True,
        "name": "Gym Lifter",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return claims


def apple_claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "https://appleid.apple.com",
        "aud": APPLE_AUDIENCE,
        "sub": "apple-sub-456",
        "email": "relay@privaterelay.appleid.com",
        "email_verified": "true",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return claims
