---
name: emil-ui
description: Apply Emil Kowalski-inspired design engineering principles to build, refine, or review web and app interfaces so they feel responsive, natural, predictable, accessible, and intentional. Use for UI components, screens, frontend code, animation and motion, micro-interactions, keyboard/touch behavior, loading and feedback states, popovers, tooltips, menus, dialogs, drawers, toasts, forms, or whenever the user asks for an Emil Kowalski-style, polished, snappy, high-taste interface. Decide when not to animate; prioritize user intent and interaction frequency over decoration.
---

# Emil UI

Use design engineering judgement, not visual imitation. Do not clone Emil Kowalski's website, typography, colors, or layout unless the user explicitly asks for those visual choices. Apply the interaction philosophy: the interface should feel like it understands the user's intent and responds with minimal friction.

## Priority Order

When rules conflict, use this order:

1. User intent and task completion
2. Clarity and predictability
3. Immediate feedback and perceived speed
4. Accessibility and input-method correctness
5. Spatial continuity and natural motion
6. Performance and interruptibility
7. Cohesion with the product
8. Delight and visual flourish

Never sacrifice a higher-priority item to improve a lower-priority one.

## Operating Workflow

For every UI task, run this sequence before choosing motion or visual polish:

1. Identify the user's goal and the primary action.
2. Classify each important interaction by frequency: high, medium, or low.
3. Identify input methods: keyboard, pointer, touch, gesture, assistive technology.
4. Identify the state change: feedback, reveal, navigation, spatial transition, loading, success/error, removal, drag, or purely decorative change.
5. Decide whether motion improves understanding or only adds waiting.
6. If motion is justified, choose origin, properties, easing, duration, interruption behavior, and reduced-motion behavior.
7. Make all actions produce immediate feedback where appropriate.
8. Validate the result against the strict review checklist before delivery.

If the user only asks for a review, do not redesign the entire product. Diagnose the smallest changes with the highest experiential impact.

## Animation Decision Gate

Before adding any animation, answer all four questions:

- What purpose does it serve?
- How often will the user see it?
- Does it make the action feel faster, clearer, or more spatially coherent?
- Does it remain pleasant after repeated use?

If the purpose is only "make it feel designed", "make it premium", or "add some life", default to no animation.

### Purpose Categories

A valid animation should normally do at least one of these:

- Confirm input or action feedback.
- Explain a state transition.
- Preserve spatial continuity.
- Show where an element came from or went.
- Help explain a product or feature.
- Support a gesture or direct manipulation.
- Add rare, intentional delight without slowing a repeated task.

### Frequency Rule

- High-frequency interaction: prefer instant response and no animation, or only near-instant feedback.
- Medium-frequency interaction: use short motion only if it improves comprehension.
- Low-frequency or first-time interaction: more expressive motion is acceptable when purposeful.
- Keyboard-initiated repeated actions: do not animate selection or navigation state changes. Keep them instant.

See `references/principles.md` for the complete decision model.

## Hard Motion Rules

Apply these unless the user's product context clearly requires an exception:

- Keep ordinary application UI motion below 300ms.
- Use 100-150ms for micro-feedback.
- Use 150-250ms for standard UI such as tooltips, dropdowns, and popovers.
- Use 200-300ms for larger UI such as dialogs and drawers.
- Exit may be about 20% faster than entrance.
- Larger travel or larger elements may justify a longer duration, but stay restrained.
- Default entering/exiting motion to `ease-out`.
- Use `ease-in-out` for an element already on screen that moves or morphs between positions.
- Use `ease` for subtle hover changes when hover motion is justified.
- Use `linear` for constant-rate continuous motion.
- Do not use `ease-in` for ordinary UI entrance/exit motion.
- Prefer custom easing curves when built-in curves feel weak, but do not add springiness by default.
- Keep bounce subtle and rare. Avoid playful bounce in utilitarian product UI unless the product personality supports it.
- Prefer `transform` and `opacity` for animation.
- Avoid animating layout-heavy properties such as `margin`, `padding`, `top`, `left`, `width`, or `height` when a transform-based solution is practical.
- Favor interruptible transitions for dynamic UI. The user must be able to reverse or change state mid-animation without waiting.
- Avoid `scale(0)` entrances. Start around `scale(0.95)` or another high initial scale when scale is useful.
- Popovers and anchored menus must use an origin related to their trigger. Centered dialogs are an exception and should remain viewport-centered.
- Respect `prefers-reduced-motion`; remove or simplify spatial movement while preserving state clarity.
- Do not add motion that causes dropped frames. Smoothness is a requirement, not decoration.

See `references/motion-rules.md` before implementing or reviewing non-trivial animation.

## Immediate Feedback Rules

The interface should feel as if it is listening to the user.

- A pressable control should provide immediate pressed feedback when appropriate.
- A default button press may use a subtle `scale(0.97)` active state; keep the range roughly 0.95-0.98 and do not use it when scaling would distort layout or conflict with native behavior.
- A submitted action should visibly enter a loading/pending state when completion is not immediate.
- Copy actions should show success feedback.
- Destructive actions must clearly show pending, confirmation, undo, or completion state as appropriate.
- Do not make users click twice because the first click produced no visible response.
- Do not delay the feedback itself just to make the animation smoother.

## Component Behavior

For component-specific defaults, read `references/components.md` before building or reviewing any of these:

- buttons and pressables
- forms and inputs
- tooltips
- dropdowns, menus, and popovers
- dialogs and modals
- drawers and sheets
- accordions and disclosure
- tabs and segmented controls
- command palettes and keyboard navigation
- toasts and notifications
- loading states
- removable chips/list items
- drag/swipe interactions
- hover interactions
- onboarding, celebrations, and marketing demos

Do not apply one global animation recipe to every component.

## Typography and Interface Detail Rules

Use these as durable defaults, not as a visual style preset:

- Keep long-form body measure around 65ch when practical.
- Use tabular numbers where numeric columns need stable alignment.
- Use the ellipsis character `...` only when technical constraints require it; otherwise prefer the single ellipsis glyph in user-facing typography.
- Uppercase labels need enough tracking to avoid cramped letterforms.
- Use fallback fonts with similar metrics when font loading could cause visible layout shift.
- Reserve underlines primarily for links and interactive text so the affordance stays reliable.
- Prefer weight or color for ordinary UI emphasis; use italics mainly for prose conventions rather than interface hierarchy.
- Favor legibility and hierarchy over decorative typography.

## Invisible Detail Principle

Treat small behavioral details as cumulative quality. Examples:

- Pause toast auto-dismiss while the document is hidden or while the user is actively interacting with the toast.
- Maintain pointer/drag behavior even when the pointer temporarily leaves the visual bounds, when the gesture has already started.
- Use friction or resistance rather than an abrupt hard stop when a drag moves past an allowed boundary.
- Preserve focus, keyboard escape behavior, and logical return focus after overlays close.
- Avoid layout shift when fonts, icons, images, or async content load.

Users do not need to notice these details consciously. The goal is for the product to feel correct without calling attention to the mechanics.

## Context Beats Mechanical Consistency

Do not apply the same timing or behavior in every state just because a design system token exists.

Example: the first tooltip should have a short delay to prevent accidental activation. Once the user is already exploring a tooltip group, subsequent tooltips should appear without the same delay and may skip the animation.

Prefer consistent principles over identical mechanics.

## Anti-Patterns

Never do these by default:

- Animate every hover, card, icon, and state change.
- Add stagger to common app UI simply because a list appears.
- Add 400-500ms entrances to frequently used tools.
- Animate keyboard selection highlights.
- Use `transition: all` when exact properties can be named.
- Use large spring bounce for ordinary dropdowns, dialogs, or form controls.
- Animate from `scale(0)` for common UI.
- Make a popover grow from the viewport center when it is visually anchored to a trigger.
- Force an animation to finish before accepting a new user action.
- Add blur, glow, gradients, or motion merely to make AI-generated UI look "premium".
- Treat "smooth" as more important than "responsive".
- Hide missing interaction feedback behind aesthetic polish.

## Review Protocol

When reviewing an existing UI, code, or prototype:

1. Find user-friction issues before aesthetic issues.
2. Check repeated/high-frequency paths first.
3. Check feedback latency and missing states.
4. Check animation purpose, easing, duration, origin, and interruptibility.
5. Check keyboard, touch, reduced motion, and focus behavior.
6. Check performance-sensitive properties.
7. Check cohesion and unnecessary flourish last.

Use the format in `references/review-checklist.md`. Prioritize findings as `critical`, `high`, `medium`, or `polish`.

When code is provided, include a markdown table with `Before | After | Why` for concrete changes. Do not give vague advice such as "make it smoother" without naming the mechanism.

## Build Protocol

When building UI from scratch:

- Start with the simplest interaction that fully communicates state.
- Add motion only after the static interaction and state model are correct.
- Prefer platform-native expectations over novelty.
- Keep component behavior consistent with its physical and spatial role.
- For high-frequency tools, bias toward immediate state changes and near-zero ceremony.
- For rare onboarding or marketing moments, allow more expressive storytelling while protecting speed and accessibility.
- If two approaches are plausible, prefer the one that removes friction from the user's main task.

## Final Self-Check

Before delivering any UI implementation or recommendation, verify:

- Every animation has a defensible purpose.
- High-frequency and keyboard interactions are not slowed by motion.
- Actions provide immediate feedback.
- Motion is usually under 300ms and uses the correct easing family.
- Anchored elements animate from the correct origin.
- Motion can be interrupted or reversed when user behavior requires it.
- `transform`/`opacity` are preferred for performance.
- Reduced motion is handled.
- Focus, keyboard, touch, and pointer interactions remain correct.
- No decorative effect competes with the task.
- The interface feels responsive before it feels impressive.

If any check fails, fix it before calling the result polished.

## References

- `references/principles.md`: philosophy, priority model, frequency and purpose decisions.
- `references/motion-rules.md`: easing, duration, origin, springs, performance, accessibility, and implementation traps.
- `references/components.md`: component-by-component behavior rules and examples.
- `references/review-checklist.md`: strict audit method and output templates.
- `references/source-notes.md`: provenance and interpretation boundaries for this skill.
