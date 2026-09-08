# Plans

**Every planning document for this repo lives here, in the repo.**

`completed/` holds the ones whose work is finished. Everything directly in `plans/` is live.
**Moving a plan into `completed/` needs the user's confirmation** — it is the final action of
the work the plan describes, not a housekeeping step a session takes on its own.

## Why this folder exists

**Found 2026-09-08: 38 of 38 files in `~/.claude/plans/` had zero commits in any repository.**
That directory is outside every repo and is captured by no backup of them — `git bundle
create --all` in every repo captures none of it. Six of those files were this project's, and
they were found only because a session auditing the REBEL-6 tree traced their contents here.

Two traps worth keeping, both paid for:

1. **Audit by CONTENT HASH, never by filename.** Rescued plans get renamed on the way in, so
   `find -name` and `git log --all -- <basename>` report them as missing and are wrong. A
   by-name sweep said 38 of 38 were unrescued; hashing said 31 had been.
2. **No hook and no `git status` can see a file that is in no commit.** Both times this class
   of loss was caught here, it was caught by a peer needing to verify a citation — not by the
   author, and not by tooling.

## The six rescued on 2026-09-08 — UNCLASSIFIED

They are filed as live because the session that moved them could not judge which are done, and
`completed/` needs the user's confirmation. **Some are likely already implemented**: the four
commits pulled the same day (`ec5e91f`, `973e672`) added `setup/debugging.md`,
`setup/extensions.md` and the F5 device picker, which is the subject matter of
`microbit-codespace-breakpoint-debugging-plan.md` and `microbit-f5-webusb-flashing-plan.md`.
The first session to work on this project should sort them against what shipped.

| file | was | topic |
|---|---|---|
| `microbit-template-modernisation-plan.md` | `i-want-to-plan-partitioned-cascade.md` | modernising the Ada / micro:bit v2 student template |
| `microbit-integrated-implementation-plan.md` | `…-agent-ab2ac2318e99955e7.md` | the five features merged into one sequenced plan |
| `microbit-f5-webusb-flashing-plan.md` | `…-agent-ad7a24a52f62045f8.md` | Feature 5 — WebUSB / WebSerial browser flashing |
| `microbit-f3-vscode-tasks-plan.md` | `…-agent-ab5e71872243bb56c.md` | Feature 3 — platform-agnostic VS Code tasks |
| `microbit-f2-build-orchestration-plan.md` | `…-agent-ae201eb0540b6ca30.md` | Feature 2 — build orchestration |
| `microbit-codespace-breakpoint-debugging-plan.md` | `golden-questing-wirth.md` | breakpoint debugging from a Codespace |
