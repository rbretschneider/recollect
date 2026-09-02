import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { passwordReset, userAccount } from '../database/schema';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail } from '../mail/templates';
import { UsersService } from '../users/users.service';

/** A reset link is good for one hour — long enough to find the email, short
 *  enough that a forgotten one in an inbox stops working. */
const TOKEN_TTL_MS = 60 * 60_000;
/** Cap outstanding requests per account so nobody can be email-bombed. */
const MAX_ACTIVE_PER_USER = 3;

/**
 * Self-service password reset over a single-use emailed link.
 *
 * Deliberately a link and not a temporary password: a temp password lives in
 * the mailbox forever and is a working credential the whole time, whereas a
 * token expires, dies on first use, and never becomes the account's password.
 *
 * Requires SMTP — with no way to send mail there is no way to prove the
 * requester owns the address, so the feature reports itself unavailable.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  /** Self-service reset is only possible when the server can send email. */
  get isAvailable(): boolean {
    return this.mail.isEnabled;
  }

  /**
   * Emails a reset link if the address belongs to an enabled account.
   *
   * Always resolves the same way regardless of whether the account exists —
   * a different response for a real address would turn this into a directory
   * of who has an account.
   */
  async request(email: string, origin: string): Promise<void> {
    if (!this.isAvailable) {
      return;
    }
    const normalized = email.trim().toLowerCase();
    const [account] = await this.db
      .select({
        id: userAccount.id,
        email: userAccount.email,
        displayName: userAccount.displayName,
        disabledAt: userAccount.disabledAt,
      })
      .from(userAccount)
      .where(sql`lower(${userAccount.email}) = ${normalized}`)
      .limit(1);
    if (!account || account.disabledAt !== null) {
      this.logger.log(`Password reset requested for an unknown/disabled address.`);
      return;
    }
    // Retire anything still outstanding, then rate-limit per account.
    await this.pruneExpired();
    const active = await this.db
      .select({ id: passwordReset.id })
      .from(passwordReset)
      .where(and(eq(passwordReset.userId, account.id), isNull(passwordReset.usedAt)));
    if (active.length >= MAX_ACTIVE_PER_USER) {
      this.logger.warn(`Password reset throttled for ${account.email}: too many active links.`);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    await this.db.insert(passwordReset).values({
      id: randomUUID(),
      userId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });
    const link = `${origin.replace(/\/+$/, '')}/reset-password?token=${token}`;
    try {
      await this.mail.send({
        to: account.email,
        ...passwordResetEmail({ displayName: account.displayName, link, origin }),
      });
    } catch (error) {
      this.logger.error(`Could not send reset email: ${(error as Error).message}`);
    }
  }

  /**
   * Consumes a token and sets the new password. Every existing session is
   * invalidated: if the reset was needed because someone else had the account,
   * this is what actually removes them.
   */
  async complete(token: string, newPassword: string): Promise<void> {
    const [grant] = await this.db
      .select({ id: passwordReset.id, userId: passwordReset.userId })
      .from(passwordReset)
      .where(
        and(
          eq(passwordReset.tokenHash, hashToken(token)),
          isNull(passwordReset.usedAt),
          sql`${passwordReset.expiresAt} > now()`,
        ),
      )
      .limit(1);
    if (!grant) {
      throw new BadRequestException('That reset link has expired or already been used.');
    }
    // Burn the token first: a slow password hash must not leave a window where
    // the same link could be redeemed twice.
    const burned = await this.db
      .update(passwordReset)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordReset.id, grant.id), isNull(passwordReset.usedAt)))
      .returning({ id: passwordReset.id });
    if (burned.length === 0) {
      throw new BadRequestException('That reset link has expired or already been used.');
    }
    await this.users.setPassword(grant.userId, newPassword, { mustChangePassword: false });
    await this.users.bumpTokenVersion(grant.userId);
    this.logger.log(`Password reset completed for user ${grant.userId}; sessions invalidated.`);
  }

  /** Expired or already-used grants are of no further use. */
  private async pruneExpired(): Promise<void> {
    await this.db
      .delete(passwordReset)
      .where(or(lt(passwordReset.expiresAt, new Date()), sql`${passwordReset.usedAt} is not null`));
  }
}

/** Only the digest is stored, so a database leak yields no usable links. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
