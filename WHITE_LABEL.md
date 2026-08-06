# White-Label & Commercial Licensing

This document defines the boundary between the **free, AGPL-licensed Community Edition (CE) core**
in this repository and the **commercial white-label license** that lets a party rebrand or resell
ECN CRM. It is not legal advice; trademark counsel review is pending for the public marketing name.

## The two planes

| | Community Edition (this repo) | Commercial white-label |
|---|---|---|
| **License** | AGPL-3.0 (core) + MIT (listed packages) | Separate commercial license **key** (code-gated) |
| **Cost to you** | $0 to ECN (you pay your own infra) | Paid ECN commercial agreement |
| **Right to rebrand** | No — attribution required (see below) | Yes — within the granted bounds |
| **Right to resell hosted** | No | Yes — under license terms |
| **Support** | Community / best-effort | Commercial SLA per agreement |

The AGPL core **stays free to self-host and modify** even if you never buy a white-label license.
White-label is an *add-on commercial module* (branding + agency package), **not** a dual-license of
the whole monorepo. This matches the V4 OSS decision: AGPL core / Hosted Growth OS / Commercial
white-label as three clean planes.

## What white-label permits

- Rebrand the **display name**, **logo**, and **accent color** via the `ECN_BRAND_*` runtime env
  (V40-4 brand-scrub). Brand is applied at boot, not compiled in.
- Resell ECN CRM as a hosted service to your own customers under the commercial agreement.
- Apply your own workspace-level default logo/color for installs you provision.

## What white-label does NOT permit

- **Misrepresenting the software as Twenty.** ECN CRM is a fork; upstream "Twenty" product
  branding must not appear in customer-facing chrome. Attribution stays in Source/About +
  `NOTICE.ECN` (AGPL §5(a)/§7(b) notice retention).
- **Stripping or altering `NOTICE.ECN` / the `LICENSE` file.** These are required AGPL notices.
- **Using upstream `/* @license Enterprise */` files** in production without a valid Twenty
  Enterprise Edition subscription. Those files are upstream-commercial and unchanged here.
- **Prohibited claims** — e.g. implying ECN warranty, implying official Twenty endorsement, or
  claiming capabilities the licensed tier does not include (e.g. SSO / custom domains / RLS that
  require a higher Twenty tier than the install actually runs).
- **Redistributing the AGPL core under closed terms.** Any derivative of the AGPL core remains
  AGPL and must carry Corresponding Source per §13 if offered as a network service.

## Enforcement

- The branding/agency package is **code-gated**: rebrand features fail closed without a valid
  license key. Without the key, the product renders neutral ECN branding only.
- The AGPL core is enforced by its license, not by a key.

## Support boundary

- **CE core:** community channels and best-effort. No SLA.
- **White-label:** commercial support per your ECN agreement (SLA, provisioning assistance,
  upgrade guidance).

## How to obtain a white-label license

Contact Earth Care Network about a commercial white-label agreement. This document describes the
*shape* of the boundary; the executed agreement governs. Until then, this repository is usable
only under its AGPL-3.0 / MIT terms (self-host, no rebrand/resale).
