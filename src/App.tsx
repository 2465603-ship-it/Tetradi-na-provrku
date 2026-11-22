import React, { useState, useMemo, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  NotebookSubmission,
  SubjectType,
  MarginMarkSymbol,
  PaperRulingType,
  NotebookError,
  TeacherProfileData,
  SchoolClassItem,
  AuthSession,
  ParentContact,
} from './types/notebook';
import {
  INITIAL_SUBMISSIONS,
  TEACHER_PROFILE,
  FGOS_GRADING_NORMS,
  TEACHER_STAMPS,
  SAMPLE_PHOTOS,
} from './data/initialSubmissions';
import { InteractiveNotebookSheet } from './components/InteractiveNotebookSheet';
import { PhotoCheckModal } from './components/PhotoCheckModal';
import { TeacherCabinetView } from './components/TeacherCabinetView';
import { AuthSidebar } from './components/AuthSidebar';
import { safeParseJsonResponse } from './utils/api';
import {
  auth,
  clearGmailAccessToken,
  fetchTeacherProfileFromFirestore,
  upsertTeacherProfileInFirestore,
  createClassInFirestore,
  updateClassInFirestore,
  deleteClassFromFirestore,
  subscribeToTeacherClasses,
  signInTeacherWithGoogle,
  signOutTeacher,
} from './firebase';
import {
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileCheck2,
  Loader2,
  Lock,
  Plus,
  Printer,
  Search,
  Sparkles,
  ArrowRight,
  UserCircle2,
  ShieldCheck,
  ShieldAlert,
  Mail,
  Download,
  X,
  AlertCircle,
} from 'lucide-react';

type ActiveTab = 'desk' | 'journal' | 'remediation' | 'norms' | 'cabinet';

function isLegacyFakeSeedClass(cls: SchoolClassItem): boolean {
  if (cls.ownerId !== 'default_teacher') return false;
  if (
    cls.id === 'cls_2a' &&
    cls.studentsList === 'Соколов Артём\nМорозов Даниил\nКозлов Илья'
  ) {
    return true;
  }
  if (
    cls.id === 'cls_3b' &&
    cls.studentsList === 'Белова Мария\nКузнецова София'
  ) {
    return true;
  }
  if (cls.id === 'cls_1v' && cls.studentsList === 'Лебедев Максим') {
    return true;
  }
  return false;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('desk');
  const [submissions, setSubmissions] = useState<NotebookSubmission[]>(() => {
    try {
      const saved = localStorage.getItem('tetrad_plus_submissions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_SUBMISSIONS;
  });
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>(
    () => submissions[0]?.id || ''
  );
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(
    () => submissions[0]?.errors[0]?.id || null
  );

  // Teacher Profile & Classes State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [teacherProfile, setTeacherProfile] =
    useState<TeacherProfileData | null>(() => {
      try {
        const saved = localStorage.getItem('tetrad_plus_teacher_profile');
        if (saved) return JSON.parse(saved);
      } catch {
        // ignore storage errors
      }
      return null;
    });

  const [classes, setClasses] = useState<SchoolClassItem[]>(() => {
    try {
      const saved = localStorage.getItem('tetrad_plus_teacher_classes');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((cls) => !isLegacyFakeSeedClass(cls));
        }
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });

  // Persist local cabinet changes and teacher-created notebook submissions
  useEffect(() => {
    try {
      localStorage.setItem(
        'tetrad_plus_submissions',
        JSON.stringify(submissions)
      );
    } catch {
      // ignore
    }
  }, [submissions]);

  useEffect(() => {
    try {
      if (teacherProfile) {
        localStorage.setItem(
          'tetrad_plus_teacher_profile',
          JSON.stringify(teacherProfile)
        );
      } else {
        localStorage.removeItem('tetrad_plus_teacher_profile');
      }
    } catch {
      // ignore
    }
  }, [teacherProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'tetrad_plus_teacher_classes',
        JSON.stringify(classes)
      );
    } catch {
      // ignore
    }
  }, [classes]);

  // Email/Password Firebase REST API Session State
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    try {
      const saved = localStorage.getItem('tetrad_plus_auth_session');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return null;
  });
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem('tetrad_plus_auth_session'));
    } catch {
      return false;
    }
  });

  // Persist email/password auth session
  useEffect(() => {
    try {
      if (authSession) {
        localStorage.setItem(
          'tetrad_plus_auth_session',
          JSON.stringify(authSession)
        );
      } else {
        localStorage.removeItem('tetrad_plus_auth_session');
      }
    } catch {
      // ignore
    }
  }, [authSession]);

  // Verify stored session with backend Firebase REST API on startup
  useEffect(() => {
    if (!authSession?.idToken && !authSession?.refreshToken) {
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: authSession.idToken,
            refreshToken: authSession.refreshToken,
          }),
        });
        if (!res.ok) {
          if (!cancelled) setAuthSession(null);
          return;
        }
        const data = await safeParseJsonResponse(res);
        if (!cancelled && data.valid && data.user) {
          setAuthSession({
            user: data.user,
            idToken: data.idToken,
            refreshToken: data.refreshToken || authSession.refreshToken,
          });
        } else if (!cancelled) {
          setAuthSession(null);
        }
      } catch {
        // Keep cached session offline only if network fails transiently
      } finally {
        if (!cancelled) setIsCheckingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Listen to optional client Firebase Auth state & sync Firestore profile + classes when configured
  useEffect(() => {
    if (!auth) return;
    let unsubscribeClasses: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (unsubscribeClasses) {
        unsubscribeClasses();
        unsubscribeClasses = null;
      }

      if (user) {
        try {
          const remoteProfile = await fetchTeacherProfileFromFirestore(user.uid);
          if (remoteProfile) {
            setTeacherProfile(remoteProfile);
          } else if (teacherProfile) {
            await upsertTeacherProfileInFirestore(user.uid, teacherProfile);
          }

          unsubscribeClasses = subscribeToTeacherClasses(
            user.uid,
            (remoteClasses) => {
              if (remoteClasses.length > 0) {
                setClasses(remoteClasses);
              }
            }
          );
        } catch (err) {
          console.warn('Firestore profile sync skipped:', err);
        }
      } else {
        clearGmailAccessToken();
        setGmailAccessToken(null);
        setGmailSenderEmail(null);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeClasses) unsubscribeClasses();
    };
  }, []);

  // Check server email capability (SMTP vs Gmail OAuth) on startup
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setServerHasSmtp(Boolean(data.hasSmtpConfig));
        }
      })
      .catch(() => {
        // Ignore transient health check failure
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filters for the queue and journal
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'checked'
  >('all');
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectType>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal & interactive feedback states
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [copiedParentFeedback, setCopiedParentFeedback] = useState(false);
  const [approvalBanner, setApprovalBanner] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  // Parent PDF & Email report state + saved parent contacts per student
  const [isParentReportModalOpen, setIsParentReportModalOpen] = useState(false);
  const [reportTargetSubmission, setReportTargetSubmission] =
    useState<NotebookSubmission | null>(null);
  const [parentEmailInput, setParentEmailInput] = useState('');
  const [parentNameInput, setParentNameInput] = useState('');
  const [parentContactsByStudent, setParentContactsByStudent] = useState<
    Record<string, ParentContact>
  >(() => {
    try {
      const saved = localStorage.getItem('tetrad_plus_parent_contacts');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return {};
  });
  const [cardParentFullName, setCardParentFullName] = useState('');
  const [cardParentEmail, setCardParentEmail] = useState('');
  const [cardParentFormError, setCardParentFormError] = useState<string | null>(
    null
  );
  const [cardParentSavedNotice, setCardParentSavedNotice] = useState(false);
  const [sentReportsBySubmissionId, setSentReportsBySubmissionId] = useState<
    Record<string, string>
  >({});
  const [isSendingParentReport, setIsSendingParentReport] = useState(false);
  const [isDownloadingPdfReport, setIsDownloadingPdfReport] = useState(false);
  const [parentReportError, setParentReportError] = useState<string | null>(
    null
  );
  const [parentReportSuccess, setParentReportSuccess] = useState<string | null>(
    null
  );
  const [deskPdfError, setDeskPdfError] = useState<string | null>(null);
  const [serverHasSmtp, setServerHasSmtp] = useState(false);
  // Gmail OAuth token stays in React memory only (never stored in localStorage/sessionStorage)
  const [gmailAccessToken, setGmailAccessToken] = useState<string | null>(null);
  const [gmailSenderEmail, setGmailSenderEmail] = useState<string | null>(null);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [isConfirmingGmailSend, setIsConfirmingGmailSend] = useState(false);
  const [generatedPdfDownload, setGeneratedPdfDownload] = useState<{
    url: string;
    filename: string;
    sizeKb: number;
    submissionId: string;
  } | null>(null);

  useEffect(() => {
    const currentUrl = generatedPdfDownload?.url;
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [generatedPdfDownload]);

  useEffect(() => {
    setDeskPdfError(null);
  }, [selectedSubmissionId]);

  // Custom error creation form state
  const [isAddingError, setIsAddingError] = useState(false);
  const [newErrorLine, setNewErrorLine] = useState<number>(3);
  const [newErrorWrong, setNewErrorWrong] = useState('');
  const [newErrorCorrect, setNewErrorCorrect] = useState('');
  const [newErrorRule, setNewErrorRule] = useState(
    'Безударная гласная в корне слова'
  );
  const [newErrorMark, setNewErrorMark] = useState<MarginMarkSymbol>('/');

  // AI Remediation card state
  const [generatingRemediationForId, setGeneratingRemediationForId] = useState<
    string | null
  >(null);
  const [generatedCards, setGeneratedCards] = useState<Record<string, any>>({});

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((sub) => {
      if (statusFilter !== 'all' && sub.status !== statusFilter) return false;
      if (subjectFilter !== 'all' && sub.subject !== subjectFilter) return false;
      if (classFilter !== 'all' && sub.classGroup !== classFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchName = sub.studentName.toLowerCase().includes(q);
        const matchClass = sub.classGroup.toLowerCase().includes(q);
        const matchTask = sub.assignmentTitle.toLowerCase().includes(q);
        if (!matchName && !matchClass && !matchTask) return false;
      }
      return true;
    });
  }, [submissions, statusFilter, subjectFilter, classFilter, searchQuery]);

  const currentSubmission = useMemo<NotebookSubmission | null>(() => {
    if (submissions.length === 0) return null;
    return (
      submissions.find((s) => s.id === selectedSubmissionId) || submissions[0]
    );
  }, [submissions, selectedSubmissionId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'tetrad_plus_parent_contacts',
        JSON.stringify(parentContactsByStudent)
      );
    } catch {
      // ignore storage errors
    }
  }, [parentContactsByStudent]);

  useEffect(() => {
    if (!currentSubmission) return;
    const saved = parentContactsByStudent[currentSubmission.studentName];
    setCardParentFullName(
      saved?.parentFullName ?? currentSubmission.parentFullName ?? ''
    );
    setCardParentEmail(
      saved?.parentEmail ?? currentSubmission.parentEmail ?? ''
    );
    setCardParentFormError(null);
    setCardParentSavedNotice(false);
  }, [currentSubmission, parentContactsByStudent]);

  const pendingCount = useMemo(
    () => submissions.filter((s) => s.status === 'pending').length,
    [submissions]
  );
  const checkedCount = useMemo(
    () => submissions.filter((s) => s.status === 'checked').length,
    [submissions]
  );

  // Calculate recommended ФГОС grade based on confirmed errors
  const recommendedFgosGrade = useMemo(() => {
    if (!currentSubmission) return 5;
    const confirmedCount = currentSubmission.errors.filter(
      (e) => e.confirmedByTeacher
    ).length;
    if (confirmedCount === 0) return 5;
    if (confirmedCount <= 2) return 4;
    if (confirmedCount <= 5) return 3;
    return 2;
  }, [currentSubmission]);

  // Handlers for Teacher Personal Cabinet & Classes
  const handleCompletePhoneRegistration = async (
    newProfile: TeacherProfileData,
    initialClass?: Omit<SchoolClassItem, 'id' | 'ownerId'>
  ) => {
    const activeUid = firebaseUser?.uid || newProfile.ownerId;
    const finalProfile: TeacherProfileData = {
      ...newProfile,
      ownerId: activeUid,
      isCloudSynced: Boolean(firebaseUser),
    };
    setTeacherProfile(finalProfile);

    if (firebaseUser) {
      try {
        await upsertTeacherProfileInFirestore(firebaseUser.uid, finalProfile);
      } catch (e) {
        console.warn('Could not save teacher profile to Firestore:', e);
      }
    }

    if (initialClass) {
      const existsAlready = classes.some(
        (c) => c.name.toLowerCase() === initialClass.name.toLowerCase()
      );
      if (!existsAlready) {
        await handleCreateClass(initialClass, activeUid);
      }
    }

    setApprovalBanner(
      `Личный кабинет учителя ${finalProfile.fullName} (${finalProfile.phone}) успешно создан!`
    );
    setTimeout(() => setApprovalBanner(null), 4000);
  };

  const handleUpdateTeacherProfile = async (updated: TeacherProfileData) => {
    setTeacherProfile(updated);
    if (firebaseUser) {
      try {
        await upsertTeacherProfileInFirestore(firebaseUser.uid, updated);
      } catch (e) {
        console.warn('Could not update profile in Firestore:', e);
      }
    }
  };

  const handleCreateClass = async (
    newClsData: Omit<SchoolClassItem, 'id' | 'ownerId'>,
    overrideUid?: string
  ) => {
    const uid =
      overrideUid ||
      firebaseUser?.uid ||
      teacherProfile?.ownerId ||
      'default_teacher';
    const newId = `cls_${Date.now()}`;
    const newClassItem: SchoolClassItem = {
      id: newId,
      ownerId: uid,
      ...newClsData,
    };

    setClasses((prev) => [newClassItem, ...prev]);

    if (firebaseUser) {
      try {
        await upsertTeacherProfileInFirestore(firebaseUser.uid, {
          fullName: teacherProfile?.fullName || TEACHER_PROFILE.name,
          phone: teacherProfile?.phone || '+7 (916) 450-12-89',
          schoolName: teacherProfile?.schoolName || TEACHER_PROFILE.school,
          qualification: teacherProfile?.qualification || TEACHER_PROFILE.role,
        });
        await createClassInFirestore(firebaseUser.uid, newId, newClsData);
      } catch (e) {
        console.warn('Could not create class in Firestore:', e);
      }
    }

    setApprovalBanner(`Класс «${newClsData.name}» добавлен в ваш личный кабинет`);
    setTimeout(() => setApprovalBanner(null), 3500);
  };

  const handleUpdateClass = async (
    classId: string,
    updatedData: Omit<SchoolClassItem, 'id' | 'ownerId'>
  ) => {
    setClasses((prev) =>
      prev.map((c) => (c.id === classId ? { ...c, ...updatedData } : c))
    );
    if (firebaseUser) {
      try {
        await updateClassInFirestore(firebaseUser.uid, classId, updatedData);
      } catch (e) {
        console.warn('Could not update class in Firestore:', e);
      }
    }
  };

  const handleDeleteClass = async (classId: string) => {
    setClasses((prev) => prev.filter((c) => c.id !== classId));
    if (firebaseUser) {
      try {
        await deleteClassFromFirestore(classId);
      } catch (e) {
        console.warn('Could not delete class in Firestore:', e);
      }
    }
  };

  const handleCreateNotebookForStudent = (
    studentName: string,
    classItem: SchoolClassItem,
    subject: SubjectType
  ) => {
    const isMath = subject === 'Математика';
    const ruling: PaperRulingType = isMath
      ? 'squared-grid'
      : classItem.defaultRuling;
    const isFirstGrade = classItem.gradeLevel === 1;

    const savedContact = parentContactsByStudent[studentName];

    const newSub: NotebookSubmission = {
      id: `sub_${Date.now()}`,
      studentName,
      classGroup: classItem.name,
      subject,
      paperRuling: ruling,
      assignmentTitle: isMath
        ? 'Домашняя работа по математике'
        : 'Домашняя работа',
      submittedDate: new Date().toLocaleDateString('ru-RU'),
      status: 'pending',
      isFirstGradeNoGrades: isFirstGrade,
      verbalStamp: isFirstGrade
        ? 'Молодец! Старайся писать ровно.'
        : 'Хорошая работа!',
      contentGrade: 5,
      calligraphyGrade: 5,
      handwrittenLines: [
        new Date().toLocaleDateString('ru-RU'),
        'Домашняя работа.',
      ],
      photoSampleUrl: isMath ? SAMPLE_PHOTOS.math : SAMPLE_PHOTOS.russian,
      teacherSummary: `Тетрадь ученика ${studentName} (${classItem.name}) создана учителем.`,
      parentMessage: `Здравствуйте! Домашняя работа ученика (${studentName}, ${classItem.name}) по предмету «${subject}» проверена.`,
      parentFullName: savedContact?.parentFullName,
      parentEmail: savedContact?.parentEmail,
      errors: [],
      customLineMarks: [],
      remediationTasks: [],
    };

    setSubmissions((prev) => [newSub, ...prev]);
    setSelectedSubmissionId(newSub.id);
    setSelectedErrorId(null);
    setActiveTab('desk');
    setApprovalBanner(
      `Открыта тетрадь: ${studentName} (${classItem.name} · ${subject})`
    );
    setTimeout(() => setApprovalBanner(null), 3500);
  };

  const handleConnectGoogleCloud = async () => {
    try {
      const cred = await signInTeacherWithGoogle();
      if (cred.accessToken) {
        setGmailAccessToken(cred.accessToken);
        setGmailSenderEmail(cred.user?.email || null);
      }
      if (cred.user && teacherProfile) {
        await upsertTeacherProfileInFirestore(cred.user.uid, teacherProfile);
      }
      setApprovalBanner('Аккаунт Google успешно подключён!');
      setTimeout(() => setApprovalBanner(null), 3500);
    } catch (err) {
      console.warn('Google sign-in cancelled or unavailable:', err);
    }
  };

  const handleConnectGmail = async () => {
    setIsConnectingGmail(true);
    setParentReportError(null);
    setParentReportSuccess(null);
    try {
      const cred = await signInTeacherWithGoogle();
      if (!cred.accessToken) {
        throw new Error(
          'Разрешение на отправку писем через Gmail не было выдано. Повторите вход и отметьте доступ к отправке писем.'
        );
      }
      setGmailAccessToken(cred.accessToken);
      setGmailSenderEmail(cred.user?.email || null);
      setIsConfirmingGmailSend(false);
    } catch (err: any) {
      const msg =
        err?.code === 'auth/popup-closed-by-user'
          ? 'Окно авторизации Google было закрыто до завершения входа.'
          : err?.message || 'Не удалось подключить Google-аккаунт (Gmail).';
      setParentReportError(msg);
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleAuthSuccess = (session: AuthSession) => {
    setAuthSession(session);
    if (!teacherProfile) {
      setTeacherProfile({
        ownerId: session.user.uid,
        fullName:
          session.user.displayName ||
          session.user.email.split('@')[0] ||
          'Учитель начальных классов',
        phone: '+7 (900) 000-00-00',
        schoolName: 'Общеобразовательная школа',
        qualification: 'Первая квалификационная категория',
        isPhoneVerified: true,
        isCloudSynced: true,
      });
    }
    setApprovalBanner(
      `Добро пожаловать, ${session.user.displayName || session.user.email}! Загрузка и проверка тетрадей открыты.`
    );
    setTimeout(() => setApprovalBanner(null), 4000);
  };

  const handleEmailLogout = async () => {
    setAuthSession(null);
    setIsPhotoModalOpen(false);
    clearGmailAccessToken();
    setGmailAccessToken(null);
    setGmailSenderEmail(null);
    setIsConfirmingGmailSend(false);
    if (firebaseUser) {
      await signOutTeacher();
    }
  };

  const handleLogoutCabinet = async () => {
    setTeacherProfile(null);
    await handleEmailLogout();
  };

  // Handlers for updating current submission
  const updateSubmission = (
    id: string,
    updater: (prev: NotebookSubmission) => NotebookSubmission
  ) => {
    setSubmissions((prevList) =>
      prevList.map((item) => (item.id === id ? updater(item) : item))
    );
  };

  const handleToggleErrorConfirm = (errorId: string) => {
    if (!currentSubmission) return;
    updateSubmission(currentSubmission.id, (sub) => {
      const updatedErrors = sub.errors.map((err) =>
        err.id === errorId
          ? { ...err, confirmedByTeacher: !err.confirmedByTeacher }
          : err
      );
      const activeErrs = updatedErrors.filter(
        (e) => e.confirmedByTeacher
      ).length;
      const autoGrade =
        activeErrs === 0 ? 5 : activeErrs <= 2 ? 4 : activeErrs <= 5 ? 3 : 2;
      return {
        ...sub,
        errors: updatedErrors,
        contentGrade: autoGrade,
      };
    });
  };

  const handleToggleLineMark = (lineIndex: number, symbol: MarginMarkSymbol) => {
    if (!currentSubmission) return;
    updateSubmission(currentSubmission.id, (sub) => {
      const exists = sub.customLineMarks.some(
        (m) => m.lineIndex === lineIndex && m.symbol === symbol
      );
      const nextMarks = exists
        ? sub.customLineMarks.filter(
            (m) => !(m.lineIndex === lineIndex && m.symbol === symbol)
          )
        : [
            ...sub.customLineMarks,
            {
              lineIndex,
              symbol,
              note: `Пометка учителя «${symbol}» на строке ${lineIndex + 1}`,
            },
          ];
      return {
        ...sub,
        customLineMarks: nextMarks,
      };
    });
  };

  const handleChangePaperRuling = (ruling: PaperRulingType) => {
    if (!currentSubmission) return;
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      paperRuling: ruling,
    }));
  };

  const handleSetGrade = (
    field: 'contentGrade' | 'calligraphyGrade',
    val: number
  ) => {
    if (!currentSubmission) return;
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      [field]: val,
    }));
  };

  const handleSetVerbalStamp = (stamp: string) => {
    if (!currentSubmission) return;
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      verbalStamp: stamp,
    }));
  };

  const handleSetParentMessage = (msg: string) => {
    if (!currentSubmission) return;
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      parentMessage: msg,
    }));
  };

  const handleAddCustomError = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSubmission || !newErrorWrong.trim() || !newErrorCorrect.trim())
      return;

    const newErr: NotebookError = {
      id: `err-custom-${Date.now()}`,
      lineIndex: Math.max(
        0,
        Math.min(
          currentSubmission.handwrittenLines.length - 1,
          newErrorLine - 1
        )
      ),
      wrongFragment: newErrorWrong.trim(),
      correctFragment: newErrorCorrect.trim(),
      ruleName: newErrorRule.trim() || 'Замечание учителя',
      explanation: `Исправление учителя: «${newErrorWrong.trim()}» → «${newErrorCorrect.trim()}»`,
      errorType:
        newErrorMark === '!'
          ? 'calculation'
          : newErrorMark === 'V'
          ? 'punctuation'
          : 'orthography',
      marginMark: newErrorMark,
      confirmedByTeacher: true,
    };

    updateSubmission(currentSubmission.id, (sub) => {
      const updatedErrors = [...sub.errors, newErr];
      const activeCount = updatedErrors.filter(
        (x) => x.confirmedByTeacher
      ).length;
      const autoGrade =
        activeCount === 0 ? 5 : activeCount <= 2 ? 4 : activeCount <= 5 ? 3 : 2;
      return {
        ...sub,
        errors: updatedErrors,
        contentGrade: autoGrade,
      };
    });

    setNewErrorWrong('');
    setNewErrorCorrect('');
    setIsAddingError(false);
    setSelectedErrorId(newErr.id);
  };

  const handleApproveAndNext = () => {
    if (!currentSubmission) return;
    const approvedName = currentSubmission.studentName;
    const approvedGrade = `${currentSubmission.contentGrade}/${currentSubmission.calligraphyGrade}`;

    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      status: 'checked',
    }));

    setApprovalBanner(
      `Тетрадь ученика ${approvedName} проверена (отметка ${approvedGrade} выставлена в журнал)`
    );
    setTimeout(() => setApprovalBanner(null), 4000);

    const nextPending = submissions.find(
      (s) => s.id !== currentSubmission.id && s.status === 'pending'
    );
    if (nextPending) {
      setSelectedSubmissionId(nextPending.id);
      setSelectedErrorId(nextPending.errors[0]?.id || null);
    }
  };

  const handleCopyParentMessage = () => {
    if (!currentSubmission) return;
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(currentSubmission.parentMessage)
        .catch(() => {});
    }
    setCopiedParentFeedback(true);
    setTimeout(() => setCopiedParentFeedback(false), 2500);
  };

  const buildReportPayload = (sub: NotebookSubmission) => ({
    studentName: sub.studentName,
    classGroup: sub.classGroup,
    subject: sub.subject,
    assignmentTitle: sub.assignmentTitle,
    submittedDate: sub.submittedDate,
    teacherName: displayTeacherName,
    isFirstGradeNoGrades: sub.isFirstGradeNoGrades,
    contentGrade: sub.contentGrade,
    calligraphyGrade: sub.calligraphyGrade,
    praiseStamp: sub.verbalStamp,
    errors: sub.errors.map((err) => ({
      lineNumber: err.lineIndex + 1,
      category: err.errorType,
      wrongText: err.wrongFragment,
      correctText: err.correctFragment,
      explanation: err.explanation,
      ruleRef: err.ruleName,
      confirmedByTeacher: err.confirmedByTeacher,
    })),
    parentMessage: sub.parentMessage,
    handwritingVerification: sub.handwritingVerification
      ? {
          match: sub.handwritingVerification.match,
          confidence_score: sub.handwritingVerification.confidence_score,
          reasoning: sub.handwritingVerification.reasoning,
        }
      : undefined,
  });

  const activeReportSubmission = reportTargetSubmission || currentSubmission;

  const handleSaveParentContact = (
    studentName: string,
    contact: ParentContact
  ) => {
    const cleanContact: ParentContact = {
      parentFullName: contact.parentFullName.trim(),
      parentEmail: contact.parentEmail.trim(),
    };
    setParentContactsByStudent((prev) => ({
      ...prev,
      [studentName]: cleanContact,
    }));
    setSubmissions((prev) =>
      prev.map((sub) =>
        sub.studentName === studentName
          ? {
              ...sub,
              parentFullName: cleanContact.parentFullName,
              parentEmail: cleanContact.parentEmail,
            }
          : sub
      )
    );
  };

  const handleSaveStudentCardParentForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSubmission) return;

    const cleanFullName = cardParentFullName.trim();
    const cleanEmail = cardParentEmail.trim();

    if (!cleanFullName) {
      setCardParentFormError('Укажите ФИО родителя.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setCardParentFormError('Укажите корректный E-mail родителя.');
      return;
    }

    setCardParentFormError(null);
    handleSaveParentContact(currentSubmission.studentName, {
      parentFullName: cleanFullName,
      parentEmail: cleanEmail,
    });
    setCardParentSavedNotice(true);
    setTimeout(() => setCardParentSavedNotice(false), 3000);
  };

  const authorizedFetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response | null> => {
    if (!authSession) return null;

    const makeRequest = (token: string) => {
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    };

    let activeToken = authSession.idToken;
    let response = activeToken ? await makeRequest(activeToken) : null;

    if ((!response || response.status === 401) && authSession.refreshToken) {
      try {
        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: authSession.refreshToken }),
        });
        if (verifyRes.ok) {
          const verifyData = await safeParseJsonResponse(verifyRes);
          if (verifyData?.valid && verifyData?.idToken && verifyData?.user) {
            const refreshedSession: AuthSession = {
              user: verifyData.user,
              idToken: verifyData.idToken,
              refreshToken:
                verifyData.refreshToken || authSession.refreshToken,
            };
            setAuthSession(refreshedSession);
            activeToken = verifyData.idToken;
            response = await makeRequest(activeToken);
          }
        }
      } catch {
        // Ignore refresh network error and handle 401 below
      }
    }

    if (!response || response.status === 401) {
      await handleEmailLogout();
      return null;
    }

    return response;
  };

  const handleOpenParentReportModal = (targetSub?: NotebookSubmission) => {
    const sub = targetSub || currentSubmission;
    if (!sub) return;
    const saved = parentContactsByStudent[sub.studentName];
    setReportTargetSubmission(sub);
    setParentEmailInput(saved?.parentEmail ?? sub.parentEmail ?? '');
    setParentNameInput(saved?.parentFullName ?? sub.parentFullName ?? '');
    setParentReportError(null);
    setParentReportSuccess(null);
    setDeskPdfError(null);
    setIsConfirmingGmailSend(false);
    setIsParentReportModalOpen(true);
  };

  const handleDownloadPdfReport = async (targetSub?: NotebookSubmission) => {
    const sub = targetSub || activeReportSubmission;
    if (!authSession || !sub) return;
    setIsDownloadingPdfReport(true);
    setParentReportError(null);
    setDeskPdfError(null);
    try {
      const response = await authorizedFetch('/api/report-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          report: buildReportPayload(sub),
        }),
      });
      if (!response) return;

      const contentType = (
        response.headers.get('content-type') || ''
      ).toLowerCase();

      if (!response.ok || !contentType.includes('pdf')) {
        const errData = await safeParseJsonResponse(response).catch(() => null);
        throw new Error(
          errData?.error || 'Сервер не смог сформировать PDF-отчёт.'
        );
      }

      const rawBlob = await response.blob();
      if (!rawBlob || rawBlob.size === 0) {
        throw new Error('Сформированный PDF-файл оказался пустым.');
      }

      const pdfBlob = new Blob([rawBlob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      const safeName = sub.studentName
        .toLowerCase()
        .replace(/[^a-zа-яё0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '');
      const filename = `otchet_${safeName || 'tetrad'}.pdf`;
      const sizeKb = Math.max(1, Math.round(pdfBlob.size / 1024));

      setGeneratedPdfDownload({
        url,
        filename,
        sizeKb,
        submissionId: sub.id,
      });

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setParentReportSuccess(
        `PDF-отчёт сформирован (${sizeKb} КБ). Если скачивание не началось автоматически, используйте ссылку ниже.`
      );
      setApprovalBanner(`PDF-отчёт для ${sub.studentName} сформирован (${sizeKb} КБ).`);
      setTimeout(() => setApprovalBanner(null), 4000);
    } catch (err: any) {
      const message = err?.message || 'Ошибка при скачивании PDF-отчёта.';
      setParentReportError(message);
      setDeskPdfError(message);
    } finally {
      setIsDownloadingPdfReport(false);
    }
  };

  const executeSendParentReport = async () => {
    if (!authSession || !activeReportSubmission) return;

    const cleanEmail = parentEmailInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setParentReportError('Введите корректный Email получателя.');
      return;
    }

    setIsSendingParentReport(true);
    setParentReportError(null);
    setParentReportSuccess(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (gmailAccessToken) {
        headers['X-Gmail-Access-Token'] = gmailAccessToken;
      }

      const response = await authorizedFetch('/api/send-parent-report', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          recipientEmail: cleanEmail,
          parentName: parentNameInput.trim(),
          report: buildReportPayload(activeReportSubmission),
        }),
      });

      if (!response) return;

      const data = await safeParseJsonResponse(response);
      if (!response.ok) {
        if (data?.requiresGmailAuth) {
          clearGmailAccessToken();
          setGmailAccessToken(null);
          setIsConfirmingGmailSend(false);
        }
        throw new Error(
          data?.error || 'Не удалось отправить отчёт на указанный Email.'
        );
      }

      setIsConfirmingGmailSend(false);
      handleSaveParentContact(activeReportSubmission.studentName, {
        parentFullName:
          parentNameInput.trim() ||
          parentContactsByStudent[activeReportSubmission.studentName]
            ?.parentFullName ||
          '',
        parentEmail: cleanEmail,
      });
      setSentReportsBySubmissionId((prev) => ({
        ...prev,
        [activeReportSubmission.id]: cleanEmail,
      }));
      const successText =
        data?.message || `PDF-отчёт успешно отправлен на ${cleanEmail}.`;
      setParentReportSuccess(successText);
      setApprovalBanner(successText);
      setTimeout(() => setApprovalBanner(null), 4000);
    } catch (err: any) {
      setParentReportError(
        err?.message || 'Не удалось отправить PDF-отчёт родителю.'
      );
    } finally {
      setIsSendingParentReport(false);
    }
  };

  const handleSendParentReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authSession || !activeReportSubmission) return;

    const cleanEmail = parentEmailInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setParentReportError('Введите корректный Email получателя.');
      return;
    }

    if (!gmailAccessToken && !serverHasSmtp) {
      setParentReportError(
        'Нажмите кнопку «Войти через Google» выше, чтобы отправить PDF-отчёт через Gmail.'
      );
      return;
    }

    // Explicit user confirmation before sending email via Gmail on behalf of user
    if (gmailAccessToken && !isConfirmingGmailSend) {
      setParentReportError(null);
      setParentReportSuccess(null);
      setIsConfirmingGmailSend(true);
      return;
    }

    await executeSendParentReport();
  };

  const handleAddCheckedSubmission = (newSub: NotebookSubmission) => {
    setSubmissions((prev) => [newSub, ...prev]);
    setSelectedSubmissionId(newSub.id);
    setSelectedErrorId(newSub.errors[0]?.id || null);
    setActiveTab('desk');
  };

  const handleUpdateAndReanalyzeLines = async (newLines: string[]) => {
    if (!authSession || !currentSubmission) return;
    try {
      const response = await authorizedFetch('/api/check-notebook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: currentSubmission.subject,
          gradeLevel: currentSubmission.classGroup,
          assignmentTitle: currentSubmission.assignmentTitle,
          studentWrittenText: newLines.join('\n'),
        }),
      });
      if (!response || !response.ok) return;
      const data = await safeParseJsonResponse(response);
      const res = data.result;
      if (!res) return;

      const mappedErrors: NotebookError[] = Array.isArray(res.errors)
        ? res.errors.map((e: any, idx: number) => ({
            id: `err-re-${Date.now()}-${idx}`,
            lineIndex: typeof e.lineIndex === 'number' ? e.lineIndex : 0,
            wrongFragment: e.wrongFragment || '',
            correctFragment: e.correctFragment || '',
            ruleName: e.ruleName || 'Правило ФГОС НОО',
            explanation: e.explanation || '',
            errorType: e.errorType || 'orthography',
            marginMark: e.marginMark || '/',
            confirmedByTeacher: true,
          }))
        : [];

      updateSubmission(currentSubmission.id, (sub) => ({
        ...sub,
        handwrittenLines: newLines,
        errors: mappedErrors,
        contentGrade: res.recommendedGrade || 4,
        calligraphyGrade: res.calligraphyScore || sub.calligraphyGrade,
        verbalStamp: res.studentPraise || sub.verbalStamp,
        teacherSummary: res.summary || sub.teacherSummary,
        parentMessage: res.parentFeedback || sub.parentMessage,
        remediationTasks: Array.isArray(res.remediationTasks)
          ? res.remediationTasks
          : sub.remediationTasks,
      }));
      setSelectedErrorId(mappedErrors[0]?.id || null);
      setApprovalBanner(
        `Текст на листе тетради (${currentSubmission.studentName}, ${currentSubmission.classGroup}) обновлён и проверен!`
      );
      setTimeout(() => setApprovalBanner(null), 3500);
    } catch (err) {
      console.warn('Re-analysis warning:', err);
    }
  };

  const handleGenerateRemediationCard = async (sub: NotebookSubmission) => {
    if (!authSession) return;
    setGeneratingRemediationForId(sub.id);
    try {
      const response = await authorizedFetch('/api/generate-remediation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          studentName: sub.studentName,
          gradeLevel: sub.classGroup,
          subject: sub.subject,
          errors: sub.errors.filter((e) => e.confirmedByTeacher),
        }),
      });
      if (response && response.ok) {
        const data = await safeParseJsonResponse(response);
        setGeneratedCards((prev) => ({
          ...prev,
          [sub.id]: data.result,
        }));
      }
    } catch {
      // Fallback handled silently
    } finally {
      setGeneratingRemediationForId(null);
    }
  };

  const displayTeacherName = teacherProfile?.fullName || TEACHER_PROFILE.name;
  const displayTeacherSchool = teacherProfile
    ? `${teacherProfile.schoolName} · ${teacherProfile.phone}`
    : TEACHER_PROFILE.school;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8 py-3.5 bg-white border-b border-slate-200 no-print">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#desk"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('desk');
          }}
          className="font-display text-xl font-semibold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          ТетрадьПлюс
        </a>

        {/* Zone 2: 5 clean navigation links with hover/active underline */}
        <nav
          aria-label="Основная навигация"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => setActiveTab('desk')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'desk'
                ? 'border-red-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Проверка тетрадей
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cabinet')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'cabinet'
                ? 'border-red-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Личный кабинет ({classes.length} кл.)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('journal')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'journal'
                ? 'border-red-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Журнал класса
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('remediation')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'remediation'
                ? 'border-red-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Работа над ошибками
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('norms')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'norms'
                ? 'border-red-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Нормы оценок ФГОС
          </button>
        </nav>

        {/* Zone 3: Primary Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab(authSession ? 'cabinet' : 'desk')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserCircle2 className="w-3.5 h-3.5 text-slate-600" />
            <span>
              {authSession
                ? authSession.user.email
                : 'Вход / Регистрация'}
            </span>
          </button>
          <button
            type="button"
            disabled={!authSession}
            onClick={() => {
              if (!authSession) return;
              setIsPhotoModalOpen(true);
            }}
            title={
              authSession
                ? 'Загрузить фото тетради'
                : 'Доступно после авторизации в боковой панели'
            }
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              authSession
                ? 'text-white bg-red-600 hover:bg-red-700 cursor-pointer'
                : 'text-slate-400 bg-slate-200 cursor-not-allowed'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Камера / Загрузить фото</span>
          </button>
        </div>
      </header>

      {/* Mobile Tab Navigation (visible on < md screens) */}
      <div className="flex md:hidden items-center gap-1 px-4 py-2 bg-white border-b border-slate-200 overflow-x-auto no-print">
        <button
          type="button"
          onClick={() => setActiveTab('desk')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'desk'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Проверка тетрадей
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('cabinet')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'cabinet'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Личный кабинет ({classes.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('journal')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'journal'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Журнал класса
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('remediation')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'remediation'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Работа над ошибками
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('norms')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'norms'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Нормы ФГОС
        </button>
      </div>

      {/* Confirmation Banner */}
      {approvalBanner && (
        <div
          role="status"
          className="bg-emerald-700 text-white px-4 sm:px-8 py-2.5 text-xs font-medium flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{approvalBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setApprovalBanner(null)}
            className="text-emerald-100 hover:text-white underline text-xs"
          >
            Скрыть
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-8 py-6">
        {/* AUTH GATE: Notebook upload, cabinet & checking require Firebase Auth */}
        {!authSession && activeTab !== 'norms' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <aside className="lg:col-span-4">
              <AuthSidebar
                authSession={authSession}
                isCheckingSession={isCheckingSession}
                onAuthSuccess={handleAuthSuccess}
                onLogout={handleEmailLogout}
              />
            </aside>
            <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-8 space-y-5">
              <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center">
                <Lock className="w-6 h-6 text-red-600" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-slate-900">
                  Доступ к проверке и загрузке тетрадей закрыт
                </h1>
                <p className="text-sm text-slate-600 max-w-2xl">
                  Для работы с фотографиями школьных тетрадей, журналом оценок,
                  личным кабинетом классов и карточками работы над ошибками
                  необходимо выполнить <strong>Вход</strong> или{' '}
                  <strong>Регистрацию</strong> по email и паролю в боковой
                  панели слева.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-slate-700">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-semibold text-slate-900">
                    1. Firebase Auth REST API
                  </div>
                  <p className="text-slate-600">
                    Вход и регистрация выполняются через серверные эндпоинты с
                    ключом из переменных окружения (.env).
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-semibold text-slate-900">
                    2. Защищённая сессия
                  </div>
                  <p className="text-slate-600">
                    Сессия проверяется на сервере по Bearer-токену при загрузке и
                    распознавании тетрадей.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-semibold text-slate-900">
                    3. Личный кабинет
                  </div>
                  <p className="text-slate-600">
                    После входа откроется камера, загрузка фото тетрадей и
                    управление вашими классами.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* VIEW 5: TEACHER PERSONAL CABINET & PHONE REGISTRATION */}
        {authSession && activeTab === 'cabinet' && (
          <TeacherCabinetView
            teacherProfile={teacherProfile}
            classes={classes}
            isFirebaseAuthenticated={Boolean(firebaseUser || authSession)}
            firebaseEmail={
              authSession?.user.email || firebaseUser?.email || null
            }
            onCompletePhoneRegistration={handleCompletePhoneRegistration}
            onUpdateProfile={handleUpdateTeacherProfile}
            onCreateClass={(cls) => handleCreateClass(cls)}
            onUpdateClass={handleUpdateClass}
            onDeleteClass={handleDeleteClass}
            onCreateNotebookForStudent={handleCreateNotebookForStudent}
            parentContacts={parentContactsByStudent}
            onSaveParentContact={handleSaveParentContact}
            onConnectGoogleCloud={handleConnectGoogleCloud}
            onLogout={handleLogoutCabinet}
          />
        )}

        {/* VIEW 1: TEACHER DESK (Проверка тетрадей) */}
        {authSession && activeTab === 'desk' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT PANEL: Auth Sidebar + Student Stack & Filters (3 cols) */}
            <aside className="lg:col-span-3 space-y-4">
              <AuthSidebar
                authSession={authSession}
                isCheckingSession={isCheckingSession}
                onAuthSuccess={handleAuthSuccess}
                onLogout={handleEmailLogout}
              />

              {/* Teacher Profile Strip with direct link to Personal Cabinet */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center gap-3">
                  {!avatarError ? (
                    <img
                      src={TEACHER_PROFILE.avatarUrl}
                      alt={displayTeacherName}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarError(true)}
                      className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-slate-800 text-white flex items-center justify-center font-semibold text-sm shrink-0">
                      ЕС
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900 truncate">
                      {displayTeacherName}
                    </h2>
                    <p className="text-xs text-slate-500 truncate">
                      {displayTeacherSchool}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-600 mt-1 font-mono-tabular">
                      <span>К проверке: {pendingCount}</span>
                      <span aria-hidden="true">·</span>
                      <span>Готово: {checkedCount}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('cabinet')}
                  className="w-full py-1.5 px-3 text-xs font-medium text-sky-800 bg-sky-50/80 hover:bg-sky-100/80 border border-sky-200/80 rounded-lg transition-colors text-center cursor-pointer"
                >
                  {teacherProfile
                    ? `Личный кабинет и мои классы (${classes.length}) →`
                    : 'Регистрация учителя по номеру телефона →'}
                </button>
              </div>

              {/* Stack Filter & Queue List */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Стопка тетрадей
                  </h2>
                  <span className="text-xs font-mono-tabular text-slate-500">
                    {filteredSubmissions.length} из {submissions.length}
                  </span>
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск по фамилии или классу..."
                    aria-label="Поиск тетради по фамилии ученика или классу"
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>

                {/* Class Dropdown Filter */}
                <div>
                  <select
                    aria-label="Фильтр по классу учителя"
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-800 font-medium"
                  >
                    <option value="all">Все мои классы ({classes.length})</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.name}>
                        {cls.name} ({cls.studentCount} уч.)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Segmented Filter */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Все ({submissions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('pending')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === 'pending'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Ожидают ({pendingCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('checked')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === 'checked'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Проверено ({checkedCount})
                  </button>
                </div>

                {/* Subject Segmented Filter */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setSubjectFilter('all')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      subjectFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubjectFilter('Русский язык')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      subjectFilter === 'Русский язык'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Русский яз.
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubjectFilter('Математика')}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      subjectFilter === 'Математика'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Математика
                  </button>
                </div>

                {/* Student Notebook Items */}
                <div className="divide-y divide-slate-200 border-t border-slate-200 -mx-4 px-4 pt-1">
                  {filteredSubmissions.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 space-y-2">
                      <p>По выбранному фильтру тетрадей не найдено.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('all');
                          setSubjectFilter('all');
                          setClassFilter('all');
                          setSearchQuery('');
                        }}
                        className="text-sky-700 font-medium hover:underline"
                      >
                        Сбросить фильтры
                      </button>
                    </div>
                  ) : (
                    filteredSubmissions.map((sub) => {
                      const isSelected = sub.id === currentSubmission?.id;
                      const activeErrorCount = sub.errors.filter(
                        (e) => e.confirmedByTeacher
                      ).length;

                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            setSelectedSubmissionId(sub.id);
                            setSelectedErrorId(sub.errors[0]?.id || null);
                          }}
                          className={`w-full text-left py-3 px-2.5 my-1 rounded-lg transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-slate-900 text-white'
                              : 'hover:bg-slate-100 text-slate-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold truncate">
                              {sub.studentName}
                            </span>
                            <span
                              className={`font-mono-tabular text-xs font-semibold shrink-0 ${
                                isSelected
                                  ? 'text-red-300'
                                  : sub.status === 'checked'
                                  ? 'text-emerald-700'
                                  : 'text-red-600'
                              }`}
                            >
                              {sub.isFirstGradeNoGrades
                                ? 'Зачёт'
                                : `${sub.contentGrade}/${sub.calligraphyGrade}`}
                            </span>
                          </div>

                          {/* Clean unboxed metadata with middle-dot separators */}
                          <div
                            className={`flex flex-wrap items-center gap-1.5 text-xs mt-1 ${
                              isSelected ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            <span>{sub.classGroup}</span>
                            <span aria-hidden="true">·</span>
                            <span>{sub.subject}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              Ошибок: {activeErrorCount}
                            </span>
                          </div>

                          <div
                            className={`flex items-center gap-1.5 text-[11px] mt-1.5 ${
                              isSelected
                                ? 'text-slate-300'
                                : sub.status === 'checked'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {sub.status === 'checked' ? (
                              <>
                                <Check className="w-3 h-3 shrink-0" />
                                <span>Проверено учителем</span>
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>Ожидает проверки</span>
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </aside>

            {!currentSubmission ? (
              <section className="lg:col-span-9 bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-5">
                <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto">
                  <BookOpen className="w-6 h-6 text-slate-700" />
                </div>
                <div className="space-y-2 max-w-lg mx-auto">
                  <h1 className="text-xl font-semibold text-slate-900">
                    Список учеников и тетрадей пока пуст
                  </h1>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    В программе нет заранее созданных учеников. Добавьте свой класс и заведите учеников вручную в личном кабинете, либо сразу загрузите фотографию тетради.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('cabinet')}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <UserCircle2 className="w-4 h-4 text-sky-700" />
                    <span>Добавить классы и учеников вручную</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Камера / Загрузить фото тетради</span>
                  </button>
                </div>
              </section>
            ) : (
            <>
            {/* CENTER STAGE: Interactive Notebook Sheet (6 cols) */}
            <section className="lg:col-span-6 space-y-4">
              {/* Assignment Context Header */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{currentSubmission.classGroup}</span>
                      <span aria-hidden="true">·</span>
                      <span>{currentSubmission.subject}</span>
                      <span aria-hidden="true">·</span>
                      <span>Сдано: {currentSubmission.submittedDate}</span>
                    </div>
                    <h1 className="text-lg font-semibold text-slate-900">
                      {currentSubmission.studentName} —{' '}
                      {currentSubmission.assignmentTitle}
                    </h1>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAddingError(!isAddingError)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-red-600" />
                    <span>Добавить ошибку вручную</span>
                  </button>
                </div>

                {currentSubmission.handwritingVerification && (
                  <div
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${
                      currentSubmission.handwritingVerification.match
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50/80 border-amber-200 text-amber-900'
                    }`}
                  >
                    {currentSubmission.handwritingVerification.match ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold">
                        {currentSubmission.handwritingVerification.match
                          ? 'Почерк соответствует эталону'
                          : 'Почерк отличается от эталона'}
                      </span>{' '}
                      <span className="font-mono-tabular opacity-80">
                        (уверенность{' '}
                        {Math.round(
                          currentSubmission.handwritingVerification
                            .confidence_score * 100
                        )}
                        %)
                      </span>
                      <span className="mx-1.5 opacity-50">·</span>
                      <span className="opacity-90">
                        {currentSubmission.handwritingVerification.reasoning}
                      </span>
                    </div>
                  </div>
                )}

                {/* Student Card: Parent Full Name & E-mail Form */}
                <form
                  onSubmit={handleSaveStudentCardParentForm}
                  className="pt-3 border-t border-slate-200 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-600" />
                      <span>Контакты родителя (для отправки отчётов)</span>
                    </span>
                    {cardParentSavedNotice && (
                      <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>Сохранено в карточке ученика</span>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-5">
                      <label htmlFor="student-card-parent-name" className="sr-only">
                        ФИО родителя
                      </label>
                      <input
                        id="student-card-parent-name"
                        type="text"
                        value={cardParentFullName}
                        onChange={(e) => setCardParentFullName(e.target.value)}
                        placeholder="ФИО родителя (например, Иванова Анна Сергеевна)"
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label htmlFor="student-card-parent-email" className="sr-only">
                        E-mail родителя
                      </label>
                      <input
                        id="student-card-parent-email"
                        type="email"
                        value={cardParentEmail}
                        onChange={(e) => setCardParentEmail(e.target.value)}
                        placeholder="E-mail родителя (parent@example.ru)"
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        className="w-full py-1.5 px-3 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Сохранить
                      </button>
                    </div>
                  </div>

                  {cardParentFormError && (
                    <p className="text-[11px] text-red-600">
                      {cardParentFormError}
                    </p>
                  )}
                </form>
              </div>

              {/* Manual Teacher Error Addition Form (Expandable) */}
              {isAddingError && (
                <form
                  onSubmit={handleAddCustomError}
                  className="p-4 bg-white border border-red-200 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Новая пометка красной ручкой в строке тетради
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsAddingError(false)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Отмена
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label
                        htmlFor="add-err-line"
                        className="block text-xs text-slate-600 mb-1"
                      >
                        Номер строки
                      </label>
                      <input
                        id="add-err-line"
                        type="number"
                        min={1}
                        max={currentSubmission.handwrittenLines.length}
                        value={newErrorLine}
                        onChange={(e) => setNewErrorLine(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="add-err-wrong"
                        className="block text-xs text-slate-600 mb-1"
                      >
                        Написано у ученика
                      </label>
                      <input
                        id="add-err-wrong"
                        type="text"
                        placeholder="напр. рощи"
                        value={newErrorWrong}
                        onChange={(e) => setNewErrorWrong(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="add-err-correct"
                        className="block text-xs text-slate-600 mb-1"
                      >
                        Верное написание
                      </label>
                      <input
                        id="add-err-correct"
                        type="text"
                        placeholder="напр. роще"
                        value={newErrorCorrect}
                        onChange={(e) => setNewErrorCorrect(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="add-err-mark"
                        className="block text-xs text-slate-600 mb-1"
                      >
                        Знак на полях
                      </label>
                      <select
                        id="add-err-mark"
                        value={newErrorMark}
                        onChange={(e) =>
                          setNewErrorMark(e.target.value as MarginMarkSymbol)
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      >
                        <option value="/">/ (Орфография)</option>
                        <option value="V">V (Пунктуация)</option>
                        <option value="!">! (Вычисление)</option>
                        <option value="К">К (Каллиграфия)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <input
                      type="text"
                      aria-label="Название правила или орфограммы"
                      value={newErrorRule}
                      onChange={(e) => setNewErrorRule(e.target.value)}
                      placeholder="Правило ФГОС (например: Падежное окончание существительного)"
                      className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                    />
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap"
                    >
                      Поставить исправление
                    </button>
                  </div>
                </form>
              )}

              {/* Interactive School Notebook Sheet */}
              <InteractiveNotebookSheet
                submission={currentSubmission}
                selectedErrorId={selectedErrorId}
                onSelectError={(id) => setSelectedErrorId(id)}
                onToggleErrorConfirm={handleToggleErrorConfirm}
                onToggleLineMark={handleToggleLineMark}
                onChangePaperRuling={handleChangePaperRuling}
                onOpenPhotoScanner={() => setIsPhotoModalOpen(true)}
                onUpdateAndReanalyzeLines={handleUpdateAndReanalyzeLines}
              />
            </section>

            {/* RIGHT PANEL: Grading, Stamps & Parent Diary Feedback (3 cols) */}
            <aside className="lg:col-span-3 space-y-4">
              {/* Grading Panel */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Итоговая отметка в тетрадь
                    </h2>
                    <p className="text-xs text-slate-500">
                      Рекомендация ФГОС по ошибкам:{' '}
                      <span className="font-mono-tabular font-semibold text-slate-800">
                        «{recommendedFgosGrade}»
                      </span>
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      currentSubmission.status === 'checked'
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {currentSubmission.status === 'checked'
                      ? '● Проверено'
                      : '▲ Черновик'}
                  </span>
                </div>

                {/* Grade for Content (5, 4, 3, 2) */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-700">
                      1. За грамотность / решение:
                    </span>
                    <span className="font-mono-tabular font-semibold text-red-600">
                      Отметка «{currentSubmission.contentGrade}»
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[5, 4, 3, 2].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => handleSetGrade('contentGrade', g)}
                        aria-label={`Поставить оценку ${g} за содержание`}
                        className={`py-2 text-sm font-mono-tabular font-semibold rounded-lg border transition-colors cursor-pointer ${
                          currentSubmission.contentGrade === g
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grade for Calligraphy & Neatness (5, 4, 3) */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-700">
                      2. За каллиграфию и аккуратность:
                    </span>
                    <span className="font-mono-tabular font-semibold text-slate-800">
                      Отметка «{currentSubmission.calligraphyGrade}»
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[5, 4, 3].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => handleSetGrade('calligraphyGrade', g)}
                        aria-label={`Поставить оценку ${g} за каллиграфию`}
                        className={`py-1.5 text-xs font-mono-tabular font-semibold rounded-lg border transition-colors cursor-pointer ${
                          currentSubmission.calligraphyGrade === g
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {g} (почерк)
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Teacher Verbal Stamp in Red Pen */}
                <div>
                  <label
                    htmlFor="verbal-stamp-input"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Запись учителя под работой (красной пастой):
                  </label>
                  <input
                    id="verbal-stamp-input"
                    type="text"
                    value={currentSubmission.verbalStamp}
                    onChange={(e) => handleSetVerbalStamp(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 mb-2"
                  />
                  <div className="flex flex-wrap gap-1">
                    {TEACHER_STAMPS.map((stamp, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSetVerbalStamp(stamp)}
                        className="text-left px-2 py-1 text-[11px] bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 rounded transition-colors cursor-pointer"
                      >
                        {stamp}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary CTA: Approve & Next Notebook */}
                <button
                  type="button"
                  onClick={handleApproveAndNext}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>Утвердить проверку и следующая тетрадь</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Parent Diary Feedback Card */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Комментарий для родителей (ЭЖД / чат)
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Педагогический такт
                  </span>
                </div>

                <textarea
                  aria-label="Текст сообщения для родителей ученика"
                  rows={4}
                  value={currentSubmission.parentMessage}
                  onChange={(e) => handleSetParentMessage(e.target.value)}
                  className="w-full p-2.5 text-xs text-slate-700 border border-slate-200 rounded-lg bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                />

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleOpenParentReportModal(currentSubmission)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Отправить отчет родителю</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdfReport(currentSubmission)}
                    disabled={isDownloadingPdfReport}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {isDownloadingPdfReport ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Скачать PDF-отчёт</span>
                  </button>
                  {deskPdfError && (
                    <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">
                      {deskPdfError}
                    </div>
                  )}
                  {generatedPdfDownload &&
                    generatedPdfDownload.submissionId ===
                      currentSubmission.id && (
                      <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 flex items-center justify-between gap-2">
                        <span>
                          PDF готов ({generatedPdfDownload.sizeKb} КБ)
                        </span>
                        <a
                          href={generatedPdfDownload.url}
                          download={generatedPdfDownload.filename}
                          className="font-semibold underline text-emerald-900 hover:text-emerald-700 shrink-0"
                        >
                          Скачать файл
                        </a>
                      </div>
                    )}
                  {sentReportsBySubmissionId[currentSubmission.id] && (
                    <div className="text-[11px] text-emerald-700 text-center">
                      Отчёт отправлен на {sentReportsBySubmissionId[currentSubmission.id]}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCopyParentMessage}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    {copiedParentFeedback ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-semibold">
                          Скопировано для отправки родителям!
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Скопировать комментарий в дневник</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </aside>
            </>
            )}
          </div>
        )}

        {/* VIEW 2: CLASS GRADEBOOK & ANALYTICS (Журнал класса) */}
        {authSession && activeTab === 'journal' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4 bg-white p-6 border border-slate-200 rounded-xl">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">
                  Сводная ведомость проверки домашних тетрадей · {displayTeacherName}
                </div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  Журнал проверки тетрадей и типичные ошибки класса
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-sm">
                <div>
                  <span className="block text-xs text-slate-500">Всего работ</span>
                  <span className="font-mono-tabular text-xl font-semibold text-slate-900">
                    {submissions.length}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">Проверено</span>
                  <span className="font-mono-tabular text-xl font-semibold text-emerald-700">
                    {checkedCount}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">Средний балл</span>
                  <span className="font-mono-tabular text-xl font-semibold text-slate-900">
                    {submissions.length > 0
                      ? (
                          submissions.reduce(
                            (acc, s) => acc + s.contentGrade,
                            0
                          ) / submissions.length
                        ).toFixed(1)
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* High-Density Gradebook Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Ведомость выставленных отметок (Содержание / Каллиграфия)
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Выбор класса в журнале"
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="px-3 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 font-medium"
                  >
                    <option value="all">Все классы ({classes.length})</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.name}>
                        {cls.name}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setSubjectFilter('all')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        subjectFilter === 'all'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Все предметы
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubjectFilter('Русский язык')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        subjectFilter === 'Русский язык'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Русский язык
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubjectFilter('Математика')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        subjectFilter === 'Математика'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Математика
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Ученик</th>
                      <th className="py-3 px-4">Класс · Предмет</th>
                      <th className="py-3 px-4">Домашнее задание</th>
                      <th className="py-3 px-4 text-right">Ошибок</th>
                      <th className="py-3 px-4 text-right">Отметка</th>
                      <th className="py-3 px-4">Статус</th>
                      <th className="py-3 px-4 text-right">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredSubmissions.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-10 px-4 text-center text-slate-500"
                        >
                          Работ учеников пока нет. Добавьте учеников в личном кабинете или загрузите фото тетради.
                        </td>
                      </tr>
                    ) : (
                      filteredSubmissions.map((sub) => {
                      const errCount = sub.errors.filter(
                        (e) => e.confirmedByTeacher
                      ).length;
                      return (
                        <tr
                          key={sub.id}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {sub.studentName}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {sub.classGroup} · {sub.subject}
                          </td>
                          <td className="py-3 px-4 text-slate-700 max-w-xs truncate">
                            {sub.assignmentTitle}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-800">
                            {errCount}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular font-bold text-red-600 text-sm">
                            {sub.isFirstGradeNoGrades
                              ? 'Усвоено'
                              : `${sub.contentGrade} / ${sub.calligraphyGrade}`}
                          </td>
                          <td className="py-3 px-4">
                            {sub.status === 'checked' ? (
                              <span className="text-emerald-700 font-medium">
                                ● Проверено
                              </span>
                            ) : (
                              <span className="text-amber-700 font-medium">
                                ▲ Ожидает проверки
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => handleOpenParentReportModal(sub)}
                                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 font-medium hover:underline cursor-pointer"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                <span>
                                  {sentReportsBySubmissionId[sub.id]
                                    ? 'Отправлено'
                                    : 'Отчёт родителю'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSubmissionId(sub.id);
                                  setActiveTab('desk');
                                }}
                                className="text-sky-700 hover:text-sky-900 font-semibold hover:underline cursor-pointer"
                              >
                                Открыть тетрадь →
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: REMEDIATION CARDS (Работа над ошибками) */}
        {authSession && activeTab === 'remediation' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-6 border border-slate-200 rounded-xl no-print">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">
                  Индивидуальные карточки-памятки для вклейки в тетрадь (ФГОС НОО)
                </div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  Карточки «Работа над ошибками» (РНО)
                </h1>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Распечатать карточки для класса</span>
              </button>
            </div>

            {submissions.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
                Карточки работы над ошибками появятся после добавления учеников и проверки их тетрадей.
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {submissions.map((sub) => {
                const customAiCard = generatedCards[sub.id];
                const isGenerating = generatingRemediationForId === sub.id;

                return (
                  <div
                    key={sub.id}
                    className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                        <div>
                          <div className="text-xs text-slate-500">
                            {sub.classGroup} · {sub.subject} · Памятка РНО
                          </div>
                          <h2 className="text-base font-semibold text-slate-900">
                            {sub.studentName}
                          </h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleGenerateRemediationCard(sub)}
                          disabled={isGenerating}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-lg transition-colors no-print whitespace-nowrap cursor-pointer"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Составляем...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Обновить задания (ИИ)</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Errors recap */}
                      {sub.errors.length === 0 ? (
                        <p className="text-xs text-emerald-700 font-medium">
                          В домашней работе ошибок нет! Рекомендовано задание повышенной сложности («Звёздочка»).
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-slate-700">
                            Исправленные слова и примеры из тетради:
                          </div>
                          <div className="space-y-1">
                            {sub.errors.map((e) => (
                              <div
                                key={e.id}
                                className="text-xs flex items-center gap-2 text-slate-700"
                              >
                                <span className="line-through text-red-600">
                                  {e.wrongFragment}
                                </span>
                                <span>→</span>
                                <span className="font-semibold text-emerald-700">
                                  {e.correctFragment}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-500">{e.ruleName}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tasks to complete in notebook */}
                      {customAiCard ? (
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <p className="text-xs font-semibold text-sky-800">
                            {customAiCard.encouragement}
                          </p>
                          {(customAiCard.steps || []).map(
                            (st: any, idx: number) => (
                              <div
                                key={idx}
                                className="p-3 rounded-lg bg-[#FFFEF9] border border-slate-200 text-xs space-y-1"
                              >
                                <div className="font-semibold text-slate-900">
                                  {st.ruleReminder}
                                </div>
                                <p className="text-slate-600">{st.taskText}</p>
                                <div className="font-handwriting text-lg text-[#1E3A8A] pt-1">
                                  {(st.practiceItems || []).join('   ·   ')}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2 pt-2">
                          {sub.remediationTasks.map((task, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-lg bg-[#FFFEF9] border border-slate-200 text-xs space-y-1"
                            >
                              <div className="font-semibold text-slate-900">
                                Задание {idx + 1}. {task.title}
                              </div>
                              <p className="text-slate-600">{task.instruction}</p>
                              <div className="font-handwriting text-xl text-[#1E3A8A] pt-1">
                                {task.examples.join('   ·   ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        {/* VIEW 4: FGOS GRADING NORMS (Нормы оценок ФГОС НОО) */}
        {activeTab === 'norms' && (
          <div className="space-y-6">
            <div className="bg-white p-6 border border-slate-200 rounded-xl space-y-2">
              <div className="text-xs text-slate-500">
                Методическая памятка учителя начальных классов · 1–4 классы
              </div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Нормы оценки письменных домашних работ и единый орфографический режим
              </h1>
              <p className="text-sm text-slate-600 max-w-3xl">
                Критерии выставления отметок за текущие и домашние письменные работы по русскому языку и математике в соответствии с методическими рекомендациями ФГОС НОО.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {FGOS_GRADING_NORMS.map((norm) => (
                <div
                  key={norm.grade}
                  className="p-6 bg-white border border-slate-200 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <h2 className="text-base font-semibold text-slate-900">
                      {norm.label}
                    </h2>
                    <span className="font-handwriting text-3xl font-bold text-red-600">
                      {norm.grade}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs text-slate-700">
                    <div>
                      <span className="font-semibold text-slate-900">
                        Русский язык (списывание, упражнения):{' '}
                      </span>
                      <span>{norm.russianCriteria}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">
                        Математика (задачи и примеры):{' '}
                      </span>
                      <span>{norm.mathCriteria}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">
                        Каллиграфия и культура оформления:{' '}
                      </span>
                      <span>{norm.calligraphyCriteria}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Unified Orthographic Regime Reference */}
            <div className="p-6 bg-white border border-slate-200 rounded-xl space-y-3">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-red-600" />
                <span>
                  Единый орфографический режим ведения тетрадей (1–4 класс)
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-700">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900">
                    Отступы в тетради по русскому языку
                  </div>
                  <p>
                    Между классной и домашней работами пропускаются 2 чистые узкие (или 2 широкие) линейки. Запись даты и вида работы ведётся по центру рабочей строки.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900">
                    Отступы в тетради по математике
                  </div>
                  <p>
                    Между классной и домашней работами отступаются 4 клетки вниз. Между столбиками примеров — 3 или 4 клетки вправо. Между видами заданий — 2 клетки вниз.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900">
                    Условные обозначения на полях
                  </div>
                  <p>
                    Знак «/» — орфографическая ошибка; знак «V» — пунктуационная ошибка; знак «!» — вычислительная ошибка или недочёт в ходе задачи; «К» — замечание по каллиграфии.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 sm:px-8 py-4 mt-8 no-print">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            ТетрадьПлюс · Рабочее место учителя начальных классов (1–4 класс, ФГОС НОО)
          </span>
          <span>
            Проверка тетрадей в косую линейку, широкую линейку и клетку 5×5 мм
          </span>
        </div>
      </footer>

      {/* AI Photo Check Modal (Only available when authenticated) */}
      {authSession && (
        <PhotoCheckModal
          isOpen={isPhotoModalOpen}
          onClose={() => setIsPhotoModalOpen(false)}
          onAddCheckedSubmission={handleAddCheckedSubmission}
          classes={classes}
          activeClassGroup={
            classFilter !== 'all' ? classFilter : currentSubmission?.classGroup
          }
          activeStudentName={currentSubmission?.studentName}
          activeSubject={currentSubmission?.subject}
          authToken={authSession.idToken}
          onAuthExpired={handleEmailLogout}
        />
      )}

      {/* Parent PDF Report & Email Modal */}
      {authSession && isParentReportModalOpen && activeReportSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="parent-report-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h2
                    id="parent-report-modal-title"
                    className="text-sm font-semibold text-slate-900"
                  >
                    Отправить отчёт родителю (PDF)
                  </h2>
                  <p className="text-xs text-slate-500">
                    {activeReportSubmission.studentName} ·{' '}
                    {activeReportSubmission.classGroup} ·{' '}
                    {activeReportSubmission.subject}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsParentReportModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer"
                aria-label="Закрыть окно отправки отчёта"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSendParentReport}
              className="p-6 space-y-4 text-xs"
            >
              {/* Included PDF Report Contents Summary */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="font-semibold text-slate-900">
                  Содержимое PDF-отчёта:
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <div>
                    Отметка:{' '}
                    <span className="font-semibold text-red-700">
                      {activeReportSubmission.isFirstGradeNoGrades
                        ? 'Усвоено / Зачёт'
                        : `${activeReportSubmission.contentGrade} / ${activeReportSubmission.calligraphyGrade}`}
                    </span>
                  </div>
                  <div>
                    Ошибок в отчёте:{' '}
                    <span className="font-semibold text-slate-900 font-mono-tabular">
                      {
                        activeReportSubmission.errors.filter(
                          (e) => e.confirmedByTeacher
                        ).length
                      }
                    </span>
                  </div>
                </div>
                <div className="text-slate-600 truncate">
                  Задание: {activeReportSubmission.assignmentTitle}
                </div>
              </div>

              {/* Email Delivery Method: Gmail (Google Sign-In) or Server SMTP */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Способ отправки письма
                  </span>
                  {gmailAccessToken ? (
                    <span className="text-[11px] font-medium text-emerald-700">
                      Gmail подключён
                    </span>
                  ) : serverHasSmtp ? (
                    <span className="text-[11px] font-medium text-emerald-700">
                      SMTP настроен
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-amber-700">
                      Требуется вход в Gmail
                    </span>
                  )}
                </div>

                {gmailAccessToken ? (
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    <div className="min-w-0 truncate">
                      Отправитель:{' '}
                      <span className="font-semibold text-emerald-900">
                        {gmailSenderEmail || 'Аккаунт Google (Gmail)'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleConnectGmail}
                      disabled={isConnectingGmail}
                      className="text-[11px] font-semibold text-sky-700 hover:underline shrink-0 cursor-pointer"
                    >
                      Сменить
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {serverHasSmtp
                        ? 'Отправка доступна через почтовый сервер школы (SMTP) или напрямую через ваш Gmail:'
                        : 'Подключите ваш Google-аккаунт, чтобы отправлять PDF-отчёт напрямую через Gmail — без настройки SMTP и паролей приложений.'}
                    </p>
                    <button
                      type="button"
                      onClick={handleConnectGmail}
                      disabled={isConnectingGmail}
                      className="inline-flex items-center justify-center gap-2.5 h-10 px-4 bg-white hover:bg-slate-50 border border-[#747775] rounded-full text-xs font-medium text-[#1f1f1f] transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                    >
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        className="w-4 h-4 shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
                      <span>
                        {isConnectingGmail
                          ? 'Подключение Gmail...'
                          : 'Sign in with Google (Gmail)'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="parent-email-input"
                  className="block font-medium text-slate-700"
                >
                  Email родителя (получателя) *
                </label>
                <input
                  id="parent-email-input"
                  type="email"
                  required
                  placeholder="parent@example.ru"
                  value={parentEmailInput}
                  onChange={(e) => {
                    setParentEmailInput(e.target.value);
                    setIsConfirmingGmailSend(false);
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="parent-name-input"
                  className="block font-medium text-slate-700"
                >
                  Имя и отчество родителя (необязательно)
                </label>
                <input
                  id="parent-name-input"
                  type="text"
                  placeholder="например, Анна Сергеевна"
                  value={parentNameInput}
                  onChange={(e) => {
                    setParentNameInput(e.target.value);
                    setIsConfirmingGmailSend(false);
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              {parentReportError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{parentReportError}</span>
                </div>
              )}

              {parentReportSuccess && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>{parentReportSuccess}</span>
                </div>
              )}

              {generatedPdfDownload &&
                generatedPdfDownload.submissionId ===
                  activeReportSubmission.id && (
                  <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-900">
                    <span className="text-xs">
                      PDF сформирован ({generatedPdfDownload.sizeKb} КБ)
                    </span>
                    <a
                      href={generatedPdfDownload.url}
                      download={generatedPdfDownload.filename}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-sky-300 rounded-md text-sky-800 hover:bg-sky-100 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Скачать файл</span>
                    </a>
                  </div>
                )}

              {isConfirmingGmailSend && gmailAccessToken && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2.5">
                  <div className="font-semibold text-xs">
                    Подтвердите отправку письма через ваш Gmail:
                  </div>
                  <div className="text-[11px] space-y-1 text-amber-900">
                    <div>
                      От кого:{' '}
                      <span className="font-medium">
                        {gmailSenderEmail || 'ваш аккаунт Google'}
                      </span>
                    </div>
                    <div>
                      Кому:{' '}
                      <span className="font-semibold">
                        {parentEmailInput.trim()}
                      </span>
                    </div>
                    <div className="truncate">
                      Тема: Отчёт о проверке тетради:{' '}
                      {activeReportSubmission.studentName} (
                      {activeReportSubmission.subject})
                    </div>
                    <div>Вложение: PDF-отчёт о проверке тетради</div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsConfirmingGmailSend(false)}
                      disabled={isSendingParentReport}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={executeSendParentReport}
                      disabled={isSendingParentReport}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                    >
                      {isSendingParentReport ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Отправка...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Подтвердить и отправить</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => handleDownloadPdfReport(activeReportSubmission)}
                  disabled={isDownloadingPdfReport || isSendingParentReport}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isDownloadingPdfReport ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Скачать PDF-отчёт</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirmingGmailSend(false);
                      setIsParentReportModalOpen(false);
                    }}
                    className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Закрыть
                  </button>
                  {!isConfirmingGmailSend && (
                    <button
                      type="submit"
                      disabled={isSendingParentReport || isDownloadingPdfReport}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {isSendingParentReport ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Отправка...</span>
                        </>
                      ) : (
                        <>
                          <Mail className="w-3.5 h-3.5" />
                          <span>Отправить PDF на Email</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
