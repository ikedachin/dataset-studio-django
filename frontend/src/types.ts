export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export interface Project {
  id: number; name: string; sourceType: 'upload' | 'local' | 'huggingface'
  inferredSchema: { fields?: Record<string, { max_string_length?: number; multiline_ratio?: number }> }
  syncRules: Array<Record<string, string>>; identifierFields: string[]
  validationSettings: Record<string, JsonValue>
}
export interface Split { id: number; name: string; datasetName: string; position: number; recordCount: number }
export interface RecordSummary { id: number; position: number; status: string; preview: string; validationErrors: number; validationWarnings: number }
export interface RecordDetail extends RecordSummary { splitId: number; original: JsonObject; data: JsonObject; isNew: boolean; isDeleted: boolean; version: number; updatedAt: string }
export interface RecordPage { items: RecordSummary[]; total: number; limit: number; offset: number }
export interface DiffItem { type: 'added' | 'removed' | 'modified'; path: string; before?: JsonValue; after?: JsonValue }
export interface ValidationIssue { severity: 'warning' | 'error'; code: string; path: string; message: string }

export interface ManagedSplit {
  datasetName: string
  id: number
  name: string
  projectId: number
  projectName: string
  isProtected: boolean
  isInheritedProtected: boolean
  isEffectivelyProtected: boolean
  deletedAt: string | null
}

export interface ManagedProject {
  id: number
  name: string
  guardId: string
  isProtected: boolean
  deletedAt: string | null
  splits: ManagedSplit[]
}

export interface ManagementResources {
  projects: ManagedProject[]
  deletedProjects: ManagedProject[]
  deletedSplits: ManagedSplit[]
}

export interface GuardAuditLog {
  id: number
  targetType: 'project' | 'split'
  targetId: string
  action: 'protect' | 'unprotect' | 'soft_delete' | 'hard_delete'
  confirmationText: string
  result: 'success' | 'rejected'
  message: string
  actor: string
  executedAt: string
}
