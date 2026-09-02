/**
 * aialm-oss-adapter — WorkItemContext + child classification (pure).
 *
 * Każdy skill składa identyczny WorkItemContext. Klasyfikacja dzieci dzieli
 * funkcjonalne child-subticketu od legacy `[QA]` podticketów (V4 nie tworzy
 * podticketów [QA]).
 */
import type { TicketState } from '../shared/state.js';
import { readStateFromFields } from './fields.js';

export type IssueTypeName = 'Epic' | 'Story' | 'Task' | 'Bug' | 'Subtask' | string;

export interface Reaction {
  emoji: string;
  isAi: boolean;
}

export interface CommentLike {
  id: string;
  author?: { accountId?: string; emailAddress?: string } | null;
  isAi: boolean;
  bodyAdf?: unknown;
  bodyText: string;
  reactions?: Reaction[];
}

export interface WorkItemSnapshot {
  id: string;
  key: string; // np. AAO-1 / CLI-12
  summary: string;
  descriptionAdf?: unknown;
  descriptionText: string;
  state: TicketState;
  labels: string[];
  issueType: IssueTypeName;
  parentKey?: string;
  created?: string;
  updated?: string;
}

export interface SubtaskContext {
  workItem: WorkItemSnapshot;
  comments: CommentLike[];
}

export interface WorkItemContext {
  workItem: WorkItemSnapshot;
  comments: CommentLike[];
  subtasks: SubtaskContext[];
}

/** Legacy QA title prefix — rozpoznawany, ale V4 NIE tworzy podticketów [QA]. */
export const LEGACY_QA_PREFIX = '[QA]';

/** Funkcjonalny subtask: ma parenta i nie jest legacy [QA]. */
export function isFunctionalSubtask(child: WorkItemSnapshot): boolean {
  return Boolean(child.parentKey) && !child.summary.trim().toUpperCase().startsWith(LEGACY_QA_PREFIX);
}

/** Exclusive subticket mode: istnieje ≥1 funkcjonalne dziecko. */
export function isExclusiveSubticketMode(subtasks: readonly WorkItemSnapshot[]): boolean {
  return subtasks.filter(isFunctionalSubtask).length > 0;
}

/** Zbuduj WorkItemContext z surowych modeli (readStateFromFields dla krotki). */
export function buildWorkItemContext(input: {
  workItem: {
    id: string;
    key: string;
    summary: string;
    description?: unknown;
    fields?: FieldMapLike;
    labels?: string[];
    issueType?: IssueTypeName;
    parentKey?: string;
    created?: string;
    updated?: string;
  };
  comments?: CommentLike[];
  subtasks?: Array<{ workItem: WorkItemSnapshot; comments?: CommentLike[] }>;
}): WorkItemContext {
  const wi = input.workItem;
  const state = readStateFromFields(wi.fields ?? {});
  const snapshot: WorkItemSnapshot = {
    id: wi.id,
    key: wi.key,
    summary: wi.summary,
    descriptionAdf: wi.description,
    descriptionText: '',
    state,
    labels: wi.labels ?? [],
    issueType: wi.issueType ?? 'Task',
    ...(wi.parentKey ? { parentKey: wi.parentKey } : {}),
    ...(wi.created ? { created: wi.created } : {}),
    ...(wi.updated ? { updated: wi.updated } : {}),
  };
  return {
    workItem: snapshot,
    comments: input.comments ?? [],
    subtasks: (input.subtasks ?? []).map(s => ({
      workItem: s.workItem,
      comments: s.comments ?? [],
    })),
  };
}

interface FieldMapLike {
  [name: string]: unknown;
}