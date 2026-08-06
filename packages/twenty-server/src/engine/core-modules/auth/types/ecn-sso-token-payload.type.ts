// Claims issued by the ECN backend (earthcare.network) for the V40-2 SSO handoff.
// Verified by ECN_SSO_HMAC_KEY on GET /ecn/sso. Not a full OIDC payload —
// full OIDC lives in V41-6.
export type EcnSsoTokenPayload = {
  iss: 'ecn.earthcare.network';
  aud: 'ecn-crm';
  sub: string;
  org: string;
  workspace: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
  jti: string;
};
