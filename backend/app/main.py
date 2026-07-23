from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.ws import router as game_router

app = FastAPI(title="Duel backend")

# Wide open for local dev: the Vite dev server runs on a different port.
# Tighten this before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(game_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
