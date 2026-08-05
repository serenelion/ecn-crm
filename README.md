# ecn-crm

Earth Care Network fork — CRM application image and source (internal slug **`ecn-crm`**).

Display name in ECN test environments: **CRM**. Public / white-label marketing names wait on trademark counsel.

This repository is **private** until counsel green-lights the AGPL §13 public source flip for production SaaS.

## Upstream

Based on an upstream open-source CRM project. See `LICENSE` (unchanged) and `NOTICE.ECN` for attribution and source links.

## Images

- Registry: `ghcr.io/serenelion/ecn-crm`
- Tag scheme: `<upstream-version>-ecn<fork-rev>` (e.g. `v2.27.0-ecn0`)
- Upstream pin for this line: **v2.27.0** (`twenty/v2.27.0` → `66e0f620…`)

## Local storage

Runtime local file storage path (provisioner volume mount):

`/app/packages/twenty-server/.local-storage`
