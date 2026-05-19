"""
 Copyright (c) 2025, WSO2 LLC. (http://www.wso2.com). All Rights Reserved.

  Agent Token Management

  Manages the agent's own identity token using Asgardeo's App Native
  Authentication flow. The agent authenticates as a first-class identity
  (registered under Console > Agents) — not via client credentials.
  Auto-refreshes the token when it approaches expiry (30-second buffer).
"""

import logging
import os
import time
from typing import Any

import httpx
from asgardeo import (
    AsgardeoConfig,
    AuthenticationError,
    NetworkError,
    OAuthToken,
    TokenError,
    generate_pkce_pair,
)
from asgardeo_ai import AgentConfig

logger = logging.getLogger(__name__)

REFRESH_BUFFER_SECONDS = 30


def _required_env(key: str) -> str:
    """Read an environment variable or raise if missing/empty."""
    value = os.getenv(key)
    if not value:
        raise ValueError(f"Missing required environment variable: {key}")
    return value


class AgentAuth:
    """Manages the agent's own token via Asgardeo App Native Auth."""

    def __init__(self):
        self._base_url = _required_env("ASGARDEO_BASE_URL").rstrip("/")
        self._client_id = _required_env("ASGARDEO_CLIENT_ID")
        self._client_secret = _required_env("ASGARDEO_CLIENT_SECRET")
        self._redirect_uri = _required_env("OBO_REDIRECT_URI")
        self._agent_id = _required_env("AGENT_ID")
        self._agent_secret = _required_env("AGENT_SECRET")
        self._agent_resource = os.getenv("AGENT_RESOURCE")

        self._asgardeo_config = AsgardeoConfig(
            base_url=self._base_url,
            client_id=self._client_id,
            redirect_uri=self._redirect_uri,
            client_secret=self._client_secret,
        )
        self._agent_config = AgentConfig(
            agent_id=self._agent_id,
            agent_secret=self._agent_secret,
        )
        self._token = None
        self._expires_at: float = 0.0

    @property
    def asgardeo_config(self) -> AsgardeoConfig:
        """Asgardeo configuration for SDK calls."""
        return self._asgardeo_config

    @property
    def agent_config(self) -> AgentConfig:
        """Agent configuration for SDK calls."""
        return self._agent_config

    async def ensure_valid_token(self):
        """Return a valid agent token, refreshing if needed."""
        if self._token and time.time() < (self._expires_at - REFRESH_BUFFER_SECONDS):
            return self._token

        scopes = _required_env("AGENT_SCOPES").split()
        logger.info("Obtaining agent token via manual App Native Auth flow...")
        self._token = await self._obtain_agent_token(scopes)

        if hasattr(self._token, "expires_in") and self._token.expires_in:
            self._expires_at = time.time() + self._token.expires_in
        else:
            self._expires_at = time.time() + 3600

        logger.info("Agent token obtained for scopes: " + " ".join(scopes))
        return self._token

    async def _obtain_agent_token(self, scopes: list[str]) -> OAuthToken:
        """Run Asgardeo's direct authorization-code flow for an AI agent."""
        code_verifier, code_challenge = generate_pkce_pair()

        async with httpx.AsyncClient() as client:
            authorize_response = await self._initiate_authorize_flow(
                client,
                scopes,
                code_challenge,
            )

            auth_data = await self._complete_agent_authentication(
                client,
                authorize_response,
            )

            code = auth_data.get("code")
            if not code:
                raise TokenError("No authorization code received from authentication flow.")

            return await self._exchange_code_for_token(client, code, code_verifier)

    async def _initiate_authorize_flow(
        self,
        client: httpx.AsyncClient,
        scopes: list[str],
        code_challenge: str,
    ) -> dict[str, Any]:
        data = {
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "response_type": "code",
            "redirect_uri": self._redirect_uri,
            "scope": " ".join(scopes),
            "response_mode": "direct",
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if self._agent_resource:
            data["resource"] = self._agent_resource

        try:
            response = await client.post(
                f"{self._base_url}/oauth2/authorize",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data=data,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise AuthenticationError(
                f"Authentication initiation failed: {e.response.status_code} {e.response.text}"
            )
        except httpx.RequestError as e:
            raise NetworkError(f"Network error during authentication initiation: {e!s}")

    async def _complete_agent_authentication(
        self,
        client: httpx.AsyncClient,
        authorize_response: dict[str, Any],
    ) -> dict[str, Any]:
        if "code" in authorize_response:
            return authorize_response

        if authorize_response.get("flowStatus") == "SUCCESS_COMPLETED":
            return authorize_response.get("authData", {})

        flow_id = authorize_response.get("flowId")
        authenticators = (
            authorize_response.get("nextStep", {}).get("authenticators", [])
        )
        username_authenticator = next(
            (
                authenticator
                for authenticator in authenticators
                if authenticator.get("authenticator") == "Username & Password"
                or {"username", "password"}.issubset(
                    set(authenticator.get("requiredParams", []))
                )
            ),
            None,
        )

        if not flow_id:
            raise AuthenticationError("No flowId received from authentication flow.")
        if not username_authenticator:
            raise AuthenticationError("No username/password authenticator found.")

        try:
            response = await client.post(
                f"{self._base_url}/oauth2/authn",
                headers={"Content-Type": "application/json"},
                json={
                    "flowId": flow_id,
                    "selectedAuthenticator": {
                        "authenticatorId": username_authenticator["authenticatorId"],
                        "params": {
                            "username": self._agent_id,
                            "password": self._agent_secret,
                        },
                    },
                },
            )
            response.raise_for_status()
            auth_response = response.json()
        except httpx.HTTPStatusError as e:
            raise AuthenticationError(
                f"Authentication step failed: {e.response.status_code} {e.response.text}"
            )
        except httpx.RequestError as e:
            raise NetworkError(f"Network error during authentication step: {e!s}")

        if "code" in auth_response:
            return auth_response
        if auth_response.get("flowStatus") == "SUCCESS_COMPLETED":
            return auth_response.get("authData", {})
        raise AuthenticationError(
            f"Agent authentication failed with status: {auth_response.get('flowStatus')}"
        )

    async def _exchange_code_for_token(
        self,
        client: httpx.AsyncClient,
        code: str,
        code_verifier: str,
    ) -> OAuthToken:
        data = {
            "grant_type": "authorization_code",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "code": code,
            "code_verifier": code_verifier,
            "redirect_uri": self._redirect_uri,
        }
        if self._agent_resource:
            data["resource"] = self._agent_resource

        try:
            response = await client.post(
                f"{self._base_url}/oauth2/token",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data=data,
            )
            response.raise_for_status()
            token_response = response.json()
            return OAuthToken(
                access_token=token_response["access_token"],
                id_token=token_response.get("id_token"),
                refresh_token=token_response.get("refresh_token"),
                expires_in=token_response.get("expires_in"),
                token_type=token_response.get("token_type", "Bearer"),
                scope=token_response.get("scope"),
            )
        except httpx.HTTPStatusError as e:
            raise TokenError(
                f"Token request failed: {e.response.status_code} {e.response.text}"
            )
        except httpx.RequestError as e:
            raise NetworkError(f"Network error during token request: {e!s}")
        except KeyError as e:
            raise TokenError(f"Missing required field in token response: {e!s}")
