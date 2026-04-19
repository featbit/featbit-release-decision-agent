export interface ProjectMemoryEntry {
  id: string;
  featbitProjectKey: string;
  key: string;
  type: string;
  content: string;
  sourceAgent: string | null;
  createdByUserId: string | null;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProjectMemoryEntry {
  id: string;
  featbitProjectKey: string;
  featbitUserId: string;
  key: string;
  type: string;
  content: string;
  sourceAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  product_facts: "Product facts",
  goals: "Goals",
  learnings: "Learnings",
  constraints: "Constraints",
  glossary: "Glossary",
};

export const USER_TYPE_LABELS: Record<string, string> = {
  capability: "Capability",
  preferences: "Preferences",
  decision_style: "Decision style",
  private_notes: "Private notes",
};
