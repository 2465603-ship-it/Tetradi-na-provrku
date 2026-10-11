import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from 'firebase/auth';
import {
  getFirestore,
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
import firebaseConfig from '../firebase-applet-config.json';
import {
  TeacherProfileData,
  SchoolClassItem,
  PaperRulingType,
} from './types/notebook';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot (Mandatory per firebase-integration-rpc skill)
async function testConnection() {
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
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
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

export async function updateClassInFirestore(
  uid: string,
  classId: string,
  classData: Omit<SchoolClassItem, 'id' | 'ownerId'>
): Promise<void> {
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

// Auth helpers
export async function signInTeacherWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signOutTeacher() {
  return signOut(auth);
}

export { RecaptchaVerifier, signInWithPhoneNumber };
export type { ConfirmationResult };
