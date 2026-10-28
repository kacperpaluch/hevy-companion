# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner, who trains with Hevy and runs this app privately on a home network. Opens it mostly on a desktop computer, after a workout, to see what changes and send them to Hevy.

## Product Purpose

Double progression on top of Hevy data (ARF rules), with Gravl-style use of RPE: reps in reserve count towards the top of the range, and a clearly easy set can jump further via estimated 1RM. Rules are checked against the owner's own Hevy history with `npm run backtest`. For each exercise in each Hevy routine it computes the next target (weight × reps), explains why, previews the change, and writes it back to the routine only after an explicit "Wyślij do Hevy". Success: after a workout, the owner sees within seconds which exercises move up, which hold and which drop back, and sends them.

## Positioning

A private companion, not a product: it trusts Hevy for history and only adds the progression decision, with the reason for each decision always available.

## Operating Context

- Main moment: after a workout, at a desk. Check, then send. Settings (rep range, weight step) change rarely.
- Data comes live from the Hevy API; settings live in `data/config.json`, and the last send attempt per routine with before/after backups lives in `data/history.json`.
- Interface language: Polish.

## Capabilities and Constraints

- One page, vanilla HTML/CSS/JS in `public/index.html`, no build step, no dependencies.
- Per routine: exercises with last session sets, current values, new target and reason. Checkboxes select individual changes before sending.
- Exercise settings: rep range, weight step, RPE limit and exclusion from progression.
- A plateau marker compares three sessions at the same weights and set counts without changing progression rules.
- The last send attempt shows its status and before/after values, with a downloadable JSON backup saved before the Hevy write.
- Exercises without a weight step set need attention (highlighted until chosen).
- Light and dark theme via system preference.
- No login; single user.

## Product Principles

- The change is the headline: what goes up, what holds, what drops back.
- Explanations and settings are available, not in the way.
- Nothing reaches Hevy without an explicit send.
