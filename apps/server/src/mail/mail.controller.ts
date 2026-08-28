import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { MailService } from './mail.service';

class TestMailRequestDto {
  @IsEmail()
  to!: string;
}

/** Admin mail status + a test send, for the Settings page. */
@RequireAdmin()
@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get('status')
  status(): { enabled: boolean; host: string; from: string } {
    return this.mail.status;
  }

  @Post('test')
  async test(@Body() body: TestMailRequestDto): Promise<{ sent: true }> {
    if (!this.mail.isEnabled) {
      throw new BadRequestException(
        'Mail is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.',
      );
    }
    try {
      await this.mail.send({
        to: body.to,
        subject: 'Recollect test email',
        text: 'Your Recollect SMTP settings work. This is only a test.',
      });
    } catch (error) {
      throw new BadRequestException(`Send failed: ${(error as Error).message}`);
    }
    return { sent: true };
  }
}
