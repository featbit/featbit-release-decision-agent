import {
  upsertProjectMemory,
  getProjectMemory,
  deleteProjectMemory,
  upsertUserProjectMemory,
  getUserProjectMemory,
  deleteUserProjectMemory,
} from "../src/lib/memory";

const PROJECT = "__smoke_project__";
const USER = "__smoke_user__";

async function main() {
  console.log("== ProjectMemory upsert ==");
  const pm = await upsertProjectMemory(PROJECT, {
    key: "product_description",
    type: "product_facts",
    content: "Smoke-test product.",
    sourceAgent: "smoke-test",
    createdByUserId: USER,
  });
  console.log(pm);

  console.log("== ProjectMemory list (filtered) ==");
  const pmList = await getProjectMemory(PROJECT, { type: "product_facts" });
  console.log(pmList);

  console.log("== UserProjectMemory upsert ==");
  const upm = await upsertUserProjectMemory(PROJECT, USER, {
    key: "experience_level",
    type: "capability",
    content: "beginner",
    sourceAgent: "smoke-test",
  });
  console.log(upm);

  console.log("== UserProjectMemory list ==");
  const upmList = await getUserProjectMemory(PROJECT, USER);
  console.log(upmList);

  console.log("== cleanup ==");
  await deleteProjectMemory(PROJECT, "product_description");
  await deleteUserProjectMemory(PROJECT, USER, "experience_level");
  console.log("ok");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
