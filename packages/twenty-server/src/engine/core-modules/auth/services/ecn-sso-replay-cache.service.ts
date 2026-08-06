import { Injectable } from '@nestjs/common';

// In-memory jti replay cache for the ECN SSO fork endpoint. Single-instance only;
// multi-instance deployments will double-accept a jti across replicas.
// TODO(V41-6): move to Redis when we roll full OIDC.
@Injectable()
export class EcnSsoReplayCacheService {
  private readonly seen = new Map<string, number>();

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
    const now = Date.now();

    // Lazy sweep: amortize cleanup across writes so the map doesn't grow unbounded.
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(key);
      }
    }

    this.seen.set(jti, now + ttlSeconds * 1000);
  }
}
