#!/usr/bin/env python3
"""Package source and reviewed demo assets without dependencies or local state."""
from pathlib import Path
import os
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "dist/warp-graph-hacks.zip"
MEDIA_KEEP = {
    "output/warp-hackathon-final.mp4",
    "output/warp-preview.png",
    "output/playwright/warp-demo.mp4",
    "output/playwright/warp-coordination.png",
    "output/playwright/warp-graph-context.png",
    "output/warp-explainer/warp-graph-hd.mp4",
    "output/warp-explainer/warp-voiceover.mp3",
    "output/warp-explainer/warp-endcard.png",
}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".warp-demo", ".playwright-cli", ".agents", ".codex", ".impeccable", "dist", "out", "vendor", ".warp_temp", "warp_artifacts", "test-results", "playwright-report"}
SKIP_NAMES = {".DS_Store", "warp", "relay", "layout-check.png"}
PRIVATE_SUFFIXES = {".key", ".pem", ".crt", ".db", ".sqlite", ".sqlite3", ".log", ".pyc", ".zip", ".webm", ".tsbuildinfo"}


def included(path):
    rel = path.relative_to(ROOT)
    if rel.parts[0] == "output" and path.suffix.lower() in {".mp4", ".mp3", ".png"} and rel.as_posix() not in MEDIA_KEEP:
        return False
    if any(part in SKIP_DIRS for part in rel.parts[:-1]):
        return False
    if path.is_symlink() or path.name in SKIP_NAMES or path.suffix in PRIVATE_SUFFIXES:
        return False
    if path.name.startswith(".env") and path.name not in {".env.example", ".env.template"}:
        return False
    if path.name.endswith((".db-shm", ".db-wal", ".test", ".prof")):
        return False
    return True


def main():
    TARGET.parent.mkdir(exist_ok=True)
    count = 0
    with zipfile.ZipFile(TARGET, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for folder, directories, files in os.walk(ROOT):
            directories[:] = sorted(directory for directory in directories if directory not in SKIP_DIRS and not directory.endswith('.egg-info'))
            for name in sorted(files):
                path = Path(folder) / name
                if path.is_file() and included(path):
                    archive.write(path, Path("warp-graph-hacks") / path.relative_to(ROOT))
                    count += 1
    print(f"Packaged {count} files: {TARGET} ({TARGET.stat().st_size / 1024**2:.1f} MiB)")


if __name__ == "__main__":
    main()
