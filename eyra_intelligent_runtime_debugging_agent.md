# EYRA — Intelligent Runtime Debugging Agent

> Extracted from the supplied 15-slide PowerPoint. Content is organized by slide; diagram relationships are summarized in text where useful.

## Project overview

- **Project:** EYRA — Intelligent Runtime Debugging Agent
- **Purpose:** AI-powered runtime analysis, root-cause investigation, and developer-assisted debugging.
- **Core workflow:** Observe → Reason → Verify → Respond.
- **Technologies named in the presentation:** Python, FastAPI, TypeScript, SQLite, Groq.
- **Domain:** Developer tooling, Agentic AI, runtime intelligence.

## Slide 1

EYRA

INTELLIGENT RUNTIME DEBUGGING AGENT

- AI-powered runtime analysis, root-cause investigation
- and developer-assisted debugging

RUNTIME

OBSERVE

Code + error context

REASON

Agent + Groq LLM

VERIFY

Evidence + checks

RESPOND

Actionable insight

Python

FastAPI

TypeScript

SQLite

Groq

Developer tooling • Agentic AI • Runtime intelligence

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Four-stage runtime loop—Observe (code + error context), Reason (agent + Groq LLM), Verify (evidence + checks), Respond (actionable insight).

## Slide 2

THE CHALLENGE

Debugging is still highly manual

Turning a runtime failure into a verified fix takes multiple investigation cycles.

02

RUN

01

READ ERROR

TRACE STACK

03

FIND CAUSE

04

SEARCH

05

MODIFY

06

RE-RUN

07

!

Long or unclear traces

The failure location is not always the true root cause.

×

Context is fragmented

Code, terminal output and runtime behavior live in different places.

↻

Repeated investigation

Similar issues are often solved repeatedly without reusable context.

OPPORTUNITY

Convert raw runtime failures into actionable debugging intelligence.

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Manual debugging sequence—Run, Read Error, Trace Stack, Find Cause, Search, Modify, Re-run. Pain points are long/unclear traces, fragmented context, and repeated investigation.

## Slide 3

THE SOLUTION

Meet EYRA

An intelligent debugging agent that connects runtime context, investigation, reasoning and memory.

03

EYRA

- Intelligent Runtime
- Debugging Agent

Observe the environment • investigate evidence • reason about causes • verify solutions • remember outcomes

ROOT CAUSE

Why did the failure occur?

ERROR EXPLANATION

Translate technical failures into clear language.

EXECUTION TIMELINE

Reconstruct the events leading to failure.

SUGGESTED FIX

Provide a developer-reviewable correction.

VERIFICATION

Check the proposed solution where possible.

DEBUGGING MEMORY

Reuse knowledge from previous sessions.

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: EYRA capability cards cover root cause, error explanation, execution timeline, suggested fix, verification, and debugging memory.

## Slide 4

AGENTIC CORE

What makes EYRA an agent?

The LLM is a reasoning component inside a larger decision-and-verification loop.

04

EYRA

AGENT

OBSERVE

REMEMBER

DECIDE

INVESTIGATE

REASON

VERIFY

PLAN

Conventional LLM

Question  →  Answer

EYRA Agent

Observe → Investigate → Verify → Respond

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Contrasts a conventional LLM's “Question → Answer” flow with EYRA's agent loop: observe, remember, decide, investigate, reason, verify, and respond.

## Slide 5

ARCHITECTURE

Three layers. One debugging intelligence.

Eyes observe. Brain orchestrates. Memory preserves knowledge.

05

01

EYES

Environment Observation

VS Code Extension • TypeScript

02

BRAIN

Intelligence & Orchestration

Python • FastAPI • Agent • Groq

03

MEMORY

Historical Debugging Knowledge

SQLite • Sessions • Context

EYES OBSERVE   →   BRAIN REASONS   →   MEMORY REMEMBERS

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Three architecture layers—Eyes (VS Code Extension/TypeScript), Brain (Python/FastAPI/Agent/Groq), Memory (SQLite/Sessions/Context).

## Slide 6

SYSTEM DESIGN

Complete system architecture

A developer-facing extension feeds runtime context into an agentic backend and returns a structured debugging report.

06

DEVELOPER

Code + Run

VS CODE

Development environment

EYRA EYES

Observe

EYRA BRAIN

FastAPI

AGENT

Decide + investigate

GROQ LLM

Reason

MEMORY

SQLite

DEBUG REPORT

Result

HTTP / JSON

Observation

Orchestration

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Developer and VS Code feed context to EYRA Eyes, then via HTTP/JSON to EYRA Brain; agent, Groq LLM, and SQLite memory support a structured debug report.

## Slide 7

EYES

VS Code extension: giving EYRA visibility

Eyes is the bridge between the developer environment and the Brain.

07

⌁

Current file

Relevant source context

✓

Diagnostics

Language and editor signals

▣

Runtime context

Terminal output and stack trace where available

test.py

Python

CODE

```text
a = 10
b = 0
print(a / b)
```

```text
ZeroDivisionError:
division by zero
Traceback: ...
```

context collected

VS Code  →  Eyes  →  HTTP / JSON  →  Brain

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Eyes collects current-file source context, editor/language diagnostics, and terminal output/stack trace where available, then sends it to Brain.

## Slide 8

BRAIN

Intelligence & orchestration

The Brain coordinates context, memory, investigation, reasoning and response.

08

INPUT

Runtime context

VALIDATE

Pydantic

RETRIEVE

Memory

DECIDE

Agent

REASON

Groq

VERIFY

Evidence

RESPOND

Structured result

01

Decision layer

Determines what needs to be investigated and which context matters.

02

Reasoning layer

Uses the LLM to interpret evidence and form a probable explanation.

03

Verification layer

Checks the proposed conclusion or solution where execution evidence is available.

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Brain pipeline—Input runtime context → Validate with Pydantic → Retrieve memory → Decide with agent → Reason with Groq → Verify evidence → Respond with structured result.

## Slide 9

MEMORY

Debugging history that compounds over time

Previous sessions can provide useful context for current investigations.

09

EYRA MEMORY

Session

#0042

Error

ZeroDivisionError

Root cause

Operand = 0

Fix

Validate divisor

Verified

Yes

CURRENT ERROR

New session

MEMORY SEARCH

Similar context

AGENT

Investigate

↻

Stored knowledge

Error context • code context • root cause • suggested fix • verification result • timestamp/history

SQLite currently provides the persistent session layer.

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Example memory record #0042 stores ZeroDivisionError, root cause “Operand = 0,” fix “Validate divisor,” and verified status “Yes.”

## Slide 10

LLM

Groq integration: reasoning, not blind automation

The LLM turns runtime evidence into a human-readable hypothesis and debugging explanation.

10

CODE

```text
ERROR
ZeroDivisionError
a = 10
b = 0
print(a / b)
```

GROQ LLM

Reason over context

01

Cause

The division operation receives a zero divisor.

02

Explanation

Variable b currently contains 0, causing the runtime failure.

03

Possible correction

Validate the divisor before performing the operation.

LLM output ≠ automatically correct solution

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Groq LLM reasons over a ZeroDivisionError example and returns cause, explanation, and a possible correction. The slide warns that LLM output is not automatically correct.

## Slide 11

API

REST interface between Eyes and Brain

Swagger is useful during development; the intended production interaction is automatic extension-to-backend communication.

11

→

POST  /api/analyze

Submit debugging context for analysis.

↻

GET  /api/history

Retrieve previous debugging sessions.

#

GET  /api/history/{session_id}

Retrieve one specific debugging session.

CODE

```text
{
"file_name": "test.py",
"language": "python",
"code_snippet": "...",
"terminal_output": "...",
"stack_trace": "..."
}
```

Development testing

Swagger / OpenAPI was used to validate the backend contract and response schema.

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: REST endpoints connect Eyes and Brain; Swagger/OpenAPI is used for development validation.

## Slide 12

LIVE FLOW

End-to-end debugging example

A real ZeroDivisionError case demonstrates the complete path from runtime failure to stored analysis.

12

CODE

```text
a = 10
b = 0
print(a / b)
```

RUNTIME ERROR

ZeroDivisionError

OBSERVE

Eyes

ANALYZE

Brain

REASON

Groq

STORE

SQLite

REPORT

VS Code

ROOT CAUSE  •  EXECUTION TIMELINE  •  SUGGESTED FIX

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: End-to-end example: code triggers ZeroDivisionError; Eyes observes, Brain analyzes, Groq reasons, SQLite stores, and VS Code reports root cause, execution timeline, and suggested fix.

## Slide 13

PROGRESS

Current implementation

The foundation is working across backend, agent, memory, extension and testing.

13

✓  IMPLEMENTED

BACKEND

- •  FastAPI
- •  Analyze + history APIs
- •  Pydantic validation
- •  Error handling

AGENT + LLM

- •  Agent workflow
- •  Groq integration
- •  Structured output
- •  Decision / verification

MEMORY

- •  SQLite database
- •  Session storage
- •  History retrieval
- •  Persistent context

EYES

- •  VS Code extension
- •  TypeScript compilation
- •  Backend communication
- •  Result WebView

TESTED  •  Runtime error analysis  •  API response  •  SQLite history  •  Extension/backend compatibility

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Four areas marked implemented—Backend, Agent + LLM, Memory, and Eyes—with runtime analysis, API response, SQLite history, and extension/backend compatibility listed as tested.

## Slide 14

TRUST + ROADMAP

Human-in-the-loop by design

EYRA assists the developer; it should not blindly modify the development environment.

14

CONTROLLED ACTION

EYRA suggests

Developer reviews

Developer approves

Developer applies

No uncontrolled source edits, file deletion or arbitrary command execution.

ROADMAP

01

FOUNDATION

Current

Agent • API • Memory • LLM • VS Code

02

RUNTIME

Next

Observation • terminal capture • execution timeline

03

INTELLIGENCE

Future

Loop detection • test generation • semantic memory

04

PLATFORM

Verification • reporting • safety controls

EYRA • Intelligent Runtime Debugging Agent

**Visual summary:** Visual: Human-in-the-loop controls: EYRA suggests → developer reviews → developer approves → developer applies. Roadmap stages are Foundation (current), Runtime (next), Intelligence (future), Platform (future).

## Slide 15

THE VISION

From error message to debugging intelligence.

EYRA transforms runtime debugging from a manual investigation process into an intelligent, evidence-driven developer workflow.

WRITE

Code

RUN

Execute

FAIL

Runtime error

OBSERVE

Eyes

INVESTIGATE

Agent

REASON

LLM + Memory

VERIFY

Evidence

REPORT

Developer

“What happened?”  →  “Why did it happen?”  →  “How do we fix it?”  →  “Can we verify it?”

EYRA

Intelligent Runtime Debugging Agent

EYRA • Thank you

**Visual summary:** Visual: Vision flow—Write → Run → Fail → Observe → Investigate → Reason → Verify → Report; the goal is to move from “What happened?” to “Why did it happen?”, “How do we fix it?”, and “Can we verify it?”

## Consolidated architecture

1. **Eyes — observation:** VS Code extension written in TypeScript gathers the current file, relevant source context, diagnostics, terminal output, and stack trace when available.
2. **Brain — intelligence and orchestration:** Python/FastAPI backend validates incoming context (Pydantic), retrieves relevant memory, coordinates agent decisions, uses Groq for reasoning, checks evidence where available, and returns a structured result.
3. **Memory — historical context:** SQLite persists debugging sessions, error/code context, root causes, suggested fixes, verification results, and timestamps/history.

## API endpoints shown

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/analyze` | Submit debugging context for analysis. |
| GET | `/api/history` | Retrieve previous debugging sessions. |
| GET | `/api/history/{session_id}` | Retrieve one specific debugging session. |

Example request fields shown in the presentation:

```json
{
  "file_name": "test.py",
  "language": "python",
  "code_snippet": "...",
  "terminal_output": "...",
  "stack_trace": "..."
}
```

## Example runtime failure

```python
a = 10
b = 0
print(a / b)
```

- **Runtime error:** `ZeroDivisionError` — division by zero.
- **Cause:** The division operation receives a zero divisor; variable `b` contains `0`.
- **Possible correction:** Validate the divisor before performing the operation.
- **Important caveat:** The LLM output is a hypothesis/suggestion, not automatically a correct solution. Verification should be performed where execution evidence is available.

## Current implementation stated in the presentation

- **Backend:** FastAPI; analyze and history APIs; Pydantic validation; error handling.
- **Agent + LLM:** Agent workflow; Groq integration; structured output; decision/verification.
- **Memory:** SQLite database; session storage; history retrieval; persistent context.
- **Eyes:** VS Code extension; TypeScript compilation; backend communication; result WebView.
- **Testing listed:** Runtime error analysis, API response, SQLite history, and extension/backend compatibility.

## Human-in-the-loop safety

- EYRA suggests a correction.
- The developer reviews it.
- The developer approves it.
- The developer applies it.
- The presentation explicitly rules out uncontrolled source edits, file deletion, or arbitrary command execution.

## Roadmap shown

1. **Foundation — Current:** Agent, API, Memory, LLM, VS Code.
2. **Runtime — Next:** Observation, terminal capture, execution timeline.
3. **Intelligence — Future:** Loop detection, test generation, semantic memory.
4. **Platform — Future:** Verification, reporting, safety controls.

## Vision

EYRA aims to transform runtime debugging from a manual investigation process into an intelligent, evidence-driven developer workflow—moving from error messages to an explanation of what happened, why it happened, how to fix it, and whether the fix can be verified.

---

_End of extracted presentation content._