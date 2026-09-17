"""One-click Ripple Alert runtime with an embedded WebView2 window."""

from __future__ import annotations

import logging
import os
from pathlib import Path
import socket
import sys
import threading
import time
import traceback

from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
import uvicorn
import webview


BACKEND_HOST = "127.0.0.1"
PREFERRED_BACKEND_PORT = 8000
HEARTBEAT_TIMEOUT_SECONDS = 12
REPORT_WINDOW = None


def application_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


ROOT = application_root()
ASSETS_ROOT = ROOT / "assets"
FRONTEND_ROOT = ASSETS_ROOT / "frontend"
DATA_ROOT = ASSETS_ROOT / "data"
LOG_PATH = (
    Path(sys.executable).resolve().parent / "ripple-alert.log"
    if getattr(sys, "frozen", False)
    else ROOT / "ripple-alert.log"
)


class RuntimeState:
    def __init__(self) -> None:
        self.last_heartbeat = time.monotonic()
        self.shutdown = threading.Event()


class ReportApi:
    def save_report(self, content: str, filename: str) -> bool:
        if REPORT_WINDOW is None:
            return False
        selected = REPORT_WINDOW.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=filename,
            file_types=("Text files (*.txt)", "All files (*.*)"),
        )
        if not selected:
            return False
        target = Path(selected[0] if isinstance(selected, (list, tuple)) else selected)
        target.write_text(content, encoding="utf-8")
        return True


def show_error(message: str) -> None:
    logging.exception(message)
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        messagebox.showerror("Ripple Alert could not start", f"{message}\n\nSee ripple-alert.log for details.")
        root.destroy()
    except Exception:
        pass


def wait_for_backend(port: int) -> None:
    import urllib.request

    deadline = time.monotonic() + 120
    url = f"http://{BACKEND_HOST}:{port}/health"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"The bundled backend did not become ready on port {port}.")


def choose_backend_port() -> int:
    for candidate in range(PREFERRED_BACKEND_PORT, PREFERRED_BACKEND_PORT + 11):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((BACKEND_HOST, candidate))
            except OSError:
                continue
            return int(probe.getsockname()[1])
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((BACKEND_HOST, 0))
        return int(probe.getsockname()[1])


def run() -> None:
    if not (FRONTEND_ROOT / "index.html").exists():
        raise RuntimeError("The production frontend is missing from the release package.")
    network_path = DATA_ROOT / "manipal_network.json"
    if not network_path.exists():
        raise RuntimeError("The bundled Manipal network data is missing from the release package.")

    backend_port = choose_backend_port()
    os.environ["NETWORK_JSON_PATH"] = str(network_path)
    import main as backend_main

    state = RuntimeState()
    backend_main.app.add_api_route(
        "/__ripple/heartbeat",
        lambda: heartbeat(state),
        methods=["POST", "GET"],
        include_in_schema=False,
    )
    backend_main.app.mount(
        "/",
        StaticFiles(directory=str(FRONTEND_ROOT), html=True),
        name="frontend",
    )

    backend_config = uvicorn.Config(
        backend_main.app,
        host=BACKEND_HOST,
        port=backend_port,
        log_level="warning",
        log_config=None,
    )
    backend_server = uvicorn.Server(backend_config)
    backend_thread = threading.Thread(target=backend_server.run, daemon=True)
    backend_thread.start()

    try:
        wait_for_backend(backend_port)
        report_api = ReportApi()
        application_url = f"http://{BACKEND_HOST}:{backend_port}/"
        from webview.platforms.winforms import _is_chromium

        if not _is_chromium():
            raise RuntimeError(
                "Microsoft Edge WebView2 Runtime is required to run Ripple Alert."
            )
        webview.create_window(
            "Ripple Alert",
            application_url,
            width=1440,
            height=900,
            min_size=(1024, 700),
            confirm_close=True,
            js_api=report_api,
        )
        global REPORT_WINDOW
        REPORT_WINDOW = webview.windows[0]
        webview.start(gui="edgechromium")
    finally:
        state.shutdown.set()
        backend_server.should_exit = True
        backend_thread.join(timeout=10)


def heartbeat(state: RuntimeState) -> Response:
    state.last_heartbeat = time.monotonic()
    return Response(status_code=204)


if __name__ == "__main__":
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    try:
        run()
    except Exception as error:
        logging.error("%s\n%s", error, traceback.format_exc())
        show_error(str(error))
