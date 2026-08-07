import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { DataSource, type QueryRunner, Repository } from 'typeorm';
import { v4 } from 'uuid';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { hashPassword } from 'src/engine/core-modules/auth/auth.util';
import { type EcnProvisionTokenPayload } from 'src/engine/core-modules/auth/types/ecn-provision-token-payload.type';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

export type EcnProvisionStep =
  | 'workspace'
  | 'user'
  | 'user_workspace'
  | 'activate'
  | 'onboarding';

export class EcnProvisionError extends Error {
  constructor(
    public readonly kind: 'subdomain_conflict' | 'provision_failed',
    public readonly step?: EcnProvisionStep,
    public readonly existingWorkspaceId?: string,
    cause?: unknown,
  ) {
    super(kind);
    this.name = 'EcnProvisionError';

    if (isDefined(cause)) {
      this.cause = cause;
    }
  }
}

export type EcnProvisionResponse = {
  workspace_id: string;
  workspace_subdomain: string;
  workspace_url: string;
  owner_user_id: string;
  activation_status: 'ACTIVE' | 'CREATED';
  onboarding_status: 'COMPLETED';
  idempotent: boolean;
};

@Injectable()
export class EcnProvisionService {
  private readonly logger = new Logger(EcnProvisionService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    private readonly workspaceService: WorkspaceService,
    private readonly onboardingService: OnboardingService,
    private readonly userRoleService: UserRoleService,
    private readonly applicationService: ApplicationService,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async provision(
    payload: EcnProvisionTokenPayload,
  ): Promise<EcnProvisionResponse> {
    const ownerEmail = payload.owner_email.toLowerCase();

    const existingWorkspace = await this.workspaceRepository.findOne({
      where: { subdomain: payload.org },
    });

    if (isDefined(existingWorkspace)) {
      return await this.buildIdempotentOrConflict({
        existingWorkspace,
        ownerEmail,
      });
    }

    return await this.createFresh({ payload, ownerEmail });
  }

  private async buildIdempotentOrConflict({
    existingWorkspace,
    ownerEmail,
  }: {
    existingWorkspace: WorkspaceEntity;
    ownerEmail: string;
  }): Promise<EcnProvisionResponse> {
    const existingUser = await this.userRepository.findOne({
      where: { email: ownerEmail },
    });

    if (!isDefined(existingUser)) {
      throw new EcnProvisionError(
        'subdomain_conflict',
        undefined,
        existingWorkspace.id,
      );
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: {
        userId: existingUser.id,
        workspaceId: existingWorkspace.id,
      },
    });

    if (!isDefined(userWorkspace)) {
      throw new EcnProvisionError(
        'subdomain_conflict',
        undefined,
        existingWorkspace.id,
      );
    }

    const rolesByUserWorkspace =
      await this.userRoleService.getRolesByUserWorkspaces({
        userWorkspaceIds: [userWorkspace.id],
        workspaceId: existingWorkspace.id,
      });

    const roles = rolesByUserWorkspace.get(userWorkspace.id) ?? [];
    const isAdmin = roles.some(
      (role) =>
        role.universalIdentifier === STANDARD_ROLE.admin.universalIdentifier,
    );

    if (!isAdmin) {
      throw new EcnProvisionError(
        'subdomain_conflict',
        undefined,
        existingWorkspace.id,
      );
    }

    return this.buildResponse({
      workspace: existingWorkspace,
      ownerUserId: existingUser.id,
      idempotent: true,
    });
  }

  private async createFresh({
    payload,
    ownerEmail,
  }: {
    payload: EcnProvisionTokenPayload;
    ownerEmail: string;
  }): Promise<EcnProvisionResponse> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    let ownerUserId: string;
    let workspaceId: string;

    try {
      const workspace = await this.createWorkspaceInTransaction({
        payload,
        queryRunner,
      });

      workspaceId = workspace.id;

      const ownerUser = await this.createOwnerUserInTransaction({
        payload,
        ownerEmail,
        queryRunner,
      });

      ownerUserId = ownerUser.id;

      await this.createUserWorkspaceInTransaction({
        userId: ownerUser.id,
        workspaceId: workspace.id,
        queryRunner,
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      await queryRunner.release();

      if (error instanceof EcnProvisionError) {
        throw error;
      }

      this.logger.error(
        `[ecn-provision] transaction failed: ${(error as Error).message}`,
      );
      throw new EcnProvisionError(
        'provision_failed',
        'workspace',
        undefined,
        error,
      );
    }

    await queryRunner.release();

    // activateWorkspace and onboarding writes run outside the createFresh
    // transaction because activateWorkspace opens its own queryRunners and
    // performs schema-level work (workspace-manager init) that cannot be nested
    // in the seed transaction. If activation fails we surface provision_failed
    // at the corresponding step; ECN retries and hits the idempotent path or
    // a subdomain_conflict on the next attempt.
    let activatedWorkspace: WorkspaceEntity;

    try {
      const workspace = await this.reloadWorkspace(workspaceId);
      const result = await this.workspaceService.activateWorkspace(
        { id: ownerUserId } as never,
        workspace,
      );

      if (!isDefined(result)) {
        throw new Error('activateWorkspace returned undefined');
      }

      activatedWorkspace = result;
    } catch (error) {
      this.logger.error(
        `[ecn-provision] activateWorkspace failed for ${workspaceId}: ${(error as Error).message}`,
      );

      if (error instanceof EcnProvisionError) {
        throw error;
      }

      throw new EcnProvisionError(
        'provision_failed',
        'activate',
        undefined,
        error,
      );
    }

    try {
      await this.markOnboardingCompleted({
        userId: ownerUserId,
        workspaceId,
      });
    } catch (error) {
      this.logger.error(
        `[ecn-provision] onboarding flag write failed for ${workspaceId}: ${(error as Error).message}`,
      );
      throw new EcnProvisionError(
        'provision_failed',
        'onboarding',
        undefined,
        error,
      );
    }

    return this.buildResponse({
      workspace: activatedWorkspace,
      ownerUserId,
      idempotent: false,
    });
  }

  private async createWorkspaceInTransaction({
    payload,
    queryRunner,
  }: {
    payload: EcnProvisionTokenPayload;
    queryRunner: QueryRunner;
  }): Promise<WorkspaceEntity> {
    try {
      // Workspace row requires a workspaceCustomApplicationId (non-nullable FK).
      // Mirror sign-in-up's create path: pre-mint the id, insert the workspace,
      // then create the ApplicationEntity inside the same transaction.
      const workspaceCustomApplicationId = v4();

      const workspaceToCreate = queryRunner.manager.create(WorkspaceEntity, {
        displayName: payload.workspace_name,
        subdomain: payload.org,
        workspaceCustomApplicationId,
        inviteHash: v4(),
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      });

      const workspace = await queryRunner.manager.save(
        WorkspaceEntity,
        workspaceToCreate,
      );

      await this.applicationService.createWorkspaceCustomApplication(
        {
          workspaceId: workspace.id,
          applicationId: workspaceCustomApplicationId,
        },
        queryRunner,
      );

      return workspace;
    } catch (error) {
      throw new EcnProvisionError(
        'provision_failed',
        'workspace',
        undefined,
        error,
      );
    }
  }

  private async createOwnerUserInTransaction({
    payload,
    ownerEmail,
    queryRunner,
  }: {
    payload: EcnProvisionTokenPayload;
    ownerEmail: string;
    queryRunner: QueryRunner;
  }): Promise<UserEntity> {
    try {
      // Password never used for actual sign-in — JWT via /ecn/sso is the entry.
      // This is a placeholder for record integrity.
      const passwordHash = await hashPassword(v4());

      const userToCreate = queryRunner.manager.create(UserEntity, {
        email: ownerEmail,
        firstName: payload.owner_first_name,
        lastName: payload.owner_last_name,
        passwordHash,
        isEmailVerified: true,
        canAccessFullAdminPanel: false,
        canImpersonate: false,
      });

      return await queryRunner.manager.save(UserEntity, userToCreate);
    } catch (error) {
      throw new EcnProvisionError(
        'provision_failed',
        'user',
        undefined,
        error,
      );
    }
  }

  private async createUserWorkspaceInTransaction({
    userId,
    workspaceId,
    queryRunner,
  }: {
    userId: string;
    workspaceId: string;
    queryRunner: QueryRunner;
  }): Promise<UserWorkspaceEntity> {
    try {
      const userWorkspace = queryRunner.manager.create(UserWorkspaceEntity, {
        userId,
        workspaceId,
      });

      return await queryRunner.manager.save(
        UserWorkspaceEntity,
        userWorkspace,
      );
    } catch (error) {
      throw new EcnProvisionError(
        'provision_failed',
        'user_workspace',
        undefined,
        error,
      );
    }
  }

  private async reloadWorkspace(workspaceId: string): Promise<WorkspaceEntity> {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (!isDefined(workspace)) {
      throw new EcnProvisionError(
        'provision_failed',
        'workspace',
        undefined,
        new Error(`Workspace ${workspaceId} vanished after commit`),
      );
    }

    return workspace;
  }

  private async markOnboardingCompleted({
    userId,
    workspaceId,
  }: {
    userId: string;
    workspaceId: string;
  }): Promise<void> {
    // All 4 pending flags must be false for OnboardingStatus.COMPLETED. Passing
    // value: false through each setter routes to userVarsService.delete, which
    // is idempotent — safe if activateWorkspace never set them in the first
    // place.
    await this.onboardingService.setOnboardingConnectAccountPending({
      userId,
      workspaceId,
      value: false,
    });

    await this.onboardingService.setOnboardingCreateProfilePending({
      userId,
      workspaceId,
      value: false,
    });

    await this.onboardingService.setOnboardingInstallAppsPending({
      userId,
      workspaceId,
      value: false,
    });

    await this.onboardingService.setOnboardingInviteTeamPending({
      workspaceId,
      value: false,
    });
  }

  private buildResponse({
    workspace,
    ownerUserId,
    idempotent,
  }: {
    workspace: WorkspaceEntity;
    ownerUserId: string;
    idempotent: boolean;
  }): EcnProvisionResponse {
    const workspaceUrl =
      this.twentyConfigService.get('SERVER_URL') ??
      process.env.SERVER_URL ??
      '';

    const activationStatus =
      workspace.activationStatus === WorkspaceActivationStatus.ACTIVE
        ? 'ACTIVE'
        : 'CREATED';

    return {
      workspace_id: workspace.id,
      workspace_subdomain: workspace.subdomain,
      workspace_url: workspaceUrl,
      owner_user_id: ownerUserId,
      activation_status: activationStatus,
      onboarding_status: 'COMPLETED',
      idempotent,
    };
  }
}
