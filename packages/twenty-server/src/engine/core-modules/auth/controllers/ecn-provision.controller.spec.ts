import { type Response } from 'express';
import * as jwt from 'jsonwebtoken';

// Mock the provision service — importing the real class pulls the entire
// monorepo graph (workspace-manager, application, onboarding, user-role, etc.)
// into the jest resolver. We only need the constructor token for DI shape.
jest.mock(
  'src/engine/core-modules/auth/services/ecn-provision.service',
  () => ({
    EcnProvisionService: class EcnProvisionService {},
    EcnProvisionError: class EcnProvisionError extends Error {
      kind: 'subdomain_conflict' | 'provision_failed';
      step?: string;
      existingWorkspaceId?: string;

      constructor(
        kind: 'subdomain_conflict' | 'provision_failed',
        step?: string,
        existingWorkspaceId?: string,
      ) {
        super(kind);
        this.name = 'EcnProvisionError';
        this.kind = kind;
        this.step = step;
        this.existingWorkspaceId = existingWorkspaceId;
      }
    },
  }),
);
jest.mock(
  'src/engine/core-modules/auth/services/ecn-sso-replay-cache.service',
  () => ({
    EcnSsoReplayCacheService: class EcnSsoReplayCacheService {
      private seen = new Map<string, number>();

      has(jti: string): boolean {
        const expiresAt = this.seen.get(jti);

        if (expiresAt === undefined) {
          return false;
        }

        if (expiresAt <= Date.now()) {
          this.seen.delete(jti);

          return false;
        }

        return true;
      }

      record(jti: string, ttlSeconds: number): void {
        this.seen.set(jti, Date.now() + ttlSeconds * 1000);
      }
    },
  }),
);
jest.mock(
  'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter',
  () => ({
    AuthRestApiExceptionFilter: class AuthRestApiExceptionFilter {},
  }),
);
jest.mock('src/engine/guards/public-endpoint.guard', () => ({
  PublicEndpointGuard: class PublicEndpointGuard {},
}));
jest.mock('src/engine/guards/no-permission.guard', () => ({
  NoPermissionGuard: class NoPermissionGuard {},
}));

// eslint-disable-next-line import/first
import { EcnProvisionController } from './ecn-provision.controller';
// eslint-disable-next-line import/first
import { EcnSsoReplayCacheService } from 'src/engine/core-modules/auth/services/ecn-sso-replay-cache.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  EcnProvisionError,
} = require('src/engine/core-modules/auth/services/ecn-provision.service');

const HMAC_KEY = 'test-key-for-specs-only';
const OTHER_KEY = 'not-the-right-key';

type BuildPayloadOverrides = {
  iss?: string;
  aud?: string;
  jti?: string;
  expiresIn?: number;
  iatOffsetSeconds?: number;
  omitField?:
    | 'org'
    | 'owner_email'
    | 'owner_first_name'
    | 'owner_last_name'
    | 'workspace_name'
    | 'jti';
};

const buildToken = (
  overrides: BuildPayloadOverrides = {},
  key: string = HMAC_KEY,
): string => {
  const nowSeconds =
    Math.floor(Date.now() / 1000) + (overrides.iatOffsetSeconds ?? 0);
  const payload: Record<string, unknown> = {
    iss: 'ecn.earthcare.network',
    aud: 'ecn-crm:provision',
    sub: 'ecn-owner-1',
    org: 'acme',
    workspace_name: 'Acme Corp',
    owner_email: 'owner@example.com',
    owner_first_name: 'Jane',
    owner_last_name: 'Doe',
    iat: nowSeconds,
    jti: `jti-${Math.random()}`,
  };

  if (overrides.iss !== undefined) {
    payload.iss = overrides.iss;
  }

  if (overrides.aud !== undefined) {
    payload.aud = overrides.aud;
  }

  if (overrides.jti !== undefined) {
    payload.jti = overrides.jti;
  }

  if (overrides.omitField !== undefined) {
    delete payload[overrides.omitField];
  }

  return jwt.sign(payload, key, {
    algorithm: 'HS256',
    expiresIn: overrides.expiresIn ?? 60,
  });
};

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
};

const makeResponse = (): MockResponse => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res as unknown as MockResponse;
};

type Mocks = {
  provisionService: { provision: jest.Mock };
  replayCache: EcnSsoReplayCacheService;
};

const makeController = (): { controller: EcnProvisionController } & Mocks => {
  const provisionService = { provision: jest.fn() };
  const replayCache = new EcnSsoReplayCacheService();

  const controller = new EcnProvisionController(
    provisionService as never,
    replayCache,
  );

  return { controller, provisionService, replayCache };
};

const makeOkResponse = () => ({
  workspace_id: 'ws-123',
  workspace_subdomain: 'acme',
  workspace_url: 'https://ecn-crm-test-test.up.railway.app',
  owner_user_id: 'user-456',
  activation_status: 'ACTIVE',
  onboarding_status: 'COMPLETED',
  idempotent: false,
});

describe('EcnProvisionController', () => {
  beforeEach(() => {
    process.env.ECN_SSO_HMAC_KEY = HMAC_KEY;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ECN_SSO_HMAC_KEY;
  });

  it('returns 400 JSON when token is missing', async () => {
    const { controller, provisionService } = makeController();
    const res = makeResponse();

    await controller.ecnProvision(undefined, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'missing_token' });
    expect(provisionService.provision).not.toHaveBeenCalled();
  });

  it('returns 400 JSON when body.token is empty string', async () => {
    const { controller, provisionService } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token: '   ' }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'missing_token' });
    expect(provisionService.provision).not.toHaveBeenCalled();
  });

  it('returns 500 JSON when ECN_SSO_HMAC_KEY is missing', async () => {
    delete process.env.ECN_SSO_HMAC_KEY;
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token: 'any-token' }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'server_not_configured',
    });
  });

  it('returns 401 signature_verification_failed on wrong HMAC key', async () => {
    const token = buildToken({}, OTHER_KEY);
    const { controller, provisionService } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'signature_verification_failed',
    });
    expect(provisionService.provision).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_token on wrong issuer', async () => {
    const token = buildToken({ iss: 'evil.example.com' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' }),
    );
  });

  it('returns 400 invalid_token on wrong audience', async () => {
    const token = buildToken({ aud: 'not-ecn-crm:provision' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' }),
    );
  });

  it('returns 400 invalid_token on expired token', async () => {
    const token = buildToken({ iatOffsetSeconds: -3600, expiresIn: 60 });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' }),
    );
  });

  it('returns 400 invalid_token when required claim org is missing', async () => {
    const token = buildToken({ omitField: 'org' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      detail: 'missing required claims',
    });
  });

  it('returns 400 invalid_token when required claim owner_email is missing', async () => {
    const token = buildToken({ omitField: 'owner_email' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      detail: 'missing required claims',
    });
  });

  it('returns 400 invalid_token when required claim owner_first_name is missing', async () => {
    const token = buildToken({ omitField: 'owner_first_name' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      detail: 'missing required claims',
    });
  });

  it('returns 400 invalid_token when required claim owner_last_name is missing', async () => {
    const token = buildToken({ omitField: 'owner_last_name' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      detail: 'missing required claims',
    });
  });

  it('returns 400 invalid_token when required claim workspace_name is missing', async () => {
    const token = buildToken({ omitField: 'workspace_name' });
    const { controller } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      detail: 'missing required claims',
    });
  });

  it('returns 400 invalid_token when required claim jti is missing', async () => {
    const token = buildToken({ omitField: 'jti' });
    const { controller, provisionService } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    // jwt.sign drops undefined fields, so the decoded token has no jti.
    // hasRequiredClaims checks `typeof payload.jti === 'string' && payload.jti.length > 0`
    // → undefined fails → 400 invalid_token missing required claims.
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_token',
      detail: 'missing required claims',
    });
    expect(provisionService.provision).not.toHaveBeenCalled();
  });

  it('returns 401 token_replayed on replayed jti', async () => {
    const { controller, provisionService, replayCache } = makeController();

    replayCache.record('used-jti', 90);
    const token = buildToken({ jti: 'used-jti' });
    const res = makeResponse();

    await controller.ecnProvision({ token }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'token_replayed' });
    expect(provisionService.provision).not.toHaveBeenCalled();
  });

  it('reserves jti in replay cache before calling provision (race protection)', async () => {
    const token = buildToken({ jti: 'fresh-jti' });
    const { controller, provisionService, replayCache } = makeController();

    provisionService.provision.mockResolvedValue(makeOkResponse());

    await controller.ecnProvision({ token }, makeResponse());

    expect(replayCache.has('fresh-jti')).toBe(true);
    expect(provisionService.provision).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with provision result on success', async () => {
    const okResult = makeOkResponse();
    const { controller, provisionService } = makeController();

    provisionService.provision.mockResolvedValue(okResult);

    const res = makeResponse();
    await controller.ecnProvision(
      {
        token: buildToken({ jti: 'success-jti' }),
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(okResult);
    expect(provisionService.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        org: 'acme',
        owner_email: 'owner@example.com',
      }),
    );
  });

  it('rejects an SSO token (aud mismatch) — spec-mandated isolation', async () => {
    // An SSO token (aud: 'ecn-crm') must NOT be accepted by /ecn/provision
    // (audience: 'ecn-crm:provision'). This is the spec-mandated isolation
    // so an SSO token cannot be replayed against the provisioner.
    const ssoPayload = {
      iss: 'ecn.earthcare.network',
      aud: 'ecn-crm',
      sub: 'owner-1',
      org: 'acme',
      email: 'owner@example.com',
      name: 'Jane Doe',
      workspace: 'ws-123',
      iat: Math.floor(Date.now() / 1000),
      jti: `sso-jti-${Math.random()}`,
    };
    const ssoToken = jwt.sign(ssoPayload, HMAC_KEY, {
      algorithm: 'HS256',
      expiresIn: 60,
    });

    const { controller, provisionService } = makeController();
    const res = makeResponse();

    await controller.ecnProvision({ token: ssoToken }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' }),
    );
    expect(provisionService.provision).not.toHaveBeenCalled();
  });

  it('returns 409 subdomain_conflict on EcnProvisionError(subdomain_conflict)', async () => {
    const { controller, provisionService } = makeController();

    provisionService.provision.mockRejectedValue(
      new EcnProvisionError('subdomain_conflict', undefined, 'ws-existing'),
    );

    const res = makeResponse();
    await controller.ecnProvision(
      {
        token: buildToken({ jti: 'conflict-jti' }),
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'subdomain_conflict',
      existing_workspace_id: 'ws-existing',
    });
  });

  it('returns 500 provision_failed with step on EcnProvisionError(provision_failed)', async () => {
    const { controller, provisionService } = makeController();

    provisionService.provision.mockRejectedValue(
      new EcnProvisionError('provision_failed', 'onboarding'),
    );

    const res = makeResponse();
    await controller.ecnProvision(
      {
        token: buildToken({ jti: 'fail-jti' }),
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'provision_failed',
      step: 'onboarding',
    });
  });

  it('returns 500 provision_failed on unknown error (no step)', async () => {
    const { controller, provisionService } = makeController();

    provisionService.provision.mockRejectedValue(new Error('boom'));

    const res = makeResponse();
    await controller.ecnProvision(
      {
        token: buildToken({ jti: 'boom-jti' }),
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'provision_failed',
    });
  });
});
