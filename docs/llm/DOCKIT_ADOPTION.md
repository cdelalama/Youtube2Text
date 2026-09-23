# DocKit adoption - 2026-09-23

Source: LLM-DocKit 4.16.2, patch candidate based on revision 361b393; final provenance is in the fleet report.

Adopted DocKit 4.16.2 delivery controls, visible skipped checks and exact Opus 5.5 high review policy. Existing deployment and acceptance gates remain unchanged.

This is a selective release rollout. Historical full-template identity is retained;
project hooks, versioning scripts, local validator regressions and excluded sections
are preserved. Copying delivery helpers does not integrate a mutation command.
Each project must bind its real probes and entrypoint and retain recovery evidence.

Delivered files:
- `scripts/dockit-validate-session.sh`
- `scripts/dockit-delivery-check.sh`
- `scripts/dockit-delivery-record.sh`
- `scripts/dockit-delivery-lib.sh`
- `scripts/dockit-delivery-state.awk`
- `scripts/test-delivery.sh`
- `docs/DELIVERY_CONTRACT.md`

Managed sections: independent-review-policy and delivery-evidence.

Validation and independent review are recorded in the source fleet report:
`LLM-DocKit/docs/FLEET_ROLLOUT_2026-09-23.md`.

The upstream regression suite runs in the DocKit source repository, where its
control-plane fixtures exist. Existing adopter regression files are preserved.
