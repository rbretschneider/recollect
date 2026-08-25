import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Hashes and verifies passwords with Argon2id. Injectable so auth logic is testable. */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
