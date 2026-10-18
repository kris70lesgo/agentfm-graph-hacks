"""Verify ``with_options`` returns a fresh client with overrides applied."""

from __future__ import annotations

import httpx

from warp import WarpClient, AsyncWarpClient


def test_with_options_overrides_retries():
    base = WarpClient(gateway_url="http://x:8080", retries=2)
    derived = base.with_options(retries=5)
    try:
        assert derived is not base
        assert derived.retries == 5
        assert base.retries == 2
        assert derived.gateway_url == base.gateway_url
    finally:
        base.close()
        derived.close()


def test_with_options_overrides_gateway_url():
    base = WarpClient(gateway_url="http://x:8080", retries=2)
    derived = base.with_options(gateway_url="http://y:9090")
    try:
        assert derived.gateway_url == "http://y:9090"
        assert base.gateway_url == "http://x:8080"
        assert derived.retries == base.retries
    finally:
        base.close()
        derived.close()


def test_with_options_overrides_timeout():
    base = WarpClient(gateway_url="http://x:8080", timeout=30.0)
    derived = base.with_options(timeout=httpx.Timeout(5.0))
    try:
        assert derived._http.timeout != base._http.timeout
    finally:
        base.close()
        derived.close()


def test_with_options_no_args_is_identity_clone():
    base = WarpClient(gateway_url="http://x:8080", retries=3)
    derived = base.with_options()
    try:
        assert derived is not base
        assert derived.gateway_url == base.gateway_url
        assert derived.retries == base.retries
        assert derived._http is not base._http
    finally:
        base.close()
        derived.close()


def test_with_options_inherits_unset_artifacts_dir(tmp_path):
    base = WarpClient(gateway_url="http://x:8080", artifacts_dir=tmp_path)
    derived = base.with_options(retries=10)
    try:
        assert derived.artifacts is not None
        assert derived.artifacts.watch_dir == tmp_path
    finally:
        base.close()
        derived.close()


def test_with_options_can_clear_artifacts_dir(tmp_path):
    base = WarpClient(gateway_url="http://x:8080", artifacts_dir=tmp_path)
    derived = base.with_options(artifacts_dir=None)
    try:
        assert derived.artifacts is None
        assert base.artifacts is not None
    finally:
        base.close()
        derived.close()


def test_with_options_async_client_overrides_retries():
    base = AsyncWarpClient(gateway_url="http://x:8080", retries=2)
    derived = base.with_options(retries=7)
    assert derived is not base
    assert derived.retries == 7
    assert base.retries == 2


def test_with_options_overrides_api_key():
    base = WarpClient(gateway_url="http://x:8080", api_key="parent")
    derived = base.with_options(api_key="child")
    try:
        assert derived.api_key == "child"
        assert base.api_key == "parent"
        assert derived._http.headers["Authorization"] == "Bearer child"
        assert base._http.headers["Authorization"] == "Bearer parent"
    finally:
        base.close()
        derived.close()


def test_with_options_clears_api_key_with_explicit_none():
    base = WarpClient(gateway_url="http://x:8080", api_key="parent")
    derived = base.with_options(api_key=None)
    try:
        assert derived.api_key is None
        assert base.api_key == "parent"
        assert "authorization" not in {k.lower() for k in derived._http.headers}
    finally:
        base.close()
        derived.close()


def test_with_options_async_overrides_api_key():
    base = AsyncWarpClient(gateway_url="http://x:8080", api_key="parent")
    derived = base.with_options(api_key="child")
    assert derived.api_key == "child"
    assert base.api_key == "parent"


def test_with_options_async_clears_api_key_with_explicit_none():
    base = AsyncWarpClient(gateway_url="http://x:8080", api_key="parent")
    derived = base.with_options(api_key=None)
    assert derived.api_key is None
    assert base.api_key == "parent"


def test_constructor_explicit_none_api_key_skips_env_fallback(monkeypatch):
    monkeypatch.setenv("WARP_API_KEY", "from-env")
    c = WarpClient(gateway_url="http://x:8080", api_key=None)
    try:
        assert c.api_key is None
        assert "authorization" not in {k.lower() for k in c._http.headers}
    finally:
        c.close()


def test_sync_client_del_tolerates_construction_failure(monkeypatch):
    import contextlib

    import warp.client as client_mod

    def boom(*args, **kwargs):
        raise RuntimeError("simulated httpx.Client construction failure")

    monkeypatch.setattr(client_mod, "make_client", boom)
    with contextlib.suppress(RuntimeError):
        WarpClient(gateway_url="http://x:8080")


def test_async_client_del_tolerates_construction_failure(monkeypatch):
    import contextlib

    import warp.async_client as async_client_mod

    def boom(*args, **kwargs):
        raise RuntimeError("simulated httpx.AsyncClient construction failure")

    monkeypatch.setattr(async_client_mod, "make_async_client", boom)
    with contextlib.suppress(RuntimeError):
        AsyncWarpClient(gateway_url="http://x:8080")
