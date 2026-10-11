import React, { useState } from 'react';
import {
  NotebookSubmission,
  NotebookError,
  MarginMarkSymbol,
  PaperRulingType,
} from '../types/notebook';
import {
  Check,
  Eye,
  FileText,
  Image as ImageIcon,
  PenTool,
  Sparkles,
} from 'lucide-react';

interface InteractiveNotebookSheetProps {
  submission: NotebookSubmission;
  selectedErrorId: string | null;
  onSelectError: (errorId: string) => void;
  onToggleErrorConfirm: (errorId: string) => void;
  onToggleLineMark: (lineIndex: number, symbol: MarginMarkSymbol) => void;
  onChangePaperRuling: (ruling: PaperRulingType) => void;
  onOpenPhotoScanner: () => void;
  onUpdateAndReanalyzeLines?: (newLines: string[]) => Promise<void>;
}

const PEN_TOOLS: Array<{
  symbol: MarginMarkSymbol;
  label: string;
  hint: string;
}> = [
  { symbol: '/', label: '/ Орфография', hint: 'Орфографическая ошибка на полях' },
  { symbol: 'V', label: 'V Пунктуация', hint: 'Пунктуационная ошибка на полях' },
  { symbol: '!', label: '! Вычисление', hint: 'Ошибка в вычислениях или задаче' },
  { symbol: 'К', label: 'К Каллиграфия', hint: 'Замечание к соединению или наклону букв' },
  { symbol: '✓', label: '✓ Верно', hint: 'Отметить правильный шаг или строку' },
];

export const InteractiveNotebookSheet: React.FC<InteractiveNotebookSheetProps> = ({
  submission,
  selectedErrorId,
  onSelectError,
  onToggleErrorConfirm,
  onToggleLineMark,
  onChangePaperRuling,
  onOpenPhotoScanner,
  onUpdateAndReanalyzeLines,
}) => {
  const [viewMode, setViewMode] = useState<'interactive' | 'photo'>('interactive');
  const [activePenSymbol, setActivePenSymbol] = useState<MarginMarkSymbol>('/');
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isEditingLines, setIsEditingLines] = useState(false);
  const [draftLinesText, setDraftLinesText] = useState('');
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  const paperClass =
    submission.paperRuling === 'squared-grid'
      ? 'notebook-paper-grid'
      : submission.paperRuling === 'lined-wide'
      ? 'notebook-paper-wide'
      : 'notebook-paper-slanted';

  const confirmedErrors = submission.errors.filter((e) => e.confirmedByTeacher);

  // Render a handwritten line with inline red-pen teacher corrections
  const renderLineWithCorrections = (lineText: string, lineIndex: number) => {
    const lineErrors = submission.errors.filter((e) => e.lineIndex === lineIndex);
    if (lineErrors.length === 0) {
      return <span>{lineText}</span>;
    }

    // Highlight the first matching error fragment on the line (or multiple sequentially)
    let remaining = lineText;
    const segments: React.ReactNode[] = [];
    let segKey = 0;

    for (const err of lineErrors) {
      const idx = remaining.indexOf(err.wrongFragment);
      if (idx !== -1) {
        if (idx > 0) {
          segments.push(
            <span key={`txt-${segKey++}`}>{remaining.slice(0, idx)}</span>
          );
        }
        const isSelected = selectedErrorId === err.id;
        segments.push(
          <button
            key={`err-${err.id}`}
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onSelectError(err.id);
            }}
            aria-label={`Ошибка: ${err.wrongFragment}, исправление: ${err.correctFragment}`}
            className={`relative inline-flex items-baseline mx-0.5 px-1 rounded transition-colors cursor-pointer ${
              err.confirmedByTeacher
                ? isSelected
                  ? 'bg-red-100/90 ring-2 ring-red-600'
                  : 'bg-red-50/80 hover:bg-red-100/70'
                : 'bg-slate-100/70 opacity-60 hover:opacity-100'
            }`}
          >
            {/* Student's original handwritten fragment with red slash/strike */}
            <span
              className={
                err.confirmedByTeacher
                  ? 'line-through decoration-red-600 decoration-2 text-[#1E3A8A]'
                  : 'text-[#1E3A8A]'
              }
            >
              {err.wrongFragment}
            </span>
            {/* Teacher's superscript red ink correction */}
            {err.confirmedByTeacher && (
              <span className="ml-1 text-red-600 font-handwriting font-bold text-xl leading-none select-none">
                {err.correctFragment}
              </span>
            )}
          </button>
        );
        remaining = remaining.slice(idx + err.wrongFragment.length);
      }
    }

    if (remaining.length > 0) {
      segments.push(<span key={`txt-end-${segKey}`}>{remaining}</span>);
    }

    return <>{segments}</>;
  };

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Top Control Bar of the Notebook Stage */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/70">
        {/* View Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('interactive')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'interactive'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Интерактивный лист</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('photo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'photo'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Фото-скан тетради</span>
          </button>
        </div>

        {/* Paper Ruling Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => onChangePaperRuling('lined-slanted')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              submission.paperRuling === 'lined-slanted'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Косая линейка
          </button>
          <button
            type="button"
            onClick={() => onChangePaperRuling('lined-wide')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              submission.paperRuling === 'lined-wide'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Широкая линейка
          </button>
          <button
            type="button"
            onClick={() => onChangePaperRuling('squared-grid')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              submission.paperRuling === 'squared-grid'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Клетка 5×5 мм
          </button>
        </div>
      </div>

      {/* Red Pen Teacher Annotation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <PenTool className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <span className="font-medium text-slate-800">Красная ручка (знак на полях):</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {PEN_TOOLS.map((tool) => (
            <button
              key={tool.symbol}
              type="button"
              title={tool.hint}
              onClick={() => setActivePenSymbol(tool.symbol)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activePenSymbol === tool.symbol
                  ? 'bg-red-50 border-red-300 text-red-700 font-semibold'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {tool.label}
            </button>
          ))}
          {onUpdateAndReanalyzeLines && (
            <button
              type="button"
              onClick={() => {
                setDraftLinesText(submission.handwrittenLines.join('\n'));
                setIsEditingLines(!isEditingLines);
              }}
              className="ml-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isEditingLines ? 'Скрыть редактор строк' : 'Изменить текст на листе'}
            </button>
          )}
        </div>
      </div>

      {/* Inline Editor for Notebook Lines */}
      {isEditingLines && onUpdateAndReanalyzeLines && (
        <div className="p-4 border-b border-slate-200 bg-sky-50/40 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800">
              Редактирование рукописных строк ученика ({submission.studentName}, {submission.classGroup}):
            </span>
            <button
              type="button"
              onClick={() => setIsEditingLines(false)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Закрыть
            </button>
          </div>
          <textarea
            rows={5}
            value={draftLinesText}
            onChange={(e) => setDraftLinesText(e.target.value)}
            placeholder="Введите строки работы ученика (каждая строка с новой строчки)..."
            className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg font-sans focus:outline-none focus:ring-2 focus:ring-sky-600"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">
              После сохранения система автоматически перепроверит орфограммы и примеры по нормам ФГОС.
            </span>
            <button
              type="button"
              disabled={isReanalyzing}
              onClick={async () => {
                const lines = draftLinesText
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (lines.length === 0) return;
                setIsReanalyzing(true);
                try {
                  await onUpdateAndReanalyzeLines(lines);
                  setIsEditingLines(false);
                } finally {
                  setIsReanalyzing(false);
                }
              }}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {isReanalyzing
                ? 'Проверяем строки...'
                : 'Обновить лист и найти ошибки'}
            </button>
          </div>
        </div>
      )}

      {/* Main Stage Content */}
      {viewMode === 'interactive' ? (
        <div className="p-4 sm:p-6 bg-slate-100/70">
          {/* Authentic School Notebook Page Container */}
          <div
            data-testid="notebook-sheet-canvas"
            className={`relative w-full rounded-lg border border-slate-300 shadow-xs overflow-hidden ${paperClass}`}
          >
            {/* Red vertical margin line on the right (Поля тетради) */}
            <div
              aria-hidden="true"
              className="absolute top-0 bottom-0 right-16 sm:right-20 w-[2px] bg-red-400/80 pointer-events-none"
            />

            {/* Notebook Header Strip (Unboxed clean metadata with separators) */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 sm:px-8 pt-4 pb-2 pr-20 sm:pr-24 text-xs text-slate-500 border-b border-sky-200/60 bg-[#FFFEF9]/90">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{submission.studentName}</span>
                <span aria-hidden="true">·</span>
                <span>{submission.classGroup}</span>
                <span aria-hidden="true">·</span>
                <span>{submission.subject}</span>
                <span aria-hidden="true">·</span>
                <span>{submission.submittedDate}</span>
              </div>
              <div className="text-red-700 font-medium">
                Поля тетради →
              </div>
            </div>

            {/* Handwritten Lines & Margin Marks */}
            <div className="divide-y divide-transparent py-2">
              {submission.handwrittenLines.map((line, idx) => {
                const lineErrors = submission.errors.filter(
                  (e) => e.lineIndex === idx && e.confirmedByTeacher
                );
                const customMarks = submission.customLineMarks.filter(
                  (m) => m.lineIndex === idx
                );
                const isHeaderLine = idx <= 2;

                return (
                  <div
                    key={idx}
                    onClick={() => onToggleLineMark(idx, activePenSymbol)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggleLineMark(idx, activePenSymbol);
                      }
                    }}
                    aria-label={`Строка ${idx + 1}: ${line}. Нажмите, чтобы поставить знак «${activePenSymbol}» на полях`}
                    className="group relative flex items-center min-h-[44px] px-5 sm:px-8 pr-20 sm:pr-24 hover:bg-sky-50/40 transition-colors cursor-pointer"
                  >
                    {/* Line Number index on the far left */}
                    <span className="w-6 text-[11px] font-mono-tabular text-slate-400 select-none shrink-0">
                      {idx + 1}
                    </span>

                    {/* Student Handwriting in blue ballpoint pen */}
                    <div
                      className={`flex-1 font-handwriting text-2xl sm:text-[26px] leading-[44px] tracking-wide text-[#1E3A8A] ${
                        isHeaderLine ? 'text-center font-semibold' : 'pl-2 sm:pl-4'
                      }`}
                    >
                      {renderLineWithCorrections(line, idx)}
                    </div>

                    {/* Right Margin Column (Поля тетради) */}
                    <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-20 flex items-center justify-center gap-1 px-1 select-none">
                      {lineErrors.map((err) => (
                        <button
                          key={err.id}
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onSelectError(err.id);
                          }}
                          title={`${err.ruleName}: ${err.wrongFragment} → ${err.correctFragment}`}
                          className="font-handwriting text-2xl font-bold text-red-600 hover:scale-110 transition-transform"
                        >
                          {err.marginMark}
                        </button>
                      ))}
                      {customMarks.map((cm, cmIdx) => (
                        <span
                          key={cmIdx}
                          title={cm.note}
                          className={`font-handwriting text-2xl font-bold ${
                            cm.symbol === '✓' ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {cm.symbol}
                        </span>
                      ))}
                      {lineErrors.length === 0 && customMarks.length === 0 && (
                        <span className="opacity-0 group-hover:opacity-45 text-xs font-mono-tabular text-red-600 transition-opacity">
                          +{activePenSymbol}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Teacher Red-Pen Grade & Verbal Stamp on the Notebook Sheet */}
            <div className="flex flex-wrap items-end justify-between gap-4 px-6 sm:px-10 py-5 pr-20 sm:pr-24 border-t border-sky-200/50 bg-[#FFFEF9]/95">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">
                  Запись учителя в тетради (красная паста):
                </div>
                <p className="font-handwriting text-2xl sm:text-3xl font-bold text-red-600">
                  {submission.verbalStamp}
                </p>
                <div className="text-xs text-slate-500">
                  Выявлено ошибок на странице:{' '}
                  <span className="font-mono-tabular font-semibold text-slate-800">
                    {confirmedErrors.length}
                  </span>{' '}
                  · Нажмите на любую строку листа, чтобы поставить знак «{activePenSymbol}» на полях
                </div>
              </div>

              {/* Big Red Handwritten Grade (Содержание / Каллиграфия) */}
              <div className="flex items-center gap-4">
                {submission.isFirstGradeNoGrades ? (
                  <div className="text-right">
                    <span className="block text-[11px] text-slate-500">
                      1 класс (безотметочно по ФГОС)
                    </span>
                    <span className="font-handwriting text-3xl font-bold text-red-600">
                      Усвоено! Молодец!
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2 rounded-lg border border-red-200 bg-red-50/50">
                    <div className="text-right">
                      <span className="block text-[11px] text-slate-600">
                        Отметка (содержание / почерк)
                      </span>
                      <span className="text-xs text-red-700 font-medium">
                        {submission.status === 'checked' ? 'Проверено учителем' : 'Предварительная оценка'}
                      </span>
                    </div>
                    <div
                      data-testid="notebook-red-grade"
                      className="font-handwriting text-4xl sm:text-5xl font-bold text-red-600 tracking-tighter select-none"
                    >
                      {submission.contentGrade}/{submission.calligraphyGrade}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Photo Scan View Mode */
        <div className="p-4 sm:p-6 bg-slate-100/70 space-y-4">
          <div className="relative rounded-lg overflow-hidden border border-slate-300 bg-slate-900">
            {!imageLoadFailed ? (
              <img
                src={submission.photoSampleUrl}
                alt={`Фотография рабочей тетради: ${submission.studentName}, предмет ${submission.subject}`}
                referrerPolicy="no-referrer"
                onError={() => setImageLoadFailed(true)}
                className="w-full max-h-[480px] object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-72 bg-slate-800 text-slate-200 p-6 text-center">
                <FileText className="w-10 h-10 mb-2 text-sky-400" />
                <p className="text-sm font-medium">
                  Скан-копия страницы тетради ({submission.studentName})
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Используйте режим «Интерактивный лист» для построчной разметки ошибок красной ручкой
                </p>
              </div>
            )}
            <div className="bg-gradient-to-t from-black/85 via-black/50 to-transparent p-4 text-white flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  Оригинал фотоснимка тетради · {submission.studentName}
                </p>
                <p className="text-xs text-slate-200">
                  {submission.assignmentTitle} · Распознано строк: {submission.handwrittenLines.length}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('interactive')}
                  className="px-3 py-1.5 text-xs font-medium bg-white text-slate-900 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  Вернуться к разметке красной ручкой
                </button>
                <button
                  type="button"
                  onClick={onOpenPhotoScanner}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-600 text-white rounded-md hover:bg-sky-500 transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Загрузить другое фото</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detected Errors Interactive List below the Notebook Page */}
      <div className="p-4 sm:p-5 border-t border-slate-200 bg-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Разбор ошибок и орфограмм по строкам ({confirmedErrors.length} из {submission.errors.length} учтено в оценке)
            </h3>
            <p className="text-xs text-slate-500">
              Нажмите на ошибку в списке или прямо на странице тетради, чтобы подтвердить или снять пометку учителя
            </p>
          </div>
        </div>

        {submission.errors.length === 0 ? (
          <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/50 flex items-center gap-3 text-sm text-emerald-900">
            <Check className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-semibold">Ошибок не обнаружено!</span> Работа выполнена без орфографических и вычислительных неточностей (рекомендуемая отметка «5»).
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
            {submission.errors.map((err) => {
              const isSelected = selectedErrorId === err.id;
              return (
                <div
                  key={err.id}
                  onClick={() => onSelectError(err.id)}
                  className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected ? 'bg-red-50/50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono-tabular font-semibold text-red-700">
                        Знак на полях: {err.marginMark}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">Строка {err.lineIndex + 1}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-800">{err.ruleName}</span>
                    </div>
                    <div className="text-sm">
                      <span className="line-through text-red-600 font-medium mr-2">
                        {err.wrongFragment}
                      </span>
                      <span className="text-slate-400 mr-2">→</span>
                      <span className="text-emerald-700 font-semibold">
                        {err.correctFragment}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{err.explanation}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onToggleErrorConfirm(err.id);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                        err.confirmedByTeacher
                          ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {err.confirmedByTeacher ? 'Учтено в тетради' : 'Игнорировать'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
