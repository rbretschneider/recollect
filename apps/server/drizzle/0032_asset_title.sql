-- A person's name for an item. Digitised tapes carry theirs on the cassette
-- label ("christmas-2007"), which until now the app read only as a filename.
ALTER TABLE "asset" ADD COLUMN "title" text;
