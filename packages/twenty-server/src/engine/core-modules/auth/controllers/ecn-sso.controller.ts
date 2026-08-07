import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type Response } from 'express';
import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';
import * as jwt from 'jsonwebtoken';

import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { EcnSsoReplayCacheService } from 'src/engine/core-modules/auth/services/ecn-sso-replay-cache.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { type EcnSsoTokenPayload } from 'src/engine/core-modules/auth/types/ecn-sso-token-payload.type';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

const ECN_SSO_ISSUER = 'ecn.earthcare.network';
const ECN_SSO_AUDIENCE = 'ecn-crm';
// 90s replay window: wider than the 60s JWT TTL so a replay after the token
// expires is still rejected as replay (not just as expired).
const ECN_SSO_REPLAY_TTL_SECONDS = 90;

type EcnSsoErrorCode =
  | 'missing_token'
  | 'server_not_configured'
  | 'invalid_token'
  | 'token_replayed'
  | 'workspace_not_found';

@Controller('ecn')
@UseFilters(AuthRestApiExceptionFilter)
export class EcnSsoController {
  constructor(
    private readonly loginTokenService: LoginTokenService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly guardRedirectService: GuardRedirectService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly replayCache: EcnSsoReplayCacheService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {}

  // Product Open path is GET ?token= (window.open). Hermes/HOSTED-O2 probe also
  // uses POST JSON {token} — both verbs must hit Nest (not SPA) and ≠404.
  @Get('sso')
  @Post('sso')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async ecnSso(
    @Query('token') queryToken: string | undefined,
    @Body() body: { token?: string } | undefined,
    @Res() res: Response,
  ): Promise<Response | void> {
    const token = (queryToken || body?.token || '').trim() || undefined;

    if (!isDefined(token) || token.length === 0) {
      return this.jsonError(res, HttpStatus.BAD_REQUEST, 'missing_token');
    }

    const key = process.env.ECN_SSO_HMAC_KEY;

    if (!isDefined(key) || key.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[ecn-sso] ECN_SSO_HMAC_KEY is not configured; refusing to verify',
      );

      return this.jsonError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'server_not_configured',
      );
    }

    let payload: EcnSsoTokenPayload;

    try {
      payload = jwt.verify(token, key, {
        algorithms: ['HS256'],
        issuer: ECN_SSO_ISSUER,
        audience: ECN_SSO_AUDIENCE,
      }) as EcnSsoTokenPayload;
    } catch {
      // Any verify failure (bad sig, expired, wrong iss/aud, malformed) is
      // reported the same way — we do not leak which specific check failed.
      return this.jsonError(res, HttpStatus.UNAUTHORIZED, 'invalid_token');
    }

    if (!isDefined(payload.jti) || payload.jti.length === 0) {
      return this.jsonError(res, HttpStatus.UNAUTHORIZED, 'invalid_token');
    }

    if (this.replayCache.has(payload.jti)) {
      return this.jsonError(res, HttpStatus.UNAUTHORIZED, 'token_replayed');
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { id: payload.workspace },
      relations: ['approvedAccessDomains'],
    });

    if (!isDefined(workspace)) {
      return this.jsonError(res, HttpStatus.NOT_FOUND, 'workspace_not_found');
    }

    // Reserve the jti BEFORE signInUp so a concurrent duplicate request loses.
    this.replayCache.record(payload.jti, ECN_SSO_REPLAY_TTL_SECONDS);

    try {
      const loginToken = await this.generateLoginToken(payload, workspace);

      return res.redirect(
        this.authService.computeRedirectURI({
          loginToken: loginToken.token,
          workspace,
        }),
      );
    } catch (error) {
      // Workspace is known here — redirect on the workspace domain rather
      // than JSON so the user lands somewhere they recognise.
      const wrappedError =
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : 'SSO error');

      return res.redirect(
        this.buildErrorRedirect(workspace, wrappedError, 'sso_failed'),
      );
    }
  }

  private jsonError(
    res: Response,
    status: number,
    code: EcnSsoErrorCode,
  ): Response {
    return res.status(status).json({ error: code });
  }

  private buildErrorRedirect(
    workspace: WorkspaceEntity,
    error: Error,
    reason: string,
  ): string {
    const workspaceDomain =
      this.workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain(
        workspace,
      );

    const baseUrl =
      this.guardRedirectService.getRedirectErrorUrlAndCaptureExceptions({
        error,
        workspace: {
          ...workspaceDomain,
          id: workspace.id,
        },
        pathname: AppPath.Verify,
      });

    const url = new URL(baseUrl);

    url.searchParams.set('sso_error', reason);

    return url.toString();
  }

  private async generateLoginToken(
    payload: EcnSsoTokenPayload,
    workspace: WorkspaceEntity,
  ) {
    const email = payload.email.toLowerCase();

    // Invitation lookup is still honored — a launcher who happens to hold a
    // matching invitation gets the invitation-side effects (credits, email
    // verified). Invitation absence must NOT block admit on this path.
    const invitation = await this.authService.findInvitationForSignInUp({
      currentWorkspace: workspace,
      email,
    });

    const existingUser = await this.userService.findUserByEmail(email);

    const [firstName, ...restName] = (payload.name ?? '').trim().split(/\s+/);

    const { userData } = this.authService.formatUserDataPayload(
      {
        email,
        firstName: firstName || null,
        lastName: restName.length > 0 ? restName.join(' ') : null,
        isEmailAlreadyVerified: true,
      },
      existingUser,
    );

    // The HMAC-verified ECN SSO JWT (iss/aud/exp/jti-checked) is the trust
    // anchor for this workspace admit. Skip checkAccessForSignIn — it would
    // otherwise reject a launcher whose Nest workspace membership hasn't been
    // pre-seeded, which contradicts the Open-path product contract that "ECN
    // session is SoT; one ECN session → CRM workspace." signInUp below routes
    // through signInUpOnExistingWorkspace (or signInUpWithPersonalInvitation
    // when an invitation is present), which idempotently binds the user to
    // the workspace and creates the user record if new.
    const { workspace: signedInWorkspace, user } =
      await this.authService.signInUp({
        userData,
        workspace,
        invitation,
        authParams: {
          provider: AuthProviderEnum.SSO,
        },
      });

    return await this.loginTokenService.generateLoginToken(
      user.email,
      signedInWorkspace.id,
      AuthProviderEnum.SSO,
    );
  }
}
