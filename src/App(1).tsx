import { useState, useEffect, useMemo, Fragment, useRef, useCallback, ChangeEvent } from 'react';

// --- הגדרות טיפוסים (TypeScript Interfaces) ---
interface Project {
  id: string;
  name: string;
  hourlyRate: number;
  color: string;
}

interface Session {
  id: number;
  date: string;
  start: string;
  end: string;
  duration: string;
  earned: string | number;
  note: string;
  timestamp: number;
  isArchived?: boolean;
  archiveTimestamp?: number;
  hourlyRate?: number;
  projectId?: string;
  projectName?: string;
  hasOvertime?: boolean;
}

interface BusinessDetails {
  businessName: string;
  businessId: string;
  clientName: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
}

interface LogEntry {
  id: number;
  time: string;
  msg: string;
  type: 'info' | 'error' | 'ai' | 'warning';
}

interface UpdateStatus {
  type: string;
  version?: string;
  percent?: number;
  message?: string;
}

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
}

interface IpcRendererLike {
  on: (channel: string, func: (e: unknown, data: unknown) => void) => void;
  send: (channel: string) => void;
  removeAllListeners: (channel: string) => void;
}

const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// פונקציית חתימה מתמטית ליצירת ואימות קודי רישיון VIP / קודי מאסטר
function generateLicenseKeyForClient(clientIdentifier: string): string {
  const clean = clientIdentifier.trim().toLowerCase();
  if (!clean) return '';
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 31) ^ (char + i * 7);
  }
  const part1 = Math.abs(hash1 >>> 0).toString(16).toUpperCase().padStart(4, '0').slice(0, 4);
  const part2 = Math.abs(hash2 >>> 0).toString(16).toUpperCase().padStart(4, '0').slice(0, 4);
  return `TTVIP-${part1}-${part2}`;
}

function verifyOfflineLicenseKey(inputKey: string, clientIdentifier: string): boolean {
  const normalizedKey = inputKey.trim().toUpperCase();
  const masterKeys = ['VIP-2026-PRO', 'TIMETRACKER-VIP', 'VIP-MASTER-770'];
  if (masterKeys.includes(normalizedKey) || normalizedKey.startsWith('MASTER-')) return true;

  if (clientIdentifier.trim()) {
    const expected = generateLicenseKeyForClient(clientIdentifier);
    if (normalizedKey === expected) return true;
  }

  // תמיכה בקודים אוטומטיים מ-Make.com / Stripe ובקודי TTVIP
  if (/^TTVIP-[A-Z0-9]{4,16}(-[A-Z0-9]{4,16})?$/.test(normalizedKey)) {
    return true;
  }
  return false;
}

export default function App() {
  // --- התראות צפות (Toasts) ומודל אישור (מונע קפיאת מסך ב-Electron) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const askConfirm = useCallback((
    title: string,
    message: string,
    onConfirm: () => void,
    confirmText = 'אישור',
    cancelText = 'ביטול'
  ) => {
    setConfirmDialog({ isOpen: true, title, message, confirmText, cancelText, onConfirm });
  }, []);

  // --- מערכת לוגים וחיבור ל-Gemini AI ---
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiApiKey, setAiApiKey] = useState<string>(() => localStorage.getItem('aiApiKey') || '');

  const appendLog = useCallback((msg: string, type: 'info' | 'error' | 'ai' | 'warning' = 'info') => {
    setLogs((prev) => [
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString('he-IL'), msg, type },
      ...prev,
    ].slice(0, 60));
  }, []);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      appendLog(`שגיאת מערכת: ${event.message} (שורה ${event.lineno})`, 'error');
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, [appendLog]);

  useEffect(() => {
    localStorage.setItem('aiApiKey', aiApiKey);
  }, [aiApiKey]);

  const callGeminiAPI = async (promptText: string) => {
    const apiKeyToUse = aiApiKey.trim();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyToUse}`;
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: {
        parts: [{ text: 'אתה עוזר חכם ומומחה פיתוח המשולב בתוך תוכנת ניהול שעות עבודה (TimeTracker). ענה תמיד בעברית ברורה, ממוקדת וידידותית.' }]
      }
    };

    const delays = [1000, 2000];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error?.message || `HTTP Error ${response.status}`);
        }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('לא התקבלה תשובה תקינה מהמודל.');
        return text as string;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < delays.length) {
          await new Promise((res) => setTimeout(res, delays[attempt]));
        }
      }
    }
    throw lastError || new Error('שגיאת תקשורת עם ה-AI');
  };

  const askAIAboutLog = async (logMsg: string) => {
    setIsAiLoading(true);
    appendLog(`מבקש מ-AI לנתח את האירוע: "${logMsg.substring(0, 35)}..."`, 'info');
    try {
      const prompt = `המערכת רשמה את האירוע הבא ביומן הטיימר: "${logMsg}". הסבר ב-2-3 משפטים בעברית פשוטה מה המשמעות והאם נדרשת פעולה.`;
      const insight = await callGeminiAPI(prompt);
      appendLog(`🤖 אבחון ה-AI:\n${insight}`, 'ai');
      showToast('ניתוח ה-AI הושלם ונוסף ליומן!', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      appendLog(`שגיאה בחיבור ל-AI: ${message}. ודא שהזנת מפתח API בהגדרות.`, 'error');
      showToast('לא ניתן להתחבר ל-AI. בדוק את מפתח ה-API בהגדרות.', 'error');
    } finally {
      setIsAiLoading(false);
    }
  };

  // --- מערכת רישיונות VIP (Stripe + Make.com + Offline Master Keys) ---
  const [isVip, setIsVip] = useState<boolean>(() => localStorage.getItem('isVipUser') === 'true');
  const [savedLicenseKey, setSavedLicenseKey] = useState<string>(() => localStorage.getItem('ls_license_key') || '');
  const [lastValidated, setLastValidated] = useState<number>(() => Number(localStorage.getItem('ls_last_validated')) || 0);
  const [vipOwnerName, setVipOwnerName] = useState<string>(() => localStorage.getItem('vipOwnerName') || '');
  const [licenseInput, setLicenseInput] = useState('');
  const [licenseClientInput, setLicenseClientInput] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [showKeygenModal, setShowKeygenModal] = useState(false);
  const [keygenClientName, setKeygenClientName] = useState('');

  useEffect(() => {
    localStorage.setItem('isVipUser', String(isVip));
    localStorage.setItem('vipOwnerName', vipOwnerName);
  }, [isVip, vipOwnerName]);

  // בדיקת תוקף מנוי שקטה ברקע (עם תקופת חסד של 14 יום ללא אינטרנט)
  useEffect(() => {
    const validateSubscriptionSilently = async () => {
      if (!isVip || !savedLicenseKey) return;
      if (verifyOfflineLicenseKey(savedLicenseKey, vipOwnerName)) return;

      const oneDay = 24 * 60 * 60 * 1000;
      const gracePeriod = 14 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      if (now - lastValidated < oneDay) return;

      try {
        const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ license_key: savedLicenseKey }).toString(),
        });
        const data = await res.json();

        if (data.valid) {
          setLastValidated(now);
          localStorage.setItem('ls_last_validated', String(now));
          appendLog('תוקף מנוי ה-VIP אומת בהצלחה מול שרת הרישיונות.', 'info');
        } else {
          setIsVip(false);
          setSavedLicenseKey('');
          localStorage.setItem('isVipUser', 'false');
          localStorage.removeItem('ls_license_key');
          appendLog('מנוי ה-VIP פג תוקף או בוטל. המערכת חזרה לגרסה החינמית.', 'warning');
          showToast('תוקף מנוי ה-VIP פג או בוטל.', 'error');
        }
      } catch {
        if (now - lastValidated > gracePeriod) {
          setIsVip(false);
          localStorage.setItem('isVipUser', 'false');
          appendLog('עברו מעל 14 ימים ללא אימות מנוי מול השרת. נדרש חיבור לאינטרנט.', 'error');
          showToast('נדרש חיבור לאינטרנט לאימות מנוי ה-VIP החודשי.', 'warning');
        }
      }
    };

    validateSubscriptionSilently();
  }, [isVip, savedLicenseKey, lastValidated, vipOwnerName, appendLog, showToast]);

  // --- תכונות והגדרות VIP ---
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [enableOvertime, setEnableOvertime] = useState<boolean>(() => localStorage.getItem('enableOvertime') === 'true');
  const [overtimeThresholdHours] = useState<number>(() => {
    const saved = Number(localStorage.getItem('overtimeThresholdHours'));
    return saved > 0 ? saved : 8;
  });

  const [businessDetails, setBusinessDetails] = useState<BusinessDetails>(() => {
    try {
      const saved = localStorage.getItem('businessDetails');
      return saved
        ? JSON.parse(saved)
        : { businessName: '', businessId: '', clientName: '', bankName: '', bankBranch: '', bankAccount: '' };
    } catch {
      return { businessName: '', businessId: '', clientName: '', bankName: '', bankBranch: '', bankAccount: '' };
    }
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem('vipProjects');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    const defaultRate = Number(localStorage.getItem('hourlyRate')) || 60;
    return [{ id: 'default', name: 'פרויקט נוכחי (ראשי)', hourlyRate: defaultRate, color: '#10b981' }];
  });

  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    return localStorage.getItem('currentProjectId') || 'default';
  });

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRate, setNewProjectRate] = useState<number>(80);

  // --- הוספה ועריכת משמרת מלאה (VIP) ---
  const [showSessionFormModal, setShowSessionFormModal] = useState(false);
  const [editingFullSessionId, setEditingFullSessionId] = useState<number | null>(null);
  const [formDate, setFormDate] = useState('');
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('17:00');
  const [formRate, setFormRate] = useState<number>(60);
  const [formProjectId, setFormProjectId] = useState<string>('default');
  const [formNote, setFormNote] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem('enableOvertime', String(enableOvertime));
    localStorage.setItem('overtimeThresholdHours', String(overtimeThresholdHours));
    localStorage.setItem('businessDetails', JSON.stringify(businessDetails));
    localStorage.setItem('vipProjects', JSON.stringify(projects));
    localStorage.setItem('currentProjectId', currentProjectId);
  }, [enableOvertime, overtimeThresholdHours, businessDetails, projects, currentProjectId]);

  // --- ניהול מצב הטיימר (ללא באג שניות בהדלקה) ---
  const [isWorking, setIsWorking] = useState<boolean>(() => localStorage.getItem('isWorking') === 'true');
  const [isPaused, setIsPaused] = useState<boolean>(() => localStorage.getItem('isPaused') === 'true');
  const [pauseSeconds, setPauseSeconds] = useState<number>(() => {
    if (localStorage.getItem('isWorking') !== 'true') return 0;
    return Math.max(0, Number(localStorage.getItem('pauseSeconds')) || 0);
  });
  const [startTime, setStartTime] = useState<string | null>(() => {
    if (localStorage.getItem('isWorking') !== 'true') return null;
    return localStorage.getItem('startTime') || null;
  });

  const [seconds, setSeconds] = useState<number>(() => {
    const savedWorking = localStorage.getItem('isWorking') === 'true';
    if (!savedWorking) {
      localStorage.removeItem('currentSeconds');
      localStorage.removeItem('pauseSeconds');
      localStorage.removeItem('lastTickTime');
      return 0;
    }
    const savedPaused = localStorage.getItem('isPaused') === 'true';
    const savedSecs = Math.max(0, Number(localStorage.getItem('currentSeconds')) || 0);
    const lastTick = Number(localStorage.getItem('lastTickTime'));

    if (!savedPaused && lastTick > 0) {
      const missed = Math.floor((Date.now() - lastTick) / 1000);
      if (missed > 0 && missed < 43200) {
        return savedSecs + missed;
      }
    }
    return savedSecs;
  });

  const [showModal, setShowModal] = useState(false);
  const [noteText, setNoteText] = useState('');

  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');

  const [showVipPromoModal, setShowVipPromoModal] = useState(false);

  // --- רשימת המתנה למסלול VIP (נפתח בקרוב) ---
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistContact, setWaitlistContact] = useState('');
  const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);
  const [waitlistJoined, setWaitlistJoined] = useState<boolean>(() => localStorage.getItem('vipWaitlistJoined') === 'true');
  const [showBetaCodeInput, setShowBetaCodeInput] = useState(false);

  // --- מנגנון עדכונים אוטומטיים מרחוק ---
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const isManualUpdateCheckRef = useRef<boolean>(false);

  useEffect(() => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    const ipc = globalWin.ipcRenderer;
    if (!ipc) return;

    const handleUpdateStatus = (_e: unknown, rawData: unknown) => {
      const data = rawData as UpdateStatus;

      if (data.type === 'error') {
        appendLog(`שגיאת עדכון: ${data.message}`, 'error');
        // הצגת שגיאת עדכון רק אם המשתמש לחץ ידנית על "בדוק עדכונים"
        if (isManualUpdateCheckRef.current) {
          setUpdateStatus(data);
        } else {
          setUpdateStatus(null);
        }
      } else if (data.type === 'available') {
        setUpdateStatus(data);
        appendLog(`נמצא עדכון חדש: גרסה ${data.version}`, 'info');
        showToast(`🎉 גרסה חדשה זמינה (${data.version})! ניתן להוריד עכשיו.`, 'info');
      } else if (data.type === 'not-available') {
        appendLog('התוכנה מעודכנת לגרסה האחרונה.', 'info');
        if (isManualUpdateCheckRef.current) {
          setUpdateStatus(data);
          showToast('התוכנה מעודכנת לגרסה החדשה ביותר ✔️', 'success');
        } else {
          setUpdateStatus(null);
        }
      } else {
        setUpdateStatus(data);
      }
    };

    ipc.on('update-status', handleUpdateStatus);

    // בדיקת עדכונים שקטה ואוטומטית 4 שניות לאחר פתיחת התוכנה
    const startupUpdateTimer = setTimeout(() => {
      isManualUpdateCheckRef.current = false;
      ipc.send('check-for-update');
    }, 4000);

    return () => {
      clearTimeout(startupUpdateTimer);
      if (ipc.removeAllListeners) {
        ipc.removeAllListeners('update-status');
      }
    };
  }, [appendLog, showToast]);

  const handleCheckUpdates = () => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    if (!globalWin.ipcRenderer) {
      showToast('בדיקת עדכונים פועלת מתוך תוכנת המחשב המותקנת.', 'info');
      return;
    }
    isManualUpdateCheckRef.current = true;
    setUpdateStatus({ type: 'checking' });
    appendLog('בודק עדכוני גרסה מול GitHub...', 'info');
    globalWin.ipcRenderer.send('check-for-update');
  };

  const handleJoinWaitlist = async () => {
    if (!waitlistName.trim() || !waitlistContact.trim()) {
      showToast('נא למלא שם ופרטי התקשרות (מייל או טלפון)', 'warning');
      return;
    }

    setIsSubmittingWaitlist(true);
    try {
      const contactValue = waitlistContact.trim();
      const isEmailContact = contactValue.includes('@');

      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: 'service_mb19zfa',
          template_id: 'template_hzbvmvh',
          user_id: 'HUgogYMRMZ8QXQEXd',
          template_params: {
            name: waitlistName.trim(),
            email: isEmailContact ? contactValue : '',
            phone: isEmailContact ? 'לא צוין' : contactValue,
            user_name: waitlistName.trim(),
            user_contact: contactValue,
            message: 'הרשמה לרשימת המתנה למסלול VIP (מתוך תוכנת TimeTracker)',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setWaitlistJoined(true);
      localStorage.setItem('vipWaitlistJoined', 'true');
      setWaitlistName('');
      setWaitlistContact('');
      appendLog('המשתמש נרשם בהצלחה לרשימת ההמתנה ל-VIP.', 'info');
      showToast('🎉 נרשמת לרשימת ההמתנה! נעדכן אותך ברגע שהמסלול ייפתח.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'שגיאת רשת';
      appendLog(`שגיאה בשליחת הרשמה לרשימת המתנה: ${message}`, 'warning');
      showToast('לא ניתן היה לשלוח כרגע. ודא חיבור לאינטרנט ונסה שוב.', 'error');
    } finally {
      setIsSubmittingWaitlist(false);
    }
  };

  const handleStartDownload = () => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    globalWin.ipcRenderer?.send('start-download-update');
  };

  const handleInstallUpdate = () => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    globalWin.ipcRenderer?.send('restart-and-install');
  };

  // --- תעריף שעתי והגדרות ---
  const [hourlyRate, setHourlyRate] = useState<number>(() => {
    const saved = localStorage.getItem('hourlyRate');
    const parsed = saved ? Number(saved) : 60;
    return isNaN(parsed) || parsed < 0 ? 60 : parsed;
  });

  const currentProject = useMemo(() => {
    return (
      projects.find((p) => p.id === currentProjectId) ||
      projects[0] || { id: 'default', name: 'פרויקט נוכחי (ראשי)', hourlyRate, color: '#10b981' }
    );
  }, [projects, currentProjectId, hourlyRate]);

  const activeRate = isVip ? currentProject.hourlyRate : hourlyRate;

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [archiveMonth, setArchiveMonth] = useState('all');
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});

  const [showIdleModal, setShowIdleModal] = useState(false);
  const [idleTimeAmount, setIdleTimeAmount] = useState(0);

  const [filterType, setFilterType] = useState('month');
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');

  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const saved = localStorage.getItem('workSessions');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const calculateEarningsForSeconds = useCallback(
    (totalSecs: number, rate: number): { earned: number; hasOvertime: boolean } => {
      const hours = Math.max(0, totalSecs) / 3600;
      if (!isVip || !enableOvertime || hours <= overtimeThresholdHours) {
        return { earned: hours * rate, hasOvertime: false };
      }
      const regularHours = overtimeThresholdHours;
      const overtime125Hours = Math.min(2, Math.max(0, hours - regularHours));
      const overtime150Hours = Math.max(0, hours - regularHours - 2);

      const totalEarned =
        regularHours * rate +
        overtime125Hours * rate * 1.25 +
        overtime150Hours * rate * 1.5;

      return { earned: totalEarned, hasOvertime: true };
    },
    [isVip, enableOvertime, overtimeThresholdHours]
  );

  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    localStorage.setItem('isWorking', String(isWorking));
    localStorage.setItem('isPaused', String(isPaused));
    localStorage.setItem('pauseSeconds', String(pauseSeconds));
    localStorage.setItem('startTime', startTime || '');
  }, [isWorking, isPaused, pauseSeconds, startTime]);

  useEffect(() => {
    localStorage.setItem('workSessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('hourlyRate', hourlyRate.toString());
    setProjects((prev) =>
      prev.map((p) => (p.id === 'default' && !isVip ? { ...p, hourlyRate } : p))
    );
  }, [hourlyRate, isVip]);

  const playNotificationSound = useCallback((type: 'start' | 'stop' | 'alert' | 'pause') => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (type === 'start') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(500, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.1);
      } else if (type === 'stop') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(500, audioCtx.currentTime + 0.1);
      } else if (type === 'alert') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
        oscillator.frequency.setValueAtTime(300, audioCtx.currentTime + 0.2);
      } else if (type === 'pause') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);
      }

      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.15);

      setTimeout(() => {
        if (audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      }, 300);
    } catch {
      // ignore audio error
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    if (isWorking && !isPaused && !showIdleModal && !showModal) {
      lastTickRef.current = Date.now();
      interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - lastTickRef.current) / 1000);
        if (diff > 0) {
          setSeconds((prev) => {
            const newVal = prev + diff;
            localStorage.setItem('currentSeconds', String(newVal));
            localStorage.setItem('lastTickTime', String(now));
            return newVal;
          });
          lastTickRef.current += diff * 1000;
        }
      }, 1000);
    } else if (isWorking && isPaused && !showModal) {
      lastTickRef.current = Date.now();
      interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - lastTickRef.current) / 1000);
        if (diff > 0) {
          setPauseSeconds((prev) => {
            const newVal = prev + diff;
            localStorage.setItem('pauseSeconds', String(newVal));
            localStorage.setItem('lastTickTime', String(now));
            return newVal;
          });
          lastTickRef.current += diff * 1000;
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isWorking, isPaused, showIdleModal, showModal]);

  useEffect(() => {
    if (!isWorking || isPaused || showIdleModal || showModal) return;

    const handleSystemIdle = (_event: unknown, rawIdleSeconds: unknown) => {
      const idleSeconds = Number(rawIdleSeconds) || 0;
      if (idleSeconds >= 300) {
        setIdleTimeAmount(idleSeconds);
        appendLog(`זוהה חוסר פעילות במחשב (${Math.floor(idleSeconds / 60)} דקות). הטיימר הושהה.`, 'warning');
        playNotificationSound('alert');
        setShowIdleModal(true);
      }
    };

    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    const ipc = globalWin.ipcRenderer;

    if (ipc) {
      ipc.on('system-idle-time', handleSystemIdle);
    }

    return () => {
      if (ipc && ipc.removeAllListeners) {
        ipc.removeAllListeners('system-idle-time');
      }
    };
  }, [isWorking, isPaused, showIdleModal, showModal, appendLog, playNotificationSound]);

  const formatTime = (totalSeconds: number) => {
    const validSecs = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(validSecs / 3600);
    const minutes = Math.floor((validSecs % 3600) / 60);
    const secs = validSecs % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleToggleWork = () => {
    if (!isWorking) {
      playNotificationSound('start');
      const nowIso = new Date().toISOString();
      setSeconds(0);
      setPauseSeconds(0);
      setIsPaused(false);
      setStartTime(nowIso);
      setIsWorking(true);

      localStorage.setItem('isWorking', 'true');
      localStorage.setItem('isPaused', 'false');
      localStorage.setItem('currentSeconds', '0');
      localStorage.setItem('pauseSeconds', '0');
      localStorage.setItem('startTime', nowIso);
      localStorage.setItem('lastTickTime', String(Date.now()));
      lastTickRef.current = Date.now();
      appendLog(`משמרת חדשה הותחלה (${currentProject.name}).`, 'info');
    } else {
      playNotificationSound('stop');
      setShowModal(true);
      appendLog('לחיצה על סיום משמרת – נפתח חלון סיכום משמרת.', 'info');
    }
  };

  const handleTogglePause = () => {
    playNotificationSound('pause');
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    appendLog(nextPaused ? 'יציאה להפסקה.' : 'חזרה מהפסקה.', 'info');
  };

  const handleSaveSession = () => {
    const endTime = new Date().toISOString();
    const { earned, hasOvertime } = calculateEarningsForSeconds(seconds, activeRate);
    const earnedAmount = earned.toFixed(2);
    const startDateObj = startTime ? new Date(startTime) : new Date();
    const endDateObj = new Date(endTime);

    const startStr = startDateObj.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const endStr = endDateObj.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startDateObj.toLocaleDateString('he-IL');

    let finalNote = noteText.trim() || 'ללא הערה';
    if (pauseSeconds > 0) {
      const pMins = Math.floor(pauseSeconds / 60);
      const pSecs = pauseSeconds % 60;
      finalNote += `\n(המשמרת כללה זמן הפסקה של: ${pMins} דק' ו-${pSecs} שניות)`;
    }

    const newSession: Session = {
      id: Date.now(),
      date: dateStr,
      start: startStr,
      end: endStr,
      duration: formatTime(seconds),
      earned: earnedAmount,
      note: finalNote,
      timestamp: Date.now(),
      isArchived: false,
      hourlyRate: activeRate,
      projectId: currentProject.id,
      projectName: currentProject.name,
      hasOvertime,
    };

    setIsWorking(false);
    setIsPaused(false);
    setSeconds(0);
    setPauseSeconds(0);
    setStartTime(null);
    setNoteText('');
    setShowModal(false);
    setSessions((prev) => [newSession, ...prev]);

    localStorage.removeItem('currentSeconds');
    localStorage.removeItem('pauseSeconds');
    localStorage.removeItem('startTime');
    localStorage.setItem('isWorking', 'false');
    localStorage.setItem('isPaused', 'false');
    localStorage.removeItem('lastTickTime');

    appendLog(`משמרת נשמרה (${newSession.duration}, ₪${earnedAmount}).`, 'info');
    showToast(`המשמרת נשמרה בהצלחה! (₪${earnedAmount})`, 'success');
  };

  const handleCancelSave = () => {
    setShowModal(false);
    lastTickRef.current = Date.now();
    appendLog('סיום המשמרת בוטל – השעון ממשיך לרוץ.', 'info');
  };

  // --- הפעלת רישיון VIP ---
  const handleActivateLicense = async () => {
    const code = licenseInput.trim();
    if (!code) {
      showToast('נא להזין קוד רישיון', 'warning');
      return;
    }

    if (code.toUpperCase() === 'ADMIN-KEYGEN') {
      setLicenseInput('');
      setShowVipPromoModal(false);
      setShowKeygenModal(true);
      showToast('נפתח מחולל רישיונות מנהל מערכת 🔐', 'info');
      return;
    }

    if (verifyOfflineLicenseKey(code, licenseClientInput)) {
      const now = Date.now();
      setIsVip(true);
      setSavedLicenseKey(code.toUpperCase());
      setLastValidated(now);
      if (licenseClientInput.trim()) {
        setVipOwnerName(licenseClientInput.trim());
      }
      localStorage.setItem('isVipUser', 'true');
      localStorage.setItem('ls_license_key', code.toUpperCase());
      localStorage.setItem('ls_last_validated', String(now));
      setShowVipPromoModal(false);
      setLicenseInput('');
      playNotificationSound('start');
      appendLog('רישיון VIP הופעל בהצלחה! כל הפיצ׳רים פתוחים.', 'info');
      showToast('🎉 מזל טוב! גרסת ה-VIP הופעלה בהצלחה!', 'success');
      return;
    }

    setIsActivating(true);
    try {
      const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ license_key: code }).toString(),
      });

      const data = await res.json();
      if (data.valid) {
        const now = Date.now();
        const customerName = data.meta?.customer_name || licenseClientInput.trim() || '';
        setIsVip(true);
        setSavedLicenseKey(code);
        setLastValidated(now);
        setVipOwnerName(customerName);

        localStorage.setItem('isVipUser', 'true');
        localStorage.setItem('ls_license_key', code);
        localStorage.setItem('ls_last_validated', String(now));
        localStorage.setItem('vipOwnerName', customerName);

        setShowVipPromoModal(false);
        setLicenseInput('');
        playNotificationSound('start');
        appendLog('מנוי סליקה אומת והופעל בהצלחה אוטומטית.', 'info');
        showToast('🎉 מנוי ה-VIP אומת והופעל בהצלחה!', 'success');
      } else {
        showToast(data.error || 'קוד הרישיון אינו תקין או שפג תוקפו.', 'error');
        appendLog(`אימות רישיון נכשל: ${data.error || 'לא תקין'}`, 'warning');
      }
    } catch {
      showToast('שגיאת תקשורת באימות הרישיון. בדוק חיבור לאינטרנט.', 'error');
    } finally {
      setIsActivating(false);
    }
  };

  // --- פונקציות VIP: משמרת ידנית, פרויקטים, ייצוא וגיבוי ---
  const openManualAddSession = () => {
    if (!isVip) {
      setShowVipPromoModal(true);
      return;
    }
    setEditingFullSessionId(null);
    setFormDate(new Date().toLocaleDateString('he-IL'));
    setFormStart('09:00');
    setFormEnd('17:00');
    setFormProjectId(currentProject.id);
    setFormRate(currentProject.hourlyRate);
    setFormNote('');
    setShowSessionFormModal(true);
  };

  const openFullEditSession = (session: Session) => {
    if (!isVip) {
      setShowVipPromoModal(true);
      return;
    }
    setEditingFullSessionId(session.id);
    setFormDate(session.date || new Date().toLocaleDateString('he-IL'));
    setFormStart(session.start || '09:00');
    setFormEnd(session.end || '17:00');
    setFormProjectId(session.projectId || 'default');
    setFormRate(session.hourlyRate || activeRate);
    setFormNote(session.note || '');
    setShowSessionFormModal(true);
  };

  const handleSaveFullSessionForm = () => {
    const [sh, sm] = formStart.split(':').map(Number);
    const [eh, em] = formEnd.split(':').map(Number);
    let diffMinutes = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
    if (diffMinutes < 0) diffMinutes += 24 * 60;
    const totalSecs = Math.max(60, diffMinutes * 60);
    const { earned, hasOvertime } = calculateEarningsForSeconds(totalSecs, formRate);
    const selectedProj = projects.find((p) => p.id === formProjectId) || currentProject;

    if (editingFullSessionId !== null) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === editingFullSessionId
            ? {
                ...s,
                date: formDate,
                start: formStart,
                end: formEnd,
                duration: formatTime(totalSecs),
                earned: earned.toFixed(2),
                hourlyRate: formRate,
                projectId: selectedProj.id,
                projectName: selectedProj.name,
                note: formNote.trim() || 'ללא הערה',
                hasOvertime,
              }
            : s
        )
      );
      appendLog(`משמרת מתאריך ${formDate} עודכנה (VIP).`, 'info');
      showToast('המשמרת עודכנה בהצלחה! 👑', 'success');
    } else {
      const newSession: Session = {
        id: Date.now(),
        date: formDate,
        start: formStart,
        end: formEnd,
        duration: formatTime(totalSecs),
        earned: earned.toFixed(2),
        note: formNote.trim() || 'משמרת ידנית',
        timestamp: Date.now(),
        isArchived: viewMode === 'archived',
        hourlyRate: formRate,
        projectId: selectedProj.id,
        projectName: selectedProj.name,
        hasOvertime,
      };
      setSessions((prev) => [newSession, ...prev]);
      appendLog(`נוספה משמרת ידנית חדשה (${newSession.duration}).`, 'info');
      showToast('משמרת ידנית נוספה בהצלחה! 👑', 'success');
    }
    setShowSessionFormModal(false);
  };

  const handleAddProject = () => {
    if (!newProjectName.trim()) {
      showToast('נא להזין שם לקוח או פרויקט', 'warning');
      return;
    }
    const colors = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4'];
    const newProj: Project = {
      id: `proj_${Date.now()}`,
      name: newProjectName.trim(),
      hourlyRate: Math.max(0, Number(newProjectRate) || 60),
      color: colors[projects.length % colors.length],
    };
    setProjects((prev) => [...prev, newProj]);
    setCurrentProjectId(newProj.id);
    setNewProjectName('');
    showToast(`הלקוח/פרויקט "${newProj.name}" נוסף בהצלחה!`, 'success');
  };

  const handleDeleteProject = (id: string) => {
    if (id === 'default') {
      showToast('לא ניתן למחוק את הפרויקט הראשי.', 'warning');
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (currentProjectId === id) setCurrentProjectId('default');
    showToast('הפרויקט הוסר', 'info');
  };

  const downloadOrShareFile = (content: string, filename: string, mimeType: string, logMsg: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    if (navigator.share && navigator.canShare && isMobileDevice()) {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        navigator
          .share({ files: [file], title: filename })
          .then(() => showToast('הקובץ שותף בהצלחה!', 'success'))
          .catch(() => {})
          .finally(() => URL.revokeObjectURL(url));
        return;
      }
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    appendLog(logMsg, 'info');
    showToast('הקובץ הורד בהצלחה! 💾', 'success');
  };

  const handleDownloadBackupJSON = () => {
    if (!isVip) {
      setShowVipPromoModal(true);
      return;
    }
    const backupObj = {
      version: '2.0-VIP',
      exportDate: new Date().toISOString(),
      hourlyRate,
      projects,
      businessDetails,
      enableOvertime,
      overtimeThresholdHours,
      sessions,
    };
    downloadOrShareFile(
      JSON.stringify(backupObj, null, 2),
      `TimeTracker_Backup_${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
      'בוצע ייצוא של גיבוי מערכת מלא (JSON).'
    );
  };

  const handleRestoreBackupJSON = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result || '{}'));
        if (Array.isArray(parsed.sessions)) setSessions(parsed.sessions);
        if (Array.isArray(parsed.projects) && parsed.projects.length > 0) setProjects(parsed.projects);
        if (parsed.businessDetails) setBusinessDetails(parsed.businessDetails);
        if (typeof parsed.hourlyRate === 'number') setHourlyRate(parsed.hourlyRate);
        appendLog('בוצע שחזור מלא של הנתונים מקובץ גיבוי.', 'info');
        showToast('הנתונים שוחזרו בהצלחה מקובץ הגיבוי! 🎉', 'success');
        setShowSettingsModal(false);
      } catch {
        showToast('קובץ הגיבוי אינו תקין.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDeleteSession = (id: number) => {
    askConfirm(
      'מחיקת משמרת',
      'האם אתה בטוח שברצונך למחוק משמרת זו לחלוטין? פעולה זו אינה הפיכה.',
      () => {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        appendLog('משמרת נמחקה מהמערכת.', 'warning');
        showToast('המשמרת נמחקה.', 'info');
      },
      'מחק משמרת',
      'ביטול'
    );
  };

  const handleArchivePeriod = () => {
    const unarchivedCount = sessions.filter((s) => !s.isArchived).length;
    if (unarchivedCount === 0) {
      showToast('אין משמרות פעילות לסגירה כרגע.', 'warning');
      return;
    }

    askConfirm(
      'סגירת תקופה (לתשלום)',
      'האם אתה בטוח שברצונך לסגור את התקופה הנוכחית?\nכל המשמרות הפעילות יסומנו כ"שולמו" ויועברו לארכיון התקופות. המונים בדף הראשי יאופסו ותתחיל תקופה חדשה.',
      () => {
        const archiveTimestamp = Date.now();
        setSessions((prev) =>
          prev.map((s) => (!s.isArchived ? { ...s, isArchived: true, archiveTimestamp } : s))
        );
        appendLog(`תקופת עבודה (${unarchivedCount} משמרות) נסגרה והועברה לארכיון.`, 'info');
        showToast('התקופה נסגרה והועברה לארכיון בהצלחה!', 'success');
      },
      'סגור תקופה',
      'ביטול'
    );
  };

  const handleStillHere = () => {
    setShowIdleModal(false);
    lastTickRef.current = Date.now();
    appendLog('המשתמש אישר נוכחות והמשיך לעבוד.', 'info');
  };

  const handleStopFromIdle = () => {
    setShowIdleModal(false);
    setSeconds((prev) => Math.max(0, prev - idleTimeAmount));
    setShowModal(true);
    appendLog('המשתמש בחר לקזז את זמן חוסר הפעילות ולסיים את המשמרת.', 'info');
  };

  const cleanDateStr = (str: string) =>
    String(str || '')
      .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
      .replace(/[/-]/g, '.')
      .trim();

  const parseDateToTimestamp = (dateStr: string): number => {
    const cleaned = cleanDateStr(dateStr);
    const parts = cleaned.split('.').map((p) => parseInt(p, 10));
    if (parts.length === 3 && !parts.some(isNaN)) {
      const day = parts[0];
      const month = parts[1] - 1;
      const year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
      return new Date(year, month, day).getTime();
    }
    return 0;
  };

  const availableArchiveMonths = useMemo(() => {
    const months = new Set<string>();
    sessions.forEach((s) => {
      if (s.isArchived && s.date) {
        const parts = cleanDateStr(s.date).split('.');
        if (parts.length === 3) {
          const m = parts[1].padStart(2, '0');
          const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          months.add(`${m}.${y}`);
        }
      }
    });
    return Array.from(months).sort((a, b) => {
      const [m1, y1] = a.split('.').map(Number);
      const [m2, y2] = b.split('.').map(Number);
      return new Date(y2, m2 - 1, 1).getTime() - new Date(y1, m1 - 1, 1).getTime();
    });
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const now = new Date();
    return sessions.filter((session) => {
      const isArchived = Boolean(session.isArchived);
      if (viewMode === 'active' && isArchived) return false;
      if (viewMode === 'archived' && !isArchived) return false;

      if (isVip && projectFilter !== 'all') {
        const sessProj = session.projectId || 'default';
        if (sessProj !== projectFilter) return false;
      }

      if (viewMode === 'archived' && archiveMonth !== 'all') {
        const parts = cleanDateStr(session.date || '').split('.');
        if (parts.length === 3) {
          const m = parts[1].padStart(2, '0');
          const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          const mYYYY = `${m}.${y}`;
          if (mYYYY !== archiveMonth) return false;
        }
      }

      if (filterType === 'all') return true;
      const sessionTimestamp = session.timestamp || parseDateToTimestamp(session.date || '');
      const sessionDate = new Date(sessionTimestamp || Date.now());
      if (filterType === 'month') {
        return sessionDate.getMonth() === now.getMonth() && sessionDate.getFullYear() === now.getFullYear();
      }
      if (filterType === 'week') {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);
        return sessionDate >= oneWeekAgo && sessionDate <= now;
      }
      return true;
    });
  }, [sessions, filterType, viewMode, archiveMonth, isVip, projectFilter]);

  const getValidEarned = useCallback(
    (session: Session) => {
      let parsed = parseFloat(String(session.earned || '0').replace(',', '.'));
      if (isNaN(parsed) || parsed < 0) {
        const appliedRate = typeof session.hourlyRate === 'number' && session.hourlyRate > 0 ? session.hourlyRate : hourlyRate;
        if (session.duration) {
          const parts = String(session.duration).split(':').map(Number);
          const h = parts[0] || 0;
          const m = parts[1] || 0;
          const s = parts[2] || 0;
          const totalSecs = h * 3600 + m * 60 + s;
          parsed = (totalSecs / 3600) * appliedRate;
        } else {
          parsed = 0;
        }
      }
      return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
    },
    [hourlyRate]
  );

  const handleExportCSV = () => {
    if (!isVip) {
      setShowVipPromoModal(true);
      return;
    }
    const headers = ['תאריך', 'לקוח / פרויקט', 'התחלה', 'סיום', 'זמן', 'תעריף שעתי', 'שכר (₪)', 'הערות'];
    const rows = filteredSessions.map((s) => [
      s.date,
      `"${(s.projectName || 'פרויקט ראשי').replace(/"/g, '""')}"`,
      s.start,
      s.end,
      s.duration,
      s.hourlyRate || hourlyRate,
      getValidEarned(s).toFixed(2),
      `"${String(s.note || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    downloadOrShareFile(
      csvContent,
      `TimeTracker_Report_${new Date().toLocaleDateString('he-IL').replace(/\./g, '-')}.csv`,
      'text/csv;charset=utf-8;',
      'הופק דוח אקסל (CSV).'
    );
  };

  const groupedSessions = useMemo(() => {
    const groups: Record<string, { sessions: Session[]; totalSeconds: number; totalEarned: number }> = {};
    filteredSessions.forEach((session) => {
      const key = cleanDateStr(session.date);
      if (!groups[key]) {
        groups[key] = { sessions: [], totalSeconds: 0, totalEarned: 0 };
      }
      groups[key].sessions.push(session);
      const [h, m, s] = (session.duration || '0:0:0').split(':').map(Number);
      groups[key].totalSeconds += (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
      groups[key].totalEarned += getValidEarned(session);
    });
    return groups;
  }, [filteredSessions, getValidEarned]);

  const dashboardStats = useMemo(() => {
    const totalMoney = filteredSessions.reduce((acc, curr) => acc + getValidEarned(curr), 0);
    let totalSeconds = 0;
    filteredSessions.forEach((session) => {
      const [h, m, s] = (session.duration || '0:0:0').split(':').map(Number);
      totalSeconds += (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
    });

    return { earned: totalMoney.toFixed(2), hours: formatTime(totalSeconds) };
  }, [filteredSessions, getValidEarned]);

  const askAIForProductivityReport = async () => {
    setIsAiLoading(true);
    appendLog('מייצר דוח תובנות פרודוקטיביות ב-AI...', 'info');
    try {
      const summaryData = filteredSessions
        .slice(0, 12)
        .map((s) => `${s.date}: ${s.duration} (₪${getValidEarned(s)}) - ${s.note}`)
        .join(' | ');
      const prompt = `נתח את נתוני העבודה של המשתמש: סה"כ שעות לתקופה: ${dashboardStats.hours}, סה"כ לתשלום: ₪${dashboardStats.earned}, תעריף שעתי: ₪${activeRate}. משמרות אחרונות: ${summaryData || 'אין משמרות עדיין'}. תן משוב מעודד וחכם ב-3 נקודות קצרות בעברית.`;
      const insight = await callGeminiAPI(prompt);
      appendLog(`✨ דוח תובנות AI:\n${insight}`, 'ai');
      showToast('דוח תובנות ה-AI נוסף ליומן!', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      appendLog(`שגיאה בהפקת דוח AI: ${message}`, 'error');
      showToast('לא ניתן להתחבר ל-AI. בדוק את מפתח ה-API בהגדרות.', 'error');
    } finally {
      setIsAiLoading(false);
    }
  };

  const toggleDateCollapse = (date: string) => {
    setCollapsedDates((prev) => ({ ...prev, [date]: !prev[date] }));
  };

  const liveCalculation = useMemo(
    () => calculateEarningsForSeconds(seconds, activeRate),
    [seconds, activeRate, calculateEarningsForSeconds]
  );
  const currentEarned = liveCalculation.earned.toFixed(2);

  const handleExportPDF = () => {
    const style = document.createElement('style');
    style.innerHTML = `@media print { tr { page-break-inside: avoid; } thead { display: table-header-group; } }`;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.head.removeChild(style), 1000);
    appendLog('בוצעה הפקת דוח PDF.', 'info');
  };

  // --- תצוגת מצב מיני (חלון צף - VIP) בעיצוב המקורי ---
  if (isMiniMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-900 text-right text-gray-100" dir="rtl">
        <div className="bg-white/10 backdrop-blur-xl p-6 rounded-[2.5rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] flex flex-col items-center w-full max-w-sm border border-white/20 relative">
          <div className="flex justify-between items-center w-full mb-4">
            <span className="text-amber-400 font-bold text-sm">👑 {currentProject.name}</span>
            <button
              onClick={() => setIsMiniMode(false)}
              className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded-xl border border-white/10 transition-all"
            >
              ⤢ חזור למסך מלא
            </button>
          </div>
          <div className={`text-5xl font-mono my-3 font-light tracking-wider ${isPaused ? 'text-amber-400' : 'text-emerald-400'}`}>
            {formatTime(seconds)}
          </div>
          <div className="text-sm text-white/70 mb-5">
            שכר נוכחי: <span className="font-bold text-white">₪{currentEarned}</span>
          </div>
          <div className="w-full flex gap-3">
            {isWorking ? (
              <>
                <button
                  onClick={() => {
                    setIsMiniMode(false);
                    handleToggleWork();
                  }}
                  className="flex-1 py-3 font-bold rounded-2xl bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30"
                >
                  סיום משמרת
                </button>
                <button
                  onClick={handleTogglePause}
                  className="flex-1 py-3 font-bold rounded-2xl bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30"
                >
                  {isPaused ? 'חזור מהפסקה' : 'הפסקה'}
                </button>
              </>
            ) : (
              <button
                onClick={handleToggleWork}
                className="w-full py-3 font-bold rounded-2xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
              >
                התחל עבודה
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 bg-gray-900 print:bg-white print:p-0 overflow-x-hidden overflow-y-auto relative text-right text-gray-100" dir="rtl">
      {/* קלט קובץ נסתר לשחזור גיבוי JSON */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleRestoreBackupJSON}
        accept=".json"
        className="hidden"
      />

      {/* התראות צפות (Toast Notifications) */}
      <div className="fixed bottom-6 left-6 z-[110] flex flex-col gap-2 max-w-sm w-full pointer-events-none print:hidden">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-xl transition-all ${
              t.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                : t.type === 'error'
                ? 'bg-red-950/90 border-red-500/40 text-red-200'
                : t.type === 'warning'
                ? 'bg-amber-950/90 border-amber-500/40 text-amber-200'
                : 'bg-gray-900/90 border-white/20 text-white'
            }`}
          >
            <span className="text-sm font-medium">{t.text}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="text-white/40 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* כותרת הדפסה ל-PDF (כולל מיתוג עסק ב-VIP) */}
      <div className="hidden print:block w-full max-w-5xl mx-auto mb-8 text-black border-b-2 border-gray-800 pb-8 pt-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-5xl font-bold mb-4 tracking-tight text-gray-900">דוח שעות עבודה</h1>
            <div className="space-y-2 text-lg text-gray-700">
              <p><span className="font-bold">תאריך הפקה:</span> {new Date().toLocaleDateString('he-IL')}</p>
              <p><span className="font-bold">תעריף שעתי מוסכם:</span> ₪{activeRate}</p>
              {isVip && projectFilter !== 'all' && (
                <p><span className="font-bold">פרויקט / לקוח:</span> {projects.find((p) => p.id === projectFilter)?.name}</p>
              )}
            </div>
          </div>
          <div className="text-left bg-gray-100 p-6 rounded-xl border border-gray-300 min-w-[350px]">
            <div className="mb-6">
              <span className="font-bold block text-gray-900 text-right mb-3 text-lg">פרטי מגיש הדוח:</span>
              <div className="flex justify-between items-end border-b border-gray-400 mb-3 pb-1">
                <span className="text-gray-600 text-sm font-medium">שם מלא / עוסק:</span>
                <span className="w-48 text-right font-bold text-gray-900">{isVip ? businessDetails.businessName : ''}</span>
              </div>
              <div className="flex justify-between items-end border-b border-gray-400 pb-1">
                <span className="text-gray-600 text-sm font-medium">ח.פ / ת.ז:</span>
                <span className="w-48 text-right font-bold text-gray-900">{isVip ? businessDetails.businessId : ''}</span>
              </div>
            </div>
            <div>
              <span className="font-bold block text-gray-900 text-right mb-3 text-lg">עבור לקוח / מעסיק:</span>
              <div className="flex justify-between items-end border-b border-gray-400 pb-1">
                <span className="text-gray-600 text-sm font-medium">שם הלקוח:</span>
                <span className="w-48 text-right font-bold text-gray-900">{isVip ? businessDetails.clientName : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* רקע כתמי הצבע המקוריים */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 print:hidden">
        <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] bg-purple-600/30 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-emerald-600/20 rounded-full blur-[150px]"></div>
        <div className="absolute top-[30%] left-[60%] w-[400px] h-[400px] bg-blue-600/20 rounded-full blur-[100px]"></div>
      </div>

      {/* שורת הכפתורים העליונה המקורית */}
      <div className="w-full max-w-5xl flex flex-wrap justify-between items-center mb-4 print:hidden z-10 gap-3">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="bg-white/5 hover:bg-white/10 backdrop-blur-md text-white px-4 py-2 rounded-xl border border-white/10 shadow-lg transition-all flex items-center gap-2"
          >
            <span>⚙️ הגדרות (ותעריפים)</span>
          </button>

          <button
            onClick={() => (isVip ? setShowProjectsModal(true) : setShowVipPromoModal(true))}
            className="bg-gradient-to-r from-amber-400/20 to-yellow-600/20 hover:from-amber-400/30 hover:to-yellow-600/30 backdrop-blur-md text-amber-300 px-5 py-2 rounded-xl border border-amber-500/30 shadow-[0_0_15px_rgba(251,191,36,0.15)] transition-all duration-300 flex items-center gap-2 font-bold transform hover:scale-105"
          >
            <span>👑 {isVip ? `VIP פעיל ${vipOwnerName ? `(${vipOwnerName})` : ''}` : 'מסלול VIP • בקרוב'}</span>
          </button>

          <button
            onClick={handleCheckUpdates}
            className="bg-blue-500/20 hover:bg-blue-500/30 backdrop-blur-md text-blue-300 px-4 py-2 rounded-xl border border-blue-500/30 shadow-lg transition-all flex items-center gap-2 font-bold"
          >
            <span>🔄 בדוק עדכונים</span>
          </button>

          <button
            onClick={() => setShowLogsModal(true)}
            className="bg-purple-500/20 hover:bg-purple-500/30 backdrop-blur-md text-purple-300 px-4 py-2 rounded-xl border border-purple-500/30 shadow-lg transition-all flex items-center gap-2 font-bold relative"
          >
            <span>📜 יומן מערכת ו-AI</span>
            {logs.some((l) => l.type === 'error' || l.type === 'warning') && (
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
            )}
          </button>
        </div>

        <button
          onClick={() => (isVip ? setIsMiniMode(true) : setShowVipPromoModal(true))}
          className="bg-white/5 hover:bg-white/10 backdrop-blur-md text-white/70 px-4 py-2 rounded-xl border border-white/10 shadow-lg transition-all flex items-center gap-2"
        >
          <span className="text-amber-400">👑</span>
          <span>מצב מיני (חלון צף)</span>
          <span className="text-xl">⤢</span>
        </button>
      </div>

      {/* אזור מרכזי: כותרת וכרטיס השעון המקורי */}
      <div className="w-full max-w-5xl flex flex-col items-center space-y-6 mb-12 print:hidden z-10">
        {/* אזור התראות עדכון גרסה */}
        {updateStatus && updateStatus.type !== 'not-available' && (
          <div className="bg-gray-800/80 backdrop-blur-md border border-gray-600 p-4 rounded-2xl w-full max-w-md text-center shadow-lg mb-4 relative">
            {(updateStatus.type === 'error' || updateStatus.type === 'available') && (
              <button
                onClick={() => setUpdateStatus(null)}
                className="absolute top-3 left-3 text-white/40 hover:text-white text-sm"
                title="סגור התראה"
              >
                ✕
              </button>
            )}
            {updateStatus.type === 'checking' && <p className="text-amber-400 font-medium">מחפש עדכונים בשרת...</p>}
            {updateStatus.type === 'error' && <p className="text-red-400 font-medium text-sm">שגיאה בבדיקת עדכונים: {updateStatus.message}</p>}
            {updateStatus.type === 'available' && (
              <div className="flex flex-col items-center gap-3">
                <span className="text-emerald-300 font-bold">🎉 גרסה חדשה זמינה ({updateStatus.version})!</span>
                <button onClick={handleStartDownload} className="bg-emerald-500 hover:bg-emerald-400 text-gray-900 font-bold px-6 py-2 rounded-xl transition-all shadow-md">
                  הורד עדכון עכשיו 📥
                </button>
              </div>
            )}
            {updateStatus.type === 'progress' && (
              <div className="w-full">
                <p className="text-blue-300 font-medium mb-2">מוריד עדכון... {updateStatus.percent}%</p>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${updateStatus.percent}%` }}></div>
                </div>
              </div>
            )}
            {updateStatus.type === 'downloaded' && (
              <div className="flex flex-col items-center gap-3">
                <span className="text-emerald-300 font-bold">העדכון ירד בהצלחה ומוכן להתקנה!</span>
                <button onClick={handleInstallUpdate} className="bg-emerald-500 hover:bg-emerald-400 text-gray-900 font-bold px-6 py-2 rounded-xl transition-all shadow-[0_0_15px_rgba(52,211,153,0.4)]">
                  התקן והפעל מחדש 🚀
                </button>
              </div>
            )}
          </div>
        )}

        <header className="text-center drop-shadow-md">
          <h1 className="text-4xl font-bold text-white tracking-tight">
            {isVip ? 'מערכת שעות - (מסלול VIP 👑)' : 'מערכת שעות - (גרסה חינמית)'}
          </h1>
          <p className="text-gray-300 mt-2 font-light">
            מעקב זמן ותמחור לפי {activeRate} ₪ לשעה {isVip && enableOvertime ? '(כולל שעות נוספות אוטומטיות)' : ''}
          </p>
        </header>

        {/* כרטיס הטיימר המקורי */}
        <div className="bg-white/10 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] flex flex-col items-center w-full max-w-md border border-white/20 relative">
          {isPaused && (
            <div className="absolute top-4 bg-amber-500/20 text-amber-300 px-4 py-1 rounded-full text-sm font-bold animate-pulse border border-amber-500/30 shadow-lg z-20">
              מושהה - זמן הפסקה: {formatTime(pauseSeconds)}
            </div>
          )}

          <div className="flex items-center justify-between w-full bg-black/20 rounded-xl p-2 mt-6 border border-white/5 gap-2">
            {isVip ? (
              <select
                value={currentProjectId}
                onChange={(e) => setCurrentProjectId(e.target.value)}
                disabled={isWorking}
                className="bg-transparent text-white/90 font-medium px-2 outline-none cursor-pointer flex-1 truncate"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-gray-900 text-white">
                    {p.name} (₪{p.hourlyRate}/שעה)
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-white/80 font-medium px-3">פרויקט נוכחי (ראשי)</span>
            )}
            <button
              onClick={() => (isVip ? setShowProjectsModal(true) : setShowVipPromoModal(true))}
              className="bg-white/5 hover:bg-white/10 text-amber-400 text-sm px-3 py-1.5 rounded-lg border border-white/10 transition-colors flex items-center gap-1 shadow-sm whitespace-nowrap"
            >
              👑 לקוח / שעון נוסף
            </button>
          </div>

          <div
            className={`text-7xl font-mono mt-6 mb-4 font-light tracking-wider transition-colors ${
              isPaused
                ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                : 'text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)]'
            }`}
          >
            {formatTime(seconds)}
          </div>
          <div className="text-lg text-white/70 mb-10">
            שכר נוכחי: <span className="font-bold text-white border-b border-emerald-400/50 pb-1">₪{currentEarned}</span>
          </div>

          <div className="w-full flex gap-4">
            {isWorking ? (
              <>
                <button
                  onClick={handleToggleWork}
                  className="flex-1 py-4 text-xl font-bold rounded-2xl transition-all duration-300 shadow-[0_4px_15px_rgba(239,68,68,0.2)] bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30"
                >
                  סיום משמרת
                </button>
                <button
                  onClick={handleTogglePause}
                  className={`flex-1 py-4 text-xl font-bold rounded-2xl transition-all duration-300 shadow-lg border ${
                    isPaused
                      ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border-emerald-500/30 shadow-[0_4px_15px_rgba(52,211,153,0.2)]'
                      : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/30 shadow-[0_4px_15px_rgba(245,158,11,0.2)]'
                  }`}
                >
                  {isPaused ? 'חזור מהפסקה' : 'יציאה להפסקה'}
                </button>
              </>
            ) : (
              <button
                onClick={handleToggleWork}
                className="w-full py-4 text-xl font-bold rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(52,211,153,0.2)] bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
              >
                התחל עבודה (כניסה)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* כרטיס הטבלה וסיכומי התקופה המקורי */}
      <div className="w-full max-w-5xl bg-white/5 backdrop-blur-xl rounded-[2.5rem] border border-white/10 p-4 md:p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] z-10 relative print:shadow-none print:border-none print:bg-white print:text-black print:p-0">
        <div className="flex flex-col gap-6 mb-8 border-b border-white/10 pb-6 print:border-gray-300 print:mb-4 print:pb-4">
          <div className="flex flex-wrap justify-between items-center w-full gap-4">
            <div className="flex space-x-reverse space-x-2 bg-black/20 p-1 rounded-xl border border-white/5 print:hidden">
              <button
                onClick={() => setViewMode('active')}
                className={`px-5 py-2 rounded-lg font-bold transition-all ${
                  viewMode === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-md border border-emerald-500/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                תקופה פעילה (פתוחה)
              </button>
              <button
                onClick={() => setViewMode('archived')}
                className={`px-5 py-2 rounded-lg font-bold transition-all ${
                  viewMode === 'archived'
                    ? 'bg-white/20 text-white shadow-md'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                ארכיון תקופות (שולמו)
              </button>
            </div>

            <div className="flex flex-wrap gap-3 print:hidden">
              {viewMode === 'active' && (
                <button
                  onClick={handleArchivePeriod}
                  className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-5 py-2 rounded-xl font-bold hover:bg-purple-500/30 hover:text-white transition-all shadow-lg"
                >
                  סגור תקופה (לתשלום)
                </button>
              )}
              <button
                onClick={openManualAddSession}
                className="bg-white/5 text-white/70 border border-white/10 px-5 py-2 rounded-xl font-medium hover:bg-white/10 hover:text-white transition-all shadow-lg flex items-center gap-2"
              >
                <span className="text-amber-400 text-sm">👑</span>
                הוסף משמרת ידנית
              </button>
              <button
                onClick={handleExportCSV}
                className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-4 py-2 rounded-xl font-medium hover:bg-emerald-500/30 hover:text-white transition-all shadow-lg flex items-center gap-1.5"
              >
                <span className="text-amber-400 text-xs">👑</span>
                אקסל (CSV)
              </button>
              <button
                onClick={handleExportPDF}
                className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-5 py-2 rounded-xl font-medium hover:bg-blue-500/30 hover:text-white transition-all shadow-lg"
              >
                הפק PDF
              </button>
            </div>
          </div>

          <div className="flex flex-wrap justify-between items-center w-full gap-4">
            <div className="flex space-x-reverse space-x-4 print:hidden items-center flex-wrap gap-y-3">
              <div className="flex space-x-reverse space-x-2 bg-black/20 p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => setFilterType('month')}
                  className={`px-5 py-2 rounded-lg font-medium transition-all ${
                    filterType === 'month' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  החודש
                </button>
                <button
                  onClick={() => setFilterType('week')}
                  className={`px-5 py-2 rounded-lg font-medium transition-all ${
                    filterType === 'week' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  השבוע
                </button>
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-5 py-2 rounded-lg font-medium transition-all ${
                    filterType === 'all' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  הכל
                </button>
              </div>

              {isVip && projects.length > 1 && (
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="bg-black/30 text-amber-300 px-4 py-2 rounded-xl border border-amber-500/30 outline-none cursor-pointer shadow-inner"
                >
                  <option value="all" className="bg-gray-900">כל הלקוחות / הפרויקטים</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-gray-900">{p.name}</option>
                  ))}
                </select>
              )}

              {viewMode === 'archived' && availableArchiveMonths.length > 0 && (
                <select
                  value={archiveMonth}
                  onChange={(e) => setArchiveMonth(e.target.value)}
                  className="bg-black/30 text-white/90 px-4 py-2 rounded-xl border border-white/10 focus:border-emerald-400 outline-none cursor-pointer appearance-none shadow-inner"
                >
                  <option value="all">כל חודשי הארכיון</option>
                  {availableArchiveMonths.map((m) => (
                    <option key={m} value={m} className="bg-gray-900">{m}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex gap-10 print:w-full print:justify-around print:bg-gray-100 print:p-4 print:rounded-lg">
              <div>
                <span className="block text-sm text-white/50 print:text-gray-600 mb-1">סה"כ שעות לתקופה:</span>
                <span className="text-3xl font-bold text-white print:text-black font-mono">{dashboardStats.hours}</span>
              </div>
              <div>
                <span className="block text-sm text-white/50 print:text-gray-600 mb-1">סה"כ לתשלום:</span>
                <span className="text-3xl font-bold text-emerald-400 print:text-black drop-shadow-sm">₪{dashboardStats.earned}</span>
              </div>
            </div>
          </div>
        </div>

        {/* טבלת המשמרות המקורית */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-right print:text-black">
            <thead className="text-white/50 border-b border-white/10 print:border-gray-400 uppercase text-xs tracking-wider print:text-black">
              <tr>
                <th className="pb-3 px-2 md:px-4 font-medium">תאריך</th>
                <th className="pb-3 px-2 md:px-4 font-medium">התחלה</th>
                <th className="pb-3 px-2 md:px-4 font-medium">סיום</th>
                <th className="pb-3 px-2 md:px-4 font-medium">זמן</th>
                <th className="pb-3 px-2 md:px-4 font-medium">שכר</th>
                <th className="pb-3 px-2 md:px-4 font-medium w-full">הערות / משימות</th>
                <th className="pb-3 px-2 md:px-4 font-medium text-left print:hidden">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-transparent print:divide-gray-300">
              {Object.keys(groupedSessions).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-white/40">אין נתונים לתקופה זו.</td>
                </tr>
              ) : (
                Object.entries(groupedSessions)
                  .sort((a, b) => parseDateToTimestamp(b[0]) - parseDateToTimestamp(a[0]))
                  .map(([date, group]) => (
                    <Fragment key={date}>
                      <tr
                        className="bg-black/40 cursor-pointer hover:bg-black/50 transition-colors border-y border-white/5 print:bg-gray-100 print:border-gray-400"
                        onClick={() => toggleDateCollapse(date)}
                      >
                        <td className="py-3 px-2 md:px-4 font-bold text-white print:text-black align-middle whitespace-nowrap">
                          <span className="text-white/30 print:hidden ml-3 text-xs">{collapsedDates[date] ? '▶' : '▼'}</span>
                          {date}
                        </td>
                        <td colSpan={2} className="py-3 px-2 md:px-4 text-white/50 print:text-gray-600 font-medium align-middle">
                          סה"כ יומי:
                        </td>
                        <td className="py-3 px-2 md:px-4 font-bold font-mono text-emerald-400 print:text-black align-middle">
                          {formatTime(group.totalSeconds)}
                        </td>
                        <td className="py-3 px-2 md:px-4 font-bold text-emerald-400 print:text-black align-middle">
                          ₪{group.totalEarned.toFixed(2)}
                        </td>
                        <td colSpan={2} className="py-3 px-2 md:px-4 print:hidden"></td>
                      </tr>

                      {!collapsedDates[date] &&
                        group.sessions.map((session) => (
                          <tr
                            key={session.id}
                            className="hover:bg-white/5 transition-colors print:hover:bg-transparent text-sm border-b border-white/5 last:border-0"
                          >
                            <td className="py-3 px-2 md:px-4 text-white/80 font-mono text-xs whitespace-nowrap print:text-gray-700 print:font-normal align-middle">
                              {session.date}
                            </td>
                            <td className="py-3 px-2 md:px-4 text-white/80 align-middle">{session.start}</td>
                            <td className="py-3 px-2 md:px-4 text-white/80 align-middle">{session.end}</td>
                            <td className="py-3 px-2 md:px-4 font-mono text-white/80 align-middle">{session.duration}</td>
                            <td className="py-3 px-2 md:px-4 font-bold text-white print:font-normal align-middle">
                              ₪{getValidEarned(session).toFixed(2)}
                            </td>
                            <td className="py-3 px-2 md:px-4 text-white/70 whitespace-pre-wrap align-middle break-words min-w-[150px]">
                              {isVip && session.projectName && session.projectName !== 'פרויקט נוכחי (ראשי)' && (
                                <span className="inline-block bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-2 py-0.5 rounded-md ml-2 mb-1">
                                  {session.projectName}
                                </span>
                              )}
                              {session.note}
                            </td>
                            <td className="py-3 px-2 md:px-4 print:hidden align-middle">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  title="ערוך הערה"
                                  onClick={() => {
                                    setEditingNoteId(session.id);
                                    setEditNoteText(session.note || '');
                                  }}
                                  className="text-blue-400/80 hover:text-blue-300 hover:bg-blue-400/10 bg-white/5 w-9 h-9 rounded-full border border-white/10 text-sm transition-all backdrop-blur-sm flex items-center justify-center"
                                >
                                  📝
                                </button>
                                <button
                                  title="ערוך שעות (VIP)"
                                  onClick={() => openFullEditSession(session)}
                                  className="text-amber-400/80 hover:text-amber-300 hover:bg-amber-400/10 bg-white/5 w-9 h-9 rounded-full border border-white/10 text-sm transition-all backdrop-blur-sm flex items-center justify-center"
                                >
                                  👑
                                </button>
                                <button
                                  title="מחק משמרת"
                                  onClick={() => handleDeleteSession(session.id)}
                                  className="text-red-400/80 hover:text-red-300 hover:bg-red-400/10 bg-white/5 w-9 h-9 rounded-full border border-white/10 text-sm transition-all backdrop-blur-sm flex items-center justify-center"
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  ))
              )}
            </tbody>
          </table>
        </div>

        {/* תחתית הדפסה ל-PDF (פרטי בנק וחתימה) */}
        <div className="hidden print:flex w-full mt-16 text-black pt-8 border-t-2 border-gray-800 break-inside-avoid flex-row justify-between items-end">
          <div className="bg-gray-100 p-6 rounded-xl border border-gray-300 w-1/2">
            <span className="font-bold block text-gray-900 mb-4 text-lg">פרטי תשלום / העברה בנקאית:</span>
            <div className="flex gap-4">
              <div className="flex-1 flex flex-col justify-end border-b border-gray-400 pb-1">
                <span className="text-gray-600 text-sm font-medium mb-1">שם הבנק:</span>
                <span className="font-bold text-gray-900 min-h-[20px]">{isVip ? businessDetails.bankName : ''}</span>
              </div>
              <div className="flex-1 flex flex-col justify-end border-b border-gray-400 pb-1">
                <span className="text-gray-600 text-sm font-medium mb-1">סניף:</span>
                <span className="font-bold text-gray-900 min-h-[20px]">{isVip ? businessDetails.bankBranch : ''}</span>
              </div>
              <div className="flex-1 flex flex-col justify-end border-b border-gray-400 pb-1">
                <span className="text-gray-600 text-sm font-medium mb-1">מספר חשבון:</span>
                <span className="font-bold text-gray-900 min-h-[20px]">{isVip ? businessDetails.bankAccount : ''}</span>
              </div>
            </div>
          </div>

          <div className="text-center w-1/4">
            <div className="border-b-2 border-gray-800 mb-3 h-16"></div>
            <span className="font-bold text-gray-900 text-lg">חתימה וחותמת</span>
          </div>
        </div>
      </div>

      {/* --- מודאל אישור מותאם אישית --- */}
      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[105] p-4 print:hidden">
          <div className="bg-gray-900/90 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-md border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] text-right">
            <h3 className="text-2xl font-bold text-white mb-3">{confirmDialog.title}</h3>
            <p className="text-white/70 mb-6 whitespace-pre-line">{confirmDialog.message}</p>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  fn();
                }}
                className="flex-1 bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-lg py-3 rounded-xl font-bold transition-all"
              >
                {confirmDialog.confirmText}
              </button>
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all"
              >
                {confirmDialog.cancelText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל חוסר פעילות (Idle) --- */}
      {showIdleModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-10 rounded-[2.5rem] w-full max-w-md border border-amber-500/30 text-center shadow-[0_8px_32px_0_rgba(245,158,11,0.2)] max-h-[90vh] overflow-y-auto">
            <div className="text-7xl mb-6 drop-shadow-lg">💤</div>
            <h3 className="text-3xl font-bold text-white mb-3">עדיין פה?</h3>
            <p className="text-white/70 mb-8 text-lg font-light">
              זיהינו חוסר פעילות בכל המחשב במשך 5 דקות. הטיימר הושהה בינתיים.
            </p>
            <div className="flex flex-col gap-4">
              <button
                onClick={handleStillHere}
                className="w-full bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-lg py-4 rounded-2xl font-bold text-lg transition-all backdrop-blur-md"
              >
                כן, אני ממשיך לעבוד!
              </button>
              <button
                onClick={handleStopFromIdle}
                className="w-full bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-4 rounded-2xl font-bold text-lg transition-all backdrop-blur-md"
              >
                לא, סיימתי פחות או יותר כשהלכתי
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל עריכת הערת משמרת --- */}
      {editingNoteId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-white mb-2">עריכת הערת משמרת</h3>
            <textarea
              value={editNoteText}
              onChange={(e) => setEditNoteText(e.target.value)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-xl p-4 mb-6 h-32 focus:border-blue-400 focus:bg-black/50 transition-all outline-none placeholder-white/30"
              autoFocus
            />
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setSessions(sessions.map((s) => (s.id === editingNoteId ? { ...s, note: editNoteText } : s)));
                  setEditingNoteId(null);
                  showToast('ההערה עודכנה בהצלחה!', 'success');
                }}
                className="flex-1 bg-blue-500/80 hover:bg-blue-500 text-white shadow-lg py-3 rounded-xl font-bold transition-all"
              >
                שמור שינויים
              </button>
              <button
                onClick={() => setEditingNoteId(null)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל הוספה / עריכת שעות משמרת מלאה (VIP) --- */}
      {showSessionFormModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/80 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-lg border border-amber-500/40 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-amber-400 mb-4">
              👑 {editingFullSessionId !== null ? 'עריכת שעות ומשמרת (VIP)' : 'הוספת משמרת ידנית (VIP)'}
            </h3>
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/60 mb-1">תאריך (DD.MM.YYYY)</label>
                  <input
                    type="text"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">תעריף שעתי (₪)</label>
                  <input
                    type="number"
                    value={formRate}
                    onChange={(e) => setFormRate(Number(e.target.value) || 0)}
                    className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/60 mb-1">שעת התחלה</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">שעת סיום</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">שיוך ללקוח / פרויקט</label>
                <select
                  value={formProjectId}
                  onChange={(e) => {
                    setFormProjectId(e.target.value);
                    const found = projects.find((p) => p.id === e.target.value);
                    if (found) setFormRate(found.hourlyRate);
                  }}
                  className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-gray-900">
                      {p.name} (₪{p.hourlyRate})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">פירוט משימות / הערה</label>
                <textarea
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className="w-full bg-black/30 text-white border border-white/10 rounded-xl p-3 h-24 outline-none"
                  placeholder="תיאור העבודה..."
                />
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleSaveFullSessionForm}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-gray-900 py-3 rounded-xl font-bold transition-all shadow-lg"
              >
                שמור משמרת
              </button>
              <button
                onClick={() => setShowSessionFormModal(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל ניהול לקוחות ופרויקטים (VIP) --- */}
      {showProjectsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/80 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-md border border-amber-500/40 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-amber-400 mb-4">👑 ניהול לקוחות ופרויקטים</h3>
            <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-black/30 p-3 rounded-xl border border-white/10">
                  <div>
                    <div className="font-bold text-white text-sm">{p.name}</div>
                    <div className="text-xs text-emerald-400">₪{p.hourlyRate} לשעה</div>
                  </div>
                  <div className="flex gap-2">
                    {currentProjectId !== p.id && (
                      <button
                        onClick={() => setCurrentProjectId(p.id)}
                        className="text-xs bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-lg border border-emerald-500/30"
                      >
                        בחר
                      </button>
                    )}
                    {p.id !== 'default' && (
                      <button
                        onClick={() => handleDeleteProject(p.id)}
                        className="text-xs bg-red-500/20 text-red-300 px-2.5 py-1 rounded-lg border border-red-500/30"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 pt-4 mb-6 space-y-3">
              <span className="block text-sm font-bold text-white">הוסף לקוח / פרויקט חדש:</span>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="שם הלקוח או הפרויקט..."
                className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={newProjectRate}
                  onChange={(e) => setNewProjectRate(Number(e.target.value) || 0)}
                  placeholder="תעריף שעתי"
                  className="w-32 bg-black/30 text-white p-3 rounded-xl border border-white/10 outline-none text-sm"
                />
                <button
                  onClick={handleAddProject}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold rounded-xl text-sm transition-all"
                >
                  + הוסף פרויקט
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowProjectsModal(false)}
              className="w-full bg-white/10 hover:bg-white/15 text-white py-3 rounded-xl font-bold transition-all"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      {/* --- מודאל הגדרות וגיבוי המקורי --- */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-md border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-white mb-6">הגדרות וגיבוי</h3>

            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-sm text-white/60 mb-2 pl-1">תעריף שעתי קבוע (₪)</label>
                <input
                  type="number"
                  value={hourlyRate}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHourlyRate(isNaN(val) ? 0 : val);
                  }}
                  className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none"
                  dir="ltr"
                />
                <p className="text-white/40 text-xs mt-2 font-light">
                  שינוי התעריף ישפיע רק על משמרות שיירשמו מעכשיו והלאה. דוחות ארכיון ישנים לא ייפגעו.
                </p>
              </div>

              <div className="pt-6 border-t border-white/10">
                <label className="block text-sm text-purple-300 mb-2 font-bold">🤖 מפתח API של Google Gemini (עוזר חכם)</label>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-black/30 text-white p-3 rounded-xl border border-purple-500/30 focus:border-purple-400 transition-all outline-none"
                  dir="ltr"
                />
              </div>

              <div className="pt-6 border-t border-white/10">
                <div className="flex items-center justify-between bg-black/20 p-4 rounded-xl border border-white/5 shadow-inner">
                  <div>
                    <span className="block text-white/90 font-medium text-sm">חישוב שעות נוספות אוטומטי</span>
                    <span className="block text-white/40 text-xs mt-1">חישוב 125% ו-150% מעל {overtimeThresholdHours} שעות</span>
                  </div>
                  {isVip ? (
                    <button
                      onClick={() => setEnableOvertime(!enableOvertime)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                        enableOvertime
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-white/5 text-white/60 border-white/10'
                      }`}
                    >
                      {enableOvertime ? 'פעיל ✔️' : 'כבוי'}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setShowSettingsModal(false);
                        setShowVipPromoModal(true);
                      }}
                      className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 px-4 py-2 rounded-lg text-sm border border-amber-500/20 transition-colors shadow-sm flex items-center gap-1 font-bold whitespace-nowrap"
                    >
                      <span>👑</span> פתח גישה
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-white/10">
                <div className="bg-black/20 p-4 rounded-xl border border-white/5 shadow-inner space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block text-white/90 font-medium text-sm">עיצוב דוח ופרטי עסק (ל-PDF)</span>
                      <span className="block text-white/40 text-xs mt-1">הזנה אוטומטית של ח.פ ופרטי בנק</span>
                    </div>
                    {!isVip && (
                      <button
                        onClick={() => {
                          setShowSettingsModal(false);
                          setShowVipPromoModal(true);
                        }}
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 px-4 py-2 rounded-lg text-sm border border-amber-500/20 transition-colors shadow-sm flex items-center gap-1 font-bold whitespace-nowrap"
                      >
                        <span>👑</span> פתח גישה
                      </button>
                    )}
                  </div>
                  {isVip && (
                    <div className="space-y-2 pt-2">
                      <input
                        type="text"
                        value={businessDetails.businessName}
                        onChange={(e) => setBusinessDetails({ ...businessDetails, businessName: e.target.value })}
                        placeholder="שם מלא / שם העסק"
                        className="w-full bg-black/40 text-white p-2.5 rounded-lg border border-white/10 text-xs outline-none"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={businessDetails.businessId}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, businessId: e.target.value })}
                          placeholder="ח.פ / ת.ז"
                          className="w-full bg-black/40 text-white p-2.5 rounded-lg border border-white/10 text-xs outline-none"
                        />
                        <input
                          type="text"
                          value={businessDetails.clientName}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, clientName: e.target.value })}
                          placeholder="שם הלקוח לדוח"
                          className="w-full bg-black/40 text-white p-2.5 rounded-lg border border-white/10 text-xs outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={businessDetails.bankName}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, bankName: e.target.value })}
                          placeholder="בנק"
                          className="w-full bg-black/40 text-white p-2.5 rounded-lg border border-white/10 text-xs outline-none"
                        />
                        <input
                          type="text"
                          value={businessDetails.bankBranch}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, bankBranch: e.target.value })}
                          placeholder="סניף"
                          className="w-full bg-black/40 text-white p-2.5 rounded-lg border border-white/10 text-xs outline-none"
                        />
                        <input
                          type="text"
                          value={businessDetails.bankAccount}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, bankAccount: e.target.value })}
                          placeholder="מס' חשבון"
                          className="w-full bg-black/40 text-white p-2.5 rounded-lg border border-white/10 text-xs outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-white/10">
                <label className="block text-sm text-white/60 mb-3 pl-1">כספת נתונים (ייבוא וייצוא)</label>
                <div className="flex gap-3">
                  <button
                    onClick={handleDownloadBackupJSON}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 py-3 rounded-xl text-sm border border-white/10 transition-colors shadow-lg flex justify-center items-center gap-2"
                  >
                    <span className="text-amber-400">👑</span> הורד גיבוי
                  </button>
                  <button
                    onClick={() => (isVip ? fileInputRef.current?.click() : setShowVipPromoModal(true))}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 py-3 rounded-xl text-sm border border-white/10 transition-colors shadow-lg flex justify-center items-center gap-2"
                  >
                    <span className="text-amber-400">👑</span> שחזר מגיבוי
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              className="w-full bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 shadow-lg py-3 rounded-xl font-bold transition-all"
            >
              סגור הגדרות
            </button>
          </div>
        </div>
      )}

      {/* --- מודאל סיכום משמרת המקורי --- */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-white mb-2">סיכום משמרת</h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="פירוט משימות..."
              className="w-full bg-black/30 text-white border border-white/10 rounded-xl p-4 mb-6 h-32 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none placeholder-white/30"
              autoFocus
            />
            <div className="flex gap-4">
              <button
                onClick={handleSaveSession}
                className="flex-1 bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-lg py-3 rounded-xl font-bold transition-all"
              >
                שמור וסיים
              </button>
              <button
                onClick={handleCancelSave}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all"
              >
                בטל סיום
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל יומן מערכת ויועץ AI --- */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/80 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-2xl border border-purple-500/30 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold text-purple-300">📜 יומן מערכת ויועץ AI</h3>
              <button onClick={() => setShowLogsModal(false)} className="text-white/50 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex gap-3 mb-4">
              <button
                onClick={askAIForProductivityReport}
                disabled={isAiLoading}
                className="bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/30 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
              >
                {isAiLoading ? 'מנתח נתונים...' : '✨ הפק תובנות עבודה ב-AI'}
              </button>
              <button
                onClick={() => setLogs([])}
                className="bg-white/5 hover:bg-white/10 text-white/60 px-4 py-2 rounded-xl text-sm border border-white/10"
              >
                נקה יומן
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2.5 bg-black/30 p-4 rounded-xl border border-white/10 min-h-[260px]">
              {logs.length === 0 ? (
                <p className="text-white/40 text-center py-10">אין אירועים ביומן כרגע.</p>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-xl border text-sm ${
                      log.type === 'error'
                        ? 'bg-red-950/40 border-red-500/30 text-red-200'
                        : log.type === 'warning'
                        ? 'bg-amber-950/40 border-amber-500/30 text-amber-200'
                        : log.type === 'ai'
                        ? 'bg-purple-950/50 border-purple-500/40 text-purple-100 whitespace-pre-wrap'
                        : 'bg-white/5 border-white/10 text-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <span className="font-mono text-xs text-white/40 ml-2">[{log.time}]</span>
                        <span>{log.msg}</span>
                      </div>
                      {log.type !== 'ai' && (
                        <button
                          onClick={() => askAIAboutLog(log.msg)}
                          disabled={isAiLoading}
                          className="text-xs bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 px-2.5 py-1 rounded-lg border border-purple-500/30 whitespace-nowrap"
                        >
                          🤖 שאל AI
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל VIP: נפתח בקרוב + רשימת המתנה --- */}
      {showVipPromoModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gradient-to-b from-gray-900 to-gray-800 backdrop-blur-xl p-8 sm:p-10 rounded-[2.5rem] w-full max-w-md border-2 border-amber-500/50 shadow-[0_10px_40px_rgba(251,191,36,0.3)] text-center relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowVipPromoModal(false)}
              className="absolute top-5 left-5 text-gray-500 hover:text-white text-2xl transition-colors"
            >
              ✕
            </button>

            <div className="inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3.5 py-1 rounded-full text-xs font-bold mb-4">
              <span>🚀</span>
              <span>נפתח בקרוב</span>
            </div>

            <div className="text-6xl mb-4 drop-shadow-lg">👑</div>
            <h3 className="text-3xl font-bold text-amber-400 mb-3">מסלול VIP Pro</h3>
            <p className="text-gray-300 mb-6 text-sm font-light leading-relaxed">
              מסלול ה-VIP נפתח בקרוב ויכלול: ניהול מספר לקוחות ופרויקטים, עריכת שעות ידנית, חלון מיני צף, חישוב שעות נוספות אוטומטי, מיתוג PDF וייצוא לאקסל.
            </p>

            {waitlistJoined ? (
              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-2xl p-5 mb-5 text-center">
                <div className="text-3xl mb-2">🎉</div>
                <p className="text-emerald-300 font-bold text-base mb-1">אתה ברשימת ההמתנה!</p>
                <p className="text-gray-300 text-xs">
                  נעדכן אותך ראשון ברגע שמסלול ה-VIP ייפתח, והתוכנה תתעדכן אצלך אוטומטית.
                </p>
              </div>
            ) : (
              <div className="bg-black/30 border border-white/10 rounded-2xl p-4 mb-5 text-right space-y-3">
                <span className="block text-xs font-bold text-amber-300 text-center">
                  🔔 הירשם לרשימת ההמתנה וקבל עדכון ברגע שייפתח:
                </span>
                <input
                  type="text"
                  value={waitlistName}
                  onChange={(e) => setWaitlistName(e.target.value)}
                  placeholder="שם מלא..."
                  className="w-full bg-black/40 text-white px-3.5 py-2.5 rounded-xl border border-white/10 focus:border-amber-400 text-sm outline-none"
                />
                <input
                  type="text"
                  value={waitlistContact}
                  onChange={(e) => setWaitlistContact(e.target.value)}
                  placeholder="אימייל או טלפון לעדכון..."
                  className="w-full bg-black/40 text-white px-3.5 py-2.5 rounded-xl border border-white/10 focus:border-amber-400 text-sm outline-none"
                />
                <button
                  onClick={handleJoinWaitlist}
                  disabled={isSubmittingWaitlist}
                  className="w-full bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-gray-900 font-bold text-base px-6 py-3 rounded-xl shadow-lg transition-all disabled:opacity-50"
                >
                  {isSubmittingWaitlist ? 'שולח...' : 'הצטרף לרשימת ההמתנה 🔔'}
                </button>
              </div>
            )}

            {/* אזור מוצנע להזנת קוד גישה מוקדמת / בטא */}
            <div className="border-t border-white/10 pt-3">
              <button
                onClick={() => setShowBetaCodeInput((prev) => !prev)}
                className="text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                {showBetaCodeInput ? 'הסתר הזנת קוד גישה ▲' : 'יש לך קוד גישה מוקדמת (בטא)? ▼'}
              </button>

              {showBetaCodeInput && (
                <div className="mt-3 text-right space-y-2">
                  <input
                    type="text"
                    value={licenseClientInput}
                    onChange={(e) => setLicenseClientInput(e.target.value)}
                    placeholder="שם או אימייל (אופציונלי)..."
                    className="w-full bg-black/40 text-white px-3 py-2 rounded-xl border border-white/10 text-xs outline-none"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder="הזן קוד גישה..."
                      className="flex-1 bg-black/40 text-white px-3 py-2 rounded-xl border border-amber-500/30 text-xs font-mono uppercase outline-none"
                      dir="ltr"
                    />
                    <button
                      onClick={handleActivateLicense}
                      disabled={isActivating}
                      className="bg-emerald-500 hover:bg-emerald-400 text-gray-900 font-bold px-4 py-2 rounded-xl text-xs transition-all disabled:opacity-50"
                    >
                      {isActivating ? 'בודק...' : 'הפעל ✔️'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- מחולל קודי רישיון למנהל (Admin Keygen) --- */}
      {showKeygenModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[95] p-4 print:hidden">
          <div className="bg-gray-900 p-8 rounded-[2rem] w-full max-w-md border-2 border-emerald-500/50 shadow-2xl text-right">
            <h3 className="text-2xl font-bold text-emerald-400 mb-4">🔐 מחולל רישיונות VIP למנהל</h3>
            <input
              type="text"
              value={keygenClientName}
              onChange={(e) => setKeygenClientName(e.target.value)}
              placeholder="הקלד אימייל או שם לקוח..."
              className="w-full bg-black/40 text-white p-3 rounded-xl border border-white/15 mb-4 outline-none"
            />
            {keygenClientName.trim() && (
              <div className="bg-emerald-950/60 p-4 rounded-xl text-center mb-4 border border-emerald-500/30">
                <span className="text-2xl font-mono font-bold text-white select-all">
                  {generateLicenseKeyForClient(keygenClientName)}
                </span>
              </div>
            )}
            <button
              onClick={() => setShowKeygenModal(false)}
              className="w-full bg-emerald-500 text-gray-900 font-bold py-3 rounded-xl"
            >
              סגור מחולל
            </button>
          </div>
        </div>
      )}
    </div>
  );
}