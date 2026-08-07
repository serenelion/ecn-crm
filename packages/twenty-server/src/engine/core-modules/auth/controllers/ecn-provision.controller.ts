import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { type Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { isDefined } from 'twenty-shared/utils';

import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { EcnSsoReplayCacheService } from 'src/engine/core-modules/auth/services/ecn-sso-replay-cache.service';
import {
  EcnProvisionError,
  EcnProvisionService,
} from 'src/engine/core-modules/auth/services/ecn-provision.service';
import { type EcnProvisionTokenPayload } from 'src/engine/core-modules/auth/types/ecn-provision-token-payload.type';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

const ECN_PROVISION_ISSUER = 'ecn.earthcare.network';
const ECN_PROVISION_AUDIENCE = 'ecn-crm:provision';
// 90s replay window: wider than the 60s JWT TTL so a replay after the token
// expires is still rejected as replay (not just as expired).
const ECN_PROVISION_REPLAY_TTL_SECONDS = 90;

type ErrorBody =
  | { error: 'missing_token' }
  | { error: 'server_not_configured' }
  | { error: 'invalid_token'; detail: string }
  | { error: 'signature_verification_failed' }
  | { error: 'token_replayed' }
  | { error: 'subdomain_conflict'; existing_workspace_id?: string }
  | {
      error: 'provision_failed';
      step?: string;
    };

@Controller('ecn')
@UseFilters(AuthRestApiExceptionFilter)
export class EcnProvisionController {
  constructor(
    private readonly provisionService: EcnProvisionService,
    private readonly replayCache: EcnSsoReplayCacheService,
  ) {}

  @Post('provision')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async ecnProvision(
    @Body() body: { token?: string } | undefined,
    @Res() res: Response,
  ): Promise<Response> {
    const token = body?.token?.trim();

    if (!isDefined(token) || token.length === 0) {
      return this.jsonError(res, HttpStatus.BAD_REQUEST, {
        error: 'missing_token',
      });
    }

    const key = process.env.ECN_SSO_HMAC_KEY;

    if (!isDefined(key) || key.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[ecn-provision] ECN_SSO_HMAC_KEY is not configured; refusing to verify',
      );

      return this.jsonError(res, HttpStatus.INTERNAL_SERVER_ERROR, {
        error: 'server_not_configured',
      });
    }

    let payload: EcnProvisionTokenPayload;

    try {
      payload = jwt.verify(token, key, {
        algorithms: ['HS256'],
        issuer: ECN_PROVISION_ISSUER,
        audience: ECN_PROVISION_AUDIENCE,
      }) as EcnProvisionTokenPayload;
    } catch (error) {
      // Signature failures get their own 401 code so the caller can distinguish
      // key drift from a malformed / expired token; anything else is 400
      // invalid_token with a short detail.
      if (
        error instanceof jwt.JsonWebTokenError &&
        error.message === 'invalid signature'
      ) {
        return this.jsonError(res, HttpStatus.UNAUTHORIZED, {
          error: 'signature_verification_failed',
        });
      }

      const detail = error instanceof Error ? error.message : 'invalid token';

      return this.jsonError(res, HttpStatus.BAD_REQUEST, {
        error: 'invalid_token',
        detail,
      });
    }

    if (!this.hasRequiredClaims(payload)) {
      return this.jsonError(res, HttpStatus.BAD_REQUEST, {
        error: 'invalid_token',
        detail: 'missing required claims',
      });
    }

    if (this.replayCache.has(payload.jti)) {
      return this.jsonError(res, HttpStatus.UNAUTHORIZED, {
        error: 'token_replayed',
      });
    }

    // Reserve the jti BEFORE the provision run so a concurrent duplicate loses.
    this.replayCache.record(payload.jti, ECN_PROVISION_REPLAY_TTL_SECONDS);

    try {
      const result = await this.provisionService.provision(payload);

      return res.status(HttpStatus.OK).json(result);
    } catch (error) {
      if (error instanceof EcnProvisionError) {
        if (error.kind === 'subdomain_conflict') {
          return this.jsonError(res, HttpStatus.CONFLICT, {
            error: 'subdomain_conflict',
            existing_workspace_id: error.existingWorkspaceId,
          });
        }

        return this.jsonError(res, HttpStatus.INTERNAL_SERVER_ERROR, {
          error: 'provision_failed',
          step: error.step,
        });
      }

      // eslint-disable-next-line no-console
      console.error('[ecn-provision] unexpected error', error);

      return this.jsonError(res, HttpStatus.INTERNAL_SERVER_ERROR, {
        error: 'provision_failed',
      });
    }
  }

  private hasRequiredClaims(payload: EcnProvisionTokenPayload): boolean {
    return (
      typeof payload.jti === 'string' &&
      payload.jti.length > 0 &&
      typeof payload.org === 'string' &&
      payload.org.length > 0 &&
      typeof payload.workspace_name === 'string' &&
      payload.workspace_name.length > 0 &&
      typeof payload.owner_email === 'string' &&
      payload.owner_email.length > 0 &&
      typeof payload.owner_first_name === 'string' &&
      typeof payload.owner_last_name === 'string'
    );
  }

  private jsonError(res: Response, status: number, body: ErrorBody): Response {
    return res.status(status).json(body);
  }
}
