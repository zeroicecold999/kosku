ALTER TABLE "Application" ADD COLUMN "roomId" TEXT;

CREATE UNIQUE INDEX "Application_roomId_key" ON "Application"("roomId");

ALTER TABLE "Application"
ADD CONSTRAINT "Application_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
