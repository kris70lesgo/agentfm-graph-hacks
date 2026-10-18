"""Deterministic task agent for an offline, key-free mesh demonstration.

This is intentionally not an LLM. Replace this image with any Warp agent
image to use inference while retaining the same graph routing and memory.
"""
import json
import os
from pathlib import Path
import sys
import time

prompt = sys.argv[1] if len(sys.argv) > 1 else "Plan the next release"
agent = os.environ.get("WARP_MODEL", "local-planner")
print(f"{agent} accepted the planning task.", flush=True)
if "DEMO_SLOW" in prompt or "DEMO_HOLD" in prompt:
    total = 18 if "DEMO_HOLD" in prompt else 6
    for step in range(1, total + 1):
        print(f"Working on step {step}/{total}…", flush=True)
        time.sleep(1)
if "DEMO_FAIL" in prompt:
    print("Controlled demo failure: this task did not complete.", file=sys.stderr, flush=True)
    sys.exit(1)

goal = prompt.replace("DEMO_SLOW", "").replace("DEMO_HOLD", "").strip()
if "user:" in goal:
    goal = goal.rsplit("user:", 1)[1].split("assistant:", 1)[0].strip()
goal = goal[:600]
steps = [
    f"Define acceptance criteria for: {goal}",
    "Map affected components and their dependencies before assigning work.",
    "Implement the smallest useful change and capture its output as an artifact.",
    "Run focused checks, review the outcome, and record what the next agent should reuse.",
]
result = {"agent": agent, "mode": "deterministic-demo", "goal": goal, "steps": steps}
output = Path("/tmp/output")
output.mkdir(parents=True, exist_ok=True)
(output / "plan.json").write_text(json.dumps(result, indent=2))
text = "## Delivery plan\n\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
(output / "plan.md").write_text(text)
print(text, flush=True)
print("\nArtifacts: plan.json, plan.md", flush=True)
