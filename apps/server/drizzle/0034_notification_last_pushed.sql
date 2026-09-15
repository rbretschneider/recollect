-- last_sent_on marks a morning as handled whether or not anything went out, so
-- it could not answer "when did a look-back push actually reach them?". This
-- records the real send.
ALTER TABLE "notification_pref" ADD COLUMN "last_pushed_at" timestamp with time zone;
