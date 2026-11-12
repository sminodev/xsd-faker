import type { Node } from '@xmldom/xmldom';

export const PROBLEM_CODES = [
  // reading the schema documents (schema-set.ts)
  'duplicate-component',
  'invalid-xml',
  'missing-file',
  'not-a-schema',
  'unknown-prefix',
  'unsupported-redefine',
  // choosing the root element
  'root-required',
  'unknown-root',
  // mistakes in the XML Schema
  'circular-group',
  'circular-type',
  'invalid-redefine',
  'invalid-facet',
  'unknown-attribute',
  'unknown-element',
  'unknown-group',
  'unknown-type',
  // what the generator cannot produce
  'depth-limit',
  'no-value',
  'unsupported',
  'resource-limit',
  'unsafe-input',
  'namespace-mismatch',
  'template-only',
  'json-mapping',
  'identity-planning',
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** An error prevents a completed instance status; a warning describes a limitation without changing that status. */
export interface Problem {
  code: ProblemCode;
  severity: 'error' | 'warning';
  message: string;
  /** path of the schema document */
  file?: string;
  line?: number;
  column?: number;
}

/** Where a problem was found. */
export interface At {
  file?: string | undefined;
  node?: Node | undefined;
}

/** The message of a caught exception. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Collects the problems of one run; the same problem at the same place is kept once. */
export class Problems {
  readonly list: Problem[] = [];
  private readonly keys = new Set<string>();

  add(severity: Problem['severity'], code: ProblemCode, message: string, at: At = {}): void {
    const problem: Problem = { code, severity, message };
    if (at.file !== undefined) {
      problem.file = at.file;
    }
    if (at.node?.lineNumber !== undefined) {
      problem.line = at.node.lineNumber;
      if (at.node.columnNumber !== undefined) {
        problem.column = at.node.columnNumber;
      }
    }
    const key = JSON.stringify(problem);
    if (!this.keys.has(key)) {
      this.keys.add(key);
      this.list.push(problem);
    }
  }

  error(code: ProblemCode, message: string, at?: At): void {
    this.add('error', code, message, at);
  }

  warning(code: ProblemCode, message: string, at?: At): void {
    this.add('warning', code, message, at);
  }
}
