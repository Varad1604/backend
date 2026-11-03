# ADR-014 — Adopt the backend brief through an additive compatibility layer

**Status:** Accepted for Milestone 1

## Context

The new backend brief defines database capabilities, server-side cookie
sessions and a new role vocabulary. The repository already has a working,
tested Gate/QC client using short-lived bearer tokens and legacy role names.
The frontend files declared authoritative by the brief are not present.

## Decision

Use the brief's Section 5 as the provisional contract. Add database-backed
capabilities and server-side cookie authentication while retaining the existing
bearer path for the current web client and future mobile clients. Seed both the
brief role codes and temporary legacy aliases from one capability matrix.

In local HTTP development the cookie is `kpmpl_sid`; in secure deployments it
is `__Host-kpmpl_sid`. This is necessary because browsers reject a `__Host-`
cookie without `Secure`. Cookie-authenticated writes require exact Origin and
`X-Requested-With` checks. Bearer requests remain protected by the same
database-derived capability guard.

## Consequences

Authorization policy changes are data changes rather than code changes. Existing
Gate/QC behavior remains usable while the contract migrates. The alias layer and
legacy refresh endpoint must be removed only after the specified frontend source
is supplied and the real adapter is verified.
