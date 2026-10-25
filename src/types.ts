export type Criterion = { id: string; name: string; max: number; desc: string };

export type Student = { id: string; stt: number; name: string; code?: string; dob?: string };

export type FileKind = 'docx' | 'pptx' | 'sb3' | 'pdf' | 'image' | 'text' | 'xlsx' | 'unsupported';

export type Submission = {
  fileNames: string[];
  kinds: FileKind[];
  text: string; // plain text used for grading and highlight matching
  analysis: string; // formatting / structure summary for the AI
  html: string; // our own generated, safe HTML for the viewer
  images: string[]; // downscaled data URLs
  warnings: string[];
};

export type ErrorItem = { criterionId: string; quote: string; note: string; found?: boolean };

export type Score = {
  criterionId: string;
  ai: number;
  teacher?: number | null;
  reason: string;
  confidence?: string;
};

export type ResultStatus = 'idle' | 'grading' | 'reviewing' | 'done' | 'error';

export type Result = {
  status: ResultStatus;
  scores: Score[];
  errors: ErrorItem[];
  comment: string;
  flags: string[];
  reviewNote?: string;
  checked: boolean;
  errorMsg?: string;
  gradedAt?: number;
  noSubmission?: boolean;
  usage?: Usage;
};

export type Usage = { input: number; output: number; cost: number; model?: string };

export type Project = {
  id: string;
  name: string;
  className: string;
  school: string;
  teacher: string;
  examText: string;
  examFileName: string;
  examImages: string[];
  rubric: Criterion[];
  instructions: string;
  scoreStep: number;
  noSubmissionZero: boolean;
  students: Student[];
  rosterFileName: string;
  fileMap: Record<string, string[]>; // studentId -> file paths
  unmatchedFiles: string[];
  submissions: Record<string, Submission>;
  results: Record<string, Result>;
  finalized: boolean;
  finalizedAt?: number;
  /** Gradebook target: which class book / term / column the final scores go to. */
  classId?: string;
  term?: Term;
  column?: ScoreCol;
  postedAt?: number;
  /** Chi phí AI đã dùng cho bài chấm này (USD, ước tính theo giá model) và hạn mức. */
  spent?: Usage & { calls: number };
  budget?: number;
  step: number;
  createdAt: number;
  updatedAt: number;
};

export type Term = 'HK1' | 'HK2';
export type ScoreCol = 'TX1' | 'TX2' | 'GK' | 'CK';
export const TERMS: Term[] = ['HK1', 'HK2'];
export const COLS: ScoreCol[] = ['TX1', 'TX2', 'GK', 'CK'];
export type Phase = 'GK' | 'CK';
/** Giữa kì: nhập TX1 + GK. Cuối kì: nhập TX2 + CK. */
export const PHASE_COLS: Record<Phase, ScoreCol[]> = { GK: ['TX1', 'GK'], CK: ['TX2', 'CK'] };
export const TERM_LABEL: Record<Term, string> = { HK1: 'Học kì I', HK2: 'Học kì II' };
export const PHASE_LABEL: Record<Phase, string> = { GK: 'Giữa kì (TX1 + GK)', CK: 'Cuối kì (TX2 + CK)' };

export type ScoreMap = Record<string, number | null>; // studentId -> score
export type ClassBook = {
  id: string;
  name: string; // "6A1"
  students: Student[];
  scores: Record<Term, Record<ScoreCol, ScoreMap>>;
  createdAt: number;
  updatedAt: number;
};
