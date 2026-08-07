// Claims issued by the ECN backend (earthcare.network) for the V40-3 managed
// workspace mint. Verified by ECN_SSO_HMAC_KEY on POST /ecn/provision. Distinct
// aud ("ecn-crm:provision") from the SSO handoff ("ecn-crm") so an SSO token
// cannot be replayed against the provisioner and vice versa.
export type EcnProvisionTokenPayload = {
  iss: 'ecn.earthcare.network';
  aud: 'ecn-crm:provision';
  sub: string;
  org: string;
  workspace_name: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
  brand_primary_color?: string;
  brand_logo_url?: string;
  iat: number;
  exp: number;
  jti: string;
};
