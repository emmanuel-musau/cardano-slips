# ADR-0001: Record architecture decisions

**Status:** Accepted
**Date:** 2026-08-19

## Context

This project is built by two part-time people at ~4.5 person-days per week over three months, with long gaps between sessions on any given package. It also produces a CIP that outside implementers will read. Decisions made in Month 1 — the CBOR decode approach, the error codes, whether CIP-0170 ships at all — will be questioned in Month 3, by us, with no memory of why they went the way they did.

Backlog rules already say a ticket must never require a decision that hasn't been made, and that open design questions become their own decision tickets. Those tickets need somewhere to deposit their answer.

## Decision

Record consequential decisions as ADRs in `docs/DECISIONS/`, numbered sequentially, using `0000-template.md`. A decision recorded here is settled: it is not reopened in code review. Changing one means writing a new ADR that supersedes it.

A decision ticket is not done until its ADR is written.

## Alternatives considered

**Decisions in PR descriptions.** They are written at the moment of least perspective and are unfindable six weeks later without knowing which PR to search.

**A single DECISIONS.md.** Fine at ten decisions, unreadable at forty, and it produces a merge conflict on every concurrent decision.

**Decisions in the spec.** The spec is normative protocol text for outside implementers. Our internal reasoning about dependencies and toolchains does not belong there and would dilute it.

## Consequences

Each decision ticket carries a small documentation cost. In exchange, the CIP submission and the test evidence can both point at a written trail of reasoning, and reviewers asking "why not Mode B?" or "why this CBOR library?" get an answer that does not depend on anyone's recall.
