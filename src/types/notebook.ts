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
  errors: NotebookError[];
  customLineMarks: CustomLineMark[];
  remediationTasks: RemediationTask[];
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
