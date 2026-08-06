import { t } from '@lingui/core/macro';

export const getStandardApplicationDescription =
  (): string => t`The base data model every CRM workspace runs on.

#### What "foundation" means

Every CRM workspace starts with this set of objects. They define the shape of your CRM, including relationships, activity, and reporting. Everything else, including marketplace apps, AI agents, and custom objects, plugs into them.

#### Included objects
- **People & Companies**: contact and account records
- **Opportunities**: your sales pipeline
- **Notes & Tasks**: activity and follow-ups
- **Workflows & Dashboards**: automation and reporting

Remove this app and the rest of CRM has nothing to hang off.

#### Source

See the [ECN CRM source repository](https://github.com/serenelion/ecn-crm) for fork APIs and contribution guidance.`;
