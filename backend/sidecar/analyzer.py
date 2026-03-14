#!/usr/bin/env python3
"""FocusLens analyzer sidecar.

Endpoints:
- POST /classify  { app: string, title: string, goal: string }
- POST /screenshot (stub)
"""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - import error handled at runtime
    OpenAI = None  # type: ignore[assignment]

HOST = "127.0.0.1"
PORT = 5001
MODEL = "gpt-4o-mini"
ENV_PATH_VAR = "FOCUSLENS_ENV_PATH"


def _resolve_env_path() -> Path:
    env_path = os.environ.get(ENV_PATH_VAR)
    if env_path:
        return Path(env_path)

    # backend/sidecar/analyzer.py -> project root is two levels up
    return Path(__file__).resolve().parents[2] / ".env"


def _read_api_key_from_env_file(env_path: Path) -> str | None:
    if not env_path.exists():
        return None

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if "=" not in line:
                continue

            key, value = line.split("=", 1)
            if key.strip() != "OPENAI_API_KEY":
                continue

            cleaned = value.strip().strip('"').strip("'")
            return cleaned or None
    except Exception:
        return None

    return None


def _load_openai_api_key() -> str | None:
    env_path = _resolve_env_path()
    return _read_api_key_from_env_file(env_path)


def _build_openai_client() -> Any:
    if OpenAI is None:
        raise RuntimeError("openai package is not installed")

    api_key = _load_openai_api_key()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY missing in .env")

    return OpenAI(api_key=api_key)


def _clamp_confidence(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, parsed))


def classify_with_openai(app_name: str, title: str, goal: str) -> dict[str, Any]:
    client = _build_openai_client()

    system_prompt = (
        "You classify whether activity is on-goal. "
        "Return strict JSON with keys: onGoal (boolean), confidence (0..1), reasoning (short string)."
    )
    user_prompt = (
        f"Goal: {goal}\n"
        f"App: {app_name}\n"
        f"Window Title: {title}\n\n"
        "Decide if this activity is helping the goal right now."
    )

    response = client.chat.completions.create(
        model=MODEL,
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    content = response.choices[0].message.content or "{}"
    parsed = json.loads(content)

    result = {
        "onGoal": bool(parsed.get("onGoal", False)),
        "confidence": _clamp_confidence(parsed.get("confidence", 0.0)),
        "reasoning": str(parsed.get("reasoning", "")),
    }
    return result


class AnalyzerHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/screenshot":
            self._send_json({"status": "not implemented"})
            return

        if self.path != "/classify":
            self._send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            payload = self._read_json_body()
        except Exception:
            self._send_json({"error": "invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)
            return

        app_name = payload.get("app")
        title = payload.get("title")
        goal = payload.get("goal")

        if not isinstance(app_name, str) or not isinstance(title, str) or not isinstance(goal, str):
            self._send_json(
                {"error": "body must include string fields: app, title, goal"},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        try:
            result = classify_with_openai(app_name=app_name, title=title, goal=goal)
            self._send_json(result)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[analyzer] {self.address_string()} - {format % args}")


def main() -> None:
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((HOST, PORT), AnalyzerHandler)
    print(f"[analyzer] starting on http://{HOST}:{PORT}")
    print(f"[analyzer] using env file path: {_resolve_env_path()}")
    server.serve_forever()


if __name__ == "__main__":
    main()
