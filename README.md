# Aerospace Mission Design & Simulation Platform

Production-grade monorepo with a **FastAPI** backend and a **Next.js** frontend.

## Project Structure

```
Armani/
├── backend/                 # Python / FastAPI API server
│   ├── core/                # Config & settings (Pydantic)
│   ├── models/              # Pydantic data models
│   ├── routers/             # API route handlers
│   ├── services/            # Business logic layer
│   ├── main.py              # App entry point
│   ├── requirements.txt
│   └── .env
├── frontend/                # Next.js (App Router) + Tailwind + shadcn/ui
│   └── src/
│       ├── app/             # Pages & layouts
│       ├── components/ui/   # shadcn/ui components
│       └── lib/             # Utilities (api.ts, utils.ts)
└── README.md
```

## Getting Started

### Prerequisites

| Tool    | Version |
|---------|---------|
| Python  | 3.11+   |
| Node.js | 18+     |
| npm     | 9+      |

### 1. Backend (port 8000)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/health` → `{"status":"ok"}`

### 2. Frontend (port 3000)

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The status indicator connects to the backend `/health` endpoint.

## Key Design Decisions

- **Separation of concerns** — routers handle HTTP, services hold logic, models define schemas.
- **Pydantic Settings** — typed, validated config loaded from `.env`.
- **CORS** — configured via `CORS_ORIGINS` env var; defaults to `http://localhost:3000`.
- **Typed API client** — `lib/api.ts` wraps `fetch` with generics and error handling.
- **Dark-first UI** — aerospace-themed dark palette with shadcn/ui components.
