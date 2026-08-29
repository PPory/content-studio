# Component Rules

## Contents

1. Buttons and pressables
2. Links
3. Inputs and forms
4. Tooltips
5. Dropdowns, menus, and popovers
6. Dialogs and modals
7. Drawers and sheets
8. Accordions and disclosures
9. Tabs and segmented controls
10. Command palettes and keyboard lists
11. Toasts and notifications
12. Loading and async states
13. Removable chips and list items
14. Drag and swipe
15. Hover interactions
16. Navigation transitions
17. Data-dense UI
18. Onboarding and marketing motion
19. Component state checklist

## 1. Buttons and pressables

### Core behavior

- Make the primary action visually obvious without making every button loud.
- Give pointer/touch presses immediate feedback.
- A subtle active scale around 0.97 is a useful default when it does not conflict with platform behavior.
- Keep the visual hit target and actual hit target large enough for touch. For small icon buttons, use an invisible hit-area expansion when needed; around 44px is a robust touch target default.
- Do not move the surrounding layout when the button enters active/loading state.
- Preserve width when replacing text with a spinner if layout shift would be distracting.
- A disabled button must look and behave disabled; do not rely on opacity alone if contrast becomes too low.
- If an operation takes time, show pending state immediately.

### Avoid

- large bounce on every click
- 300ms+ press feedback
- press effect that shrinks text enough to blur
- changing button width during loading
- hiding focus styles to make the button look cleaner

### Loading buttons

Prefer one clear state model:

`idle -> pressed -> pending -> success/error -> idle`

Do not allow repeated submission unless the action is intentionally repeatable.

If success is important but the user immediately moves on, show success outside the button rather than forcing a long success animation inside it.

## 2. Links

- Underline is a strong affordance; reserve it primarily for links and interactive text.
- Do not make non-interactive emphasized text look like a link.
- Hover changes should be subtle and fast.
- Keyboard focus must be at least as clear as hover.
- External-link icons should add information, not decoration.

## 3. Inputs and forms

### Feedback order

1. focus response
2. input accepted
3. validation when useful
4. pending state after submit
5. success/error result

### Rules

- Do not animate cursor, keyboard selection, or typing response.
- Validation should not cause the entire form to jump if space can be reserved or feedback can be placed predictably.
- Error motion should never be the only error signal.
- Avoid exaggerated shake animations for validation; they can feel punitive and distract from the fix.
- When submit begins, acknowledge immediately.
- Keep labels visible; placeholder-only forms reduce clarity.
- Preserve entered values after errors whenever possible.
- Use clear focus states and maintain logical tab order.

### Async validation

Do not show a spinner on every keystroke. Debounce or validate at meaningful moments if the system requires remote checks.

## 4. Tooltips

Tooltips are a context-dependent interaction.

### First tooltip

- use a short delay so pointer travel does not trigger accidental tooltips
- use a short reveal if motion helps
- keep copy concise

### Subsequent tooltip in the same group/exploration

- remove the delay
- often remove the animation
- prioritize fast scanning

### Accessibility

- do not put critical instructions only in tooltips
- make keyboard focus expose equivalent information
- avoid tooltips for touch-only essential content
- do not trap interaction inside a tooltip unless it is actually a popover

## 5. Dropdowns, menus, and popovers

### Dropdown/menu

- opening should feel immediate
- use a short ease-out reveal only if it improves continuity
- high-frequency menus may be instant
- keyboard navigation inside the open menu must be instant
- selection highlight should not lag arrow keys
- Escape closes immediately

### Popover

- use origin-aware transform related to the trigger
- combine small scale and opacity rather than large travel
- if placement flips near viewport edges, transform origin should follow the actual placement

### Avoid

- center-origin popover attached to a side trigger
- large Y translation for a tiny menu
- staggered menu items in ordinary app UI
- animation on every arrow-key selection

## 6. Dialogs and modals

Dialogs are viewport-level overlays, not anchored popovers.

- center-origin is normally appropriate
- keep enter/exit short
- backdrop and panel should feel like one event, not two unrelated animations
- focus should move into the dialog when opened and return appropriately when closed
- Escape should close unless the product has a strong reason not to
- closing must interrupt opening cleanly
- reduced motion should remove large scale/translate while keeping state clarity

Avoid:

- dialog scaling from the button that opened it if the dialog is visually centered and not spatially attached to that trigger
- slow zoom from 0
- waiting for exit animation before accepting a new open request when state can safely retarget

## 7. Drawers and sheets

Drawers have an edge relationship.

- enter from the edge they belong to
- use motion to explain that relationship
- on mobile, bottom sheets can feel more native than centered dialogs for many tasks
- if draggable, movement must track touch/pointer directly
- use resistance past boundaries rather than a hard wall
- release should settle to open or closed based on position/velocity
- allow reverse/cancel while dragging
- protect input behavior and scrolling from gesture conflicts

Do not add spring bounce unless it improves the physical feel and fits the product.

## 8. Accordions and disclosures

Ask whether animation is useful at all.

Good case:

- low/medium-frequency content reveal where motion helps maintain reading position

Bad case:

- frequently opened utility section where height animation delays access

Rules:

- keep duration short
- preserve content continuity
- do not animate keyboard focus movement
- avoid excessive overshoot
- rapid open/close should reverse smoothly

## 9. Tabs and segmented controls

### High-frequency tabs

- prefer immediate content response
- a moving indicator may be acceptable if it does not lag behind input
- keyboard left/right selection must remain immediate

### Shared indicator

If a visual indicator slides between tabs:

- use a short ease-in-out because the element is already on screen and moving between positions
- do not let the indicator arrive after the content has already changed by a noticeable amount
- under heavy main-thread load, use a robust CSS path if a JS layout animation drops frames

Avoid ornamental page-transition animations for routine tab switching.

## 10. Command palettes and keyboard lists

This is a strict high-frequency category.

- opening should be instant or near-instant
- arrow-key highlight changes are instant
- Enter activation is instant
- Escape closes immediately
- search results should update without decorative stagger
- do not animate selection between rows
- avoid hover effects that make pointer scanning feel delayed

The user enters this UI with a clear goal. Remove ceremony.

## 11. Toasts and notifications

### Spatial model

- choose a consistent region and enter/exit direction
- support swipe dismissal in a direction that matches the spatial model when appropriate
- if stacking, preserve depth/order without causing jumps when new toasts appear

### Timing details

- auto-dismiss can pause while hovered/focused
- pause or account for time while the document is hidden so the user does not miss the message
- do not dismiss a toast while the user is actively interacting with it

### Interruptibility

Rapidly adding multiple toasts should not make existing toasts jump. Use a layout/motion approach that can retarget smoothly.

### Content

- keep success messages concise
- persistent/error messages need enough time or explicit dismissal
- avoid using toast for information the user must retain to complete the task

## 12. Loading and async states

Choose feedback based on expected wait and task semantics.

### Immediate operations

Do not flash a spinner for extremely brief work if it creates visual noise.

### Noticeable async operations

- acknowledge immediately
- use spinner, progress, skeleton, or pending state as appropriate
- keep animation active enough to communicate work, but do not make it theatrical

### Progress

Use determinate progress when the system can estimate completion meaningfully. Do not fake precise progress.

### Skeletons

Skeletons should preserve layout and reduce perceived instability. Avoid elaborate shimmer in a high-frequency surface if a static placeholder is sufficient.

## 13. Removable chips and list items

Animation can help preserve spatial orientation when an item disappears.

Use it when:

- removal would make adjacent items jump in a confusing way
- the user needs to see which item was removed

Keep it fast.

For repeated bulk removal, prefer speed over a full exit ceremony.

Undo can be more useful than a dramatic delete animation.

## 14. Drag and swipe

- start tracking immediately after the gesture threshold is met
- maintain pointer capture when appropriate
- map movement directly to object position
- use friction outside allowed bounds
- preserve velocity when settling if using a spring model
- do not let visual motion lag behind input
- provide a non-gesture alternative for accessibility

## 15. Hover interactions

Hover is optional polish, not the foundation of interaction.

Use hover when it:

- clarifies clickability
- reveals secondary controls without hiding essential actions
- provides lightweight preview on pointer devices

Avoid hover motion when:

- the component is scanned constantly
- the effect makes the target move away from the pointer
- it causes flicker because the hit target changes
- there is no touch or keyboard equivalent for essential functionality

If scaling a hover visual causes hit-area flicker, keep the parent hit box stable and animate a child layer.

## 16. Navigation transitions

For core app navigation:

- prioritize immediate content access
- preserve orientation with minimal motion only when it helps
- avoid full-page cinematic transitions in frequent workflows

For marketing/storytelling:

- transitions may be more expressive because presentation is part of the content

Do not import marketing motion into productivity UI without re-evaluating frequency and purpose.

## 17. Data-dense UI

Tables, dashboards, editors, admin tools, and developer tools need restraint.

- favor instant sorting/filtering feedback
- avoid animating every row reorder
- use tabular numbers for aligned numeric columns
- keep hover states simple
- preserve stable layout
- do not animate focus/selection with lag
- make loading states preserve column geometry where possible

Beauty here comes from clarity, rhythm, spacing, typography, and fast behavior more than motion.

## 18. Onboarding and marketing motion

This is where expressive motion has more budget.

Use motion to:

- explain a feature sequence
- direct attention
- demonstrate cause and effect
- reveal hierarchy
- create a memorable first impression

Still require:

- a clear purpose
- readable pacing
- reduced-motion behavior
- no unnecessary blocking before the user can act

The animation may be content, but it should not become noise.

## 19. Component state checklist

Before a component is considered complete, inspect relevant states:

- idle
- hover (pointer only)
- focus-visible
- active/pressed
- selected
- disabled
- loading/pending
- success
- error
- empty
- open/closed
- entering/exiting
- interrupted/reversed
- reduced motion
- keyboard-only
- touch-only
- long content
- narrow viewport
- slow/busy environment

Not every component needs every state. Every state that exists must be intentional.
