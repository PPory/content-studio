# Motion Rules

## Contents

1. Motion decision sequence
2. Duration
3. Easing
4. Springs
5. Scale
6. Transform origin
7. Enter and exit
8. Interruptibility
9. Direct manipulation
10. Stagger
11. Blur
12. Performance
13. Reduced motion
14. CSS implementation rules
15. Motion QA

## 1. Motion decision sequence

Do not choose a library, spring, easing, or duration first.

Choose in this order:

1. Should this animate at all?
2. What purpose does motion serve?
3. Is the interaction high-frequency or keyboard-driven?
4. What state or spatial relationship needs explanation?
5. Which properties can express that relationship?
6. Which easing matches the motion type?
7. Which duration matches element size and travel distance?
8. How can the motion be interrupted or reversed?
9. What happens under reduced motion?
10. Does it maintain smooth performance under load?

## 2. Duration

Use these as starting ranges:

| Type | Default range |
| --- | --- |
| press feedback / tiny microinteraction | 100-150ms |
| tooltip / dropdown / popover / small state transition | 150-250ms |
| dialog / drawer / larger spatial transition | 200-300ms |

Rules:

- keep normal application UI under 300ms
- larger elements may be slightly slower than small ones
- longer travel can justify a longer duration
- exits can be about 20% faster than entrances
- a shorter duration is not automatically better if it makes a large motion abrupt
- do not use 400-500ms as a default for ordinary app UI
- do not slow an animation to make it easier to notice

Marketing and storytelling are separate contexts. They may use longer motion because the animation itself can carry content.

## 3. Easing

Use this decision tree:

```text
Is the element entering or exiting?
|- yes -> ease-out
`- no
   |- is it moving or morphing while already on screen?
   |  `- yes -> ease-in-out
   `- no
      |- is it a subtle hover transition?
      |  `- yes -> ease
      `- no
         |- is it continuous constant-rate motion?
         |  `- yes -> linear
         `- default -> ease-out
```

### Why ease-out for enter/exit

Ease-out starts with strong movement and decelerates. The interface appears to respond immediately, then settles.

Avoid ordinary `ease-in` entrances. They begin slowly, which makes the product feel delayed.

### Custom curves

Built-in CSS easing can feel weak. Custom curves are allowed when they improve the product's feel, but do not invent exaggerated curves without a reason.

When uncertain, prefer a restrained ease-out over a theatrical spring.

## 4. Springs

Use springs when their behavior adds value, especially for gesture-driven or interruptible interactions.

Springs are useful when:

- a draggable element should preserve velocity
- a sheet/drawer follows a gesture
- the user may reverse direction mid-motion
- a direct-manipulation object should settle naturally

Avoid springs when:

- a simple fade/transform transition is enough
- the component is a high-frequency utilitarian control
- bounce would imply playfulness that does not fit the product

If bounce is used, keep it subtle. Large overshoot is a special effect, not a default.

## 5. Scale

### Press feedback

A pressable control may use a subtle active scale around 0.97.

Acceptable default range: approximately 0.95-0.98.

Do not use a visible shrinking effect that distracts from the click or makes text hard to read.

### Entrances

Do not animate common UI from `scale(0)`.

Prefer a high initial scale such as 0.95, often combined with opacity.

Bad:

```css
transform: scale(0);
```

Better:

```css
transform: scale(0.95);
opacity: 0;
```

The goal is not to show off scaling. The scale should often be barely perceived.

## 6. Transform origin

Anchored components should reveal from the anchor relationship.

Examples:

- dropdown below trigger -> origin near top edge aligned to trigger
- popover to upper-right of trigger -> origin near lower-left of popover
- context menu -> origin related to pointer/trigger position when practical

Do not leave the default center origin if it contradicts the component's anchor.

Exception:

- centered modal/dialog has no single local anchor; center origin is appropriate

When using component primitives that expose origin CSS variables, use them rather than hardcoding one origin for every placement.

## 7. Enter and exit

Enter and exit should form one spatial story.

Rules:

- keep direction consistent with component placement
- if a toast enters from a direction, its dismissal should not contradict that model
- exits can be faster than entrances
- do not use a large fade plus large scale plus large translation at the same time unless the effect truly requires layering
- for ordinary product UI, one primary transform plus opacity is often enough

Avoid visual teleportation between states.

## 8. Interruptibility

Dynamic UI must follow the latest user intent.

Test:

- open, then immediately close
- close, then immediately reopen
- start a gesture, reverse it
- trigger multiple toasts rapidly
- press Escape while the overlay is entering

Bad behavior:

- animation must finish before reversing
- element jumps to a new starting position
- queue of stale animations plays after the user has changed intent

Prefer:

- CSS transitions for values that may retarget
- spring/gesture systems that preserve velocity when appropriate
- animation systems that can cancel or update the target

Be cautious with one-shot keyframes for dynamic state because they can be harder to retarget smoothly.

## 9. Direct manipulation

For drag/swipe interactions:

- visual position should track the pointer/finger directly
- avoid lag between gesture and element
- retain interaction after the gesture begins even if pointer leaves visual bounds, when safe
- use resistance/friction when moving beyond allowed boundaries instead of an abrupt stop
- settle to a valid state after release
- allow cancel/reversal

The object should feel attached to the user's gesture.

## 10. Stagger

Stagger is not a default.

Use it when:

- revealing a small, low-frequency group where sequence communicates hierarchy
- marketing/storytelling benefits from staged attention

Avoid it when:

- the list is frequently opened
- the user is scanning for an item
- keyboard navigation begins immediately
- it makes content unavailable one item at a time

If stagger is used, keep the offsets small enough that the final item does not feel late.

## 11. Blur

Blur can mask an awkward crossfade by blending two visual states.

Use only after fixing:

- wrong easing
- wrong duration
- wrong scale
- wrong origin
- wrong layering

Then, if a crossfade still exposes two distinct overlapping objects, a small blur may help.

Typical subtle case: around 2px during transition.

Do not use heavy blur as a universal polish effect. Large blur is expensive, especially in Safari and on lower-power devices.

## 12. Performance

A beautiful animation that drops frames is not polished.

Prefer:

- `transform`
- `opacity`

Be cautious with:

- `width`
- `height`
- `top`
- `left`
- `margin`
- `padding`
- large filters
- large box-shadow animation

These can trigger layout and/or paint work.

When the main thread may be busy, prefer browser/hardware-friendly motion paths such as CSS transitions/animations or WAAPI for appropriate properties.

Do not assume a motion library is automatically more performant. Inspect what properties and scheduling model it uses.

Use `will-change` selectively for known animation hotspots. Do not apply it to the whole page.

## 13. Reduced motion

Respect `prefers-reduced-motion`.

Reduced motion does not mean removing state feedback.

Good reduced-motion behavior:

- replace large translate/scale with opacity
- remove parallax and large spatial movement
- keep state changes immediate and clear
- preserve focus and interaction behavior

Example:

```css
.panel {
  transition: transform 200ms ease-out, opacity 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .panel {
    transform: none;
    transition: opacity 120ms ease-out;
  }
}
```

## 14. CSS implementation rules

### Name exact properties

Avoid:

```css
transition: all 200ms ease;
```

Prefer:

```css
transition: transform 180ms ease-out, opacity 180ms ease-out;
```

Why:

- prevents accidental animation of unrelated properties
- makes performance characteristics clearer
- makes review easier

### Modern enter transitions

When supported, `@starting-style` can express enter transitions without a post-mount state toggle.

Use it where it simplifies implementation and browser support is acceptable.

### Hover flicker

If scaling or translating a hovered element changes its own hit area and causes flicker, animate a child visual layer while keeping the parent hit target stable.

### Touch

Do not depend on hover for essential feedback or content. Guard hover-specific behavior with appropriate media queries if needed.

## 15. Motion QA

For every motion implementation, test:

- normal open/close
- rapid repeated open/close
- keyboard invocation
- pointer invocation
- touch if relevant
- reduced motion
- slow device or busy page if practical
- content with short and long text
- viewport edges
- multiple instances at once

Ask:

- Does motion clarify anything?
- Does the first frame respond immediately?
- Is the duration short enough?
- Is the easing correct for the motion type?
- Is the origin spatially correct?
- Can the interaction reverse?
- Does it remain pleasant after repetition?
- Does it stay smooth?
