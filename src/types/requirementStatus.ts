export interface RequirementStatus {
  id: string;
  label: string;
  order: number;
  aliases: string[];
}

export interface RequirementStatusConfig {
  statuses: RequirementStatus[];
}
