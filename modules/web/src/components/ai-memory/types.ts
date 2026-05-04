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

export const PROJECT_TYPE_DESCRIPTIONS: Record<string, string> = {
  product_facts: "Core facts about the product — what it does, who it serves, and how it's deployed.",
  goals: "Current business goals and OKRs the team is working toward.",
  learnings: "Insights and lessons learned from past experiments and decisions.",
  constraints: "Known limitations, technical debt, or non-negotiables the agent must respect.",
  glossary: "Domain-specific terms and their definitions used in your product.",
};

export const USER_TYPE_LABELS: Record<string, string> = {
  capability: "Capability",
  preferences: "Preferences",
  decision_style: "Decision style",
  private_notes: "Private notes",
};

export const USER_TYPE_DESCRIPTIONS: Record<string, string> = {
  capability: "Your technical skills, tools you use, and areas of expertise.",
  preferences: "How you like to work — detail level, format, communication style.",
  decision_style: "How you approach decisions — risk tolerance, data vs. intuition balance.",
  private_notes: "Personal context or reminders visible only to you.",
};
