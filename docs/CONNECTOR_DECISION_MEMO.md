# Connector Decision Memo

## Purpose

This document defines how `{reply}` should evaluate external connector and bridge technologies.

It exists to prevent a recurring mistake:

- confusing a technically impressive bridge with a product-acceptable dependency

`{reply}` is a local-first macOS operator workspace.

Connector decisions must be made against that product shape, not against generic “can we connect?” enthusiasm.

## Core Rule

The best connector for `{reply}` is not the one with the most features.

The best connector is the one that preserves:

- local truth
- stable thread identity
- supportable operator behavior
- bounded failure modes
- explicit send authority

with the least hidden fragility.

## What `{reply}` Needs From Connectors

Every connector should be judged separately for:

1. ingestion quality
2. send/transport quality
3. operator support burden
4. replay and identity stability

A strong ingestion path does not imply a strong send path.

A strong prototype bridge does not imply a strong shipped-product dependency.

## Acceptance Criteria

### Product-acceptable

A connector is product-acceptable only if most of the following are true:

- works without requiring unsafe machine-wide compromises for normal users
- preserves stable thread and participant identity
- survives reconnects and routine local restarts
- supports deterministic local ingestion into `{reply}` read models
- fails visibly and safely
- does not force cloud dependency into the drafting loop
- can be explained and supported for operators
- does not blur transport authority away from `{reply}`

### Prototype-acceptable

A connector is prototype-acceptable if:

- it is useful for research or validation
- it can generate realistic local traffic
- it helps prove schema or workflow assumptions

but it still has major support, trust, or upgrade risks.

### Research-only

A connector is research-only if:

- it teaches useful implementation patterns
- it reveals session-management or data-shape realities

but it is not a serious dependency candidate for the product in its current form.

### Do not use

A connector belongs in `do not use` if it:

- requires unsafe system changes as a normal product assumption
- hides core product truth behind a vendor abstraction
- cannot preserve stable identity
- is too brittle to support
- would force `{reply}` into pretending a source is healthier than it really is

## What To Learn From The Ecosystem

The external connector ecosystem is still useful.

The right way to use it is to extract patterns, not inherit product shapes.

Useful patterns:

- early channel normalization
- linked-session or puppeting lifecycle management
- local mirroring before request-time reads
- explicit bridge-vs-native classification
- session continuity and reconnect handling

Not useful as defaults:

- product architectures built around centralized cloud orchestration
- hiding source fragility behind a fake “unified inbox”
- treating transport execution as a generic provider abstraction

## Connector Classification For `{reply}`

### iMessage

#### Barcelona

Classification:

- `research-only`

What it teaches:

- high-fidelity macOS-local iMessage access patterns
- the upper bound of what private-framework integration can do

Why not product-acceptable:

- requires disabling SIP
- unacceptable as a normal-user support assumption
- too high-risk for a durable shipped local product dependency

Blunt rule:

- do not treat Barcelona as the default product connector path

#### `mautrix-imessage` normal-mac mode

Classification:

- `prototype-acceptable`

What it teaches:

- safer local Mac ingestion/send patterns
- direct `chat.db` read plus bounded local send path tradeoffs

Why it is stronger than Barcelona for product thinking:

- closer to a supportable machine posture
- more aligned with `{reply}`’s current local-truth model

Remaining risk:

- still fragile for advanced features
- still not automatically a shipped dependency decision

#### `ichat2json`-style utilities

Classification:

- `research-only`

Use:

- history extraction and migration understanding

Not sufficient for:

- live transport ownership

### WhatsApp

#### `mautrix-whatsapp`

Classification:

- `prototype-acceptable`, potentially `product-acceptable` as a design reference

What it teaches:

- linked-device session ownership
- durable reconnect logic
- stable local session lifecycle

Why it matters:

- this is closer to the right model for a local-first operator product than ad hoc browser scraping

What still needs proof before product adoption:

- identity mapping quality inside `{reply}`
- support burden
- local operator recovery flows

#### OpenClaw-style local transport

Classification:

- current local product path, but still operationally sensitive

What it proves:

- `{reply}` can preserve local send authority

What it requires:

- honest health reporting
- visible degraded modes
- no fake claim of universal stability

### LinkedIn

#### Browser/userscript bridge

Classification:

- `prototype-acceptable`

What it teaches:

- normalized inbound bridge events
- draft-only bridge classification

Why it must stay bounded:

- LinkedIn is a fragile surface
- outbound compliance and runtime stability are weaker than for core local channels

Product rule:

- keep this explicitly draft-only unless a compliant outbound path is proven

#### n8n-style workflow glue

Classification:

- `research-only`

Reason:

- useful for automation experiments
- not strong enough as a durable operator connector abstraction

### Email

#### MBSync / local mirroring pattern

Classification:

- `product-acceptable` as a pattern

What it teaches:

- local mailbox mirroring
- prepared local read models
- decoupling sync from drafting-time reads

Important nuance:

- the lesson is the mirroring model, not necessarily a mandatory switch of `{reply}` to one exact external tool

### Vendor-unified inbox products

#### Unipile-style abstraction

Classification:

- `do not use` as a core runtime dependency for `{reply}`

Why:

- hides connector truth behind a vendor layer
- weakens local-first guarantees
- risks moving identity, session, and transport truth outside the product boundary

Possible narrow use:

- research reference only

but not as the core product dependency.

## Decision Heuristics

When evaluating a new connector, ask:

1. Does it improve local truth, or just make demos easier?
2. Does it preserve stable thread identity?
3. Can `{reply}` still own send authority explicitly?
4. Can it fail in a way an operator can understand?
5. Can we classify it honestly as:
   - native conversation channel
   - bridge-only draft channel
   - input-only source
   - not realistic now

If those answers are weak, the connector is not ready for product adoption.

## Immediate Guidance For `{reply}`

### Strongest lessons to adopt

- prefer local mirroring over drafting-time remote access
- prefer persistent linked-session bridge models over brittle scraping
- classify every source honestly before giving it product UI weight
- keep ingestion contracts and send contracts separate

### Strongest mistakes to avoid

- do not adopt a connector just because it is open-source and powerful
- do not hide source fragility under “unified inbox” marketing language
- do not let bridge tooling redefine the product architecture
- do not let a connector force `{reply}` to pretend a draft-only or degraded path is a first-class send path

## Final Rule

Connector research is useful.

Connector optimism is dangerous.

For `{reply}`, product honesty and supportability matter more than connector novelty.
