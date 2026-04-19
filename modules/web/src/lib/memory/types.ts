export const PROJECT_MEMORY_TYPES = [
  "product_facts",
  "goals",
  "learnings",
  "constraints",
  "glossary",
] as const;
export type ProjectMemoryType = (typeof PROJECT_MEMORY_TYPES)[number];

export const USER_PROJECT_MEMORY_TYPES = [
  "capability",
  "preferences",
  "decision_style",
  "private_notes",
] as const;
export type UserProjectMemoryType = (typeof USER_PROJECT_MEMORY_TYPES)[number];

export function isProjectMemoryType(value: unknown): value is ProjectMemoryType {
  return (
    typeof value === "string" &&
    (PROJECT_MEMORY_TYPES as readonly string[]).includes(value)
  );
}

export function isUserProjectMemoryType(
  value: unknown
): value is UserProjectMemoryType {
  return (
    typeof value === "string" &&
    (USER_PROJECT_MEMORY_TYPES as readonly string[]).includes(value)
  );
}

export interface ProjectMemoryUpsertInput {
  key: string;
  type: ProjectMemoryType;
  content: string;
  sourceAgent?: string | null;
  createdByUserId?: string | null;
  editable?: boolean;
}

export interface UserProjectMemoryUpsertInput {
  key: string;
  type: UserProjectMemoryType;
  content: string;
  sourceAgent?: string | null;
}
