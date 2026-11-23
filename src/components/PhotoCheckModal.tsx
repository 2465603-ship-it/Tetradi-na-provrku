import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  NotebookSubmission,
  SubjectType,
  MarginMarkSymbol,
  ErrorCategory,
  SchoolClassItem,
  HandwritingVerificationResult,
  StudentRecord,
  StudentIdentificationResult,
} from '../types/notebook';
import { SAMPLE_PHOTOS } from '../data/initialSubmissions';
import { safeParseJsonResponse } from '../utils/api';
import {
  compressAndNormalizeImage,
  blobToDataUrl,
} from '../utils/imageCompression';
import { ServiceReferenceImage } from './ServiceReferenceImage';
import {
  Camera,
  CheckCircle2,
  FileText,
  Fingerprint,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserSearch,
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
  studentsRecords?: StudentRecord[];
  activeClassGroup?: string;
  activeStudentName?: string;
  activeSubject?: SubjectType;
  authToken?: string;
  onUploadStudentReferenceFile?: (
    classItem: SchoolClassItem,
    studentName: string,
    imageBase64: string,
    previousUrl?: string
  ) => Promise<string>;
  onDeleteStudentReferenceFile?: (
    classItem: SchoolClassItem,
    studentName: string,
    currentUrl?: string
  ) => Promise<void>;
  onAuthExpired?: () => void;
}

export const PhotoCheckModal: React.FC<PhotoCheckModalProps> = ({
  isOpen,
  onClose,
  onAddCheckedSubmission,
  classes,
  studentsRecords = [],
  activeClassGroup,
  activeStudentName,
  activeSubject,
  authToken,
  onUploadStudentReferenceFile,
  onDeleteStudentReferenceFile,
  onAuthExpired,
}) => {
  const defaultClassName =
    activeClassGroup && activeClassGroup !== 'all'
      ? activeClassGroup
      : classes[0]?.name || '';

  const [classGroup, setClassGroup] = useState(defaultClassName);
  const [studentName, setStudentName] = useState(activeStudentName || '');
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

  // Graphological Handwriting Verification states (Image #1 Reference vs Image #2 Current)
  const [showHandwritingVerifier, setShowHandwritingVerifier] = useState(false);
  const [referenceImageBase64, setReferenceImageBase64] = useState<
    string | null
  >(null);
  const [referenceMimeType, setReferenceMimeType] =
    useState<string>('image/jpeg');
  const [isUploadingReferencePhoto, setIsUploadingReferencePhoto] =
    useState(false);
  const [isVerifyingHandwriting, setIsVerifyingHandwriting] = useState(false);
  const [handwritingResult, setHandwritingResult] =
    useState<HandwritingVerificationResult | null>(null);
  const [handwritingError, setHandwritingError] = useState<string | null>(null);

  // Automatic Student Identification by Handwriting (identify_student)
  const [isIdentifyingStudent, setIsIdentifyingStudent] = useState(false);
  const [identificationResult, setIdentificationResult] =
    useState<StudentIdentificationResult | null>(null);
  const [identificationError, setIdentificationError] = useState<string | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const studentNameInputRef = useRef<HTMLInputElement | null>(null);
  const studentSelectRef = useRef<HTMLSelectElement | null>(null);
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
      setIdentificationResult(null);
      setIdentificationError(null);
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
          : classes[0]?.name || '';

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
      } else {
        setStudentName(activeStudentName || '');
      }

      if (activeSubject) {
        setSubject(activeSubject);
      }
    }
  }, [isOpen, activeClassGroup, activeStudentName, activeSubject, classes]);

  // Load saved handwriting reference photo (from local cache or directly from service storage)
  useEffect(() => {
    if (!isOpen) return;
    const cleanName = studentName.trim();
    if (!cleanName) {
      setReferenceImageBase64(null);
      return;
    }

    let localSaved: string | null = null;
    try {
      localSaved = localStorage.getItem(
        `tetrad_plus_hw_ref:${cleanName.toLowerCase()}`
      );
    } catch {
      localSaved = null;
    }

    setHandwritingResult(null);
    setHandwritingError(null);

    if (localSaved) {
      setReferenceImageBase64(localSaved);
      setReferenceMimeType('image/jpeg');
      return;
    }

    const activeCls = classes.find((c) => c.name === classGroup);
    const matchingRec = studentsRecords.find(
      (sr) =>
        sr.studentName.trim().toLowerCase() === cleanName.toLowerCase() &&
        (!activeCls || !sr.classId || sr.classId === activeCls.id)
    );
    const savedUrl = matchingRec?.handwriting_reference_url?.trim() || '';

    if (savedUrl.startsWith('/api/handwriting-references/') && authToken) {
      let cancelled = false;
      fetch(savedUrl, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          if (!cancelled && dataUrl) {
            setReferenceImageBase64(dataUrl);
            setReferenceMimeType(blob.type || 'image/jpeg');
          }
        })
        .catch(() => {
          if (!cancelled) setReferenceImageBase64(null);
        });
      return () => {
        cancelled = true;
      };
    }

    setReferenceImageBase64(null);
  }, [isOpen, studentName, classGroup, classes, studentsRecords, authToken]);

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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/check-notebook', {
        method: 'POST',
        headers,
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

      const data = await safeParseJsonResponse(response);

      if (response.status === 401 && onAuthExpired) {
        onAuthExpired();
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

  const handleReferenceFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHandwritingError(null);
    setHandwritingResult(null);
    setIsUploadingReferencePhoto(true);
    try {
      const normalized = await compressAndNormalizeImage(file, 1400, 0.86);
      setReferenceImageBase64(normalized.dataUrl);
      setReferenceMimeType(normalized.mimeType);
      const cleanName = studentName.trim();
      if (cleanName) {
        try {
          localStorage.setItem(
            `tetrad_plus_hw_ref:${cleanName.toLowerCase()}`,
            normalized.dataUrl
          );
        } catch {
          // Ignore localStorage quota limits for large images
        }

        if (selectedClassObj && onUploadStudentReferenceFile) {
          const existingRec = studentsRecords.find(
            (sr) =>
              sr.studentName.trim().toLowerCase() === cleanName.toLowerCase() &&
              (!sr.classId || sr.classId === selectedClassObj.id)
          );
          await onUploadStudentReferenceFile(
            selectedClassObj,
            cleanName,
            normalized.dataUrl,
            existingRec?.handwriting_reference_url
          );
        }
      }
    } catch (err: any) {
      setHandwritingError(
        err?.message || 'Не удалось загрузить эталонное фото почерка в сервис.'
      );
    } finally {
      setIsUploadingReferencePhoto(false);
    }
    e.target.value = '';
  };

  const handleClearReferencePhoto = async () => {
    setReferenceImageBase64(null);
    setHandwritingResult(null);
    setHandwritingError(null);
    const cleanName = studentName.trim();
    if (cleanName) {
      try {
        localStorage.removeItem(
          `tetrad_plus_hw_ref:${cleanName.toLowerCase()}`
        );
      } catch {
        // ignore
      }
      if (selectedClassObj && onDeleteStudentReferenceFile) {
        const existingRec = studentsRecords.find(
          (sr) =>
            sr.studentName.trim().toLowerCase() === cleanName.toLowerCase() &&
            (!sr.classId || sr.classId === selectedClassObj.id)
        );
        try {
          await onDeleteStudentReferenceFile(
            selectedClassObj,
            cleanName,
            existingRec?.handwriting_reference_url
          );
        } catch {
          // ignore cleanup failure
        }
      }
    }
  };

  const handleVerifyHandwriting = async () => {
    setHandwritingError(null);

    if (!referenceImageBase64) {
      setHandwritingError(
        'Загрузите Изображение №1 (эталон тетради ученика) для сравнения.'
      );
      return;
    }

    let activeCurrentBase64 = customImageBase64;
    if (isCameraActive) {
      const snapped = handleCaptureSnapshotFromCamera();
      if (snapped) activeCurrentBase64 = snapped;
    }

    if (
      (selectedSample === 'custom' || selectedSample === 'camera') &&
      !activeCurrentBase64
    ) {
      setHandwritingError(
        'Загрузите или сфотографируйте текущую страницу тетради (Изображение №2).'
      );
      return;
    }

    setIsVerifyingHandwriting(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/verify-handwriting', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          studentName: studentName.trim() || 'Ученик',
          referenceImageBase64,
          referenceMimeType,
          currentImageBase64: activeCurrentBase64,
          currentMimeType: customMimeType,
          sampleId:
            selectedSample === 'math'
              ? 'math'
              : selectedSample === 'russian'
              ? 'russian'
              : 'custom',
        }),
      });

      const data = await safeParseJsonResponse(response);
      if (response.status === 401 && onAuthExpired) {
        onAuthExpired();
      }
      if (!response.ok) {
        throw new Error(
          data?.error || 'Не удалось выполнить графологическую сверку почерка.'
        );
      }

      setHandwritingResult({
        match: Boolean(data.match),
        confidence_score: Number(data.confidence_score ?? 0),
        reasoning: String(data.reasoning || ''),
        modelUsed: data.modelUsed,
        checkedAt: new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } catch (err: any) {
      setHandwritingError(
        err?.message || 'Ошибка при сравнении почерка на сервере.'
      );
    } finally {
      setIsVerifyingHandwriting(false);
    }
  };

  // Build candidate students with service-hosted or cached handwriting reference photos
  const candidateStudentsForIdentify = (() => {
    const seen = new Set<string>();
    const list: Array<{
      studentName: string;
      handwriting_reference_url?: string;
      referenceImageBase64?: string;
      referenceMimeType?: string;
    }> = [];

    const activeClassId = selectedClassObj?.id;
    const prioritizedRecords = [
      ...studentsRecords.filter(
        (s) => s.handwriting_reference_url && s.classId === activeClassId
      ),
      ...studentsRecords.filter(
        (s) => s.handwriting_reference_url && s.classId !== activeClassId
      ),
    ];

    for (const rec of prioritizedRecords) {
      const key = rec.studentName.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let localBackup: string | undefined;
      try {
        localBackup = localStorage.getItem(`tetrad_plus_hw_ref:${key}`) || undefined;
      } catch {
        localBackup = undefined;
      }
      list.push({
        studentName: rec.studentName.trim(),
        handwriting_reference_url: rec.handwriting_reference_url.trim(),
        ...(localBackup
          ? { referenceImageBase64: localBackup, referenceMimeType: 'image/jpeg' }
          : {}),
      });
    }

    for (const stuName of classStudents) {
      const key = stuName.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      try {
        const localSample = localStorage.getItem(`tetrad_plus_hw_ref:${key}`);
        if (localSample) {
          seen.add(key);
          list.push({
            studentName: stuName.trim(),
            referenceImageBase64: localSample,
            referenceMimeType: 'image/jpeg',
          });
        }
      } catch {
        // ignore localStorage read errors
      }
    }

    return list;
  })();

  const handleIdentifyStudentByHandwriting = async () => {
    setIdentificationError(null);
    setIdentificationResult(null);

    let activeBase64 = customImageBase64;
    if (isCameraActive) {
      const snapped = handleCaptureSnapshotFromCamera();
      if (snapped) activeBase64 = snapped;
    }

    if (
      (selectedSample === 'custom' || selectedSample === 'camera') &&
      !activeBase64
    ) {
      setIdentificationError(
        'Сначала сфотографируйте или загрузите фото тетради. После этого можно запустить распознавание автора, либо введите ФИО ученика вручную.'
      );
      studentNameInputRef.current?.focus();
      return;
    }

    if (candidateStudentsForIdentify.length === 0) {
      setIdentificationError(
        'Ни у одного ученика ещё не загружен эталон почерка в сервис. Загрузите фото эталона в Личном кабинете или в блоке «Сверка почерка» ниже.'
      );
      if (classStudents.length > 0) {
        studentSelectRef.current?.focus();
      } else {
        studentNameInputRef.current?.focus();
      }
      return;
    }

    setIsIdentifyingStudent(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/identify-student', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageBase64: activeBase64,
          mimeType: customMimeType,
          sampleId:
            selectedSample === 'math'
              ? 'math'
              : selectedSample === 'russian'
              ? 'russian'
              : 'custom',
          students: candidateStudentsForIdentify,
        }),
      });

      const data = await safeParseJsonResponse(response);
      if (response.status === 401 && onAuthExpired) {
        onAuthExpired();
      }
      if (!response.ok) {
        throw new Error(
          data?.error ||
            'Не удалось определить автора по почерку. Выберите или введите ученика вручную.'
        );
      }

      const result: StudentIdentificationResult = {
        identified: Boolean(data?.identified),
        studentName:
          typeof data?.studentName === 'string' && data.studentName.trim()
            ? data.studentName.trim()
            : null,
        confidencePercent: Number(data?.confidencePercent ?? 0),
        autoSelected: Boolean(data?.autoSelected),
        reasoning: String(data?.reasoning || ''),
        candidateScores: Array.isArray(data?.candidateScores)
          ? data.candidateScores
          : [],
        skippedReferences: Array.isArray(data?.skippedReferences)
          ? data.skippedReferences
          : [],
        modelUsed: data?.modelUsed,
      };

      setIdentificationResult(result);

      // Requirement 3: Auto-select in selectbox if confidence > 85%; otherwise ask teacher to select manually
      if (
        result.identified &&
        result.studentName &&
        result.confidencePercent > 85
      ) {
        const matchedName = result.studentName;
        const matchedClass = classes.find((c) =>
          (c.studentsList || '')
            .split('\n')
            .map((s) => s.trim().toLowerCase())
            .includes(matchedName.toLowerCase())
        );
        if (matchedClass && matchedClass.name !== classGroup) {
          setClassGroup(matchedClass.name);
        }
        setStudentName(matchedName);
      } else if (!result.identified) {
        studentNameInputRef.current?.focus();
      } else {
        // <= 85% confidence: prompt manual selection in selectbox
        studentSelectRef.current?.focus();
      }
    } catch (err: any) {
      setIdentificationError(
        err?.message ||
          'Почерк не опознан из-за ошибки сервиса распознавания. Пожалуйста, выберите ученика из списка или введите ФИО вручную.'
      );
      studentNameInputRef.current?.focus();
    } finally {
      setIsIdentifyingStudent(false);
    }
  };

  const handleSaveToQueue = () => {
    if (!analysisResult) return;

    const cleanStudentName = studentName.trim();
    if (!cleanStudentName) {
      setErrorMsg('Укажите фамилию и имя ученика перед сохранением тетради.');
      return;
    }

    const cleanClassGroup = classGroup.trim() || 'Мой класс';

    const isFirstGrade =
      selectedClassObj?.gradeLevel === 1 || cleanClassGroup.startsWith('1');
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
      studentName: cleanStudentName,
      classGroup: cleanClassGroup,
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
      handwritingVerification: handwritingResult || undefined,
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
                  {classes.length > 0 ? (
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
                  ) : (
                    <input
                      id="modal-class-group"
                      type="text"
                      value={classGroup}
                      onChange={(e) => setClassGroup(e.target.value)}
                      placeholder="Например: 2 «А» класс"
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  )}
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
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label
                    htmlFor="modal-student-name"
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Фамилия и имя ученика ({classGroup})
                  </label>
                  <button
                    type="button"
                    onClick={handleIdentifyStudentByHandwriting}
                    disabled={isIdentifyingStudent}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-md transition-colors cursor-pointer"
                  >
                    {isIdentifyingStudent ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Определяем автора...</span>
                      </>
                    ) : (
                      <>
                        <UserSearch className="w-3 h-3" />
                        <span>Определить автора по почерку</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={studentNameInputRef}
                    id="modal-student-name"
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Введите или выберите ученика..."
                    className={`flex-1 px-3 py-1.5 text-xs border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-600 ${
                      identificationError ||
                      (identificationResult &&
                        (!identificationResult.identified ||
                          identificationResult.confidencePercent <= 85))
                        ? 'border-amber-400 ring-1 ring-amber-300'
                        : 'border-slate-300'
                    }`}
                  />
                  {classStudents.length > 0 && (
                    <select
                      ref={studentSelectRef}
                      aria-label="Выбрать ученика из списка класса"
                      value={
                        classStudents.includes(studentName) ? studentName : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) setStudentName(e.target.value);
                      }}
                      className={`px-2.5 py-1.5 text-xs border rounded-lg bg-white text-slate-700 ${
                        identificationResult &&
                        identificationResult.identified &&
                        identificationResult.confidencePercent <= 85
                          ? 'border-amber-500 ring-2 ring-amber-300'
                          : 'border-slate-300'
                      }`}
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

                {/* Recognized Student Preview & Confidence Handling (>85% auto-select / <=85% manual / Error fallback) */}
                {identificationResult && (
                  <div
                    className={`mt-2.5 p-2.5 rounded-lg border text-xs space-y-1.5 ${
                      identificationResult.identified &&
                      identificationResult.confidencePercent > 85
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : identificationResult.identified
                        ? 'bg-amber-50 border-amber-300 text-amber-950'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {(() => {
                          const targetLower = (
                            identificationResult.studentName || ''
                          ).toLowerCase();
                          const matchedRef = studentsRecords.find(
                            (r) => r.studentName.trim().toLowerCase() === targetLower
                          );
                          let localThumb: string | null = null;
                          try {
                            if (targetLower) {
                              localThumb = localStorage.getItem(
                                `tetrad_plus_hw_ref:${targetLower}`
                              );
                            }
                          } catch {
                            localThumb = null;
                          }
                          return matchedRef?.handwriting_reference_url || localThumb ? (
                            <ServiceReferenceImage
                              src={matchedRef?.handwriting_reference_url || localThumb}
                              fallbackSrc={localThumb}
                              authToken={authToken}
                              alt={`Эталон почерка ${matchedRef?.studentName || identificationResult.studentName || ''}`}
                              className="w-9 h-9 rounded object-cover border border-white shadow-2xs shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded bg-white/80 border border-slate-200 flex items-center justify-center shrink-0">
                              <UserCheck className="w-4 h-4 text-slate-600" />
                            </div>
                          );
                        })()}
                        <div className="min-w-0">
                          {identificationResult.identified &&
                          identificationResult.confidencePercent > 85 ? (
                            <div className="font-semibold text-emerald-900 truncate">
                              Распознан ученик: {identificationResult.studentName}
                            </div>
                          ) : identificationResult.identified ? (
                            <div className="font-semibold text-amber-950 truncate">
                              Вероятный автор: {identificationResult.studentName} — выберите вручную
                            </div>
                          ) : (
                            <div className="font-semibold text-red-900">
                              Почерк не опознан — укажите ученика вручную
                            </div>
                          )}
                          <div className="text-[11px] opacity-85">
                            {identificationResult.identified
                              ? identificationResult.confidencePercent > 85
                                ? `Уверенность ${identificationResult.confidencePercent}% (> 85%) — ученик выбран автоматически`
                                : `Уверенность ${identificationResult.confidencePercent}% (ниже 85%) — подтвердите ученика в выпадающем списке`
                              : 'Укажите ФИО ученика вручную в поле выше или выберите из списка.'}
                          </div>
                        </div>
                      </div>

                      {identificationResult.identified && (
                        <span
                          className={`font-mono-tabular font-bold text-xs px-2 py-0.5 rounded shrink-0 ${
                            identificationResult.confidencePercent > 85
                              ? 'bg-emerald-600 text-white'
                              : 'bg-amber-200 text-amber-950'
                          }`}
                        >
                          {identificationResult.confidencePercent}%
                        </span>
                      )}
                    </div>

                    {identificationResult.reasoning && (
                      <p className="text-[11px] leading-snug opacity-90">
                        {identificationResult.reasoning}
                      </p>
                    )}

                    {identificationResult.identified &&
                      identificationResult.confidencePercent <= 85 &&
                      identificationResult.studentName && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] font-medium">
                            Пожалуйста, выберите ученика в списке вручную.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (identificationResult.studentName) {
                                setStudentName(identificationResult.studentName);
                              }
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold bg-amber-900 text-white rounded hover:bg-amber-800 cursor-pointer"
                          >
                            Выбрать «{identificationResult.studentName}»
                          </button>
                        </div>
                      )}
                  </div>
                )}

                {identificationError && (
                  <div className="mt-2.5 p-2.5 rounded-lg border border-red-200 bg-red-50 text-red-900 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold">
                        Не удалось автоматически опознать автора
                      </div>
                      <p className="text-[11px] leading-snug">
                        {identificationError}
                      </p>
                    </div>
                  </div>
                )}
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

            {/* Optional Graphological Handwriting Verification (Reference vs Current Photo) */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setShowHandwritingVerifier(!showHandwritingVerifier)
                  }
                  className="flex items-center gap-2 text-xs font-semibold text-slate-800 hover:text-red-700 transition-colors cursor-pointer"
                >
                  <Fingerprint className="w-4 h-4 text-red-600 shrink-0" />
                  <span>
                    Сверка почерка с эталоном ученика (графология)
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setShowHandwritingVerifier(!showHandwritingVerifier)
                  }
                  className="text-[11px] font-medium text-sky-700 hover:underline cursor-pointer"
                >
                  {showHandwritingVerifier
                    ? 'Скрыть'
                    : referenceImageBase64
                    ? 'Эталон загружен'
                    : 'Открыть'}
                </button>
              </div>

              {(showHandwritingVerifier || referenceImageBase64 || handwritingResult) && (
                <div className="space-y-2.5 pt-1 border-t border-slate-200">
                  <p className="text-[11px] text-slate-600">
                    Загрузите <strong>Изображение №1 (эталон)</strong> — страницу
                    тетради, достоверно написанную учеником{' '}
                    <strong>{studentName || 'учеником'}</strong>. Система сравнит
                    наклон, нажим, написание букв («а», «т», «д») и интервалы с
                    текущей работой.
                  </p>

                  <input
                    ref={referenceFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleReferenceFileUpload}
                    className="hidden"
                    aria-label="Загрузить эталонное фото почерка ученика"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {referenceImageBase64 ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0 p-1.5 bg-white border border-slate-200 rounded-lg">
                        <img
                          src={referenceImageBase64}
                          alt="Эталон почерка ученика"
                          className="w-10 h-10 rounded object-cover border border-slate-200 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold text-slate-800 truncate">
                            Эталон: {studentName || 'Ученик'}
                          </div>
                          <div className="text-[10px] text-emerald-700">
                            {isUploadingReferencePhoto
                              ? 'Сохраняем эталон в сервис...'
                              : 'Сохранено в сервисе · готово к сверке'}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isUploadingReferencePhoto}
                          onClick={() => referenceFileInputRef.current?.click()}
                          className="text-[11px] text-sky-700 hover:underline px-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          Заменить
                        </button>
                        <button
                          type="button"
                          disabled={isUploadingReferencePhoto}
                          onClick={handleClearReferencePhoto}
                          aria-label="Удалить эталон почерка"
                          className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isUploadingReferencePhoto}
                        onClick={() => referenceFileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {isUploadingReferencePhoto ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                        ) : (
                          <Upload className="w-3.5 h-3.5 text-sky-600" />
                        )}
                        <span>
                          {isUploadingReferencePhoto
                            ? 'Сохраняем эталон...'
                            : 'Загрузить эталон в сервис (Фото №1)'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleVerifyHandwriting}
                      disabled={isVerifyingHandwriting || !referenceImageBase64}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      {isVerifyingHandwriting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Сверяем...</span>
                        </>
                      ) : (
                        <>
                          <Fingerprint className="w-3.5 h-3.5" />
                          <span>Сверить почерк</span>
                        </>
                      )}
                    </button>
                  </div>

                  {handwritingError && (
                    <div className="p-2.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <span>{handwritingError}</span>
                    </div>
                  )}
                </div>
              )}
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
          <div className="lg:col-span-6 flex flex-col justify-between border border-slate-200 rounded-xl p-4 bg-slate-50/60 space-y-3">
            {handwritingResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                  handwritingResult.match
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-200 text-red-950'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold">
                    {handwritingResult.match ? (
                      <>
                        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Почерк совпадает с эталоном ученика</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                        <span>Почерк отличается от эталона</span>
                      </>
                    )}
                  </div>
                  <span className="font-mono-tabular font-bold">
                    Уверенность: {Math.round(handwritingResult.confidence_score * 100)}%
                  </span>
                </div>
                <p className="leading-relaxed opacity-90">
                  {handwritingResult.reasoning}
                </p>
              </div>
            )}

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
