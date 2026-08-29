# Strict UI Review Checklist

## Contents

1. Review posture
2. Severity model
3. Review order
4. Motion audit
5. Interaction audit
6. Accessibility audit
7. Performance audit
8. Visual-detail audit
9. Required output format
10. Final acceptance checklist

## 1. Review posture

Review the interface as a repeated-use product, not as a dribbble shot.

Do not reward visible complexity. Reward:

- correct behavior
- low friction
- fast feedback
- clear state changes
- natural spatial relationships
- robust input handling
- accessibility
- performance
- cohesive details

When a detail looks impressive but harms repeated use, mark it as a problem.

## 2. Severity model

### critical

Blocks or seriously harms task completion, accessibility, or input correctness.

Examples:

- keyboard cannot operate a core flow
- focus becomes trapped or lost
- dialog cannot be dismissed appropriately
- action provides no state feedback and causes duplicate submissions

### high

Makes an important or frequent interaction feel slow, confusing, or unreliable.

Examples:

- animated keyboard selection
- 500ms command palette entrance
- non-interruptible overlay that ignores rapid user reversal
- popover origin is visibly disconnected from trigger

### medium

Noticeable quality issue that does not block the task.

Examples:

- wrong easing
- slightly too slow dropdown
- unnecessary stagger
- layout shift during loading

### polish

Small detail whose value is cumulative.

Examples:

- missing active scale on a pressable control
- tooltip sequence could skip second delay
- toast timer should pause when tab is hidden

## 3. Review order

Always inspect in this order:

1. core user goal
2. high-frequency path
3. keyboard/touch correctness
4. action feedback and async states
5. motion purpose
6. timing/easing/origin/interruptibility
7. accessibility
8. performance
9. typography and layout stability
10. delight and visual finish

Do not begin with shadows, colors, or easing if the state model is broken.

## 4. Motion audit

For every animated element, answer:

- What is the purpose?
- How often is it seen?
- Is it keyboard-initiated?
- Would no animation be better?
- Is the first visible response immediate?
- Is duration appropriate and normally below 300ms?
- Is easing appropriate?
- Does the direction match spatial logic?
- Is transform origin correct?
- Does enter match exit?
- Can it be interrupted/reversed?
- Does it use performant properties?
- Is reduced motion supported?

### Automatic flags

Flag these unless clearly justified:

- `ease-in` on UI entrance/exit
- `transition: all`
- `scale(0)` entrance
- 400ms+ ordinary UI motion
- stagger in common menus/lists
- keyboard selection animation
- large bounce in utilitarian UI
- keyframe-based dynamic state that jumps when retargeted
- popover using default center origin despite visible trigger

## 5. Interaction audit

For each important action:

- Is the target obvious?
- Is the hit area sufficient?
- Is press/click acknowledged immediately?
- Is loading/pending state visible when needed?
- Can duplicate action occur accidentally?
- Is success/error visible and understandable?
- Does the UI preserve user input on error?
- Can the user reverse/cancel where expected?
- Does rapid repetition remain stable?

Test "abusive" interaction deliberately:

- rapid click
- double submit
- open/close/open quickly
- press Escape during entry
- resize viewport while open
- long content
- multiple toasts
- pointer leaves drag area

## 6. Accessibility audit

Check:

- focus-visible state
- logical tab order
- Escape behavior
- return focus after overlay closes
- touch alternatives
- no hover-only essential information
- reduced motion
- state is not communicated by motion/color alone
- disabled state remains legible
- sufficient touch target for small controls

Do not treat accessibility as a final patch. It changes the correct interaction design.

## 7. Performance audit

Check animated properties.

Prefer:

- transform
- opacity

Investigate:

- layout properties
- heavy blur
- large shadows
- JS animation under main-thread load
- unnecessary reflow

Test the UI while async content is loading or the page is busy. Motion that only looks good in an empty demo is not production quality.

## 8. Visual-detail audit

Only after behavior passes:

- Is hierarchy clear?
- Is long-form text width comfortable?
- Do numeric columns align?
- Do font fallbacks avoid obvious layout shift?
- Are underlines reserved for interactive text?
- Are uppercase labels tracked appropriately?
- Are loading states dimensionally stable?
- Are decorative effects coherent with the product rather than generic "premium UI" styling?

## 9. Required output format

Start with a short verdict, then a prioritized table.

Use:

| Severity | Before | After | Why |
| --- | --- | --- | --- |
| high | `transition: all 450ms ease-in` | `transition: transform 180ms ease-out, opacity 180ms ease-out` | The current entrance delays feedback and animates unrelated properties. |

When no code is available, describe the observed behavior in `Before` and the target behavior in `After`.

After the table, include at most three sections when useful:

### Keep

Name choices that already follow the philosophy so they are not accidentally "improved" away.

### Test

List interaction cases that must be verified manually.

### Optional polish

Only non-essential improvements. Do not mix them with functional issues.

Avoid generic advice such as:

- make it smoother
- make it more premium
- add subtle animations
- improve UX

Name the exact mechanism and reason.

## 10. Final acceptance checklist

A UI passes this skill only when:

- core task is obvious and fast
- repeated actions do not accumulate friction
- keyboard actions are not slowed by motion
- every animation has a purpose
- common UI motion is normally below 300ms
- easing matches the motion type
- anchored overlays have correct origin
- action feedback is immediate
- dynamic motion can be interrupted when needed
- touch and keyboard behavior are correct
- reduced motion is supported
- animation uses performant properties where practical
- loading/error/success states are complete
- no decorative motion competes with the task
- the experience feels responsive before it feels impressive
