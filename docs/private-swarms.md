# Private Swarms

Connect an office laptop to a home GPU PC behind strict corporate firewalls, with traffic restricted to the peers in your mesh.

## Three-step setup

```bash
# 1. Generate a swarm key (distribute it out-of-band to every node)
warp -mode genkey  # writes ./swarm.key

# 2. On a $5/mo VPS — boot a relay with that key
warp -mode relay -port 4001 -swarmkey ./swarm.key
# (prints a permanent multiaddr backed by ~/.warp/relay_identity.key)

# 3. Join nodes with both -swarmkey and -bootstrap
warp -mode worker -swarmkey ./swarm.key \
  -bootstrap "/ip4/198.51.100.23/tcp/4001/p2p/12D3KooWQHw8..." \
  -agentdir "./my-agent" -image "my-agent:v1" -agent "Home Rig" -model "mistral-nemo"
```

## How it works

The swarm key is a 256-bit PSK applied at the libp2p `pnet` layer. Peers without it see ciphertext garbage at the TCP layer and the connection is dropped before a single byte of Warp protocol is exchanged.

**Treat the swarm key like an SSH private key.** Distribute out-of-band (USB stick, Signal message, password manager); never commit to git; deploy with `0600` perms (the loader warns if the perm bits are looser).

## Verify the PSK is enforced

Start a worker WITHOUT `-swarmkey` and try to dial the relay:

```bash
warp -mode worker -bootstrap "/ip4/198.51.100.23/tcp/4001/p2p/..." \
  -agentdir ./test -image test:v1 -agent "intruder" -model "x"
# → repeated "failed to dial bootstrap" errors; never connects.
```

Then start it WITH the same `-swarmkey`:

```bash
warp -mode worker -swarmkey ./swarm.key \
  -bootstrap "/ip4/198.51.100.23/tcp/4001/p2p/..." \
  -agentdir ./test -image test:v1 -agent "trusted" -model "x"
# → "✅ Successfully connected to Bootstrap Node!"
```

## Operational checklist

- [ ] Swarm key is `0600`. Warp warns at load time if it's group/world-readable.
- [ ] The relay (`warp -mode relay`) runs the SAME swarm key as the workers/bosses joining it.
- [ ] The node uses the explicit relay and private swarm key; Warp does not configure a public relay by default.
- [ ] Boss nodes joining the private mesh ALSO need `-swarmkey` and `-bootstrap`.
- [ ] If a key is compromised, generate a new one (`warp -mode genkey`) and redistribute — every node must rebuild before it can re-join.

## Related

- [Architecture](architecture.md) — how libp2p `pnet` integrates with the four protocol streams
- [Security Model](security.md) — what private swarms protect against
- [CLI Reference](cli.md) — `-swarmkey` and `-bootstrap` flag details
