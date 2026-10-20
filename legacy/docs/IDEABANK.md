# Ideabank

This file is not the task tracker or the source of truth for delivery.

It is a parking lot for product ideas, deferred connectors, and platform concepts that are not realistic to commit now.

Operational work still belongs in the issue tracker and project board.

## Messaging Systems Not Realistically Solvable Now

These are not current `{reply}` product commitments.

They should not be presented as if direct native support already exists.

If a platform is parked here, the native dashboard must not pretend it is a first-class connector.

### Unsolved or non-viable now

- `Facebook Messenger`
  - No clean local-first compliant ingestion/send path in the current product.

- `Instagram DMs`
  - No clean local-first compliant ingestion/send path in the current product.

- `WeChat`
  - No current compliant local-first integration path in the product.

- `Line`
  - No current compliant local-first integration path in the product.

- `Skype`
  - Not a current target and no clean modern local-first product path is defined.

- `Snapchat`
  - Not a realistic local-first operator connector target for this product now.

### Conceptually possible later, but not product-ready now

- `official Viber direct connector`
  - Current realistic path is bridge-fed inbound draft-only, not direct native product integration.

- `official Signal direct connector`
  - Current realistic path is bridge-fed inbound draft-only, not direct native product integration.

- `official Telegram direct connector`
  - Current realistic path is bridge-fed inbound draft-only, not direct native product integration.

- `official Discord direct connector`
  - Current realistic path is bridge-fed inbound draft-only, not direct native product integration.

- `official LinkedIn direct native outbound connector`
  - Current realistic path is draft-first and compliance-constrained. Do not promise direct send unless the outbound path is formally supported and compliant.

## Native Product Rule

Anything in this ideabank must be treated as one of the following until promoted:

- hidden from the product entirely
- visible only as a deferred connector concept
- visible only as a bridge-fed draft-only source

It must not be shown as:

- a native conversation channel
- a guaranteed sync target
- a supported native send destination

## Product Classification Rules

If a source does not have a real compliant connector path now, classify it as one of:

- `bridge-only`
- `input-only`
- `ideabank`

Do not classify it as a full native conversation channel by implication.
