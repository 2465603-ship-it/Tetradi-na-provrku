export type SubjectType = 'Русский язык' | 'Математика' | 'Окружающий мир';

export type PaperRulingType = 'lined-slanted' | 'lined-wide' | 'squared-grid';

export type ErrorCategory =
  | 'orthography'
  | 'punctuation'
  | 'calculation'
  | 'calligraphy'
  | 'logic';

export type MarginMarkSymbol = '/' | 'V' | '!' | 'К' | '✓';

export interface NotebookError {
  id: string;
  lineIndex: number;
  wrongFragment: string;
  correctFragment: string;
  ruleName: string;
  explanation: string;
  errorType: ErrorCategory;
  marginMark: MarginMarkSymbol;
  confirmedByTeacher: boolean;
}

export interface RemediationTask {
  title: string;
  instruction: string;
  examples: string[];
}

export interface CustomLineMark {
  lineIndex: number;
  symbol: MarginMarkSymbol;
  note: string;
}

export interface HandwritingVerificationResult {
  match: boolean;
  confidence_score: number;
  reasoning: string;
  modelUsed?: string;
  checkedAt?: string;
}

export interface ParentContact {
  parentFullName: string;
  parentEmail: string;
}

export interface NotebookSubmission {
  id: string;
  studentName: string;
  classGroup: string; // e.g., "2 «А» класс"
  subject: SubjectType;
  paperRuling: PaperRulingType;
  assignmentTitle: string;
  submittedDate: string;
  status: 'pending' | 'checked';
  isFirstGradeNoGrades?: boolean;
  verbalStamp: string;
  contentGrade: number; // 5, 4, 3, 2
  calligraphyGrade: number; // 5, 4, 3
  handwrittenLines: string[];
  photoSampleUrl: string;
  teacherSummary: string;
  parentMessage: string;
  parentFullName?: string;
  parentEmail?: string;
  errors: NotebookError[];
  customLineMarks: CustomLineMark[];
  remediationTasks: RemediationTask[];
  handwritingVerification?: HandwritingVerificationResult;
}

export interface FgosNormItem {
  grade: number;
  label: string;
  russianCriteria: string;
  mathCriteria: string;
  calligraphyCriteria: string;
}

export interface TeacherProfileData {
  ownerId: string;
  fullName: string;
  phone: string;
  schoolName: string;
  qualification: string;
  avatarUrl?: string;
  isPhoneVerified?: boolean;
  isCloudSynced?: boolean;
}

export interface SchoolClassItem {
  id: string;
  ownerId: string;
  name: string; // e.g. "2 «А» класс"
  gradeLevel: number; // 1, 2, 3, 4
  academicYear: string; // e.g. "2026/2027"
  defaultRuling: PaperRulingType;
  studentCount: number;
  studentsList: string; // newline-separated student names
}

export interface StudentRecord {
  id: string;
  ownerId: string;
  classId: string;
  studentName: string;
  handwriting_reference_url: string;
}

export interface StudentIdentificationCandidateScore {
  studentName: string;
  confidencePercent: number;
}

export interface StudentIdentificationResult {
  identified: boolean;
  studentName: string | null;
  confidencePercent: number;
  autoSelected: boolean;
  reasoning: string;
  candidateScores?: StudentIdentificationCandidateScore[];
  skippedReferences?: Array<{
    studentName: string;
    reason: string;
  }>;
  modelUsed?: string;
}

export interface AuthUser {
  uid: string;
  email: string;
  displayName?: string;
  emailVerified?: boolean;
}

export interface AuthSession {
  user: AuthUser;
  idToken: string;
  refreshToken: string;
}

