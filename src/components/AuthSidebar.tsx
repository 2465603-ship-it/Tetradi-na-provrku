import React, { useState } from 'react';
import { AuthSession } from '../types/notebook';
import { safeParseJsonResponse } from '../utils/api';
import {
  AlertCircle,
  CheckCircle2,
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
  onAuthSuccess: (session: AuthSession) => void;
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
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
          Используется серверный Firebase Auth REST API.
        </p>
      </div>

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
          className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
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
          disabled={isSubmitting}
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
