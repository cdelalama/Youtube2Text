# Media2Text existing access and account administration authority - 2026-10-23

Immutable attributed scope record. Subject: youtube2text; service: y2t.
Conversation: 01a165c4-a385-73d1-8725-97abf11165ad.

Carlos requested easy addition of tokens from his different accounts and STT
providers in the existing interface, with exact Opus consensus. After the
concrete proposal he replied: "Go". The reviewed proposal is
`docs/operations/STT_ACCOUNT_UI_PROPOSAL_2026-10-23.md` at Media2Text source
977ab9b84685edce796303d477c1f68b9c91a7c7, SHA-256
`e71afbd84a9fbf755dc0e0ea69f19ea615038b5606672934da11578da5dc2499`.
Its accepted scope includes encrypted account/key storage, authenticated
administration, recent password confirmation, manual account selection, all
processing entry paths, deployment preparation and explicit legacy migration.
The proposal explicitly selects no login-provider migration or shared SSO.

Preserve the existing single-operator application password/HMAC-session login
at https://y2t.lamanoriega.com/ on the current private ingress. Declaration:
application / manual / local_credentials, no new identity provider, operator,
URL or topology. This records preservation PLUS the approved new private
credential-administration surface; it is not a blanket legacy exemption.
The subject is present in the owner's existing-admission baseline
9eeb5c689d3c550a3d22d53fcbfa5ba35308dbfe.

The web console and private /api routes remain session-protected. The backend
operator API retains x-api-key, intake retains its dedicated key/profile bearer,
and Cortex retains its scoped transcript-reader credential. New backend
/provider-accounts is loopback-only, behind the operator key, with a separate
short-lived one-use proof for writes issued by the authenticated web server.
The web /api/provider-accounts route requires a session; writes also require
same-origin and login within five minutes. Never publish the backend admin route
at the edge. Public read-only machine paths are individually scoped: backend
GET /health and /status/media-pipeline, web GET /api/status/media-pipeline.
The existing login/logout endpoints remain authentication operations, not public
private-data APIs. Existing static login assets remain available.

The executor must qualify the existing login for this new surface before
activation, including actual anonymous denial, login/read, stale-session write
refusal, reauthentication/write, logout/browser denial, peer restriction and
sanitized public status. Stateless logout clears the browser cookie; it does
not revoke a copied still-valid cookie. A copied cookie issued less than five
minutes ago can authorize administration until that freshness window expires.
Record the actual configured session TTL in the implementation receipt. This
limitation is not a fabricated session-revocation proof or a new auth selection.

Required owner integration, a fixed content-free Sentinel availability target,
reader compatibility, scoped source publication and real reader/restore checks
belong to the authorized delivery. Reuse the existing observer and preserve
all other targets. No additional outbound notifications are requested: this
target records local incidents only. No automatic repair, production fault
injection, new STT submission, credit/budget increase or automatic account
failover is authorized. Existing runtime and history remain preserved until
reviewed prerequisites and guarded deployment are qualified.

This record states accepted intent; it does not claim completed source,
authentication, consumer or runtime acceptance. Technical receipts remain in
MEDIA2TEXT_ACCOUNTS_DELIVERY_2026-10-23.md and the product implementation record.
