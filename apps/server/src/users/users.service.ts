import { Inject, Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { PasswordService } from '../auth/password.service';
import { Permission } from '../auth/permission';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { userAccount } from '../database/schema';
import { CreateUserInput, UserProfile } from './user.types';

/** Manages household member accounts. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
  ) {}

  async countUsers(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(userAccount);
    return row.value;
  }

  async findById(id: string): Promise<UserProfile | null> {
    const [row] = await this.db.select().from(userAccount).where(eq(userAccount.id, id)).limit(1);
    if (!row || row.disabledAt !== null) {
      return null;
    }
    return this.toProfile(row);
  }

  async findByEmailWithHash(
    email: string,
  ): Promise<{ profile: UserProfile; passwordHash: string } | null> {
    const [row] = await this.db
      .select()
      .from(userAccount)
      .where(sql`lower(${userAccount.email}) = lower(${email})`)
      .limit(1);
    if (!row || row.disabledAt !== null) {
      return null;
    }
    return { profile: this.toProfile(row), passwordHash: row.passwordHash };
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    const [row] = await this.db
      .insert(userAccount)
      .values({
        id: uuidv7(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await this.passwords.hash(input.password),
        permission: input.permission,
        isAdmin: input.isAdmin,
      })
      .returning();
    return this.toProfile(row);
  }

  private toProfile(row: typeof userAccount.$inferSelect): UserProfile {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      permission: row.permission as Permission,
      isAdmin: row.isAdmin,
      mustChangePassword: row.mustChangePassword,
    };
  }
}
