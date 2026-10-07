import React, { useState, useMemo } from 'react';
import {
  NotebookSubmission,
  SubjectType,
  MarginMarkSymbol,
  PaperRulingType,
  NotebookError,
} from './types/notebook';
import {
  INITIAL_SUBMISSIONS,
  TEACHER_PROFILE,
  FGOS_GRADING_NORMS,
  TEACHER_STAMPS,
} from './data/initialSubmissions';
import { InteractiveNotebookSheet } from './components/InteractiveNotebookSheet';
import { PhotoCheckModal } from './components/PhotoCheckModal';
import {
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileCheck2,
  Loader2,
  Plus,
  Printer,
  Search,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

type ActiveTab = 'desk' | 'journal' | 'remediation' | 'norms';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('desk');
  const [submissions, setSubmissions] =
    useState<NotebookSubmission[]>(INITIAL_SUBMISSIONS);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>(
    INITIAL_SUBMISSIONS[0].id
  );
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(
    INITIAL_SUBMISSIONS[0].errors[0]?.id || null
  );

  // Filters for the queue and journal
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'checked'>('all');
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal & interactive feedback states
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [copiedParentFeedback, setCopiedParentFeedback] = useState(false);
  const [approvalBanner, setApprovalBanner] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  // Custom error creation form state
  const [isAddingError, setIsAddingError] = useState(false);
  const [newErrorLine, setNewErrorLine] = useState<number>(3);
  const [newErrorWrong, setNewErrorWrong] = useState('');
  const [newErrorCorrect, setNewErrorCorrect] = useState('');
  const [newErrorRule, setNewErrorRule] = useState('Безударная гласная в корне слова');
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
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchName = sub.studentName.toLowerCase().includes(q);
        const matchClass = sub.classGroup.toLowerCase().includes(q);
        const matchTask = sub.assignmentTitle.toLowerCase().includes(q);
        if (!matchName && !matchClass && !matchTask) return false;
      }
      return true;
    });
  }, [submissions, statusFilter, subjectFilter, searchQuery]);

  const currentSubmission = useMemo(() => {
    return (
      submissions.find((s) => s.id === selectedSubmissionId) || submissions[0]
    );
  }, [submissions, selectedSubmissionId]);

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
    const confirmedCount = currentSubmission.errors.filter(
      (e) => e.confirmedByTeacher
    ).length;
    if (confirmedCount === 0) return 5;
    if (confirmedCount <= 2) return 4;
    if (confirmedCount <= 5) return 3;
    return 2;
  }, [currentSubmission]);

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
    updateSubmission(currentSubmission.id, (sub) => {
      const updatedErrors = sub.errors.map((err) =>
        err.id === errorId
          ? { ...err, confirmedByTeacher: !err.confirmedByTeacher }
          : err
      );
      const activeErrs = updatedErrors.filter((e) => e.confirmedByTeacher).length;
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
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      paperRuling: ruling,
    }));
  };

  const handleSetGrade = (
    field: 'contentGrade' | 'calligraphyGrade',
    val: number
  ) => {
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      [field]: val,
    }));
  };

  const handleSetVerbalStamp = (stamp: string) => {
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      verbalStamp: stamp,
    }));
  };

  const handleSetParentMessage = (msg: string) => {
    updateSubmission(currentSubmission.id, (sub) => ({
      ...sub,
      parentMessage: msg,
    }));
  };

  const handleAddCustomError = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newErrorWrong.trim() || !newErrorCorrect.trim()) return;

    const newErr: NotebookError = {
      id: `err-custom-${Date.now()}`,
      lineIndex: Math.max(
        0,
        Math.min(currentSubmission.handwrittenLines.length - 1, newErrorLine - 1)
      ),
      wrongFragment: newErrorWrong.trim(),
      correctFragment: newErrorCorrect.trim(),
      ruleName: newErrorRule.trim() || 'Замечание учителя',
      explanation: `Исправление учителя: «${newErrorWrong.trim()}» → «${newErrorCorrect.trim()}»`,
      errorType: newErrorMark === '!' ? 'calculation' : newErrorMark === 'V' ? 'punctuation' : 'orthography',
      marginMark: newErrorMark,
      confirmedByTeacher: true,
    };

    updateSubmission(currentSubmission.id, (sub) => {
      const updatedErrors = [...sub.errors, newErr];
      const activeCount = updatedErrors.filter((x) => x.confirmedByTeacher).length;
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

    // Move to next pending notebook if available
    const nextPending = submissions.find(
      (s) => s.id !== currentSubmission.id && s.status === 'pending'
    );
    if (nextPending) {
      setSelectedSubmissionId(nextPending.id);
      setSelectedErrorId(nextPending.errors[0]?.id || null);
    }
  };

  const handleCopyParentMessage = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(currentSubmission.parentMessage).catch(() => {});
    }
    setCopiedParentFeedback(true);
    setTimeout(() => setCopiedParentFeedback(false), 2500);
  };

  const handleAddCheckedSubmission = (newSub: NotebookSubmission) => {
    setSubmissions((prev) => [newSub, ...prev]);
    setSelectedSubmissionId(newSub.id);
    setSelectedErrorId(newSub.errors[0]?.id || null);
    setActiveTab('desk');
  };

  const handleGenerateRemediationCard = async (sub: NotebookSubmission) => {
    setGeneratingRemediationForId(sub.id);
    try {
      const response = await fetch('/api/generate-remediation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: sub.studentName,
          gradeLevel: sub.classGroup,
          subject: sub.subject,
          errors: sub.errors.filter((e) => e.confirmedByTeacher),
        }),
      });
      if (response.ok) {
        const data = await response.json();
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

        {/* Zone 2: 4 clean navigation links with hover/active underline */}
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

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPhotoModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Загрузить фото тетради</span>
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

      {/* Confirmation Banner when a notebook is approved */}
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
        {/* VIEW 1: TEACHER DESK (Проверка тетрадей) */}
        {activeTab === 'desk' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT PANEL: Student Stack & Filters (3 cols) */}
            <aside className="lg:col-span-3 space-y-4">
              {/* Teacher Profile Strip */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center gap-3">
                {!avatarError ? (
                  <img
                    src={TEACHER_PROFILE.avatarUrl}
                    alt={TEACHER_PROFILE.name}
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
                    {TEACHER_PROFILE.name}
                  </h2>
                  <p className="text-xs text-slate-500 truncate">
                    {TEACHER_PROFILE.school}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-600 mt-1 font-mono-tabular">
                    <span>К проверке: {pendingCount}</span>
                    <span aria-hidden="true">·</span>
                    <span>Готово: {checkedCount}</span>
                  </div>
                </div>
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
                          setSearchQuery('');
                        }}
                        className="text-sky-700 font-medium hover:underline"
                      >
                        Сбросить фильтры
                      </button>
                    </div>
                  ) : (
                    filteredSubmissions.map((sub) => {
                      const isSelected = sub.id === currentSubmission.id;
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

            {/* CENTER STAGE: Interactive Notebook Sheet (6 cols) */}
            <section className="lg:col-span-6 space-y-4">
              {/* Assignment Context Header */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{currentSubmission.classGroup}</span>
                    <span aria-hidden="true">·</span>
                    <span>{currentSubmission.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span>Сдано: {currentSubmission.submittedDate}</span>
                  </div>
                  <h1 className="text-lg font-semibold text-slate-900">
                    {currentSubmission.studentName} — {currentSubmission.assignmentTitle}
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
            </aside>
          </div>
        )}

        {/* VIEW 2: CLASS GRADEBOOK & ANALYTICS (Журнал класса) */}
        {activeTab === 'journal' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4 bg-white p-6 border border-slate-200 rounded-xl">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">
                  Сводная ведомость проверки домашних тетрадей · 6 октября
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
                    {(
                      submissions.reduce((acc, s) => acc + s.contentGrade, 0) /
                      submissions.length
                    ).toFixed(1)}
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
                    {filteredSubmissions.map((sub) => {
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: REMEDIATION CARDS (Работа над ошибками) */}
        {activeTab === 'remediation' && (
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
                          {(customAiCard.steps || []).map((st: any, idx: number) => (
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
                          ))}
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
                <span>Единый орфографический режим ведения тетрадей (1–4 класс)</span>
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

      {/* AI Photo Check Modal */}
      <PhotoCheckModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        onAddCheckedSubmission={handleAddCheckedSubmission}
      />
    </div>
  );
}
