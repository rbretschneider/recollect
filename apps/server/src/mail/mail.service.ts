import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';

/**
 * Outgoing mail over plain SMTP (Gmail app password, Brevo, SMTP2GO, a paid
 * Proton Mail plan — anything with SMTP creds). Unconfigured = quietly off;
 * features that want to email check isEnabled first.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (this.isEnabled) {
      this.transporter = createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        // 465 = implicit TLS; 587/25 = STARTTLS (nodemailer upgrades itself).
        secure: config.smtpPort === 465,
        auth:
          config.smtpUser.length > 0
            ? { user: config.smtpUser, pass: config.smtpPass }
            : undefined,
      });
    }
  }

  get isEnabled(): boolean {
    return this.config.smtpHost.length > 0 && this.config.smtpFrom.length > 0;
  }

  /** What the settings page shows (never the password). */
  get status(): { enabled: boolean; host: string; from: string } {
    return {
      enabled: this.isEnabled,
      host: this.config.smtpHost,
      from: this.config.smtpFrom,
    };
  }

  async send(options: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    if (!this.transporter) {
      throw new Error('Mail is not configured (SMTP_HOST / SMTP_FROM).');
    }
    await this.transporter.sendMail({
      from: this.config.smtpFrom,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    this.logger.log(`Mail sent to ${options.to}: ${options.subject}`);
  }
}
