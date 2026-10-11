import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  NotebookSubmission,
  SubjectType,
  MarginMarkSymbol,
  ErrorCategory,
  SchoolClassItem,
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
  Edit3,
  RefreshCw,
  Image as ImageIcon,
  Video,
} from 'lucide-react';

interface PhotoCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddCheckedSubmission: (submission: NotebookSubmission) => void;
  classes: SchoolClassItem[];
  activeClassGroup?: string;
  activeStudentName?: string;
  activeSubject?: SubjectType;
}

// Normalize & compress any photo (including 12MP mobile camera shots or HEIC/PNG) into a crisp JPEG <= 1600px
function compressAndNormalizeImage(file: File | Blob): Promise<{
  dataUrl: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать выбранный файл изображения'));
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 1600;
          let width = img.naturalWidth || img.width || 1200;
          let height = img.naturalHeight || img.height || 900;

          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
            return;
          }
          // Fill white background in case of transparent PNG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.88);
          resolve({
            dataUrl: jpegDataUrl,
            mimeType: 'image/jpeg',
          });
        } catch {
          resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
        }
      };
      img.onerror = () => {
        // If browser cannot render the format on canvas, fallback to raw dataUrl
        resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const PhotoCheckModal: React.FC<PhotoCheckModalProps> = ({
  isOpen,
  onClose,
  onAddCheckedSubmission,
  classes,
  activeClassGroup,
  activeStudentName,
  activeSubject,
}) => {
  const defaultClassName =
    activeClassGroup && activeClassGroup !== 'all'
      ? activeClassGroup
      : classes[0]?.name || '2 «А» класс';

  const [classGroup, setClassGroup] = useState(defaultClassName);
  const [studentName, setStudentName] = useState(
    activeStudentName || 'Соколов Артём'
  );
  const [subject, setSubject] = useState<SubjectType>(
    activeSubject || 'Русский язык'
  );
  const [assignmentTitle, setAssignmentTitle] = useState('Домашняя работа');
  const [referenceSolution, setReferenceSolution] = useState('');
  const [studentWrittenText, setStudentWrittenText] = useState('');
  const [selectedSample, setSelectedSample] = useState<
    'custom' | 'camera' | 'russian' | 'math'
  >('custom');
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(
    null
  );
  const [customImageBase64, setCustomImageBase64] = useState<string | null>(
    null
  );
  const [customMimeType, setCustomMimeType] = useState<string>('image/jpeg');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [modelUsedBadge, setModelUsedBadge] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Live WebRTC Camera states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<
    'environment' | 'user'
  >('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  const startCameraStream = useCallback(
    async (facing: 'environment' | 'user' = cameraFacingMode) => {
      setCameraError(null);
      setErrorMsg(null);
      stopCameraStream();

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraError(
          'Ваш браузер не поддерживает прямой видеопоток. Воспользуйтесь кнопкой «Снять на камеру телефона» или «Выбрать из галереи».'
        );
        return;
      }

      try {
        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facing },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available video camera (e.g. laptop webcam)
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = mediaStream;
        setIsCameraActive(true);
        setSelectedSample('camera');

        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
            videoRef.current.play().catch(() => {});
          }
        }, 50);
      } catch (err: any) {
        console.warn('Camera permission or device error:', err);
        setCameraError(
          'Доступ к веб-камере отклонён браузером или камера не найдена. Разрешите доступ к камере в адресной строке браузера или нажмите «Снять на камеру устройства / Галерея».'
        );
      }
    },
    [cameraFacingMode, stopCameraStream]
  );

  // Clean up camera when modal closes or unmounts
  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [isOpen, stopCameraStream]);

  // Process any File/Blob (from gallery, native camera, drag-and-drop, or clipboard paste)
  const processImageFile = useCallback(
    async (file: File | Blob) => {
      stopCameraStream();
      setSelectedSample('custom');
      setAnalysisResult(null);
      setErrorMsg(null);
      setCameraError(null);
      setStudentWrittenText('');

      try {
        const { dataUrl, mimeType } = await compressAndNormalizeImage(file);
        setCustomMimeType(mimeType);
        setCustomImagePreview(dataUrl);
        setCustomImageBase64(dataUrl);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Ошибка при обработке фотографии');
      }
    },
    [stopCameraStream]
  );

  // Support Ctrl+V / Cmd+V image paste while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (blob) {
            processImageFile(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, processImageFile]);

  // Sync with teacher's currently selected class and student when modal opens
  useEffect(() => {
    if (isOpen) {
      const targetClass =
        activeClassGroup &&
        activeClassGroup !== 'all' &&
        classes.some((c) => c.name === activeClassGroup)
          ? activeClassGroup
          : classes[0]?.name || '2 «А» класс';

      setClassGroup(targetClass);

      const matchedClassObj = classes.find((c) => c.name === targetClass);
      const roster = matchedClassObj?.studentsList
        ? matchedClassObj.studentsList
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      if (activeStudentName && roster.includes(activeStudentName)) {
        setStudentName(activeStudentName);
      } else if (roster.length > 0) {
        setStudentName(roster[0]);
      } else if (activeStudentName) {
        setStudentName(activeStudentName);
      }

      if (activeSubject) {
        setSubject(activeSubject);
      }
    }
  }, [isOpen, activeClassGroup, activeStudentName, activeSubject, classes]);

  if (!isOpen) return null;

  const selectedClassObj = classes.find((c) => c.name === classGroup);
  const classStudents = selectedClassObj?.studentsList
    ? selectedClassObj.studentsList
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const handleClassChange = (newClassName: string) => {
    setClassGroup(newClassName);
    const clsObj = classes.find((c) => c.name === newClassName);
    if (clsObj?.studentsList) {
      const firstStu = clsObj.studentsList
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)[0];
      if (firstStu) {
        setStudentName(firstStu);
      }
    }
  };

  // Capture high-resolution snapshot from live video stream
  const handleCaptureSnapshotFromCamera = (): string | null => {
    const video = videoRef.current;
    if (!video) return null;

    const canvas = document.createElement('canvas');
    const maxDim = 1600;
    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 960;
    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

    stopCameraStream();
    setSelectedSample('custom');
    setCustomMimeType('image/jpeg');
    setCustomImagePreview(dataUrl);
    setCustomImageBase64(dataUrl);
    setStudentWrittenText('');
    setAnalysisResult(null);
    setErrorMsg(null);
    return dataUrl;
  };

  const handleToggleCameraFacing = () => {
    const nextFacing =
      cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(nextFacing);
    startCameraStream(nextFacing);
  };

  const handleSelectPreset = (preset: 'russian' | 'math') => {
    stopCameraStream();
    setSelectedSample(preset);
    setCustomImagePreview(null);
    setCustomImageBase64(null);
    setStudentWrittenText('');
    setAnalysisResult(null);
    setErrorMsg(null);
    setCameraError(null);

    if (preset === 'russian') {
      setSubject('Русский язык');
      setAssignmentTitle('Каллиграфия и письменная работа');
    } else {
      setSubject('Математика');
      setAssignmentTitle('Решение примеров в тетради');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
    e.target.value = '';
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processImageFile(file);
    }
  };

  const handleRunAnalysis = async () => {
    let activeBase64 = customImageBase64;
    if (isCameraActive) {
      const snapped = handleCaptureSnapshotFromCamera();
      if (snapped) activeBase64 = snapped;
    }

    if (
      (selectedSample === 'custom' || selectedSample === 'camera') &&
      !activeBase64 &&
      !studentWrittenText.trim()
    ) {
      setErrorMsg(
        'Пожалуйста, сделайте снимок камерой или выберите фотографию тетради из галереи устройства.'
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/check-notebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: activeBase64,
          mimeType: customMimeType,
          subject,
          gradeLevel: classGroup,
          assignmentTitle,
          referenceSolution,
          studentWrittenText: studentWrittenText.trim(),
          sampleId:
            selectedSample === 'math'
              ? 'math'
              : selectedSample === 'russian'
              ? 'russian'
              : 'custom',
        }),
      });

      const rawText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          `Ошибка сервера (${response.status}): размер снимка слишком велик или требуется повторная публикация (Deploy) приложения.`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error || 'Не удалось выполнить проверку снимка тетради'
        );
      }

      if (data.warning) {
        setErrorMsg(data.warning);
      }

      setAnalysisResult(data.result);
      setModelUsedBadge(data.source || 'gemini');
      if (
        Array.isArray(data.result?.recognizedLines) &&
        data.result.recognizedLines.length > 0
      ) {
        setStudentWrittenText(data.result.recognizedLines.join('\n'));
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message || 'Произошла ошибка при обращении к серверу анализа'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveToQueue = () => {
    if (!analysisResult) return;

    const isFirstGrade =
      selectedClassObj?.gradeLevel === 1 || classGroup.startsWith('1');
    const defaultRuling =
      subject === 'Математика'
        ? 'squared-grid'
        : selectedClassObj?.defaultRuling || 'lined-slanted';

    const finalLines = studentWrittenText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const newSubmission: NotebookSubmission = {
      id: `sub-${Date.now()}`,
      studentName: studentName.trim() || 'Ученик класса',
      classGroup,
      subject,
      paperRuling: defaultRuling,
      assignmentTitle,
      submittedDate: '11 октября (по фото)',
      status: 'checked',
      isFirstGradeNoGrades: isFirstGrade,
      verbalStamp:
        analysisResult.studentPraise ||
        'Хорошая работа! Обрати внимание на пометки.',
      contentGrade: analysisResult.recommendedGrade || 4,
      calligraphyGrade: analysisResult.calligraphyScore || 4,
      handwrittenLines:
        finalLines.length > 0
          ? finalLines
          : Array.isArray(analysisResult.recognizedLines) &&
            analysisResult.recognizedLines.length > 0
          ? analysisResult.recognizedLines
          : ['Домашняя работа.'],
      photoSampleUrl:
        customImagePreview ||
        (selectedSample === 'math'
          ? SAMPLE_PHOTOS.math
          : SAMPLE_PHOTOS.russian),
      teacherSummary:
        analysisResult.summary || 'Проверено по фотографии тетради.',
      parentMessage:
        analysisResult.parentFeedback ||
        'Домашняя работа проверена, рекомендации добавлены в дневник.',
      errors: Array.isArray(analysisResult.errors)
        ? analysisResult.errors.map((e: any, i: number) => ({
            id: `err-ai-${Date.now()}-${i}`,
            lineIndex: typeof e.lineIndex === 'number' ? e.lineIndex : 0,
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
    selectedSample === 'custom' || selectedSample === 'camera'
      ? customImagePreview
      : selectedSample === 'math'
      ? SAMPLE_PHOTOS.math
      : SAMPLE_PHOTOS.russian;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-check-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="relative w-full max-w-5xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2
              id="photo-check-modal-title"
              className="text-lg font-semibold text-slate-900"
            >
              Камера и фото: распознавание почерка в тетради
            </h2>
            <p className="text-xs text-slate-500">
              Сфотографируйте страницу тетради прямо с камеры устройства или загрузите готовое фото из галереи ({classGroup})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно проверки по фото"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[82vh] overflow-y-auto">
          {/* Left Column: Class, Student, Live Camera / Photo Upload */}
          <div className="lg:col-span-6 space-y-4">
            {/* 1. Class, Subject & Student */}
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="modal-class-group"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    1. Ваш класс
                  </label>
                  <select
                    id="modal-class-group"
                    value={classGroup}
                    onChange={(e) => handleClassChange(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                  >
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.name}>
                        {cls.name} ({cls.gradeLevel} кл.)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="modal-subject-select"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    Предмет
                  </label>
                  <select
                    id="modal-subject-select"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value as SubjectType)}
                    className="w-full px-2.5 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Русский язык">Русский язык</option>
                    <option value="Математика">Математика</option>
                    <option value="Окружающий мир">Окружающий мир</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="modal-student-name"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  Фамилия и имя ученика ({classGroup})
                </label>
                <div className="flex gap-2">
                  <input
                    id="modal-student-name"
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Введите или выберите ученика..."
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                  {classStudents.length > 0 && (
                    <select
                      aria-label="Выбрать ученика из списка класса"
                      value={
                        classStudents.includes(studentName) ? studentName : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) setStudentName(e.target.value);
                      }}
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
                    >
                      <option value="">Из списка класса...</option>
                      {classStudents.map((stu, i) => (
                        <option key={i} value={stu}>
                          {stu}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Camera & Photo Controls */}
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                2. Доступ к камере и загрузка фотографии тетради
              </label>

              {/* Primary Camera & Gallery Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2.5">
                <button
                  type="button"
                  onClick={() =>
                    isCameraActive ? stopCameraStream() : startCameraStream()
                  }
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isCameraActive
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-red-600 hover:bg-red-700 text-white border-red-600'
                  }`}
                >
                  <Video className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isCameraActive ? 'Выключить камеру' : 'Включить веб-камеру'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => mobileCameraInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>Камера телефона</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>Выбрать из фото</span>
                </button>
              </div>

              {/* Built-in demo switcher strip */}
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-2">
                <span>Или проверьте на встроенных демо-снимках:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectPreset('russian')}
                    className={`underline cursor-pointer ${
                      selectedSample === 'russian'
                        ? 'text-red-600 font-semibold'
                        : 'hover:text-slate-800'
                    }`}
                  >
                    Демо: Русский яз.
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => handleSelectPreset('math')}
                    className={`underline cursor-pointer ${
                      selectedSample === 'math'
                        ? 'text-red-600 font-semibold'
                        : 'hover:text-slate-800'
                    }`}
                  >
                    Демо: Математика
                  </button>
                </div>
              </div>

              {/* Hidden file input for Photo Gallery / File System */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                aria-label="Выбрать фотографию тетради из галереи или файлов"
              />

              {/* Hidden file input with capture="environment" for direct Mobile / Tablet Rear Camera */}
              <input
                ref={mobileCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                className="hidden"
                aria-label="Сфотографировать тетрадь на камеру телефона или планшета"
              />

              {cameraError && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2 mb-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{cameraError}</span>
                </div>
              )}

              {/* Live WebRTC Camera Viewfinder OR Photo Preview OR Drag & Drop Zone */}
              {isCameraActive ? (
                <div className="relative rounded-xl overflow-hidden border-2 border-red-500 bg-slate-950 h-56 flex flex-col justify-between">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Notebook Framing Guide Overlay */}
                  <div className="absolute inset-4 border border-dashed border-white/60 rounded-lg pointer-events-none flex items-start justify-center pt-2">
                    <span className="px-2 py-0.5 rounded bg-black/60 text-[11px] text-white">
                      Наведите камеру на страницу тетради
                    </span>
                  </div>

                  {/* Camera Shutter & Switch Controls */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleToggleCameraFacing}
                      className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 text-white px-2.5 py-1.5 rounded-lg backdrop-blur-xs transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Сменить камеру</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCaptureSnapshotFromCamera}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg shadow-md transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Сделать снимок страницы</span>
                    </button>

                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="text-xs text-slate-200 hover:text-white px-2 py-1 cursor-pointer"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : currentPhotoUrl ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDropFile}
                  className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-950 h-48"
                >
                  <img
                    src={currentPhotoUrl}
                    alt="Предпросмотр страницы тетради для проверки"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 flex flex-wrap items-center justify-between gap-2 text-white">
                    <span className="text-xs font-medium">
                      {selectedSample === 'custom' || selectedSample === 'camera'
                        ? 'Снимок тетради готов к распознаванию'
                        : selectedSample === 'math'
                        ? 'Демо-снимок тетради в клетку'
                        : 'Демо-снимок тетради в линейку'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startCameraStream()}
                        className="flex items-center gap-1 text-xs bg-red-600/90 hover:bg-red-600 px-2.5 py-1 rounded transition-colors cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Переснять</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded backdrop-blur-xs transition-colors cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Другое фото</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDropFile}
                  className={`w-full h-44 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2.5 transition-colors p-4 text-center ${
                    isDraggingOver
                      ? 'border-red-600 bg-red-50/50'
                      : 'border-slate-300 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => startCameraStream()}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Сфотографировать камерой</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-sky-600" />
                      <span>Загрузить из фото / файлов</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-sm">
                    Перетащите сюда изображение (JPG, PNG, WEBP, HEIC), вставьте из буфера обмена (<kbd className="font-mono-tabular">Ctrl+V</kbd>) или сделайте снимок камерой
                  </p>
                </div>
              )}
            </div>

            {/* 3. Optional Editable Text Area */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="modal-student-written-text"
                  className="text-xs font-semibold text-slate-800 flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5 text-red-600" />
                  <span>
                    3. Расшифрованный текст (заполняется автоматически с фото или вручную):
                  </span>
                </label>
                {studentWrittenText && (
                  <button
                    type="button"
                    onClick={() => setStudentWrittenText('')}
                    className="text-[11px] text-red-600 hover:underline cursor-pointer"
                  >
                    Очистить для чтения с фото
                  </button>
                )}
              </div>
              <textarea
                id="modal-student-written-text"
                rows={3}
                value={studentWrittenText}
                onChange={(e) => setStudentWrittenText(e.target.value)}
                placeholder="Оставьте это поле ПУСТЫМ, чтобы нейросеть сама прочитала почерк со сделанного снимка..."
                className="w-full p-2.5 text-xs border border-slate-300 rounded-lg font-sans focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="modal-assignment-title"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Тема / номер задания
                </label>
                <input
                  id="modal-assignment-title"
                  type="text"
                  value={assignmentTitle}
                  onChange={(e) => setAssignmentTitle(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="modal-reference-text"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Эталон задания (необязательно)
                </label>
                <input
                  id="modal-reference-text"
                  type="text"
                  value={referenceSolution}
                  onChange={(e) => setReferenceSolution(e.target.value)}
                  placeholder="Если нужно сверить с конкретным текстом..."
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
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
                  <span>Читаем почерк с фотографии (Gemini Vision)...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Распознать почерк с фото и найти ошибки</span>
                </>
              )}
            </button>
          </div>

          {/* Right Column: Live Analysis Output */}
          <div className="lg:col-span-6 flex flex-col justify-between border border-slate-200 rounded-xl p-4 bg-slate-50/60">
            {errorMsg && (
              <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs flex items-start gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {!analysisResult && !isAnalyzing && (
              <div className="flex flex-col items-center justify-center text-center h-full py-12 px-4">
                <FileText className="w-10 h-10 text-slate-400 mb-3" />
                <h3 className="text-sm font-semibold text-slate-800">
                  Готово к съёмке или загрузке фото ({classGroup}, {studentName})
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Нажмите «Включить веб-камеру», «Камера телефона» или «Выбрать из фото» слева, затем нажмите «Распознать почерк с фото и найти ошибки».
                </p>
              </div>
            )}

            {isAnalyzing && (
              <div className="space-y-3 py-6">
                <div className="text-xs font-medium text-slate-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                  <span>Выполняется оптическое распознавание рукописного листа...</span>
                </div>
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
                    <span className="text-xs text-emerald-700 font-medium">
                      ● Распознано с изображения ({modelUsedBadge})
                    </span>
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
                      {analysisResult.recommendedGrade}/
                      {analysisResult.calligraphyScore}
                    </span>
                  </div>
                </div>

                {/* Recognized lines */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                    Прочитанные строки с фотографии:
                  </h4>
                  <div className="p-3 rounded-lg bg-[#FFFEF9] border border-slate-200 font-handwriting text-xl text-[#1E3A8A] space-y-0.5 max-h-44 overflow-y-auto">
                    {(analysisResult.recognizedLines || []).map(
                      (line: string, idx: number) => (
                        <div key={idx}>{line}</div>
                      )
                    )}
                  </div>
                </div>

                {/* Errors found */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                    Найденные ошибки ({analysisResult.errors?.length || 0}):
                  </h4>
                  {(analysisResult.errors || []).length === 0 ? (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                      Ошибок на фотографии не обнаружено! Работа выполнена верно.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {(analysisResult.errors || []).map(
                        (err: any, i: number) => (
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
                        )
                      )}
                    </div>
                  )}
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
                  <span>
                    Открыть тетрадь ({studentName}, {classGroup}) на рабочем столе
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
