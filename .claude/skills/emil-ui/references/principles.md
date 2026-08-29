# Principles

## Contents

1. Design target
2. Decision hierarchy
3. Purpose model
4. Frequency model
5. Perceived speed
6. Continuity and spatial logic
7. Responsiveness and feedback
8. Delight budget
9. Context over rigid consistency
10. Taste and judgement
11. AI failure modes
12. Decision matrix

## 1. Design target

The target is not "more animation" or "more polish". The target is an interface that feels correct: responsive, predictable, natural, coherent, and easy to use repeatedly.

A successful interface should let the user focus on the task instead of noticing the interface mechanics. The best details often disappear into the experience.

Use motion as one tool among many. It is not the default solution.

## 2. Decision hierarchy

Resolve tradeoffs in this order:

1. Task completion
2. Comprehension
3. Feedback latency
4. Input-method correctness
5. Accessibility
6. Spatial continuity
7. Performance
8. Product cohesion
9. Delight

Examples:

- If a beautiful transition slows keyboard navigation, remove the transition.
- If a delightful hover makes a frequently used list feel sluggish, remove it.
- If an expressive drawer animation makes reduced-motion users uncomfortable, simplify it.
- If an instant state change makes a spatial transformation confusing, add a short transition that explains the change.

## 3. Purpose model

Before adding motion, state its purpose in one sentence.

Good purposes:

- "This pressed state confirms that the click was received."
- "This popover grows from its trigger so the relationship is obvious."
- "This drawer follows the finger so the gesture feels direct."
- "This enter/exit transition prevents the toast from appearing disconnected from the page."
- "This product demo explains a sequence that is difficult to communicate statically."

Weak purposes:

- "It feels premium."
- "It looks modern."
- "The page needs movement."
- "Every other product has this."
- "AI-generated UI looks boring without it."

If the purpose cannot be made concrete, remove the motion.

### Purpose categories

Use these labels while reasoning:

- feedback: confirms input or completion
- transition: explains change between states
- spatial: explains where something came from or went
- direct-manipulation: follows drag, swipe, scrub, press, or pointer movement
- teaching: explains product behavior
- delight: adds rare personality or memorability
- ambient: continuous decorative motion; use with extreme restraint in product UI

## 4. Frequency model

Frequency changes what "good" means.

### High frequency

Examples:

- command palette
- search
- arrow-key navigation
- repeated list selection
- editor actions
- tab switching in a core workflow
- frequently opened menus

Target: immediate, low ceremony, minimal or no motion.

Rules:

- do not animate keyboard selection
- avoid long fades and staged entrances
- remove hover choreography that delays scanning
- prefer visual state changes over animated transitions
- feedback can still be immediate and subtle

### Medium frequency

Examples:

- settings panels
- filters
- ordinary dropdowns
- occasional dialogs
- accordion sections

Target: short, purposeful transitions that improve understanding.

### Low frequency

Examples:

- onboarding
- feature introduction
- milestone celebration
- rare success moment
- marketing product demonstration

Target: more expressive motion is allowed, but still maintain clarity, accessibility, and control.

### Frequency test

Ask: "Would this still feel good after the 100th use today?"

If not, simplify it.

## 5. Perceived speed

Users judge responsiveness by what they see immediately after an action, not only by actual network or compute time.

Optimize both:

- real latency
- perceived latency

Patterns:

- show pressed state immediately
- enter loading state immediately when work starts
- keep UI motion short
- use fast-starting easing for entrances
- do not block interaction behind a transition
- use optimistic UI only when the product semantics safely support it

A fast spinner can feel more active than a slow spinner even when the underlying wait is identical. Do not use that observation to hide genuinely poor performance; use it to avoid making acceptable latency feel worse.

## 6. Continuity and spatial logic

Changes should preserve a believable relationship between states.

Users should understand:

- where an overlay came from
- where an item went
- whether a card expanded or was replaced
- whether a toast belongs to the top or bottom region
- whether a drawer is attached to an edge

Rules:

- anchored UI should animate from its anchor
- enter and exit directions should agree with the spatial model
- swipe-to-dismiss direction should match how the element is positioned and exits
- avoid teleporting an element between unrelated positions
- avoid scaling common UI from zero
- prefer transformations that preserve identity between states

Continuity is not permission to animate everything. If the relationship is already obvious, an instant change may be better.

## 7. Responsiveness and feedback

The interface should feel like it heard the user.

Every important action needs a visible or otherwise perceivable response:

- press -> active/pressed feedback
- submit -> pending/loading
- copy -> success
- destructive action -> confirmation/undo/result
- async save -> saving/saved/error state when useful
- toggle -> immediate state change or explicit pending state

Do not confuse feedback with animation. Feedback may be instant.

### Latency ordering

1. acknowledge action
2. communicate pending state if needed
3. reveal result
4. add optional polish

Never reverse this ordering to showcase motion.

## 8. Delight budget

Delight is valid but scarce.

Spend it where:

- the interaction is rare
- the user has completed something meaningful
- the motion reinforces product character
- the flourish does not slow the next action

Do not spend it where:

- the action repeats all day
- the user has a strong goal and wants speed
- the system is already visually busy
- the animation must be watched before continuing

A rare morph can be charming. The same morph repeated hundreds of times becomes friction.

## 9. Context over rigid consistency

Consistency means consistent reasoning, not identical mechanics.

Example: tooltip delay.

- first tooltip in a group: use a short delay to avoid accidental activation
- subsequent tooltip while the user is already exploring: remove delay and optionally remove motion

The user's current context changed, so the correct behavior changed.

Other examples:

- mouse hover may use a subtle transition; keyboard focus should remain immediate
- a large drawer can take slightly longer than a tiny tooltip
- a marketing demonstration can be slower than an app menu

Do not force one duration or animation token across all contexts.

## 10. Taste and judgement

Rules should reduce bad defaults, not replace judgement.

When something still feels wrong:

1. identify what feels wrong
2. name the mechanism: timing, easing, origin, distance, scale, opacity, layering, hierarchy, or feedback latency
3. change one variable at a time
4. compare variants
5. prefer the simplest version that feels correct

Do not use "it feels off" as the final diagnosis.

Good judgement is trained by studying strong interfaces, explaining why they work, practicing, and comparing alternatives.

## 11. AI failure modes

AI often over-designs because it optimizes for visible output. Counteract these defaults.

### Failure: animate everything

Fix: require a purpose and frequency check for every motion decision.

### Failure: slow equals premium

Fix: application UI should feel snappy. Reserve slower storytelling for marketing or rare moments.

### Failure: one motion recipe everywhere

Fix: classify component role, frequency, and input method first.

### Failure: visual polish before state correctness

Fix: design idle, hover/focus, active, disabled, loading, success, and error states before decoration.

### Failure: hover-centric desktop thinking

Fix: confirm touch and keyboard equivalents. Never make essential information hover-only.

### Failure: ignore interruption

Fix: rapidly open/close or reverse the state during review. The component should follow the latest user intent.

### Failure: "premium" effects

Fix: remove gratuitous blur, glow, glass, gradient, scale, stagger, and parallax unless each has a functional or coherent product reason.

## 12. Decision matrix

| Situation | Default decision | Reason |
| --- | --- | --- |
| Arrow-key list navigation | No animation | Repeated keyboard input must stay connected to action |
| Command palette open used all day | Instant or near-instant | High frequency; user has a clear goal |
| Button press | Immediate subtle feedback | Confirms input |
| Dropdown open | Short ease-out transition | Useful reveal without delay |
| Popover | Short origin-aware reveal | Reinforces trigger relationship |
| Dialog | Short centered reveal | Not anchored to a trigger |
| Drawer/sheet | Short spatial transition; gesture-aware if draggable | Preserves edge/spatial model |
| First tooltip | Short delay, short reveal | Prevents accidental activation |
| Subsequent tooltip in same exploration | No delay; often no animation | Keeps scanning fast |
| Toast | Enter/exit with consistent direction | Avoids disconnected appearance; supports gesture model |
| List item removal | Animate only if it helps preserve place | Continuity can prevent disorientation |
| Frequent table row hover | Usually no motion | High-frequency scanning |
| Onboarding step | Purposeful transition allowed | Low frequency and explanatory value |
| Marketing product demo | Expressive motion allowed | Motion can be content |
| Success celebration | Rare, brief delight | Emotion can be the purpose |
| Reduced motion preference | Remove spatial movement; keep clear state change | Accessibility |
