import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import {
  TeacherProfileData,
  SchoolClassItem,
  PaperRulingType,
  StudentRecord,
} from './types/notebook';

const optionalConfigModules = import.meta.glob('../firebase-applet-config.json', {
  eager: true,
}) as Record<string, { default?: Record<string, any> }>;

const fileConfig: Record<string, any> =
  optionalConfigModules['../firebase-applet-config.json']?.default ||
  (optionalConfigModules['../firebase-applet-config.json'] as any) ||
  {};

const envVars = ((import.meta as any).env || {}) as Record<string, string | undefined>;

const resolvedFirebaseConfig: Record<string, any> = {
  projectId: envVars.VITE_FIREBASE_PROJECT_ID || fileConfig.projectId || '',
  appId: envVars.VITE_FIREBASE_APP_ID || fileConfig.appId || '',
  apiKey: envVars.VITE_FIREBASE_API_KEY || fileConfig.apiKey || '',
  authDomain: envVars.VITE_FIREBASE_AUTH_DOMAIN || fileConfig.authDomain || '',
  storageBucket:
    envVars.VITE_FIREBASE_STORAGE_BUCKET || fileConfig.storageBucket || '',
  messagingSenderId:
    envVars.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    fileConfig.messagingSenderId ||
    '',
  measurementId:
    envVars.VITE_FIREBASE_MEASUREMENT_ID || fileConfig.measurementId || '',
  oAuthClientId: fileConfig.oAuthClientId || '',
  recaptchaSiteKey: fileConfig.recaptchaSiteKey || '',
  firestoreDatabaseId:
    envVars.VITE_FIREBASE_DATABASE_ID || fileConfig.firestoreDatabaseId || '',
};

export const isClientFirebaseConfigured = Boolean(
  resolvedFirebaseConfig.apiKey &&
    resolvedFirebaseConfig.apiKey !== 'MY_FIREBASE_WEB_API_KEY' &&
    resolvedFirebaseConfig.projectId &&
    resolvedFirebaseConfig.projectId !== 'MY_FIREBASE_PROJECT_ID'
);

let app: FirebaseApp | null = null;
export let db: Firestore | null = null;
export let auth: Auth | null = null;

if (isClientFirebaseConfigured) {
  app = initializeApp(resolvedFirebaseConfig);
  const firestoreDbId = resolvedFirebaseConfig.firestoreDatabaseId;
  db = firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);
  auth = getAuth(app);
}


// Validate connection to Firestore on boot (Mandatory per firebase-integration-rpc skill)
async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
export const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
}

export function sanitizeTeacherPayload(
  uid: string,
  profile: Omit<TeacherProfileData, 'ownerId'>
) {
  const safeUid = sanitizeId(uid);
  const fullName = (profile.fullName || 'Учитель начальных классов')
    .trim()
    .slice(0, 120);
  const phone = (profile.phone || '+7 (900) 000-00-00').trim().slice(0, 30);
  const schoolName = (profile.schoolName || 'Общеобразовательная школа')
    .trim()
    .slice(0, 150);
  const qualification = (profile.qualification || 'Первая категория')
    .trim()
    .slice(0, 100);

  return {
    ownerId: safeUid,
    fullName: fullName.length >= 2 ? fullName : 'Учитель школы',
    phone: phone.length >= 5 ? phone : '+7 (900) 000-00-00',
    schoolName: schoolName.length >= 1 ? schoolName : 'Школа',
    qualification: qualification.length >= 1 ? qualification : 'Учитель',
  };
}

export function sanitizeClassPayload(
  uid: string,
  cls: Omit<SchoolClassItem, 'id' | 'ownerId'>
) {
  const safeUid = sanitizeId(uid);
  const name = (cls.name || '1 «А» класс').trim().slice(0, 60);
  const gradeLevel = Math.max(1, Math.min(4, Math.round(Number(cls.gradeLevel) || 1)));
  const academicYear = (cls.academicYear || '2026/2027').trim().slice(0, 20);
  const allowedRulings: PaperRulingType[] = [
    'lined-slanted',
    'lined-wide',
    'squared-grid',
  ];
  const defaultRuling: PaperRulingType = allowedRulings.includes(cls.defaultRuling)
    ? cls.defaultRuling
    : 'lined-slanted';
  const studentsList = (cls.studentsList || '').trim().slice(0, 2000);
  const parsedCount = studentsList
    ? studentsList
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean).length
    : 0;
  const studentCount = Math.max(0, Math.min(50, parsedCount));

  return {
    ownerId: safeUid,
    name: name.length >= 1 ? name : '1 «А» класс',
    gradeLevel,
    academicYear: academicYear.length >= 4 ? academicYear : '2026/2027',
    defaultRuling,
    studentCount,
    studentsList,
  };
}

// Teacher Profile Firestore Operations
export async function fetchTeacherProfileFromFirestore(
  uid: string
): Promise<TeacherProfileData | null> {
  if (!db) return null;
  const safeUid = sanitizeId(uid);
  const path = `teachers/${safeUid}`;
  try {
    const snap = await getDoc(doc(db, 'teachers', safeUid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      ownerId: data.ownerId,
      fullName: data.fullName,
      phone: data.phone,
      schoolName: data.schoolName,
      qualification: data.qualification,
      isPhoneVerified: true,
      isCloudSynced: true,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function upsertTeacherProfileInFirestore(
  uid: string,
  profile: Omit<TeacherProfileData, 'ownerId'>
): Promise<void> {
  if (!db) return;
  const safeUid = sanitizeId(uid);
  const path = `teachers/${safeUid}`;
  const clean = sanitizeTeacherPayload(safeUid, profile);

  try {
    const docRef = doc(db, 'teachers', safeUid);
    const existingSnap = await getDoc(docRef);

    if (!existingSnap.exists()) {
      await setDoc(docRef, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        fullName: clean.fullName,
        phone: clean.phone,
        schoolName: clean.schoolName,
        qualification: clean.qualification,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// School Class Firestore Operations
export async function createClassInFirestore(
  uid: string,
  classId: string,
  classData: Omit<SchoolClassItem, 'id' | 'ownerId'>
): Promise<void> {
  if (!db) return;
  const safeClassId = sanitizeId(classId);
  const path = `classes/${safeClassId}`;
  const clean = sanitizeClassPayload(uid, classData);

  try {
    await setDoc(doc(db, 'classes', safeClassId), {
      ...clean,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function ensureClassExistsInFirestore(
  uid: string,
  classId: string,
  classData: Omit<SchoolClassItem, 'id' | 'ownerId'>
): Promise<void> {
  if (!db) return;
  const safeClassId = sanitizeId(classId);
  const path = `classes/${safeClassId}`;
  try {
    const docRef = doc(db, 'classes', safeClassId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      const clean = sanitizeClassPayload(uid, classData);
      await setDoc(docRef, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateClassInFirestore(
  uid: string,
  classId: string,
  classData: Omit<SchoolClassItem, 'id' | 'ownerId'>
): Promise<void> {
  if (!db) return;
  const safeClassId = sanitizeId(classId);
  const path = `classes/${safeClassId}`;
  const clean = sanitizeClassPayload(uid, classData);

  try {
    await updateDoc(doc(db, 'classes', safeClassId), {
      name: clean.name,
      gradeLevel: clean.gradeLevel,
      academicYear: clean.academicYear,
      defaultRuling: clean.defaultRuling,
      studentCount: clean.studentCount,
      studentsList: clean.studentsList,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteClassFromFirestore(classId: string): Promise<void> {
  if (!db) return;
  const safeClassId = sanitizeId(classId);
  const path = `classes/${safeClassId}`;
  try {
    await deleteDoc(doc(db, 'classes', safeClassId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToTeacherClasses(
  uid: string,
  onData: (classes: SchoolClassItem[]) => void,
  onError?: (err: unknown) => void
) {
  if (!db) return () => {};
  const safeUid = sanitizeId(uid);
  const path = 'classes';
  const q = query(collection(db, 'classes'), where('ownerId', '==', safeUid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SchoolClassItem[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          name: data.name,
          gradeLevel: data.gradeLevel,
          academicYear: data.academicYear,
          defaultRuling: data.defaultRuling as PaperRulingType,
          studentCount: data.studentCount,
          studentsList: data.studentsList,
        };
      });
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// Student Firestore Operations (students collection with handwriting_reference_url)
export function validateHttpUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.length > 2048) {
    throw new Error('Ссылка на эталон почерка не должна превышать 2048 символов.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Введите корректную URL-ссылку (начинающуюся с https:// или http://).');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Допустимы только ссылки с протоколом https:// или http://.');
  }
  return parsed.toString();
}

export function buildStudentDocId(classId: string, studentName: string): string {
  const safeClass = sanitizeId(classId).slice(0, 48);
  const normalized = studentName.trim().toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return sanitizeId(`stu_${safeClass}_${hex}`);
}

export function sanitizeStudentPayload(
  uid: string,
  student: Omit<StudentRecord, 'id' | 'ownerId'>
) {
  const safeUid = sanitizeId(uid);
  const safeClassId = sanitizeId(student.classId);
  const studentName = (student.studentName || '').trim().slice(0, 120);
  const handwriting_reference_url = validateHttpUrl(
    student.handwriting_reference_url || ''
  );

  return {
    ownerId: safeUid,
    classId: safeClassId,
    studentName: studentName.length >= 1 ? studentName : 'Ученик',
    handwriting_reference_url,
  };
}

export async function upsertStudentInFirestore(
  uid: string,
  studentId: string,
  student: Omit<StudentRecord, 'id' | 'ownerId'>
): Promise<void> {
  if (!db) return;
  const safeStudentId = sanitizeId(studentId);
  const path = `students/${safeStudentId}`;
  const clean = sanitizeStudentPayload(uid, student);

  try {
    const docRef = doc(db, 'students', safeStudentId);
    const existingSnap = await getDoc(docRef);

    if (!existingSnap.exists()) {
      await setDoc(docRef, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        studentName: clean.studentName,
        handwriting_reference_url: clean.handwriting_reference_url,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteStudentFromFirestore(studentId: string): Promise<void> {
  if (!db) return;
  const safeStudentId = sanitizeId(studentId);
  const path = `students/${safeStudentId}`;
  try {
    await deleteDoc(doc(db, 'students', safeStudentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToTeacherStudents(
  uid: string,
  onData: (students: StudentRecord[]) => void,
  onError?: (err: unknown) => void
) {
  if (!db) return () => {};
  const safeUid = sanitizeId(uid);
  const path = 'students';
  const q = query(collection(db, 'students'), where('ownerId', '==', safeUid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: StudentRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          classId: data.classId,
          studentName: data.studentName,
          handwriting_reference_url: data.handwriting_reference_url || '',
        };
      });
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
];

// Access token is kept strictly in memory (never in localStorage or sessionStorage)
let cachedGmailAccessToken: string | null = null;

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
}

// Auth helpers
export async function signInTeacherWithGoogle() {
  if (!auth) {
    throw new Error(
      'Клиентский Firebase Auth не настроен. Проверьте конфигурацию Firebase.'
    );
  }
  const provider = new GoogleAuthProvider();
  for (const scope of WORKSPACE_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({
    prompt: 'consent select_account',
  });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  cachedGmailAccessToken = credential?.accessToken || null;

  return {
    user: result.user,
    accessToken: cachedGmailAccessToken,
  };
}

export async function signOutTeacher() {
  cachedGmailAccessToken = null;
  if (!auth) return;
  return signOut(auth);
}

export { RecaptchaVerifier, signInWithPhoneNumber };
export type { ConfirmationResult };
