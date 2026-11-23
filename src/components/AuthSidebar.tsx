import React, { useState } from 'react';
import { AuthSession } from '../types/notebook';
import { safeParseJsonResponse } from '../utils/api';
import {
  getFirebaseProjectId,
  isClientFirebaseConfigured,
  signInTeacherWithGoogle,
} from '../firebase';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';

interface AuthSidebarProps {
  authSession: AuthSession | null;
  isCheckingSession: boolean;
  onAuthSuccess: (session: AuthSession, gmailAccessToken?: string | null) => void;
  onLogout: () => void;
}

export const AuthSidebar: React.FC<AuthSidebarProps> = ({
  authSession,
  isCheckingSession,
  onAuthSuccess,
  onLogout,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isEmailProviderDisabled, setIsEmailProviderDisabled] = useState(false);
  const [consoleProjectId, setConsoleProjectId] = useState<string>(() =>
    getFirebaseProjectId()
  );
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setErrorMsg(null);
    setIsEmailProviderDisabled(false);
    setSuccessMsg(null);
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsEmailProviderDisabled(false);
    setIsGoogleSubmitting(true);

    try {
      const cred = await signInTeacherWithGoogle();
      if (!cred?.user || !cred.idToken) {
        throw new Error('Не удалось получить токен авторизации Google Firebase.');
      }

      const session: AuthSession = {
        user: {
          uid: cred.user.uid,
          email: cred.user.email || '',
          displayName: cred.user.displayName || undefined,
          emailVerified: Boolean(cred.user.emailVerified),
        },
        idToken: cred.idToken,
        refreshToken: cred.refreshToken || '',
      };

      setSuccessMsg('Вход через Google выполнен успешно.');
      onAuthSuccess(session, cred.accessToken || null);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Окно входа через Google было закрыто до завершения авторизации.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg(
          'Браузер заблокировал всплывающее окно Google. Разрешите всплывающие окна для этого сайта и повторите.'
        );
      } else if (code === 'auth/unauthorized-domain') {
        setErrorMsg(
          'Текущий домен ещё не добавлен в Firebase Authentication -> Settings -> Authorized domains.'
        );
      } else {
        setErrorMsg(err?.message || 'Не удалось выполнить вход через Google.');
      }
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsEmailProviderDisabled(false);
    setSuccessMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      setErrorMsg('Введите корректный адрес электронной почты.');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setErrorMsg('Пароль должен содержать минимум 6 символов.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Пароли не совпадают.');
        return;
      }
    } else if (!password) {
      setErrorMsg('Введите пароль.');
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint =
        mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'register'
          ? { email: cleanEmail, password, fullName: fullName.trim() }
          : { email: cleanEmail, password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await safeParseJsonResponse(response);
      if (!response.ok) {
        if (
          data?.code === 'EMAIL_PASSWORD_DISABLED' ||
          String(data?.error || '').includes('Email/Password')
        ) {
          setIsEmailProviderDisabled(true);
          if (typeof data?.projectId === 'string' && data.projectId.trim()) {
            setConsoleProjectId(data.projectId.trim());
          }
        }
        throw new Error(data?.error || 'Не удалось выполнить авторизацию.');
      }

      const session: AuthSession = {
        user: data.user,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
      };

      setPassword('');
      setConfirmPassword('');
      setSuccessMsg(
        mode === 'register'
          ? 'Аккаунт успешно создан!'
          : 'Вход выполнен успешно.'
      );
      onAuthSuccess(session);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ошибка при обращении к серверу авторизации.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="p-5 bg-white border border-slate-200 rounded-xl flex items-center gap-3 text-xs text-slate-600">
        <Loader2 className="w-4 h-4 animate-spin text-red-600 shrink-0" />
        <span>Проверяем сохранённую сессию...</span>
      </div>
    );
  }

  if (authSession) {
    return (
      <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Авторизован через Firebase</span>
            </div>
            {authSession.user.displayName && (
              <div className="text-sm font-semibold text-slate-900 truncate">
                {authSession.user.displayName}
              </div>
            )}
            <div className="text-xs text-slate-600 truncate">
              {authSession.user.email}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Выйти из аккаунта"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Выйти</span>
          </button>
        </div>
      </div>
    );
  }

  const firebaseProvidersUrl = consoleProjectId
    ? `https://console.firebase.google.com/project/${encodeURIComponent(consoleProjectId)}/authentication/providers`
    : 'https://console.firebase.google.com/';

  return (
    <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-red-600">
          <ShieldCheck className="w-4 h-4" />
          <span>Авторизация учителя</span>
        </div>
        <h2 className="text-base font-semibold text-slate-900">
          {mode === 'login' ? 'Вход в систему' : 'Регистрация аккаунта'}
        </h2>
        <p className="text-xs text-slate-500">
          Войдите через Google (доступно сразу) или по email и паролю Firebase.
        </p>
      </div>

      {/* Primary instant sign-in via Google Firebase Auth */}
      {isClientFirebaseConfigured && (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isGoogleSubmitting || isSubmitting}
            className="w-full h-10 px-4 inline-flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 border border-[#747775] rounded-full text-xs font-medium text-[#1f1f1f] transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            {isGoogleSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
                <span>Открываем вход Google...</span>
              </>
            ) : (
              <>
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
                <span>Войти через Google</span>
              </>
            )}
          </button>

          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink mx-2.5 text-[11px] text-slate-400">
              или по email и паролю
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>
        </div>
      )}

      {/* Mode Switcher: Вход / Регистрация */}
      <div
        role="tablist"
        aria-label="Режим авторизации"
        className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => switchMode('login')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            mode === 'login'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Вход</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          onClick={() => switchMode('register')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            mode === 'register'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Регистрация</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>

          {isEmailProviderDisabled && (
            <div className="pt-2 border-t border-red-200/80 space-y-2 text-[11px] text-slate-800">
              {isClientFirebaseConfigured && (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isGoogleSubmitting}
                  className="w-full py-1.5 px-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md transition-colors cursor-pointer"
                >
                  Войти через Google прямо сейчас (работает без настройки)
                </button>
              )}
              <p className="text-slate-600 leading-snug">
                Чтобы использовать вход по Email/Паролю, включите провайдер{' '}
                <strong>Email/Password</strong> в консоли Firebase и сохраните:
              </p>
              <a
                href={firebaseProvidersUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
              >
                <span>Открыть Authentication → Sign-in method в Firebase</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-start gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'register' && (
          <div>
            <label
              htmlFor="auth-fullname"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              ФИО учителя (необязательно)
            </label>
            <input
              id="auth-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Смирнова Елена Викторовна"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="auth-email"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Email *
          </label>
          <div className="relative">
            <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teacher@school.ru"
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="auth-password"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Пароль * {mode === 'register' && '(мин. 6 символов)'}
          </label>
          <div className="relative">
            <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="auth-password"
              type="password"
              required
              minLength={mode === 'register' ? 6 : 1}
              autoComplete={
                mode === 'register' ? 'new-password' : 'current-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        {mode === 'register' && (
          <div>
            <label
              htmlFor="auth-confirm-password"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Повторите пароль *
            </label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-confirm-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || isGoogleSubmitting}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                {mode === 'register' ? 'Создаём аккаунт...' : 'Выполняем вход...'}
              </span>
            </>
          ) : (
            <span>
              {mode === 'register' ? 'Зарегистрироваться' : 'Войти в кабинет'}
            </span>
          )}
        </button>
      </form>
    </div>
  );
};
