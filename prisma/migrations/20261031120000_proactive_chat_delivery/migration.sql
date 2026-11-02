ALTER TABLE "ProactiveMessage" ADD COLUMN "deliveryKey" TEXT;
ALTER TABLE "Message" ADD COLUMN "proactiveMessageId" TEXT;

CREATE UNIQUE INDEX "ProactiveMessage_deliveryKey_key" ON "ProactiveMessage"("deliveryKey");
CREATE UNIQUE INDEX "Message_proactiveMessageId_key" ON "Message"("proactiveMessageId");

ALTER TABLE "Message" ADD CONSTRAINT "Message_proactiveMessageId_fkey"
  FOREIGN KEY ("proactiveMessageId") REFERENCES "ProactiveMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
