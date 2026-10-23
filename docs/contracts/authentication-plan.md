# Authentication Plan

<!-- FORGEOS-AUTH-PLAN:START -->
## Declared Placement

- Public placement mode: `application`.
- Project-local implementation owner: `manual`.
- Application stack: `not declared`.
- Login method: `local_credentials` (federated means OAuth 2.0/OIDC).
- Planning state: `declaration_only`.
- Project Birth lifecycle observed: `build_authorized` at transition #0.
- Public contract reference: `home-infra-protocol@1c29249`.
- No runtime protection is claimed by this plan.
- This is declaration and implementation planning, not proof that anonymous access is blocked.
- Exact check command:

```sh
/home/cdelalama/src/.worktrees/forgeos/operator-access-handoff-20261021/scripts/project-auth-plan.py check --project-root "$PWD"
```
<!-- FORGEOS-AUTH-PLAN:END -->

## Boundary

This document does not prove protection and does not select a central identity
provider. Home Infra owns policy and catalog acceptance. The application owns
runtime implementation and evidence.
