import React, { useState, useRef } from 'react';
import {
  NotebookSubmission,
  SubjectType,
  MarginMarkSymbol,
  ErrorCategory,
} from '../types/notebook';
import { SAMPLE_PHOTOS } from '../data/initialSubmissions';
import {
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
  AlertCircle,
} from 'lucide-react';

interface PhotoCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddCheckedSubmission: (submission: NotebookSubmission) => void;
}

export const PhotoCheckModal: React.FC<PhotoCheckModalProps> = ({
  isOpen,
  onClose,
  onAddCheckedSubmission,
}) => {
  const [studentName, setStudentName] = useState('Козлов Илья');
  const [classGroup, setClassGroup] = useState('2 «А» класс');
  const [subject, setSubject] = useState<SubjectType>('Русский язык');
  const [assignmentTitle, setAssignmentTitle] = useState(
    'Упр. 45 · Правописание сочетаний ЖИ–ШИ, ЧА–ЩА'
  );
  const [referenceSolution, setReferenceSolution] = useState(
    'В роще расцвели душистые ландыши. Пушистые бельчата ловко прыгали по веткам сосны. Ребята несли домой полные корзины грибов.'
  );
  const [selectedSample, setSelectedSample] = useState<'russian' | 'math' | 'custom'>('russian');
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const [customImageBase64, setCustomImageBase64] = useState<string | null>(null);
  const [customMimeType, setCustomMimeType] = useState<string>('image/jpeg');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: 'russian' | 'math') => {
    setSelectedSample(preset);
    setCustomImagePreview(null);
    setCustomImageBase64(null);
    setAnalysisResult(null);
    setErrorMsg(null);

    if (preset === 'russian') {
      setSubject('Русский язык');
      setClassGroup('2 «А» класс');
      setAssignmentTitle('Упр. 45 · Правописание сочетаний ЖИ–ШИ, ЧА–ЩА');
      setReferenceSolution(
        'В роще расцвели душистые ландыши. Пушистые бельчата ловко прыгали по веткам сосны. Ребята несли домой полные корзины грибов.'
      );
    } else {
      setSubject('Математика');
      setClassGroup('3 «Б» класс');
      setAssignmentTitle('Стр. 28, Задача № 14 и примеры № 16');
      setReferenceSolution(
        '1) 24 + 18 = 42 (кг); 2) 24 + 42 = 66 (кг). Примеры: 56 - 29 = 27, 48 + 35 = 83, 72 - 18 = 54.'
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedSample('custom');
    setCustomMimeType(file.type || 'image/jpeg');
    setAnalysisResult(null);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCustomImagePreview(dataUrl);
      setCustomImageBase64(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/check-notebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: customImageBase64,
          mimeType: customMimeType,
          subject,
          gradeLevel: classGroup,
          assignmentTitle,
          referenceSolution,
          sampleId: selectedSample === 'math' ? 'math' : 'russian',
        }),
      });

      if (!response.ok) {
        throw new Error('Не удалось выполнить проверку снимка тетради');
      }

      const data = await response.json();
      setAnalysisResult(data.result);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Произошла ошибка при обращении к серверу анализа');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveToQueue = () => {
    if (!analysisResult) return;

    const newSubmission: NotebookSubmission = {
      id: `sub-${Date.now()}`,
      studentName: studentName.trim() || 'Новый ученик',
      classGroup,
      subject,
      paperRuling: subject === 'Математика' ? 'squared-grid' : 'lined-slanted',
      assignmentTitle,
      submittedDate: '6 октября (по фото)',
      status: 'checked',
      verbalStamp:
        analysisResult.studentPraise || 'Хорошая работа! Обрати внимание на пометки.',
      contentGrade: analysisResult.recommendedGrade || 4,
      calligraphyGrade: analysisResult.calligraphyScore || 4,
      handwrittenLines:
        Array.isArray(analysisResult.recognizedLines) &&
        analysisResult.recognizedLines.length > 0
          ? analysisResult.recognizedLines
          : ['Домашняя работа.', 'Распознанный текст ученика.'],
      photoSampleUrl:
        customImagePreview ||
        (subject === 'Математика' ? SAMPLE_PHOTOS.math : SAMPLE_PHOTOS.russian),
      teacherSummary: analysisResult.summary || 'Проверено с помощью фото-анализа.',
      parentMessage:
        analysisResult.parentFeedback ||
        'Домашняя работа проверена, рекомендации добавлены в дневник.',
      errors: Array.isArray(analysisResult.errors)
        ? analysisResult.errors.map((e: any, i: number) => ({
            id: `err-ai-${Date.now()}-${i}`,
            lineIndex: typeof e.lineIndex === 'number' ? e.lineIndex : 3,
            wrongFragment: e.wrongFragment || '',
            correctFragment: e.correctFragment || '',
            ruleName: e.ruleName || 'Правило ФГОС НОО',
            explanation: e.explanation || '',
            errorType: (e.errorType as ErrorCategory) || 'orthography',
            marginMark: (e.marginMark as MarginMarkSymbol) || '/',
            confirmedByTeacher: true,
          }))
        : [],
      customLineMarks: [],
      remediationTasks: Array.isArray(analysisResult.remediationTasks)
        ? analysisResult.remediationTasks
        : [],
    };

    onAddCheckedSubmission(newSubmission);
    onClose();
  };

  const currentPhotoUrl =
    customImagePreview ||
    (selectedSample === 'math' ? SAMPLE_PHOTOS.math : SAMPLE_PHOTOS.russian);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-check-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2
              id="photo-check-modal-title"
              className="text-lg font-semibold text-slate-900"
            >
              Проверка тетради по фотографии (ФГОС НОО)
            </h2>
            <p className="text-xs text-slate-500">
              Загрузите фото разворота тетради или выберите готовый образец для мгновенного распознавания почерка и поиска ошибок
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно проверки по фото"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[80vh] overflow-y-auto">
          {/* Left Column: Photo Upload & Parameters */}
          <div className="lg:col-span-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                1. Выберите снимок тетради (образец или свой файл)
              </label>
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg mb-3">
                <button
                  type="button"
                  onClick={() => handleSelectPreset('russian')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selectedSample === 'russian'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Образец: Русский язык (2 кл.)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectPreset('math')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selectedSample === 'math'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Образец: Математика (3 кл.)
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selectedSample === 'custom'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Свой файл</span>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                aria-label="Загрузить фото тетради с устройства"
              />

              {/* Photo Preview Box */}
              <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-900 h-48">
                <img
                  src={currentPhotoUrl}
                  alt="Предпросмотр страницы тетради для проверки"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 flex items-center justify-between text-white">
                  <span className="text-xs font-medium">
                    {selectedSample === 'custom'
                      ? 'Загруженное фото тетради'
                      : selectedSample === 'math'
                      ? 'Тетрадь в клетку (Математика, 3 класс)'
                      : 'Тетрадь в косую линейку (Русский язык, 2 класс)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded backdrop-blur-xs transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Заменить фото</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Student & Subject Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="modal-student-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Фамилия и имя ученика
                </label>
                <input
                  id="modal-student-name"
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
              <div>
                <label
                  htmlFor="modal-class-group"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Класс и предмет
                </label>
                <div className="flex gap-2">
                  <select
                    id="modal-class-group"
                    value={classGroup}
                    onChange={(e) => setClassGroup(e.target.value)}
                    className="w-1/2 px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="1 «В» класс">1 «В» кл.</option>
                    <option value="2 «А» класс">2 «А» кл.</option>
                    <option value="3 «Б» класс">3 «Б» кл.</option>
                    <option value="4 «А» класс">4 «А» кл.</option>
                  </select>
                  <select
                    aria-label="Выбор предмета"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value as SubjectType)}
                    className="w-1/2 px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Русский язык">Русский язык</option>
                    <option value="Математика">Математика</option>
                    <option value="Окружающий мир">Окр. мир</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="modal-assignment-title"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Номер упражнения / тема домашнего задания
              </label>
              <input
                id="modal-assignment-title"
                type="text"
                value={assignmentTitle}
                onChange={(e) => setAssignmentTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>

            <div>
              <label
                htmlFor="modal-reference-text"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Образец правильного выполнения / текст упражнения (необязательно)
              </label>
              <textarea
                id="modal-reference-text"
                rows={2}
                value={referenceSolution}
                onChange={(e) => setReferenceSolution(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>

            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={isAnalyzing}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Распознаём почерк и проверяем по ФГОС...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Распознать почерк и проверить работу</span>
                </>
              )}
            </button>
          </div>

          {/* Right Column: Live Analysis Output */}
          <div className="lg:col-span-6 flex flex-col justify-between border border-slate-200 rounded-xl p-4 bg-slate-50/60">
            {errorMsg && (
              <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {!analysisResult && !isAnalyzing && (
              <div className="flex flex-col items-center justify-center text-center h-full py-12 px-4">
                <FileText className="w-10 h-10 text-slate-400 mb-3" />
                <h3 className="text-sm font-semibold text-slate-800">
                  Готово к распознаванию страницы
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Нажмите кнопку «Распознать почерк и проверить работу» слева. Помощник расшифрует рукописные строки ученика, выделит орфографические или вычислительные ошибки и предложит отметку по нормам ФГОС НОО.
                </p>
              </div>
            )}

            {isAnalyzing && (
              <div className="space-y-3 py-6">
                <div className="h-5 bg-slate-200 rounded w-2/3 animate-pulse" />
                <div className="h-24 bg-slate-200 rounded w-full animate-pulse" />
                <div className="h-16 bg-slate-200 rounded w-full animate-pulse" />
                <div className="h-16 bg-slate-200 rounded w-5/6 animate-pulse" />
              </div>
            )}

            {analysisResult && !isAnalyzing && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <span className="text-xs text-slate-500">Результат проверки</span>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {studentName} · {classGroup}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="block text-[11px] text-slate-500">
                        Рекомендуемая отметка
                      </span>
                      <span className="text-xs font-medium text-red-700">
                        Содержание / Почерк
                      </span>
                    </div>
                    <span className="font-handwriting text-4xl font-bold text-red-600">
                      {analysisResult.recommendedGrade}/{analysisResult.calligraphyScore}
                    </span>
                  </div>
                </div>

                {/* Recognized lines */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                    Распознанный рукописный текст ученика:
                  </h4>
                  <div className="p-3 rounded-lg bg-[#FFFEF9] border border-slate-200 font-handwriting text-xl text-[#1E3A8A] space-y-0.5">
                    {(analysisResult.recognizedLines || []).map((line: string, idx: number) => (
                      <div key={idx}>{line}</div>
                    ))}
                  </div>
                </div>

                {/* Errors found */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                    Найденные ошибки ({analysisResult.errors?.length || 0}):
                  </h4>
                  <div className="space-y-2">
                    {(analysisResult.errors || []).map((err: any, i: number) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800">
                            {err.ruleName}
                          </span>
                          <span className="font-mono-tabular text-red-600 font-semibold">
                            Поля: {err.marginMark}
                          </span>
                        </div>
                        <div>
                          <span className="line-through text-red-600 mr-1.5">
                            {err.wrongFragment}
                          </span>
                          <span>→</span>
                          <span className="text-emerald-700 font-semibold ml-1.5">
                            {err.correctFragment}
                          </span>
                        </div>
                        <p className="text-slate-500">{err.explanation}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Summary & Action */}
                <div className="p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 space-y-1">
                  <div className="font-semibold text-slate-900">
                    Методическое заключение:
                  </div>
                  <p>{analysisResult.summary}</p>
                </div>

                <button
                  type="button"
                  onClick={handleSaveToQueue}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Открыть эту тетрадь на рабочем столе и сохранить в журнал</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
