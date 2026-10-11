/**
 * Security Rules Dirty Dozen Verification Suite (Phase 0 TDD)
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on Teacher Create (isAdmin: true)',
    collection: '/teachers/user_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Identity Spoofing on Teacher Create (ownerId != auth.uid)',
    collection: '/teachers/user_2',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Token Write Attempt',
    collection: '/teachers/user_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'PII Cross-User Read on Teacher Profile',
    collection: '/teachers/user_1',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Teacher Collection Enumeration (list)',
    collection: '/teachers',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned Class Creation without Parent Teacher Profile',
    collection: '/classes/class_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery on Class Create',
    collection: '/classes/class_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable Field Mutation (ownerId / createdAt) on Class Update',
    collection: '/classes/class_1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Value Poisoning on Class Update (name > 60 chars)',
    collection: '/classes/class_1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Invalid Enum Value on defaultRuling',
    collection: '/classes/class_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unauthorized Cross-Teacher Class List',
    collection: '/classes',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'ID Poisoning Attack with Invalid Characters',
    collection: '/classes/bad id!@#',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
