"""Exception hierarchy for the Warp SDK.

Mirrors the error envelope codes emitted by the Go gateway so callers can
``except`` on a specific failure mode without parsing strings.
"""

from __future__ import annotations

from typing import Any


class WarpError(Exception):
    """Base class for every error raised by the SDK."""

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status

    def __repr__(self) -> str:
        return f"{type(self).__name__}(message={self.message!r}, code={self.code!r}, status={self.status!r})"


class GatewayConnectionError(WarpError):
    """The local Go gateway is unreachable."""


class GatewayProtocolError(WarpError):
    """The gateway returned a response the SDK cannot decode.

    Reserved for malformed bodies / non-envelope 5xx responses. A well-formed
    error envelope reporting a server-side bug is :class:`GatewayInternalError`.
    """


class GatewayInternalError(WarpError):
    """The gateway returned a well-formed envelope reporting an internal bug.

    Distinguished from :class:`GatewayProtocolError` (decode failure) so
    callers can route real server bugs separately from SDK-side parsing
    issues. Maps to the gateway's ``internal_error`` code.
    """


class InvalidRequestError(WarpError):
    """Request was rejected by the gateway with a 4xx (other than 404 / 503)."""


class ModelNotFoundError(WarpError):
    """No worker on the mesh advertises the requested ``model`` field."""


class WorkerNotFoundError(WarpError):
    """The requested worker peer ID is not present in current telemetry."""


class AuthenticationError(WarpError):
    """Gateway rejected the request with HTTP 401 (missing or invalid API key)."""


class MeshOverloadedError(WarpError):
    """All matching workers are at capacity (HTTP 503 mesh_overloaded)."""


class WorkerUnreachableError(WarpError):
    """Gateway could not dial the selected worker via direct or relay."""


class WorkerStreamError(WarpError):
    """A worker stream failed mid-task (read error, decode error, etc.)."""


class TaskExecutionError(WarpError):
    """The worker accepted the task but execution failed on its side."""


class ArtifactError(WarpError):
    """Artifact zip handling failed (missing, corrupt, or unsafe)."""


# Mapping of Go gateway error codes -> Python exception classes. Used by the
# HTTP layer to translate ``{"error": {"code": "...", ...}}`` envelopes.
_CODE_MAP: dict[str, type[WarpError]] = {
    "model_not_found": ModelNotFoundError,
    "mesh_overloaded": MeshOverloadedError,
    "worker_unreachable": WorkerUnreachableError,
    "worker_stream_failed": WorkerStreamError,
    "model_required": InvalidRequestError,
    "prompt_required": InvalidRequestError,
    "unsupported_prompt_type": InvalidRequestError,
    "invalid_request_error": InvalidRequestError,
    "method_not_allowed": InvalidRequestError,
    "internal_error": GatewayInternalError,
    "unauthorized": AuthenticationError,
    "invalid_api_key": AuthenticationError,
}


def from_envelope(envelope: dict[str, Any], status: int) -> WarpError:
    """Build the right exception subclass from a Go error envelope dict.

    Always returns *some* :class:`WarpError`; never raises.
    """
    err = envelope.get("error") if isinstance(envelope, dict) else None
    if not isinstance(err, dict):
        return GatewayProtocolError(f"unparseable error envelope (HTTP {status})", status=status)
    raw_code = err.get("code")
    code: str | None = raw_code if isinstance(raw_code, str) else None
    raw_message = err.get("message")
    message: str = raw_message if isinstance(raw_message, str) else "unknown error"
    cls = _CODE_MAP.get(code, WarpError) if code else WarpError
    return cls(message, code=code, status=status)


__all__ = [
    "WarpError",
    "ArtifactError",
    "AuthenticationError",
    "GatewayConnectionError",
    "GatewayInternalError",
    "GatewayProtocolError",
    "InvalidRequestError",
    "MeshOverloadedError",
    "ModelNotFoundError",
    "TaskExecutionError",
    "WorkerNotFoundError",
    "WorkerStreamError",
    "WorkerUnreachableError",
    "from_envelope",
]
