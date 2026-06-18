# Downstream Feedback

This file records local changes or findings that should be considered for
upstream LLM-DocKit. Keep entries short and actionable.

## 2026-06-18 - HISTORY entry format enforcement

- Local file: `scripts/dockit-validate-session.sh`
- Upstream target: LLM-DocKit session validator
- Feedback: preserve or upstream the check that validates the first real
  `docs/llm/HISTORY.md` entry against the declared `YYYY-MM-DD - ...` format
  and newest-first order.
- Reason: passive prose rules were not enough to prevent the obsolete leading
  dash style from returning.
