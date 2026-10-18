# Product

## Register

product

## Users

Warp operators and developers who run AI workers across a peer-to-peer mesh. They need to see which workers are available, understand why a task was routed to a peer, dispatch work, and inspect results shared by other coordinators.

## Product Purpose

Warp turns spare machines into a peer-to-peer network for running agent tasks. The product helps people coordinate that network without hiding where work runs, what capacity is available, or how previous outcomes influence a new route. FalkorDB carries the connected worker, capability, trust, workload, and task-memory context between sessions and Boss nodes.

## Brand Personality

Grounded, capable, transparent. The interface should feel like a dependable operations tool that explains its decisions and keeps the operator in control.

## Anti-references

- No noisy terminal cosplay, neon cyberpunk dashboards, or decorative graph effects that do not explain real relationships.
- No cloud control plane that obscures peer identity, routing inputs, or shared state.
- No tiny low-contrast labels for data operators need to act on.

## Design Principles

- Show the route and its reasons alongside the action that uses it.
- Make shared state and its owning coordinator visible.
- Keep task outcomes and capacity changes legible as they happen.
- Preserve the peer-to-peer model: identify the worker that actually ran each task.
- Make privacy boundaries explicit; task memory stores digests, not prompts or outputs.

## Accessibility & Inclusion

- Target WCAG 2.2 AA contrast for content and controls.
- Support keyboard focus and operation for every interactive control.
- Use labels and text in addition to color for status and outcome.
- Respect reduced-motion preferences.
