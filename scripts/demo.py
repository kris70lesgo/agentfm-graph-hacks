#!/usr/bin/env python3
"""Start, verify, and stop an isolated Warp + FalkorDB demonstration."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".warp-demo"
MANIFEST = STATE / "processes.json"
BIN = STATE / "bin" / "warp"
GATEWAYS = {"boss-a": 8080, "boss-b": 8081}
DB_PORT = int(os.environ.get("FALKORDB_PORT", "6380"))


def request(port, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(f"http://127.0.0.1:{port}{path}", data=data,
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=40) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw


def wait_for(probe, description, seconds=100):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            value = probe()
            if value:
                return value
        except (OSError, URLError, ValueError, KeyError) as error:
            last = error
        time.sleep(0.4)
    raise RuntimeError(f"Timed out waiting for {description}: {last}. Logs: {STATE}")


def run(command, cwd=ROOT):
    subprocess.run([str(part) for part in command], cwd=cwd, check=True)


def load_state():
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"processes": {}}


def save_state(state):
    MANIFEST.write_text(json.dumps(state, indent=2))


def environment():
    return {**os.environ, "FALKORDB_ADDR": f"127.0.0.1:{DB_PORT}",
            "FALKORDB_GRAPH": "warp_graph_hacks", "FALKORDB_MESH_ID": "graph-hacks-local",
            "FALKORDB_USERNAME": "", "FALKORDB_PASSWORD": "", "FALKORDB_TLS": "false", "WARP_API_KEYS": ""}


def alive(process):
    try:
        command = subprocess.check_output(["ps", "-p", str(process["pid"]), "-o", "command="], text=True).strip()
        return all(part in command for part in process["command"])
    except subprocess.CalledProcessError:
        return False


def spawn(name, command, state, workdir=None):
    work = STATE / name
    work.mkdir(parents=True, exist_ok=True)
    with (STATE / f"{name}.log").open("ab") as log:
        process = subprocess.Popen([str(part) for part in command], cwd=workdir or work,
                                   env=environment(), stdout=log, stderr=log, start_new_session=True)
    state["processes"][name] = {"pid": process.pid, "command": [str(part) for part in command]}
    save_state(state)


def stop(name, state):
    process = state["processes"].get(name)
    if not process or not alive(process):
        return
    os.killpg(process["pid"], signal.SIGTERM)
    deadline = time.monotonic() + 6
    while alive(process) and time.monotonic() < deadline:
        time.sleep(0.2)
    if alive(process):
        os.killpg(process["pid"], signal.SIGKILL)


def up():
    STATE.mkdir(exist_ok=True)
    state = load_state()
    if len(state["processes"]) == 6 and all(alive(p) for p in state["processes"].values()):
        status()
        return
    for name in reversed(list(state["processes"])):
        stop(name, state)
    for port in [4015, 8080, 8081, 5173]:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as error:
                raise RuntimeError(f"Port {port} is already in use; stop its service before starting the demo") from error
    for executable in ("go", "docker", "node", "npm"):
        if not shutil.which(executable):
            raise RuntimeError(f"Install {executable} first; see docs/falkordb-hackathon.md")
    run(["docker", "compose", "-f", "compose.falkordb.yml", "up", "-d", "--wait"])
    BIN.parent.mkdir(exist_ok=True)
    run(["go", "build", "-o", BIN, "./cmd/warp"], ROOT / "warp-go")
    key = STATE / "swarm.key"
    if not key.exists():
        key.write_text("/key/swarm/psk/1.0.0/\n/base16/\n" + secrets.token_hex(32) + "\n")
        key.chmod(0o600)
    state = {"processes": {}}
    try:
        spawn("relay", [BIN, "-mode", "relay", "-port", "4015", "-swarmkey", key,
                        "-identity", STATE / "relay.key", "-ledger-path", STATE / "relay.db", "-prom-listen", "-"], state)

        def relay_id():
            text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", (STATE / "relay.log").read_text(errors="replace"))
            matches = re.findall(r"Peer ID: (12D3KooW[A-Za-z0-9]+)", text)
            return matches[-1] if matches else None

        relay = f"/ip4/127.0.0.1/tcp/4015/p2p/{wait_for(relay_id, 'local relay', 20)}"
        state["relay"] = relay
        common = ["-swarmkey", key, "-bootstrap", relay]
        for slug, name in (("atlas", "Atlas Planner"), ("nova", "Nova Planner")):
            spawn(slug, [BIN, "-mode", "worker", *common, "-runtime", "docker",
                         "-agentdir", ROOT / "demo/agent", "-image", "warp-graph-demo:local",
                         "-agent", name, "-model", f"{slug}-local", "-capability", "planning",
                         "-desc", "Deterministic planning demo agent; no LLM or API key required",
                         "-maxtasks", "1", "-maxcpu", "99", "-prom-listen", "-",
                         "-identity", STATE / f"{slug}.key"], state)
        for name, port in GATEWAYS.items():
            spawn(name, [BIN, "-mode", "api", *common, "-apiport", port,
                         "-ledger-path", STATE / f"{name}.db", "-log-level", "debug"], state)
        desktop = ROOT / "warp-desktop"
        if not (desktop / "node_modules/vite/bin/vite.js").exists():
            run(["npm", "ci"], desktop)
        spawn("web", [shutil.which("node"), desktop / "node_modules/vite/bin/vite.js",
                      "--config", desktop / "vite.demo.config.ts", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], state, workdir=desktop)
        for name, port in GATEWAYS.items():
            wait_for(lambda: request(port, "/v1/graph/status")[0] == 200, f"{name} graph connection")
            def workers_ready():
                for child in ("atlas", "nova", name):
                    if not alive(state["processes"][child]):
                        raise RuntimeError(f"{child} stopped during startup; see {STATE / (child + '.log')}")
                return request(port, "/api/workers")[1].get("online_count", 0) >= 2
            wait_for(workers_ready, f"{name} workers")
        status()
    except BaseException:
        for name in reversed(list(state["processes"])):
            stop(name, state)
        raise


def status():
    state = load_state()
    for name, process in state["processes"].items():
        print(f"{name:8s} {'running' if alive(process) else 'stopped'} (pid {process['pid']})")
    print("\nOpen http://127.0.0.1:5173/demo.html?apiPort=8080")
    print("Second Boss: http://127.0.0.1:5173/demo.html?apiPort=8081")
    print(f"FalkorDB: 127.0.0.1:{DB_PORT}; Browser: http://127.0.0.1:3001")
    print(f"Logs and verification report: {STATE}")


def chat(port, model, prompt):
    return request(port, "/v1/chat/completions", {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False})


def verify(restart_db=False):
    workers = request(8080, "/api/workers")[1]["agents"]
    atlas = next(w["peer_id"] for w in workers if w["name"] == "Atlas Planner")
    nova = next(w["peer_id"] for w in workers if w["name"] == "Nova Planner")
    report = {"checks": [], "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def check(condition, description):
        if not condition:
            raise AssertionError(description)
        report["checks"].append(description)
        print("PASS", description)

    code, _ = chat(8080, atlas, "DEMO_FAIL demonstrate accurate failure memory")
    check(code == 502, "Worker failure reaches the OpenAI client")
    code, response = chat(8080, nova, "Plan a release with graph routing and shared memory")
    check(code == 200 and "Delivery plan" in response["choices"][0]["message"]["content"], "Real task container produces a delivery plan")
    memory = request(8081, "/v1/graph/memory")[1]["episodes"]
    check(any(e["peer_id"] == atlas and e["outcome"] == "failure" for e in memory), "Another Boss reads the failed task from shared memory")
    check(all(len(e["prompt_digest"]) == 64 and "prompt" not in e for e in memory), "Memory retains digests without raw prompts")
    code, route = request(8081, "/v1/graph/route?capability=planning")
    check(code == 200 and route["selected"]["peer_id"] == nova, "Graph history favors the successful worker")
    code, response = chat(8081, "planning", "Use the shared route to plan the demo release")
    check(code == 200 and response.get("warp_peer_id") == nova, "A second Boss dispatches to the graph-selected worker")
    with ThreadPoolExecutor() as pool:
        running = pool.submit(chat, 8080, nova, "DEMO_SLOW coordinate a shared worker")
        leases = wait_for(lambda: request(8081, "/v1/graph/reservations")[1].get("reservations"), "shared reservation", 15)
        check(any(lease["peer_id"] == nova for lease in leases), "In-flight reservation is visible to another Boss")
        code, _ = chat(8081, nova, "This task must wait for worker capacity")
        check(code == 503, "A second Boss cannot double-book reserved capacity")
        check(running.result()[0] == 200, "Original task completes normally")
    wait_for(lambda: request(8081, "/v1/graph/status")[1]["summary"]["active_reservations"] == 0, "released capacity", 15)
    check(True, "Completion releases the shared reservation")
    before = request(8081, "/v1/graph/status")[1]["summary"]["task_episodes"]
    state = load_state()
    command = state["processes"]["boss-b"]["command"]
    stop("boss-b", state)
    spawn("boss-b", command, state)
    wait_for(lambda: request(8081, "/v1/graph/status")[0] == 200, "restarted Boss")
    after = request(8081, "/v1/graph/status")[1]["summary"]["task_episodes"]
    check(after >= before, "A fresh Boss process recovers persistent task memory")
    if restart_db:
        run(["docker", "compose", "-f", "compose.falkordb.yml", "restart", "falkordb"])
        wait_for(lambda: request(8081, "/v1/graph/status")[0] == 200, "FalkorDB restart", 30)
        recovered = request(8081, "/v1/graph/status")[1]["summary"]["task_episodes"]
        check(recovered >= after, "FalkorDB restart preserves graph memory on disk")
    report["route"] = route
    report["summary"] = request(8081, "/v1/graph/status")[1]["summary"]
    (STATE / "verification.json").write_text(json.dumps(report, indent=2))
    print(f"\n{len(report['checks'])} checks passed. Report: {STATE / 'verification.json'}")


def down():
    state = load_state()
    for name in reversed(list(state["processes"])):
        stop(name, state)
    print("Demo processes stopped. FalkorDB and its persistent volume are retained.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["up", "verify", "status", "down"])
    parser.add_argument("--restart-db", action="store_true", help="also check disk persistence during verify")
    args = parser.parse_args()
    try:
        if args.action == "verify":
            verify(args.restart_db)
        else:
            globals()[args.action]()
    except (RuntimeError, AssertionError, subprocess.CalledProcessError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
