import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";

const DEFAULT_ENV_ID = "66cf64af-7cdd-4779-9434-4ae5b4df20f3";

async function main() {
  const prisma = new PrismaClient();
  try {
    const target = await prisma.experiment.count({
      where: { NOT: { featbitEnvId: DEFAULT_ENV_ID } },
    });
    console.log(
      `experiments not on env ${DEFAULT_ENV_ID}: ${target}`,
    );

    if (target > 0) {
      const result = await prisma.experiment.updateMany({
        where: { NOT: { featbitEnvId: DEFAULT_ENV_ID } },
        data: { featbitEnvId: DEFAULT_ENV_ID },
      });
      console.log(`rows updated: ${result.count}`);
    }

    const total = await prisma.experiment.count();
    const good = await prisma.experiment.count({
      where: { featbitEnvId: DEFAULT_ENV_ID },
    });
    console.log(`total experiments: ${total}, on default env: ${good}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
