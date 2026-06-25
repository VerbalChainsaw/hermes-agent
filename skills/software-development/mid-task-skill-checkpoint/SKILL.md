---
name: mid-task-skill-checkpoint
description: "Use when more than 5 tool calls into a debugging or audit chain. Mid-task re-scan of relevant skills and memory entries before continuing — catches skills the reactive session-start loader missed."
version: 1.0.0
author: Hermes Agent (ARGUS family)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [meta, workflow, discipline, debugging, audit, skill-loader, mid-task]
    related_skills: [systematic-debugging, codebase-audit-hardening, fix-with-sketchpad, plan, evidence-collection]
---

# Mid-Task Skill Checkpoint

## Overview

Skills get loaded **reactively at session start**. The system prompt scans
the skill manifest, picks the obvious matches for the user's first message,
and those load. After 5-10 tool calls into a multi-step chain (debugging,
auditing, multi-file patching, complex refactors), the original context has
drifted — and a skill that would have changed the approach mid-chain (e.g.
`systematic-debugging` while debugging, `codebase-audit-hardening` while
auditing, `fix-with-sketchpad` while patching multiple files) is sitting
unloaded in the tree.

This skill is a **5-tool-call checkpoint**: a procedure for re-scanning the
relevant skill surface mid-task, deciding whether to load a new one, and
recording the outcome. It is paired with a persona-level rule in SOUL.md
("Skill-checkpoint mid-task" + the "checkpoint" signal) that triggers the
same procedure on the user's one-word command.

The skill's value is not in adding new capabilities. It is in **forcing
the moment of reflection** that the reactive loader skips. Most of the
time, no skill fits and you note "no skill fits" and proceed. That note is
the win — it proves the checkpoint ran.

## When to Use

Use this skill when **any** of the following are true:

- You have made 5+ tool calls in a single multi-step task and have not
  re-scanned the skill surface since session start.
- The task has shifted shape from its first message. (E.g. user asked
  for a diagnosis, you found it, and are now mid-fix — that's a new task
  shape that the session-start skill load didn't see.)
- The user typed the magic word **"checkpoint"**. Treat that as an
  immediate, unconditional trigger regardless of tool-call count.
- You are about to start a sub-task (delegation to a subagent, a fix
  sketchpad write, an audit writeup) and want to confirm no skill
  applies before doing it ad-hoc.

**Don't use for:**

- Single-shot questions or one-tool-call answers. The overhead is not
  worth it.
- Tasks where the user is mid-rant or has explicitly said "don't stop,
  keep going." Use judgment — the "checkpoint" magic word overrides
  that, but mid-flow chatter does not.
- Already-running delegation chains where the subagent has its own
  skill context. The subagent's loader is its own problem.

## The 5-Tool-Call Checkpoint Procedure

### Step 1 — Count tool calls in the current chain

The checkpoint fires every 5 tool calls in the active task. The
**active task** is the chain since the last user message, or since
the last major pivot (e.g. user said "now do X" or you finished a
deliverable and started a new one). If you are at 5, 10, 15, ... tool
calls — checkpoint.

If the user typed "checkpoint" — skip the count, run the rest.

### Step 2 — Identify the current task domain

Pick one or more of: `debugging`, `audit`, `code-review`, `refactor`,
`fix-multiple-items`, `delegation`, `planning`, `research`, `release`.
The domain determines which skills are worth scanning.

### Step 3 — Run the filtered skill scan

```python
# Pseudocode — adapt to the actual tool surface in your session
import json
all_skills = skills_list()  # full manifest
domain_keywords = {
    "debugging": ["debug", "trace", "root-cause", "symptom"],
    "audit":     ["audit", "defect", "review", "evidence"],
    # ... etc
}
candidates = []
for s in all_skills:
    blob = (s["name"] + " " + s["description"] + " " +
            " ".join(s.get("tags", []))).lower()
    if any(k in blob for k in domain_keywords.get(domain, [])):
        candidates.append(s)
print(json.dumps([c["name"] for c in candidates[:5]], indent=2))
```

Look at the top 3-5 candidates. For each, ask: **"Would this skill
change my next 1-3 tool calls?"** If yes, `skill_view(name=...)` and
follow its procedure. If no, note the candidate and the reason for
skipping.

### Step 4 — Memory check (cheap)

Re-read the most recent memory entries that could apply. You don't
need to reload all of memory — just the entries tagged with dates
from the last 7 days AND with content matching the current task
domain. If `session_search` is available, a single search like
`"<task domain keywords> <recent dates>"` is enough.

### Step 5 — State audit (the part that matters)

Before continuing, write a one-line state summary:

```
TOOL COUNT: <N>
TASK DOMAIN: <domain>
SKILL CHECK: <loaded X | no skill fits | skipped Y because Z>
MEMORY CHECK: <recalled A, B | nothing applicable>
NEXT ACTION: <what I'm about to do, with verification plan>
```

That line is the deliverable. It goes in your reply (the user sees
it) AND in the session scratchpad if you have one. It is the
proof the checkpoint ran.

### Step 6 — Continue or pause

If state audit found an unaddressed risk (e.g. you just realised
you're about to skip a verification step), pause and address it.
Otherwise, continue with the original task. The checkpoint is not
a stopping point by default — it is a moment of awareness.

## Common Pitfalls

1. **Treating the checkpoint as a delay to apologize for.** The line
   "TOOL COUNT: 10, SKILL CHECK: no skill fits" is fine. Don't pad
   it with "sorry for the interruption" — the user wants the
   awareness, not the mea culpa.

2. **Loading every candidate skill.** If `systematic-debugging`
   shows up in the scan but you are 8 tool calls into a task that
   doesn't match its procedure, **don't load it**. The scan is for
   candidates that would change the next 1-3 calls, not for
   "this might be relevant later." Skill content in the prompt
   eats context budget; load only when it changes the work.

3. **Confusing tool-call count with elapsed time.** This is a tool-call
   count, not a wall-clock check. A 3-second subprocess that the
   user is waiting on is not 5 tool calls. A 5-minute debugging
   chain is. The metric is forward momentum on the task.

4. **Ignoring the user-triggered "checkpoint" magic word.** If the
   user types exactly the word "checkpoint" (or close variants like
   "ckpt" or "do a checkpoint"), that is a HARD signal. Do not
   judge whether it's "really needed." Do not ask "are you sure?"
   The user has given you the signal; run the procedure.

5. **Subagent context drift.** When you `delegate_task` to a
   subagent, that subagent has its own session and its own skill
   loader. Your checkpoint does not propagate. If the subagent is
   about to do significant work, you can mention "consider a skill
   checkpoint at 5 tool calls" in the subagent's `context`, but
   do not assume it ran one.

6. **Checkpointing in the middle of a multi-tool-call atomic
   operation.** If a single user request is being handled by a 10-
   call pipeline (e.g. `hermes setup` running through a wizard), do
   not pause mid-pipeline. The checkpoint is between distinct
   logical subtasks, not between individual tool calls in a tight
   sequence.

7. **Treating "no skill fits" as failure.** Most checkpoints will
   return "no skill fits" because the right skill is already
   loaded. That is the success case — it proves you asked.

8. **Not recording the checkpoint in the session.** If you don't
   surface the state summary to the user, the checkpoint is
   invisible. The user can't tell whether you ran it or skipped it.
   Always include the one-line state summary in your reply.

9. **Letting the checkpoint become a planning rabbit hole.** The
   checkpoint should take 1-2 tool calls (skill_list + maybe
   skill_view). If you're 4 calls into the checkpoint itself,
   you've over-thought it. Note "no skill fits" and move on.

## Verification Checklist

- [ ] Tool-call count is at 5, 10, 15, etc. for the active task,
      OR user typed "checkpoint"
- [ ] Task domain identified (debugging / audit / refactor / etc.)
- [ ] `skills_list` run with domain filter (1 tool call)
- [ ] At most 1-2 `skill_view` calls (only for candidates that
      would change the next 1-3 actions)
- [ ] Memory check (cheap — recent entries only, or session_search)
- [ ] One-line state summary written in the reply
- [ ] State summary includes: tool count, domain, skill check
      outcome, memory check outcome, next action with verification

## Pairing With the Persona Rule

This skill is the **concrete checklist** for SOUL.md rules 13 and 14:

- **Rule 13 (self-trigger):** Every 5 tool calls during a multi-step
  debugging or audit chain, run the procedure above. The persona
  commitment is "I will run this on my own initiative." The skill
  is "here is exactly what 'running this' means."
- **Rule 14 (user-triggered "checkpoint" signal):** When the user
  types "checkpoint," the persona commitment is "I treat that as a
  hard signal and run the same procedure." Same skill; different
  trigger.

If you change this skill, update SOUL.md to match. If you change
SOUL.md's checkpoint behavior, update this skill. They are a pair.

## Origin

Added 2026-06-25 after observing that multi-call debugging chains
routinely missed skills the reactive session-start loader should
have caught but didn't. The user (Director Gabriel) explicitly
asked for both layers — persona rule + real skill — because the
persona rule is the *commitment* and the skill is the *procedure*
the commitment invokes. Persona without skill = aspirational
discipline. Skill without persona = ignored under pressure. Both
together = the checkpoint actually fires.
