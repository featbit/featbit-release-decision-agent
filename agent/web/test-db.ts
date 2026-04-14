import { PrismaClient } from "./src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  try {
    const experiments = await prisma.experiment.findMany({ take: 3, orderBy: { updatedAt: "desc" } });
    console.log("OK - found", experiments.length, "experiments");
    console.log(JSON.stringify(experiments[0], null, 2));
  } catch (e: unknown) {
    console.error("ERROR:", (e as Error).message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
