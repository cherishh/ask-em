# Soft-Detach vs Hard-Failure

This note defines the internal distinction between normal tab movement and true sync failure.

The product copy does not need to expose these terms directly. The distinction exists so background
orchestration can stay consistent.

## Soft-Detach

`soft-detach` means a claimed tab is no longer representing the previously bound chat, but the system
has not yet failed to recover delivery.

Typical examples:

- a claimed tab navigates from a bound session to `new-chat`
- a claimed tab lands on a different existing session
- a provider keeps the user on an unresolved existing-session surface and the old claim is no longer trustworthy

Expected behavior:

- clear or transfer the claimed tab association
- keep the workspace member binding unless a stronger signal says otherwise
- do not surface a user-facing sync failure solely because the tab moved

Why:

- tab movement is often a normal user action
- the next delivery may still recover by reusing, navigating, or opening another provider tab

## Hard-Failure

`hard-failure` means the system attempted to recover or deliver and still could not reach the target model.

Typical examples:

- recovery resolves to a login-required page
- recovery resolves to an explicit error page
- delivery reaches the tab but prompt confirmation fails
- recovery cannot restore the expected session and delivery cannot proceed

Expected behavior:

- persist a concrete workspace issue
- let presentation helpers translate that issue into user-visible warning state

Current issue mapping:

- `needs-login`
- `loading`
- `error-page`
- `delivery-failed`

## Practical Rule

Only persist a user-facing workspace issue when the system has crossed from `soft-detach` into
`hard-failure`.

This keeps normal tab movement from looking like product failure, while still preserving actionable
warning state after actual recovery or delivery failure.
