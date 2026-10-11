import React, { useState } from 'react';
import {
  TeacherProfileData,
  SchoolClassItem,
  PaperRulingType,
  SubjectType,
} from '../types/notebook';
import {
  Check,
  CheckCircle2,
  Cloud,
  FilePlus2,
  HelpCircle,
  LogOut,
  Phone,
  Plus,
  School,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  Edit3,
  AlertCircle,
} from 'lucide-react';

interface TeacherCabinetViewProps {
  teacherProfile: TeacherProfileData | null;
  classes: SchoolClassItem[];
  isFirebaseAuthenticated: boolean;
  firebaseEmail: string | null;
  onCompletePhoneRegistration: (
    profile: TeacherProfileData,
    initialClass?: Omit<SchoolClassItem, 'id' | 'ownerId'>
  ) => Promise<void>;
  onUpdateProfile: (profile: TeacherProfileData) => Promise<void>;
  onCreateClass: (newClass: Omit<SchoolClassItem, 'id' | 'ownerId'>) => Promise<void>;
  onUpdateClass: (
    classId: string,
    updated: Omit<SchoolClassItem, 'id' | 'ownerId'>
  ) => Promise<void>;
  onDeleteClass: (classId: string) => Promise<void>;
  onCreateNotebookForStudent: (
    studentName: string,
    classItem: SchoolClassItem,
    subject: SubjectType
  ) => void;
  onConnectGoogleCloud: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export function formatRussianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '+7 ';
  let normalized = digits;
  if (normalized.startsWith('8')) {
    normalized = '7' + normalized.slice(1);
  } else if (!normalized.startsWith('7')) {
    normalized = '7' + normalized;
  }
  normalized = normalized.slice(0, 11);

  const p1 = normalized.slice(1, 4);
  const p2 = normalized.slice(4, 7);
  const p3 = normalized.slice(7, 9);
  const p4 = normalized.slice(9, 11);

  let result = '+7';
  if (p1) result += ` (${p1}`;
  if (p1.length === 3 && (p2 || raw.length > 7)) result += ')';
  if (p2) result += ` ${p2}`;
  if (p3) result += `-${p3}`;
  if (p4) result += `-${p4}`;
  return result;
}

export const TeacherCabinetView: React.FC<TeacherCabinetViewProps> = ({
  teacherProfile,
  classes,
  isFirebaseAuthenticated,
  firebaseEmail,
  onCompletePhoneRegistration,
  onUpdateProfile,
  onCreateClass,
  onUpdateClass,
  onDeleteClass,
  onCreateNotebookForStudent,
  onConnectGoogleCloud,
  onLogout,
}) => {
  // Registration by phone states
  const [phoneInput, setPhoneInput] = useState(
    teacherProfile?.phone || '+7 (916) 450-12-89'
  );
  const [fullNameInput, setFullNameInput] = useState(
    teacherProfile?.fullName || 'Смирнова Елена Викторовна'
  );
  const [schoolInput, setSchoolInput] = useState(
    teacherProfile?.schoolName || 'ГБОУ Школа № 1542'
  );
  const [qualificationInput, setQualificationInput] = useState(
    teacherProfile?.qualification || 'Высшая квалификационная категория'
  );
  const [firstClassName, setFirstClassName] = useState('2 «А» класс');
  const [firstClassGrade, setFirstClassGrade] = useState(2);

  const [otpStep, setOtpStep] = useState<'form' | 'verify'>('form');
  const [otpCode, setOtpCode] = useState('');
  const [otpHintMessage, setOtpHintMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [showFirebasePhoneGuide, setShowFirebasePhoneGuide] = useState(false);

  // Profile editing inside cabinet
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileSavedNotice, setProfileSavedNotice] = useState(false);

  // Create class form states
  const [isCreatingClass, setIsCreatingClass] = useState(false);
  const [newClassName, setNewClassName] = useState('1 «Б» класс');
  const [newClassGrade, setNewClassGrade] = useState<number>(1);
  const [newClassYear, setNewClassYear] = useState('2026/2027');
  const [newClassRuling, setNewClassRuling] =
    useState<PaperRulingType>('lined-slanted');
  const [newClassStudents, setNewClassStudents] = useState(
    'Абрамова Полина\nВолков Тимофей\nГромова Алиса\nЗайцев Матвей'
  );

  // Quick student addition inside an existing class
  const [addingStudentToClassId, setAddingStudentToClassId] = useState<
    string | null
  >(null);
  const [newStudentName, setNewStudentName] = useState('');
  const [selectedSubjectForNewNotebook, setSelectedSubjectForNewNotebook] =
    useState<SubjectType>('Русский язык');

  // Step 1: Request SMS code
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 11) {
      setAuthError('Введите полный номер телефона в формате +7 (XXX) XXX-XX-XX');
      return;
    }
    if (fullNameInput.trim().length < 2) {
      setAuthError('Укажите ФИО учителя');
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось отправить СМС-код');
      }
      setOtpHintMessage(data.message);
      setOtpCode(data.demoCodeHint || '4825');
      setOtpStep('verify');
    } catch (err: any) {
      setAuthError(err?.message || 'Ошибка при отправке СМС-кода');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  // Step 2: Verify SMS code & complete registration
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmittingAuth(true);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Неверный код подтверждения');
      }

      const newProfile: TeacherProfileData = {
        ownerId: data.teacherTokenId || `teacher_${Date.now()}`,
        fullName: fullNameInput.trim(),
        phone: phoneInput.trim(),
        schoolName: schoolInput.trim() || 'Школа',
        qualification: qualificationInput.trim() || 'Учитель начальных классов',
        isPhoneVerified: true,
        isCloudSynced: isFirebaseAuthenticated,
      };

      const initialClass: Omit<SchoolClassItem, 'id' | 'ownerId'> | undefined =
        firstClassName.trim()
          ? {
              name: firstClassName.trim(),
              gradeLevel: firstClassGrade,
              academicYear: '2026/2027',
              defaultRuling:
                firstClassGrade <= 2 ? 'lined-slanted' : 'lined-wide',
              studentCount: 3,
              studentsList:
                'Соколов Артём\nМорозов Даниил\nКозлова Вероника',
            }
          : undefined;

      await onCompletePhoneRegistration(newProfile, initialClass);
      setOtpStep('form');
    } catch (err: any) {
      setAuthError(err?.message || 'Не удалось подтвердить номер телефона');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleSaveProfileEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacherProfile) return;

    await onUpdateProfile({
      ...teacherProfile,
      fullName: fullNameInput.trim(),
      phone: phoneInput.trim(),
      schoolName: schoolInput.trim(),
      qualification: qualificationInput.trim(),
    });
    setIsEditingProfile(false);
    setProfileSavedNotice(true);
    setTimeout(() => setProfileSavedNotice(false), 3000);
  };

  const handleCreateNewClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;

    const cleanRoster = newClassStudents
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
    const count = cleanRoster ? cleanRoster.split('\n').length : 0;

    await onCreateClass({
      name: newClassName.trim(),
      gradeLevel: newClassGrade,
      academicYear: newClassYear.trim() || '2026/2027',
      defaultRuling: newClassRuling,
      studentCount: count,
      studentsList: cleanRoster,
    });

    setIsCreatingClass(false);
    setNewClassName(`${newClassGrade} «В» класс`);
  };

  const handleAddStudentToClass = async (cls: SchoolClassItem) => {
    if (!newStudentName.trim()) return;
    const existingList = cls.studentsList
      ? cls.studentsList
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const updatedList = [...existingList, newStudentName.trim()];

    await onUpdateClass(cls.id, {
      name: cls.name,
      gradeLevel: cls.gradeLevel,
      academicYear: cls.academicYear,
      defaultRuling: cls.defaultRuling,
      studentCount: updatedList.length,
      studentsList: updatedList.join('\n'),
    });

    setNewStudentName('');
    setAddingStudentToClassId(null);
  };

  // If teacher is not registered/signed in yet, show the Phone Registration & Sign-In screen
  if (!teacherProfile) {
    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Registration by Phone Form (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 border-b border-slate-200 pb-4">
            <div className="text-xs text-slate-500">
              Личный кабинет педагога · Авторизация по СМС
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Регистрация учителя по номеру телефона
            </h1>
            <p className="text-xs text-slate-600">
              Укажите ваш номер мобильного телефона, ФИО и ваш первый класс. После подтверждения номера по СМС откроется личный кабинет с классами и списком тетрадей.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {otpStep === 'form' ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label
                  htmlFor="reg-phone-input"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Номер мобильного телефона *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="reg-phone-input"
                    type="tel"
                    value={phoneInput}
                    onChange={(e) =>
                      setPhoneInput(formatRussianPhone(e.target.value))
                    }
                    placeholder="+7 (999) 000-00-00"
                    className="w-full pl-10 pr-4 py-2.5 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-fullname-input"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Фамилия, имя и отчество учителя *
                </label>
                <input
                  id="reg-fullname-input"
                  type="text"
                  value={fullNameInput}
                  onChange={(e) => setFullNameInput(e.target.value)}
                  placeholder="Например: Смирнова Елена Викторовна"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-school-input"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    Школа / образовательный центр
                  </label>
                  <input
                    id="reg-school-input"
                    type="text"
                    value={schoolInput}
                    onChange={(e) => setSchoolInput(e.target.value)}
                    placeholder="ГБОУ Школа № 1542"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-qual-input"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    Квалификационная категория
                  </label>
                  <select
                    id="reg-qual-input"
                    value={qualificationInput}
                    onChange={(e) => setQualificationInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Высшая квалификационная категория">
                      Высшая категория
                    </option>
                    <option value="Первая квалификационная категория">
                      Первая категория
                    </option>
                    <option value="Молодой специалист">
                      Молодой специалист
                    </option>
                    <option value="Учитель начальных классов">
                      Без категории
                    </option>
                  </select>
                </div>
              </div>

              {/* Optional initial class setup right during registration */}
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Создать ваш основной класс сразу при регистрации:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="reg-first-class"
                      className="block text-xs text-slate-600 mb-1"
                    >
                      Название класса (буква)
                    </label>
                    <input
                      id="reg-first-class"
                      type="text"
                      value={firstClassName}
                      onChange={(e) => setFirstClassName(e.target.value)}
                      placeholder="Например: 2 «А» класс"
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-first-grade"
                      className="block text-xs text-slate-600 mb-1"
                    >
                      Параллель начальной школы
                    </label>
                    <select
                      id="reg-first-grade"
                      value={firstClassGrade}
                      onChange={(e) => setFirstClassGrade(Number(e.target.value))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                    >
                      <option value={1}>1 класс (безотметочно)</option>
                      <option value={2}>2 класс</option>
                      <option value={3}>3 класс</option>
                      <option value={4}>4 класс</option>
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingAuth}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Phone className="w-4 h-4" />
                <span>
                  {isSubmittingAuth
                    ? 'Отправляем СМС-код...'
                    : 'Получить СМС-код и зарегистрироваться'}
                </span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {otpHintMessage && (
                <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{otpHintMessage}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="otp-code-input"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Введите 4-значный код из СМС для номера {phoneInput}
                </label>
                <input
                  id="otp-code-input"
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="4825"
                  className="w-full px-4 py-2.5 text-lg font-mono-tabular font-bold tracking-widest text-center border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
                  required
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOtpStep('form')}
                  className="px-4 py-2.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Изменить номер
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAuth}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Подтвердить номер и открыть личный кабинет</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Column: Benefits & Firebase Phone Auth Setup Guide (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 bg-white border border-slate-200 rounded-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-red-600" />
              <span>Что даёт личный кабинет учителя</span>
            </h2>
            <ul className="space-y-2.5 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Создание собственных классов (1–4 класс) с настройкой вида разлиновки тетрадей по умолчанию (косая линейка, широкая линейка, клетка).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Ведение списка учеников каждого класса и создание новой страницы тетради для проверки в один клик.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Синхронизация классов и профиля с облачной базой данных Firestore (`teachers` и `classes`).
                </span>
              </li>
            </ul>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <button
                type="button"
                onClick={onConnectGoogleCloud}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Cloud className="w-3.5 h-3.5 text-sky-600" />
                <span>
                  {isFirebaseAuthenticated
                    ? `Облако подключено (${firebaseEmail || 'Firebase'})`
                    : 'Войти через Google для облачной синхронизации Firebase'}
                </span>
              </button>
            </div>
          </div>

          {/* Collapsible Firebase Console Phone Auth Guide */}
          <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-2">
            <button
              type="button"
              onClick={() => setShowFirebasePhoneGuide(!showFirebasePhoneGuide)}
              className="w-full flex items-center justify-between text-left text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                <span>Настройка СМС-провайдера в консоли Firebase</span>
              </span>
              <span className="text-sky-700">
                {showFirebasePhoneGuide ? 'Скрыть' : 'Подробнее'}
              </span>
            </button>
            {showFirebasePhoneGuide && (
              <div className="pt-2 text-xs text-slate-600 space-y-1.5 border-t border-slate-100">
                <p>
                  В приложении уже работает встроенная проверка номера по СМС-коду (код <code className="font-mono-tabular font-semibold">4825</code>). Для подключения внешней рассылки СМС через Firebase Authentication:
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Откройте консоль проекта Firebase → раздел <strong>Authentication</strong>.</li>
                  <li>Перейдите на вкладку <strong>Sign-in method</strong> (Способы входа).</li>
                  <li>Выберите провайдер <strong>Phone</strong> (Телефон), переключите тумблер <strong>Enable</strong> и нажмите <strong>Save</strong>.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Signed-in Teacher Personal Cabinet View
  return (
    <div className="space-y-6">
      {/* Top Teacher Cabinet Profile Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="text-emerald-700 font-medium">
                ● Номер подтверждён: {teacherProfile.phone}
              </span>
              <span aria-hidden="true">·</span>
              <span>{teacherProfile.schoolName}</span>
              <span aria-hidden="true">·</span>
              <span>{teacherProfile.qualification}</span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Личный кабинет: {teacherProfile.fullName}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isFirebaseAuthenticated ? (
              <button
                type="button"
                onClick={onConnectGoogleCloud}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-sky-300 bg-sky-50/70 text-sky-900 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer"
              >
                <Cloud className="w-3.5 h-3.5 text-sky-700" />
                <span>Синхронизировать с облаком Firebase</span>
              </button>
            ) : (
              <span className="text-xs text-emerald-700 font-medium px-2.5 py-1">
                ● Облачная база Firestore активна
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                setFullNameInput(teacherProfile.fullName);
                setPhoneInput(teacherProfile.phone);
                setSchoolInput(teacherProfile.schoolName);
                setQualificationInput(teacherProfile.qualification);
                setIsEditingProfile(!isEditingProfile);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Изменить анкету</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Сменить номер / Выйти</span>
            </button>
          </div>
        </div>

        {profileSavedNotice && (
          <div className="mt-3 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>Данные личного кабинета учителя сохранены.</span>
          </div>
        )}

        {/* Inline Edit Teacher Profile Form */}
        {isEditingProfile && (
          <form
            onSubmit={handleSaveProfileEdit}
            className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                ФИО учителя
              </label>
              <input
                type="text"
                value={fullNameInput}
                onChange={(e) => setFullNameInput(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Номер телефона
              </label>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) =>
                  setPhoneInput(formatRussianPhone(e.target.value))
                }
                className="w-full px-3 py-1.5 text-xs font-mono-tabular border border-slate-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Школа
              </label>
              <input
                type="text"
                value={schoolInput}
                onChange={(e) => setSchoolInput(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-1.5 px-3 bg-slate-900 text-white text-xs font-semibold rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="py-1.5 px-2.5 text-xs text-slate-600 hover:text-slate-900"
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Section Header: My Classes + Create Class Button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Мои классы ({classes.length})
          </h2>
          <p className="text-xs text-slate-500">
            Создайте свой класс, добавьте список учеников и открывайте новые тетради для проверки в один клик
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreatingClass(!isCreatingClass)}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Создать свой класс</span>
        </button>
      </div>

      {/* Expandable Create New Class Form */}
      {isCreatingClass && (
        <form
          onSubmit={handleCreateNewClassSubmit}
          className="p-6 bg-white border border-red-200 rounded-xl space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <School className="w-4 h-4 text-red-600" />
              <span>Создание нового класса начальной школы</span>
            </h3>
            <button
              type="button"
              onClick={() => setIsCreatingClass(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Закрыть
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="new-class-name"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Название класса *
              </label>
              <input
                id="new-class-name"
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="Например: 1 «Б» класс"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                required
              />
            </div>

            <div>
              <label
                htmlFor="new-class-grade"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Параллель (1–4 класс)
              </label>
              <select
                id="new-class-grade"
                value={newClassGrade}
                onChange={(e) => {
                  const g = Number(e.target.value);
                  setNewClassGrade(g);
                  if (g <= 2) setNewClassRuling('lined-slanted');
                  else setNewClassRuling('lined-wide');
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value={1}>1 класс (безотметочно ФГОС)</option>
                <option value={2}>2 класс</option>
                <option value={3}>3 класс</option>
                <option value={4}>4 класс</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="new-class-ruling"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Тетрадь по умолчанию
              </label>
              <select
                id="new-class-ruling"
                value={newClassRuling}
                onChange={(e) =>
                  setNewClassRuling(e.target.value as PaperRulingType)
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="lined-slanted">Узкая косая линейка</option>
                <option value="lined-wide">Широкая линейка</option>
                <option value="squared-grid">Клетка 5×5 мм</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="new-class-year"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Учебный год
              </label>
              <input
                id="new-class-year"
                type="text"
                value={newClassYear}
                onChange={(e) => setNewClassYear(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="new-class-students"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Список учеников класса (по одному ФИО на каждой строке)
            </label>
            <textarea
              id="new-class-students"
              rows={4}
              value={newClassStudents}
              onChange={(e) => setNewClassStudents(e.target.value)}
              placeholder="Иванов Александр&#10;Петрова Мария&#10;Сидоров Максим"
              className="w-full p-3 text-xs border border-slate-300 rounded-lg font-sans"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsCreatingClass(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Сохранить класс в личном кабинете</span>
            </button>
          </div>
        </form>
      )}

      {/* Subject Switcher for Quick Notebook Creation */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl">
        <span className="text-xs text-slate-600">
          Предмет при создании новой тетради из списка класса:
        </span>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            ['Русский язык', 'Математика', 'Окружающий мир'] as SubjectType[]
          ).map((subj) => (
            <button
              key={subj}
              type="button"
              onClick={() => setSelectedSubjectForNewNotebook(subj)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                selectedSubjectForNewNotebook === subj
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {subj}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Teacher's Created Classes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {classes.map((cls) => {
          const students = cls.studentsList
            ? cls.studentsList
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

          const rulingLabel =
            cls.defaultRuling === 'squared-grid'
              ? 'Клетка 5×5 мм'
              : cls.defaultRuling === 'lined-wide'
              ? 'Широкая линейка'
              : 'Узкая косая линейка';

          return (
            <div
              key={cls.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>{cls.gradeLevel} параллель</span>
                      <span aria-hidden="true">·</span>
                      <span>{cls.academicYear} уч. год</span>
                      <span aria-hidden="true">·</span>
                      <span>{rulingLabel}</span>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mt-0.5">
                      {cls.name}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono-tabular text-slate-600">
                      Учеников: {students.length}
                    </span>
                    {classes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteClass(cls.id)}
                        title="Удалить класс"
                        aria-label={`Удалить класс ${cls.name}`}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Roster of students in this class */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <Users className="w-3.5 h-3.5" />
                      <span>Список учеников класса:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAddingStudentToClassId(
                          addingStudentToClassId === cls.id ? null : cls.id
                        )
                      }
                      className="text-sky-700 hover:underline font-medium cursor-pointer"
                    >
                      + Добавить ученика
                    </button>
                  </div>

                  {addingStudentToClassId === cls.id && (
                    <div className="flex items-center gap-2 py-1.5">
                      <input
                        type="text"
                        value={newStudentName}
                        onChange={(e) => setNewStudentName(e.target.value)}
                        placeholder="Фамилия и имя ученика..."
                        className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddStudentToClass(cls)}
                        className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md hover:bg-slate-800 cursor-pointer"
                      >
                        Добавить
                      </button>
                    </div>
                  )}

                  {students.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3">
                      В классе пока нет учеников. Нажмите «+ Добавить ученика».
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                      {students.map((stuName, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50"
                        >
                          <span className="font-medium text-slate-800">
                            <span className="font-mono-tabular text-slate-400 mr-2">
                              {idx + 1}.
                            </span>
                            {stuName}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onCreateNotebookForStudent(
                                stuName,
                                cls,
                                selectedSubjectForNewNotebook
                              )
                            }
                            className="flex items-center gap-1 text-sky-700 hover:text-sky-900 font-semibold whitespace-nowrap cursor-pointer"
                          >
                            <FilePlus2 className="w-3.5 h-3.5" />
                            <span>Открыть тетрадь ({selectedSubjectForNewNotebook})</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
