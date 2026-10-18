#!/usr/bin/env python3
"""Compatibility entry point for the clean Warp Playwright recording."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
subprocess.run(["node", str(ROOT / "scripts/record_warp_demo.mjs")], cwd=ROOT, check=True)
