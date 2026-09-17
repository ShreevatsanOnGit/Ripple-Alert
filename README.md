# Ripple Alert frontend

This repository contains the Ripple Alert frontend and the Windows release packaging wrapper for the Manipal infrastructure-resilience application. The simulation algorithms and network dataset remain in the separate FastAPI backend repository.

## Run locally

Install dependencies and start the frontend:

```bash
npm install
npm run dev
```

Run the frontend checks:

```bash
npm run typecheck
npm run build
```

## Windows release

From PowerShell on the development machine, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\build-release.ps1 `
  -BackendRoot C:\path\to\Cascade-Ripple-Alert\backend `
  -Python C:\path\to\Cascade-Ripple-Alert\backend\venv\Scripts\python.exe
```

This creates `RippleAlert-Windows.zip`. The release contains a PyInstaller-bundled
Python runtime, an `assets/` directory with the production frontend and
`manipal_network.json`, and a native application window. Extract the ZIP and
double-click `RippleAlert.exe`; it starts FastAPI on `127.0.0.1:8000`, waits for
`/health`, loads the frontend in the Ripple Alert window, and shuts down the
backend when that window closes. Python, Node.js, npm, and pip are not required
on the target machine. The launcher prefers localhost port 8000 and automatically
selects another free localhost port if 8000 is occupied. It opens the packaged app
inside an embedded Microsoft Edge WebView2 desktop window. The target machine must
have the Microsoft Edge WebView2 Runtime installed, which is included on current
Windows 10 and Windows 11 installations.

Development uses `http://localhost:8000` for the backend. Override it with the Vite environment variable when needed:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

Start the backend from the separate `Cascade-Ripple-Alert` repository. For the real Manipal network, configure its `NETWORK_JSON_PATH` to `data/manipal_network.json` before starting FastAPI:

```bash
NETWORK_JSON_PATH=../data/manipal_network.json uvicorn main:app --reload --port 8000
```

On Windows PowerShell, set the variable for the process before starting:

```powershell
$env:NETWORK_JSON_PATH = "..\data\manipal_network.json"
uvicorn main:app --reload --port 8000
```

The production build uses same-origin API requests, so the packaged browser only
connects to the local FastAPI server. The UI uses the backend responses from
`/network`, `/criticality`, `/simulate-failure`, and `/explain`. Impact metrics and
incident text are never calculated or fabricated in the frontend. The only active
basemap is keyless OpenStreetMap:
`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`.

## Troubleshooting

- If Windows blocks the executable, use the file's Properties dialog to unblock it
  or approve the SmartScreen prompt.
- If port 8000 is already in use, the launcher automatically selects another free
  localhost port. Startup errors are written to `ripple-alert.log` beside the executable.
- Map tiles require internet access; the local network and API remain available if
  OpenStreetMap tiles cannot be reached.
