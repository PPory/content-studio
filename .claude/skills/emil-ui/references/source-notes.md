# Source Notes and Interpretation Boundaries

This is an independent synthesis for practical AI use. It is not Emil Kowalski's official skill and should not be represented as an exact copy of his private or paid course material.

## Primary public sources

The rules are grounded in public material from Emil Kowalski, including:

- https://emilkowal.ski/ui/you-dont-need-animations
- https://emilkowal.ski/ui/great-animations
- https://emilkowal.ski/ui/7-practical-animation-tips
- https://emilkowal.ski/ui/agents-with-taste
- https://emilkowal.ski/ui/developing-taste
- https://emilkowal.ski/ui/train-your-judgement
- https://emilkowal.ski/ui/building-a-toast-component
- https://emilkowal.ski/ui/building-a-drawer-component
- https://emilkowal.ski/skill
- https://github.com/emilkowalski/skills

## Directly grounded concepts

The following are directly supported by Emil's public writing and public skill material:

- animation needs a purpose
- frequency of use should influence whether motion exists
- keyboard-initiated repeated actions should not be animated
- application UI motion should generally be fast and usually below 300ms
- ease-out is a strong default for entering/exiting UI
- ease-in-out fits movement/morphing of an element already on screen
- linear fits constant-rate continuous motion
- press feedback can use a subtle scale around 0.97
- common entrances should not start at scale(0)
- popovers should use an origin related to their trigger
- first tooltip delay can prevent accidental activation; subsequent tooltips can skip delay/animation
- transform and opacity are preferred animation properties for performance
- interruptibility matters
- reduced motion must be respected
- invisible details compound into perceived quality
- taste can be trained by studying, explaining, practicing, and comparing
- component details such as toast timers, drag friction, and stable interactions matter even when users do not consciously notice them

## Operational extensions in this skill

Some rules in this package are implementation-oriented extensions that translate the philosophy into a reliable review/build workflow. Examples include:

- the explicit priority order
- severity labels for reviews
- the full component state checklist
- the exact review sequence
- guidance on preserving form values, focus return, and preventing duplicate submit
- some testing cases for touch, busy pages, and long content

These are not claimed as direct quotations or unique doctrines from Emil. They are conservative product-design practices chosen to make the philosophy executable and reduce AI ambiguity.

## Interpretation rule

When an operational extension conflicts with a clearly stated public principle from Emil, prefer the public principle.

When a project has stronger product, platform, accessibility, or user constraints, prefer those constraints over this skill's defaults.

The goal is judgement, not dogma.
