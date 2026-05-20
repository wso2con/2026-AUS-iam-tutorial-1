"""
 Copyright (c) 2025, WSO2 LLC. (http://www.wso2.com). All Rights Reserved.

  Smart Employee Agent — Agent Server (Resource Server)

  A FastAPI server that:
  - Hosts a LangChain AI agent connected to the WayFinder MCP server
  - Manages its own credentials for basic MCP access (Pattern 2)
  - Handles OBO flow for elevated user-specific actions (Pattern 3)
  - Maintains per-user sessions with chat history

  No internal employee IDs — user identity comes from JWT tokens.
"""

import os
import logging
from datetime import date

from dotenv import load_dotenv
load_dotenv()

# Disable SSL verification for self-signed certificates (dev only)
if os.getenv("DISABLE_SSL_VERIFY", "").lower() == "true":
    import warnings
    import httpx
    warnings.warn("SSL verification disabled — for development/testing only!", stacklevel=1)
    _orig_httpx_init = httpx.AsyncClient.__init__
    def _patched_httpx_init(self, *args, **kwargs):
        kwargs.setdefault("verify", False)
        _orig_httpx_init(self, *args, **kwargs)
    httpx.AsyncClient.__init__ = _patched_httpx_init

from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

import jwt as pyjwt
from jwt.algorithms import RSAAlgorithm
import httpx

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain.agents import create_agent
from langchain_google_genai import ChatGoogleGenerativeAI

import uvicorn

from session import SessionStore, UserSession
from agent_auth import AgentAuth
import obo_flow

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Configuration ───────────────────────────────────────────────────────────

def _resolve_wayfinder_mcp_url() -> str:
    """
    Prefer an explicit WAYFINDER_MCP_SERVER_URL when it's a real http(s) URL.
    Otherwise fall back to the Choreo Connection-injected service URL.
    Choreo doesn't expand ${VAR} placeholders in config values, so a value
    like "${CHOREO_HR_SERVER_SERVICEURL}/mcp" reaches us literally — treat
    that as "not set" and use the actual env var instead.
    """
    explicit = os.getenv("WAYFINDER_MCP_SERVER_URL", "")
    if explicit.startswith(("http://", "https://")):
        return explicit
    base = os.getenv("CHOREO_HR_SERVER_SERVICEURL", "").rstrip("/")
    if base:
        return f"{base}/mcp"
    return "http://localhost:8000/mcp"


WAYFINDER_MCP_SERVER_URL = _resolve_wayfinder_mcp_url()
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")
logger.info("WayFinder MCP server URL: %s", WAYFINDER_MCP_SERVER_URL)

# Cap on chat-history turns replayed to the model per request (user+assistant = 1 turn).
MAX_CHAT_HISTORY_TURNS = int(os.getenv("MAX_CHAT_HISTORY_TURNS", "20"))

# JWT validation config
JWKS_URL = os.getenv("JWKS_URL")
AUTH_ISSUER = os.getenv("AUTH_ISSUER")
TOKEN_AUDIENCE = os.getenv("TOKEN_AUDIENCE")

# ─── JWT Validation ──────────────────────────────────────────────────────────

_jwks_cache = None


async def _fetch_jwks():
    """Fetch and cache JWKS keys from Asgardeo."""
    global _jwks_cache
    async with httpx.AsyncClient() as client:
        resp = await client.get(JWKS_URL)
        resp.raise_for_status()
        _jwks_cache = resp.json()
    return _jwks_cache


async def validate_user_token(token: str) -> dict:
    """Validate a user JWT and return the payload.

    Checks signature, expiry, issuer, audience, and scopes.
    """
    global _jwks_cache

    try:
        header = pyjwt.get_unverified_header(token)
        jwks = _jwks_cache or await _fetch_jwks()

        kid = header.get("kid")
        signing_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                signing_key = RSAAlgorithm.from_jwk(key)
                break

        if not signing_key:
            jwks = await _fetch_jwks()
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    signing_key = RSAAlgorithm.from_jwk(key)
                    break
            if not signing_key:
                raise HTTPException(status_code=401, detail="Invalid token: unknown signing key")

        payload = pyjwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=AUTH_ISSUER,
            audience=TOKEN_AUDIENCE,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_aud": True,
            },
        )

        return payload

    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        raise HTTPException(status_code=401, detail="Token validation failed")


# ─── Globals ─────────────────────────────────────────────────────────────────

agent_auth = AgentAuth()
sessions = SessionStore()

# ─── Helper Functions ────────────────────────────────────────────────────────


# def determine_role(scopes: list[str]) -> str:
#     """Derive the user's role from their token scopes."""
#     if "hr_approve_rest" in scopes:
#         return "HR Admin"
#     return "Employee"


def build_system_prompt(session: UserSession) -> str:
    """Build a dynamic system prompt based on the user's identity and role."""
    # name = session.user_name or "User"
    # role = session.user_role or "Employee"
    has_obo = session.has_valid_obo

    # role_capabilities = {
    #     "Employee": (
    #         "- View company holidays and leave policy\n"
    #         "- View your own leave balance\n"
    #         "- View your own leave requests\n"
    #         "- Apply for leave (Annual, Sick, or Personal)"
    #     ),
    #     "HR Admin": (
    #         "- Everything an Employee can do, plus:\n"
    #         "- View all leave requests across the organization\n"
    #         "- View detailed information about any leave request\n"
    #         "- Approve or reject pending leave requests"
    #     ),
    # }

    # capabilities = role_capabilities.get(role, role_capabilities["Employee"])

    if not has_obo:
        auth_guidance = (
            "**Authorization Status**: You currently have basic access only "
            "(company holidays and leave policy).\n"
            '- If the create_booking tool returns an "insufficient_scope" error, tell the user: '
            '"I need your authorization to perform this action. '
            'Please click the Authorize button to grant me access."\n'
            '- If any other tool returns an "insufficient_scope" error, explain that you cannot '
            "perform that action with your current permissions. Do not ask for authorization.\n"
            "- Do NOT retry create_booking — the client will handle the authorization popup.\n"
        )
    else:
        auth_guidance = (
            "**Authorization Status**: You have been authorized by the user "
            "and can perform actions on their behalf.\n"
            '- If a tool returns an "insufficient_scope" error, this means the user\'s role '
            "does NOT have permission for this action. Explain politely what their role can "
            "do instead. Do NOT ask for re-authorization.\n"
            '- If a tool returns a "token_expired" error, tell the user their authorization '
            "has expired and ask them to re-authorize.\n"
        )

    today = date.today()

    return f"""You are the WayFinder Concierge, a smart AI assistant.
You help users with flight booking. 

**Today's date is {today.isoformat()}. The current year is {today.year}.**
Always use the current year for any date-related operations.

Very IMPORTANT: Never ask for the internal details like flight IDs from user. Instead, resolve such information 
using the internally available tools.

{auth_guidance}

**Important guidelines:**
- Never initiate requesting authorization for booking a flight until all required information is gathered.
- Be clear and concise. Include relevant details like names, dates, and status."""


def _create_mcp_client(access_token: str) -> MultiServerMCPClient:
    """Create an MCP client with the given access token."""
    return MultiServerMCPClient(
        {
            "wayfinder_mcp_server": {
                "transport": "streamable_http",
                "url": WAYFINDER_MCP_SERVER_URL,
                "headers": {"Authorization": f"Bearer {access_token}"},
            },
        }
    )


def _extract_text(content) -> str:
    """Extract plain text from a LangChain message content."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block["text"])
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return str(content)


def _check_tool_errors(response) -> tuple:
    """Check tool responses for auth-related errors.

    Returns (error_type, error_message, tool_name) or (None, None, None).
    """
    tool_call_names = _collect_tool_call_names(response)
    first_auth_error = (None, None, None)

    for message in response.get("messages", []):
        if hasattr(message, "type") and message.type == "tool":
            content = str(message.content)
            error_type = _auth_error_from_text(content)
            if not error_type:
                continue

            tool_name = _get_tool_message_name(message, tool_call_names)
            if _is_create_booking_tool(tool_name):
                return error_type, content, tool_name
            if not first_auth_error[0]:
                first_auth_error = (error_type, content, tool_name)

    return first_auth_error


def _collect_tool_call_names(response) -> dict:
    """Map tool call IDs to tool names from AI messages in a LangChain response."""
    tool_call_names = {}

    for message in response.get("messages", []):
        for tool_call in getattr(message, "tool_calls", []) or []:
            if isinstance(tool_call, dict):
                tool_call_id = tool_call.get("id")
                tool_name = tool_call.get("name")
            else:
                tool_call_id = getattr(tool_call, "id", None)
                tool_name = getattr(tool_call, "name", None)

            if tool_call_id and tool_name:
                tool_call_names[tool_call_id] = tool_name

    return tool_call_names


def _get_tool_message_name(message, tool_call_names: dict) -> str | None:
    """Return the MCP tool name for a LangChain ToolMessage when available."""
    for attr in ("name", "tool_name"):
        value = getattr(message, attr, None)
        if value:
            return str(value)

    tool_call_id = getattr(message, "tool_call_id", None)
    if tool_call_id:
        return tool_call_names.get(tool_call_id)

    return None


def _is_create_booking_tool(tool_name: str | None) -> bool:
    """Handle exact or MCP-server-prefixed create_booking tool names."""
    return bool(tool_name) and (
        tool_name == "create_booking"
        or tool_name.endswith("_create_booking")
    )


def _auth_error_mentions_create_booking(message: str | None) -> bool:
    """Best-effort guard for raised tool exceptions that include tool context."""
    if not message:
        return False

    normalized = message.lower()
    return "create_booking" in normalized or "create booking" in normalized


def _iter_exception_messages(error: BaseException, seen: set[int] | None = None):
    """Yield message text from an exception tree, including ExceptionGroup children."""
    if seen is None:
        seen = set()

    error_id = id(error)
    if error_id in seen:
        return
    seen.add(error_id)

    yield str(error)
    yield repr(error)

    for nested in getattr(error, "exceptions", []) or []:
        yield from _iter_exception_messages(nested, seen)

    for nested in (getattr(error, "__cause__", None), getattr(error, "__context__", None)):
        if nested:
            yield from _iter_exception_messages(nested, seen)


def _auth_error_from_text(text: str) -> str | None:
    """Return auth-related error type if present in text."""
    normalized = text.lower()
    if "token_expired" in normalized or "token expired" in normalized:
        return "token_expired"
    if "insufficient_scope" in normalized or "insufficient scope" in normalized:
        return "insufficient_scope"
    return None


def _check_exception_auth_error(error: BaseException) -> tuple:
    """Check raised agent/tool exceptions for auth-related errors."""
    for message in _iter_exception_messages(error):
        error_type = _auth_error_from_text(message)
        if error_type:
            return error_type, message
    return None, None


def _auth_error_response(
    error_type: str,
    session: UserSession,
    user_message: str,
    fallback_message: str | None = None,
) -> JSONResponse:
    """Build the same response for auth errors from tool messages or exceptions."""
    if error_type == "token_expired":
        session.pending_message = user_message
        return JSONResponse({
            "type": "obo_required",
            "message": "Your authorization has expired. Please re-authorize to continue.",
        })

    if error_type == "insufficient_scope":
        if not session.has_valid_obo and not session.obo_expired:
            session.pending_message = user_message
            return JSONResponse({
                "type": "obo_required",
                "message": fallback_message or (
                    "I need your authorization to perform this action. "
                    "Please click the Authorize button to grant me access."
                ),
            })
        if session.obo_expired:
            session.pending_message = user_message
            return JSONResponse({
                "type": "obo_required",
                "message": "Your authorization has expired. Please re-authorize to continue.",
            })

        # return JSONResponse({
        #     "type": "response",
        #     "message": fallback_message or "You do not have permission to perform this action.",
        #     "refresh_dashboard": False,
        # })

    return JSONResponse(
        {"type": "error", "message": "Unknown authorization error."},
        status_code=500,
    )


# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(title="WayFinder Travel Agent")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def get_session(request: Request) -> UserSession:
    """FastAPI dependency: validate JWT and return the user's session."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    token = auth_header[7:]
    payload = await validate_user_token(token)

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    session = sessions.get_or_create(sub)

    # Update session with latest token info
    scopes = payload.get("scope", "").split()
    session.user_scopes = scopes

    # Extract name — prefer given_name + last_name, fallback to name claim
    first_name = payload.get("given_name") or ""
    last_name = payload.get("last_name") or ""
    if first_name or last_name:
        session.user_name = f"{first_name} {last_name}".strip()
    else:
        session.user_name = (
            payload.get("name")
            or payload.get("preferred_username")
        )
    # session.user_role = determine_role(scopes)

    return session


# ─── Startup ─────────────────────────────────────────────────────────────────


@app.on_event("startup")
async def startup():
    """Authenticate the agent on startup."""
    logger.info("Authenticating agent with Asgardeo...")
    await agent_auth.ensure_valid_token()
    logger.info("Agent server ready on :5001")


# ─── Chat Endpoint ───────────────────────────────────────────────────────────


@app.post("/api/chat")
async def chat(request: Request, session: UserSession = Depends(get_session)):
    """Process a user message through the AI agent.

    Uses OBO token if available, otherwise falls back to agent token.
    Detects auth errors and returns appropriate response types.
    """
    body = await request.json()
    user_message = body.get("message", "").strip()
    if not user_message:
        return JSONResponse(
            {"type": "error", "message": "Message cannot be empty."},
            status_code=400,
        )

    # Determine which token to use for MCP calls
    if session.has_valid_obo:
        access_token = session.obo_token.access_token
    else:
        agent_token = await agent_auth.ensure_valid_token()
        access_token = agent_token.access_token

    mcp_client = _create_mcp_client(access_token)

    try:
        tools = await mcp_client.get_tools()

        llm = ChatGoogleGenerativeAI(model=MODEL_NAME, temperature=0.7)
        agent = create_agent(llm, tools)

        system_prompt = build_system_prompt(session)
        messages = [{"role": "system", "content": system_prompt}]
        # Replay only the most recent N turns to bound latency/cost and avoid
        # blowing past the model's context window.
        history_window = session.chat_history[-(MAX_CHAT_HISTORY_TURNS * 2):]
        messages.extend(history_window)
        messages.append({"role": "user", "content": user_message})

        response = await agent.ainvoke({"messages": messages})

    except Exception as e:
        error_type, error_message = _check_exception_auth_error(e)
        if error_type and _auth_error_mentions_create_booking(error_message):
            logger.warning(
                "Agent invocation raised create_booking auth-related tool error: %s (%s)",
                error_type,
                error_message,
            )
            return _auth_error_response(error_type, session, user_message)
        if error_type:
            logger.warning(
                "Agent invocation raised non-booking auth-related tool error: %s (%s)",
                error_type,
                error_message,
            )
            return JSONResponse({
                "type": "response",
                "message": "I do not have permission to perform that action.",
                "refresh_dashboard": False,
            })

        logger.exception("Agent invocation failed")
        # ExceptionGroup (TaskGroup) hides the real cause — surface the inner exceptions too.
        detail = str(e)
        sub_excs = getattr(e, "exceptions", None)
        if sub_excs:
            for i, sub in enumerate(sub_excs):
                logger.error("  sub-exception %d: %r", i, sub, exc_info=sub)
            detail = "; ".join(repr(s) for s in sub_excs)
        return JSONResponse(
            {"type": "error", "message": f"Agent error: {detail}"},
            status_code=500,
        )

    # Check for auth-related errors in tool responses
    error_type, _, tool_name = _check_tool_errors(response)
    agent_reply = _extract_text(response["messages"][-1].content)

    if error_type and _is_create_booking_tool(tool_name):
        return _auth_error_response(error_type, session, user_message, agent_reply)
    if error_type:
        logger.info(
            "Ignoring auth-related tool response from non-booking tool: %s (%s)",
            tool_name or "unknown",
            error_type,
        )

    # Successful response — append and trim to the configured window.
    session.chat_history.append({"role": "user", "content": user_message})
    session.chat_history.append({"role": "assistant", "content": agent_reply})
    max_msgs = MAX_CHAT_HISTORY_TURNS * 2
    if len(session.chat_history) > max_msgs:
        del session.chat_history[:-max_msgs]
    session.pending_message = None

    return JSONResponse({
        "type": "response",
        "message": agent_reply,
        "refresh_dashboard": True,
    })


# ─── OBO Flow Endpoints ─────────────────────────────────────────────────────


@app.get("/api/obo/url")
async def get_obo_url(session: UserSession = Depends(get_session)):
    """Generate OBO authorization URL for the consent popup."""
    auth_url, state, code_verifier = await obo_flow.get_authorization_url(agent_auth)

    session.obo_code_verifier = code_verifier
    session.obo_pkce_state = state

    return JSONResponse({"auth_url": auth_url})


@app.get("/api/obo/callback")
async def obo_callback(code: str = None, state: str = None, error: str = None):
    """Handle OBO redirect from Asgardeo.

    Browser redirect (not API call), so no JWT validation.
    Session identified by the state parameter from the PKCE flow.
    """
    if error:
        logger.warning(f"OBO OAuth error: {error}")
        return HTMLResponse(content=obo_flow.callback_html(success=False, error=error))

    if not code:
        return HTMLResponse(
            content=obo_flow.callback_html(success=False, error="Missing authorization code")
        )

    if not state:
        return HTMLResponse(
            content=obo_flow.callback_html(success=False, error="Missing state parameter")
        )

    session = sessions.find_by_obo_state(state)
    if not session:
        return HTMLResponse(
            content=obo_flow.callback_html(success=False, error="Invalid state parameter")
        )

    try:
        obo_token, scopes, expires_at = await obo_flow.exchange_code(
            agent_auth, code, session.obo_code_verifier
        )

        session.obo_token = obo_token
        session.obo_scopes = scopes
        session.obo_expires_at = expires_at
        session.obo_code_verifier = None
        session.obo_pkce_state = None

        logger.info(f"OBO token stored for user {session.user_sub} (scopes: {scopes})")
        return HTMLResponse(content=obo_flow.callback_html(success=True))

    except Exception as e:
        logger.error(f"OBO token exchange failed: {e}")
        return HTMLResponse(content=obo_flow.callback_html(success=False, error=str(e)))


@app.get("/api/obo/status")
async def obo_status(session: UserSession = Depends(get_session)):
    """Check OBO authorization status."""
    if session.has_valid_obo:
        return JSONResponse({"authorized": True, "scopes": session.obo_scopes})
    return JSONResponse({"authorized": False})


@app.get("/api/obo/pending")
async def get_pending(session: UserSession = Depends(get_session)):
    """Get the pending message that triggered the OBO flow."""
    return JSONResponse({"pending_message": session.pending_message})


# ─── Logout Endpoint ─────────────────────────────────────────────────────────


@app.post("/api/logout")
async def logout(session: UserSession = Depends(get_session)):
    """Clear the user's agent session (OBO tokens, chat history).

    The SPA should call this on sign-out so that a subsequent login
    starts with a fresh session instead of reusing a stale OBO token.
    """
    sub = session.user_sub
    sessions.remove(sub)
    logger.info("Session cleared for user %s", sub)
    return JSONResponse({"success": True, "message": "Session cleared."})

# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = os.getenv("AGENT_SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_SERVER_PORT", os.getenv("PORT", "5001")))
    uvicorn.run(app, host=host, port=port)
