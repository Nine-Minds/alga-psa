import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

import User from "../server/src/lib/models/user.tsx";
import { hashPassword } from "../server/src/utils/encryption/encryption.tsx";

async function main() {
  const password = "TempPass123!";
  const hashed = await hashPassword(password);
  await User.updatePassword("robert@managedminds.ai", hashed);
  console.log("Updated password for robert@managedminds.ai to", password);
}

main().catch((error) => {
  console.error("Failed to update password", error);
  process.exit(1);
});
