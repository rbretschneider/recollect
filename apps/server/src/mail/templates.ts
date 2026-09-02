/** Email templates: inline-styled, email-client-safe HTML. */

const ACCENT = '#5b7cfa';

/** Shared shell: card on a soft background, brand header, muted footer. */
function shell(title: string, bodyHtml: string, origin: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f2f3f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f7;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(20,20,40,0.08);">
          <tr>
            <td style="padding:22px 28px;border-bottom:1px solid #ececf2;">
              <span style="font-size:18px;font-weight:700;color:#1c1c28;letter-spacing:-0.2px;">Recollect</span>
              <span style="font-size:12px;color:#8b8b99;"> &nbsp;·&nbsp; the family's own photo home</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 14px;font-size:20px;color:#1c1c28;letter-spacing:-0.2px;">${title}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #ececf2;">
              <p style="margin:0;font-size:12px;color:#8b8b99;">
                Sent by the Recollect server at
                <a href="${origin}" style="color:${ACCENT};text-decoration:none;">${origin.replace(/^https?:\/\//, '')}</a>
                — self-hosted, no clouds involved.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** "You've been added" — sent when an admin creates a member account. */
export function memberInviteEmail(input: {
  displayName: string;
  email: string;
  inviterName: string;
  origin: string;
}): { subject: string; html: string; text: string } {
  const body = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3c3c48;">
      Hi ${input.displayName} — <strong>${input.inviterName}</strong> added you to the
      family's photo library. Every photo, memory, and album lives on the family's
      own server, and now you're part of it.
    </p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3c3c48;">
      Sign in with <strong>${input.email}</strong> and the password
      ${input.inviterName} gave you. On your phone, use the menu's
      <em>Install&nbsp;app</em> button to put it on your home screen.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${ACCENT};">
      <a href="${input.origin}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Open Recollect</a>
    </td></tr></table>`;
  return {
    subject: `${input.inviterName} added you to the family photos`,
    html: shell('Welcome to the family library', body, input.origin),
    text: `Hi ${input.displayName} — ${input.inviterName} added you to the family's photo library.\n\nSign in at ${input.origin} with ${input.email} and the password they gave you.`,
  };
}

export function passwordResetEmail(input: {
  displayName: string;
  link: string;
  origin: string;
}): { subject: string; html: string; text: string } {
  const body = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3c3c48;">
      Hi ${input.displayName} — someone asked to reset the password for your
      Recollect account. Use the button below to choose a new one.
    </p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3c3c48;">
      This link works once and expires in an hour. If you didn't ask for it you
      can ignore this email — your password stays as it is.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${ACCENT};">
      <a href="${input.link}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Choose a new password</a>
    </td></tr></table>`;
  return {
    subject: 'Reset your Recollect password',
    html: shell('Reset your password', body, input.origin),
    text:
      `Hi ${input.displayName} — someone asked to reset the password for your Recollect account.\n\n` +
      `Choose a new one here (works once, expires in an hour):\n${input.link}\n\n` +
      `If you didn't ask for this, ignore this email — your password stays as it is.`,
  };
}
