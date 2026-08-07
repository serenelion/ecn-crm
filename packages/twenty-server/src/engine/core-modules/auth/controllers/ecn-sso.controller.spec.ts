import { type Response } from 'express';
import * as jwt from 'jsonwebtoken';

// Mock the transitive auth/user service modules — importing the real classes
// pulls the entire monorepo graph (twenty-emails, twenty-client-sdk, etc.)
// into the jest resolver. We only need the constructor tokens for DI shape.
jest.mock('src/engine/core-modules/auth/services/auth.service', () => ({
  AuthService: class AuthService {},
}));
jest.mock('src/engine/core-modules/user/services/user.service', () => ({
  UserService: class UserService {},
}));
jest.mock(
  'src/engine/core-modules/auth/token/services/login-token.service',
  () => ({
    LoginTokenService: class LoginTokenService {},
  }),
);
jest.mock(
  'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service',
  () => ({
    WorkspaceDomainsService: class WorkspaceDomainsService {},
  }),
);
jest.mock(
  'src/engine/core-modules/guard-redirect/services/guard-redirect.service',
  () => ({
    GuardRedirectService: class GuardRedirectService {},
  }),
);
jest.mock('src/engine/core-modules/auth/filters/auth-rest-api-exception.filter', () => ({
  AuthRestApiExceptionFilter: class AuthRestApiExceptionFilter {},
}));
jest.mock('src/engine/guards/public-endpoint.guard', () => ({
  PublicEndpointGuard: class PublicEndpointGuard {},
}));
jest.mock('src/engine/guards/no-permission.guard', () => ({
  NoPermissionGuard: class NoPermissionGuard {},
}));
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class WorkspaceEntity {},
}));

// eslint-disable-next-line import/first
import { EcnSsoReplayCacheService } from 'src/engine/core-modules/auth/services/ecn-sso-replay-cache.service';
// eslint-disable-next-line import/first
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

// eslint-disable-next-line import/first
import { EcnSsoController } from './ecn-sso.controller';

const HMAC_KEY = 'test-key-for-specs-only';
const OTHER_KEY = 'not-the-right-key';
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

type BuildPayloadOverrides = {
  iss?: string;
  aud?: string;
  jti?: string;
  workspace?: string;
  email?: string;
  name?: string;
  expiresIn?: number;
  iatOffsetSeconds?: number;
};

const buildToken = (
  overrides: BuildPayloadOverrides = {},
  key: string = HMAC_KEY,
): string => {
  const nowSeconds =
    Math.floor(Date.now() / 1000) + (overrides.iatOffsetSeconds ?? 0);
  const payload = {
    iss: overrides.iss ?? 'ecn.earthcare.network',
    aud: overrides.aud ?? 'ecn-crm',
    sub: 'ecn-user-1',
    org: 'acme',
    workspace: overrides.workspace ?? WORKSPACE_ID,
    email: overrides.email ?? 'user@example.com',
    name: overrides.name ?? 'Test User',
    iat: nowSeconds,
    jti: overrides.jti ?? `jti-${Math.random()}`,
  };

  return jwt.sign(payload, key, {
    algorithm: 'HS256',
    expiresIn: overrides.expiresIn ?? 60,
  });
};

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
  redirect: jest.Mock;
};

const makeResponse = (): MockResponse => {
  const res = {
    redirect: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res as unknown as MockResponse;
};

// Minimal shape used by the controller; kept as `unknown` cast to sidestep the
// giant real entity type.
type FakeWorkspace = {
  id: string;
  subdomain: string;
  customDomain: string | null;
  isCustomDomainEnabled: boolean;
  approvedAccessDomains: unknown[];
};

const workspace: FakeWorkspace = {
  id: WORKSPACE_ID,
  subdomain: 'acme',
  customDomain: null,
  isCustomDomainEnabled: false,
  approvedAccessDomains: [],
};

type Mocks = {
  loginTokenService: { generateLoginToken: jest.Mock };
  authService: {
    findInvitationForSignInUp: jest.Mock;
    formatUserDataPayload: jest.Mock;
    checkAccessForSignIn: jest.Mock;
    signInUp: jest.Mock;
    computeRedirectURI: jest.Mock;
  };
  userService: { findUserByEmail: jest.Mock };
  guardRedirectService: { getRedirectErrorUrlAndCaptureExceptions: jest.Mock };
  workspaceDomainsService: {
    getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain: jest.Mock;
  };
  workspaceRepository: { findOne: jest.Mock };
  replayCache: EcnSsoReplayCacheService;
};

const makeController = (): { controller: EcnSsoController } & Mocks => {
  const loginTokenService = { generateLoginToken: jest.fn() };
  const authService = {
    findInvitationForSignInUp: jest.fn().mockResolvedValue(undefined),
    formatUserDataPayload: jest.fn(),
    checkAccessForSignIn: jest.fn().mockResolvedValue(undefined),
    signInUp: jest.fn(),
    computeRedirectURI: jest.fn(),
  };
  const userService = { findUserByEmail: jest.fn() };
  const guardRedirectService = {
    getRedirectErrorUrlAndCaptureExceptions: jest
      .fn()
      .mockReturnValue('https://acme.example.com/verify'),
  };
  const workspaceDomainsService = {
    getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain: jest
      .fn()
      .mockReturnValue({
        subdomain: 'acme',
        customDomain: null,
        isCustomDomainEnabled: false,
      }),
  };
  const workspaceRepository = { findOne: jest.fn() };
  const replayCache = new EcnSsoReplayCacheService();

  const controller = new EcnSsoController(
    loginTokenService as never,
    authService as never,
    userService as never,
    guardRedirectService as never,
    workspaceDomainsService as never,
    replayCache,
    workspaceRepository as never,
  );

  return {
    controller,
    loginTokenService,
    authService,
    userService,
    guardRedirectService,
    workspaceDomainsService,
    workspaceRepository,
    replayCache,
  };
};

describe('EcnSsoController', () => {
  beforeEach(() => {
    process.env.ECN_SSO_HMAC_KEY = HMAC_KEY;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ECN_SSO_HMAC_KEY;
  });

  it('returns 400 JSON when token is missing', async () => {
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnSso(undefined, undefined, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'missing_token' });
  });

  it('accepts token from POST body (Hermes HOSTED-O2 probe shape)', async () => {
    const token = buildToken({}, OTHER_KEY);
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnSso(undefined, { token }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' });
  });

  it('returns 500 JSON when ECN_SSO_HMAC_KEY is missing', async () => {
    delete process.env.ECN_SSO_HMAC_KEY;

    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnSso('any-token', undefined, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'server_not_configured' });
  });

  it('returns 401 JSON on invalid signature', async () => {
    const token = buildToken({}, OTHER_KEY);
    const { controller, workspaceRepository } = makeController();
    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' });
    expect(workspaceRepository.findOne).not.toHaveBeenCalled();
  });

  it('returns 401 JSON on expired token', async () => {
    const token = buildToken({ iatOffsetSeconds: -3600, expiresIn: 60 });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' });
  });

  it('returns 401 JSON on wrong audience', async () => {
    const token = buildToken({ aud: 'not-ecn-crm' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' });
  });

  it('returns 401 JSON on wrong issuer', async () => {
    const token = buildToken({ iss: 'evil.example.com' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' });
  });

  it('returns 401 JSON with token_replayed on replayed jti', async () => {
    const { controller, workspaceRepository, replayCache } = makeController();

    replayCache.record('used-jti', 90);

    const token = buildToken({ jti: 'used-jti' });
    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'token_replayed' });
    expect(workspaceRepository.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 JSON when workspace not found', async () => {
    const token = buildToken();
    const { controller, workspaceRepository } = makeController();

    workspaceRepository.findOne.mockResolvedValue(null);

    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'workspace_not_found' });
  });

  it('generates loginToken and redirects for an existing user (email lowercased)', async () => {
    const token = buildToken({ email: 'Existing@Example.com' });
    const existingUser = { id: 'u1', email: 'existing@example.com' };
    const {
      controller,
      workspaceRepository,
      userService,
      authService,
      loginTokenService,
    } = makeController();

    workspaceRepository.findOne.mockResolvedValue(workspace);
    userService.findUserByEmail.mockResolvedValue(existingUser);
    authService.formatUserDataPayload.mockReturnValue({
      userData: { type: 'existingUser', existingUser },
    });
    authService.signInUp.mockResolvedValue({
      user: existingUser,
      workspace,
    });
    loginTokenService.generateLoginToken.mockResolvedValue({
      token: 'login-token-xyz',
    });
    authService.computeRedirectURI.mockReturnValue(
      'https://acme.example.com/verify?loginToken=login-token-xyz',
    );

    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(userService.findUserByEmail).toHaveBeenCalledWith(
      'existing@example.com',
    );
    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      'existing@example.com',
      WORKSPACE_ID,
      AuthProviderEnum.SSO,
    );
    expect(authService.computeRedirectURI).toHaveBeenCalledWith({
      loginToken: 'login-token-xyz',
      workspace,
    });
    expect(res.redirect).toHaveBeenCalledWith(
      'https://acme.example.com/verify?loginToken=login-token-xyz',
    );
    expect(authService.checkAccessForSignIn).not.toHaveBeenCalled();
  });

  it('admits a new launcher with no prior invitation (JWT is the trust anchor)', async () => {
    const token = buildToken({
      email: 'newperson@example.com',
      name: 'New Person',
    });
    const {
      controller,
      workspaceRepository,
      userService,
      authService,
      loginTokenService,
    } = makeController();

    workspaceRepository.findOne.mockResolvedValue(workspace);
    userService.findUserByEmail.mockResolvedValue(null);
    authService.findInvitationForSignInUp.mockResolvedValue(undefined);
    authService.formatUserDataPayload.mockImplementation(
      (newUserPayload: unknown, existingUser: unknown) => ({
        userData: existingUser
          ? { type: 'existingUser', existingUser }
          : { type: 'newUser', newUserPayload },
      }),
    );
    authService.signInUp.mockResolvedValue({
      user: { email: 'newperson@example.com' },
      workspace,
    });
    loginTokenService.generateLoginToken.mockResolvedValue({
      token: 'login-token-new',
    });
    authService.computeRedirectURI.mockReturnValue(
      'https://acme.example.com/verify?loginToken=login-token-new',
    );

    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(authService.formatUserDataPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'newperson@example.com',
        firstName: 'New',
        lastName: 'Person',
        isEmailAlreadyVerified: true,
      }),
      null,
    );
    expect(authService.checkAccessForSignIn).not.toHaveBeenCalled();
    expect(authService.signInUp).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        authParams: { provider: AuthProviderEnum.SSO },
        invitation: undefined,
        userData: expect.objectContaining({ type: 'newUser' }),
      }),
    );
    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      'newperson@example.com',
      WORKSPACE_ID,
      AuthProviderEnum.SSO,
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://acme.example.com/verify?loginToken=login-token-new',
    );
  });

  it('still honors the invitation-present path (passes invitation to signInUp)', async () => {
    const token = buildToken({ email: 'invited@example.com' });
    const invitation = { id: 'invite-1', value: 'invite-token' };
    const {
      controller,
      workspaceRepository,
      userService,
      authService,
      loginTokenService,
    } = makeController();

    workspaceRepository.findOne.mockResolvedValue(workspace);
    userService.findUserByEmail.mockResolvedValue(null);
    authService.findInvitationForSignInUp.mockResolvedValue(invitation);
    authService.formatUserDataPayload.mockReturnValue({
      userData: {
        type: 'newUser',
        newUserPayload: { email: 'invited@example.com' },
      },
    });
    authService.signInUp.mockResolvedValue({
      user: { email: 'invited@example.com' },
      workspace,
    });
    loginTokenService.generateLoginToken.mockResolvedValue({
      token: 'login-token-inv',
    });
    authService.computeRedirectURI.mockReturnValue(
      'https://acme.example.com/verify?loginToken=login-token-inv',
    );

    await controller.ecnSso(token, undefined, makeResponse());

    expect(authService.findInvitationForSignInUp).toHaveBeenCalledWith({
      currentWorkspace: workspace,
      email: 'invited@example.com',
    });
    expect(authService.checkAccessForSignIn).not.toHaveBeenCalled();
    expect(authService.signInUp).toHaveBeenCalledWith(
      expect.objectContaining({
        invitation,
        authParams: { provider: AuthProviderEnum.SSO },
      }),
    );
  });

  it('records the jti in the replay cache on first successful request', async () => {
    const token = buildToken({ jti: 'first-time-jti' });
    const user = { id: 'u1', email: 'user@example.com' };
    const {
      controller,
      workspaceRepository,
      userService,
      authService,
      loginTokenService,
      replayCache,
    } = makeController();

    workspaceRepository.findOne.mockResolvedValue(workspace);
    userService.findUserByEmail.mockResolvedValue(user);
    authService.formatUserDataPayload.mockReturnValue({
      userData: { type: 'existingUser', existingUser: user },
    });
    authService.signInUp.mockResolvedValue({ user, workspace });
    loginTokenService.generateLoginToken.mockResolvedValue({
      token: 'login-token-ok',
    });
    authService.computeRedirectURI.mockReturnValue(
      'https://acme.example.com/verify?loginToken=login-token-ok',
    );

    expect(replayCache.has('first-time-jti')).toBe(false);

    await controller.ecnSso(token, undefined, makeResponse());

    expect(replayCache.has('first-time-jti')).toBe(true);
  });

  it('redirects via GuardRedirectService when signInUp throws (workspace known)', async () => {
    const token = buildToken();
    const {
      controller,
      workspaceRepository,
      userService,
      authService,
      guardRedirectService,
    } = makeController();

    workspaceRepository.findOne.mockResolvedValue(workspace);
    userService.findUserByEmail.mockResolvedValue(null);
    authService.formatUserDataPayload.mockReturnValue({
      userData: {
        type: 'newUser',
        newUserPayload: { email: 'user@example.com' },
      },
    });
    authService.signInUp.mockRejectedValue(new Error('signup exploded'));

    const res = makeResponse();

    await controller.ecnSso(token, undefined, res);

    expect(
      guardRedirectService.getRedirectErrorUrlAndCaptureExceptions,
    ).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledTimes(1);
    const redirectedTo = (res.redirect as jest.Mock).mock.calls[0][0] as string;

    expect(redirectedTo).toContain('sso_error=sso_failed');
  });
});
