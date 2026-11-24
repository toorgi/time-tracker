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

interface AdminMessage {
  id: number;
  target_user_id: string | null;
  title: string;
  body: string;
  style: 'info' | 'warning' | 'vip';
  is_active: boolean;
  created_at: string;
}

interface IpcRendererLike {
  on: (channel: string, func: (e: unknown, data: unknown) => void) => void;
  send: (channel: string) => void;
  removeAllListeners: (channel: string) => void;
}

const SUPABASE_URL = 'https://lmgpqavzkvlnixgiokzy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZ3BxYXZ6a3Zsbml4Z2lva3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNzI2MzgsImV4cCI6MjExMDk0ODYzOH0.TxGaatk7tYUyar0l5ODoyIAUHCxrGz4r_2sLuNxJ-m4';
const APP_CLIENT_VERSION = '1.0.6';
const LANDING_PAGE_URL = 'https://playful-wisp-0af7ed.netlify.app/';

function getOrCreateAppUserId(): string {
  const storageKey = 'tt_app_user_id';
  const existing = localStorage.getItem(storageKey);
  if (existing && /^TT-[A-Z0-9]{4}-[A-Z0-9]{3}$/.test(existing)) {
    return existing;
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randPart = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const newId = `TT-${randPart(4)}-${randPart(3)}`;
  localStorage.setItem(storageKey, newId);
  return newId;
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
  // --- מצב בהירות אוטומטי (יום / לילה) ---
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('tt_theme_mode');
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  });

  const [isNightTime, setIsNightTime] = useState<boolean>(() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 19;
  });

  useEffect(() => {
    localStorage.setItem('tt_theme_mode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const checkDayOrNight = () => {
      const hour = new Date().getHours();
      setIsNightTime(hour < 6 || hour >= 19);
    };
    checkDayOrNight();
    const timer = setInterval(checkDayOrNight, 60000);
    window.addEventListener('focus', checkDayOrNight);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', checkDayOrNight);
    };
  }, []);

  const isDark = themeMode === 'dark' || (themeMode === 'auto' && isNightTime);

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

  // --- חיבור חי לשרת Supabase: מזהה משתמש, פתיחת VIP מרחוק והודעות מנהל ---
  const [appUserId] = useState<string>(() => getOrCreateAppUserId());
  const [userDisplayName, setUserDisplayName] = useState<string>(() => localStorage.getItem('tt_user_display_name') || '');
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [vipExpiresAt, setVipExpiresAt] = useState<string | null>(() => localStorage.getItem('tt_vip_expires_at') || null);
  const [lastServerSyncTime, setLastServerSyncTime] = useState<string>(() => localStorage.getItem('tt_last_server_sync') || '');
  const [allUserAdminMessages, setAllUserAdminMessages] = useState<AdminMessage[]>([]);
  const [adminMessagesQueue, setAdminMessagesQueue] = useState<AdminMessage[]>([]);
  const [showPersonalAreaModal, setShowPersonalAreaModal] = useState(false);
  const [personalAreaTab, setPersonalAreaTab] = useState<'overview' | 'plan' | 'messages'>('overview');
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [idAutoCopied, setIdAutoCopied] = useState(false);
  const [dismissedMessageIds, setDismissedMessageIds] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('tt_dismissed_messages');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.map(Number).filter((n) => !isNaN(n)) : [];
    } catch {
      return [];
    }
  });
  const dismissedMessageIdsRef = useRef<number[]>(dismissedMessageIds);

  // העתקה אוטומטית ושקטה של מזהה ההתקנה ללוח ללא צורך בפעולה ידנית של המשתמש
  const autoCopyUserId = useCallback(async (showNotification = false) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(appUserId);
        setIdAutoCopied(true);
        if (showNotification) {
          showToast('מזהה ההתקנה הועתק אוטומטית ללוח ✔️', 'success');
        }
      }
    } catch {
      // התעלמות שקטה במידה והסביבה חוסמת גישה ללוח
    }
  }, [appUserId, showToast]);

  useEffect(() => {
    localStorage.setItem('tt_user_display_name', userDisplayName);
    if (userDisplayName.trim()) {
      localStorage.removeItem('tt_name_cleared');
    }
  }, [userDisplayName]);

  useEffect(() => {
    dismissedMessageIdsRef.current = dismissedMessageIds;
    localStorage.setItem('tt_dismissed_messages', JSON.stringify(dismissedMessageIds));
  }, [dismissedMessageIds]);

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

  const syncWithServer = useCallback(async (isManual = false) => {
    // הגנה: מניעת רישום משתמשי בדיקה בשרת בעת צפייה ב-Preview מקוון בדפדפן
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    const isDesktopOrLocal =
      Boolean(globalWin.ipcRenderer) ||
      window.location.protocol === 'file:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!isManual && !isDesktopOrLocal) {
      return;
    }

    if (isManual) setIsSyncingServer(true);
    try {
      const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      };

      const isNameClearedLocally = localStorage.getItem('tt_name_cleared') === 'true';

      // 1. סנכרון משתמש ובדיקת סטטוס VIP מול השרת
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_app_user`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_user_id: appUserId,
          p_app_version: APP_CLIENT_VERSION,
          p_display_name: userDisplayName.trim() || null,
        }),
      });

      if (rpcRes.ok) {
        const userData = await rpcRes.json();
        const serverSaysVip = Boolean(userData?.is_vip);
        const wasServerVip = localStorage.getItem('tt_server_vip') === 'true';
        const serverExpiry = userData?.vip_expires_at ? String(userData.vip_expires_at) : null;
        const formattedSyncNow = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

        localStorage.setItem('tt_server_vip', String(serverSaysVip));
        localStorage.setItem('tt_server_vip_last_check', String(Date.now()));
        localStorage.setItem('tt_last_server_sync', formattedSyncNow);
        setLastServerSyncTime(formattedSyncNow);
        setVipExpiresAt(serverExpiry);
        if (serverExpiry) {
          localStorage.setItem('tt_vip_expires_at', serverExpiry);
        } else {
          localStorage.removeItem('tt_vip_expires_at');
        }

        // מניעת "בומרנג שם": לא משחזרים שם מהשרת אם המשתמש ביצע איפוס מלא מקומי
        if (!isNameClearedLocally && userData?.display_name && !userDisplayName) {
          setUserDisplayName(userData.display_name);
        }

        if (serverSaysVip) {
          setIsVip((prev) => {
            if (!prev) {
              playNotificationSound('start');
              appendLog('מסלול VIP נפתח עבורך מרחוק על ידי מנהל המערכת!', 'info');
              showToast('👑 מסלול VIP הופעל עבורך! כל הפיצ׳רים פתוחים.', 'success');
            }
            return true;
          });
          if (!isNameClearedLocally && userData?.display_name && !vipOwnerName) {
            setVipOwnerName(userData.display_name);
          }
        } else if (wasServerVip && !savedLicenseKey) {
          setIsVip(false);
          localStorage.setItem('isVipUser', 'false');
          appendLog('גישת ה-VIP מרחוק הסתיימה. המערכת חזרה לגרסה החינמית.', 'warning');
          showToast('גישת ה-VIP הסתיימה. המערכת חזרה לגרסה החינמית.', 'info');
        } else if (isManual && !serverSaysVip) {
          showToast('הסנכרון הושלם — כרגע החשבון מוגדר בגרסה החינמית.', 'info');
        }
      }

      // 2. משיכת הודעות מנהל פעילות (לכל המשתמשים או למזהה הספציפי הזה)
      const msgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_messages?select=*&is_active=eq.true&order=created_at.desc`,
        { method: 'GET', headers }
      );

      if (msgRes.ok) {
        const messages: AdminMessage[] = await msgRes.json();
        if (Array.isArray(messages)) {
          const forMeMessages = messages.filter((m) => {
            const target = (m.target_user_id || '').trim().toUpperCase();
            return !target || target === appUserId.toUpperCase();
          });
          setAllUserAdminMessages(forMeMessages);
          const dismissedSet = new Set(dismissedMessageIdsRef.current.map(Number));
          const relevant = forMeMessages.filter((m) => !dismissedSet.has(Number(m.id)));
          setAdminMessagesQueue(relevant);
        }
      }
    } catch {
      // בדיקת תקופת חסד של 14 ימים במצב אופליין עבור VIP מהשרת
      const wasServerVip = localStorage.getItem('tt_server_vip') === 'true';
      const lastServerCheck = Number(localStorage.getItem('tt_server_vip_last_check')) || 0;
      const gracePeriod = 14 * 24 * 60 * 60 * 1000;
      if (wasServerVip && !savedLicenseKey && lastServerCheck > 0 && Date.now() - lastServerCheck > gracePeriod) {
        setIsVip(false);
        localStorage.setItem('tt_server_vip', 'false');
        localStorage.setItem('isVipUser', 'false');
      }
      if (isManual) {
        showToast('לא ניתן להתחבר לשרת כרגע. בדוק חיבור לאינטרנט.', 'warning');
      }
    } finally {
      if (isManual) setIsSyncingServer(false);
    }
  }, [appUserId, userDisplayName, vipOwnerName, savedLicenseKey, appendLog, showToast, playNotificationSound]);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      syncWithServer(false);
    }, 2000);

    const pollInterval = setInterval(() => {
      syncWithServer(false);
    }, 25000);

    const handleWindowFocus = () => {
      syncWithServer(false);
    };
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [syncWithServer]);

  const handleDismissAdminMessage = (msgId: number) => {
    const normalizedId = Number(msgId);
    const msg = adminMessagesQueue.find((m) => Number(m.id) === normalizedId);
    if (msg) {
      appendLog(`📢 הודעת מערכת (${msg.title}): ${msg.body}`, 'info');
    }
    const nextDismissed = Array.from(new Set([...dismissedMessageIdsRef.current, normalizedId]));
    dismissedMessageIdsRef.current = nextDismissed;
    localStorage.setItem('tt_dismissed_messages', JSON.stringify(nextDismissed));
    setDismissedMessageIds(nextDismissed);
    setAdminMessagesQueue((prev) => prev.filter((m) => Number(m.id) !== normalizedId));
  };

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
  const isElectronEnv = useMemo(() => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    return Boolean(globalWin.ipcRenderer);
  }, []);

  // סנכרון מצב המיני מול חלון ה-Electron האמיתי (כיווץ + הצמדה לפינת המסך מעל כל החלונות)
  useEffect(() => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    const ipc = globalWin.ipcRenderer;
    if (!ipc) return;
    ipc.send(isMiniMode ? 'enter-mini-mode' : 'exit-mini-mode');
  }, [isMiniMode]);

  useEffect(() => {
    return () => {
      const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
      globalWin.ipcRenderer?.send('exit-mini-mode');
    };
  }, []);

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

  // העתקה אוטומטית של המזהה בכל פתיחה של האזור האישי או חלון ה-VIP
  useEffect(() => {
    if (showVipPromoModal || showPersonalAreaModal) {
      autoCopyUserId(false);
    }
  }, [showVipPromoModal, showPersonalAreaModal, autoCopyUserId]);

  // --- רשימת המתנה למסלול VIP (נפתח בקרוב) ---
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistContact, setWaitlistContact] = useState('');
  const [waitlistMessage, setWaitlistMessage] = useState('');
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
        if (isManualUpdateCheckRef.current) {
          setUpdateStatus(data);
        } else {
          setUpdateStatus(null);
        }
      } else if (data.type === 'available') {
        setUpdateStatus(data);
        appendLog(`נמצא עדכון חדש (גרסה ${data.version}) — מוריד אוטומטית ברקע...`, 'info');
      } else if (data.type === 'downloaded') {
        setUpdateStatus(data);
        appendLog(`עדכון חדש${data.version ? ` (${data.version})` : ''} ירד אוטומטית ויותקן בסגירה הבאה.`, 'info');
        showToast('✨ עדכון חדש ירד ויותקן אוטומטית בסגירה הבאה', 'success');
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
      const fullLabel = `${waitlistName.trim()} (${contactValue})`;
      const customNote = waitlistMessage.trim();
      const requestBodyText = customNote || 'בקשה לפתיחת מסלול VIP / הצטרפות לרשימת המתנה (מתוך תוכנת TimeTracker)';

      localStorage.removeItem('tt_name_cleared');
      setUserDisplayName(fullLabel);
      localStorage.setItem('tt_user_display_name', fullLabel);

      const supabaseHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      };

      fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_app_user`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({
          p_user_id: appUserId,
          p_app_version: APP_CLIENT_VERSION,
          p_display_name: fullLabel,
        }),
      }).catch(() => {});

      const adminPanelPromise = fetch(`${SUPABASE_URL}/rest/v1/vip_requests`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          user_id: appUserId,
          user_name: waitlistName.trim(),
          user_contact: contactValue,
          message: requestBodyText,
          status: 'pending',
        }),
      });

      const emailPromise = fetch('https://api.emailjs.com/api/v1.0/email/send', {
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
            message: `${requestBodyText}\nמזהה התקנה לפתיחה מרחוק: ${appUserId}`,
          },
        }),
      });

      const [adminResult, emailResult] = await Promise.allSettled([adminPanelPromise, emailPromise]);
      const sentToAdminPanel = adminResult.status === 'fulfilled' && adminResult.value.ok;
      const sentToEmail = emailResult.status === 'fulfilled' && emailResult.value.ok;

      if (!sentToAdminPanel && !sentToEmail) {
        throw new Error('לא התקבל אישור מהשרת או משירות המייל');
      }

      setWaitlistJoined(true);
      localStorage.setItem('vipWaitlistJoined', 'true');
      setWaitlistName('');
      setWaitlistContact('');
      setWaitlistMessage('');
      appendLog(
        `בקשת VIP נשלחה בהצלחה${sentToAdminPanel ? ' (התקבלה במרכז הניהול)' : ''}.`,
        'info'
      );
      showToast('🎉 הבקשה נשלחה בהצלחה! נפתח לך גישה ונעדכן אותך בהקדם.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'שגיאת רשת';
      appendLog(`שגיאה בשליחת בקשת VIP: ${message}`, 'warning');
      showToast('לא ניתן היה לשלוח כרגע. ודא חיבור לאינטרנט ונסה שוב.', 'error');
    } finally {
      setIsSubmittingWaitlist(false);
    }
  };

  const handleInstallUpdate = () => {
    const globalWin = window as unknown as { ipcRenderer?: IpcRendererLike };
    globalWin.ipcRenderer?.send('restart-and-install');
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard?.writeText(LANDING_PAGE_URL);
      showToast('🔗 קישור השיתוף הועתק ללוח!', 'success');
    } catch {
      showToast('ניתן להעתיק את הקישור ישירות מהחלון', 'info');
    }
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
        localStorage.removeItem('tt_name_cleared');
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
        if (customerName) {
          localStorage.removeItem('tt_name_cleared');
          setVipOwnerName(customerName);
        }

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
      version: `${APP_CLIENT_VERSION}-VIP`,
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

  // --- אפשרויות איפוס מערכת מבוקרות למשתמש ---
  const handleResetSessionsOnly = () => {
    askConfirm(
      'איפוס משמרות וטיימר בלבד',
      'פעולה זו תמחק את כל המשמרות הפעילות, הארכיון והטיימר הפעיל.\nההגדרות, הפרויקטים, התעריף וסטטוס ה-VIP שלך יישארו שמורים.\nהאם להמשיך?',
      () => {
        setIsWorking(false);
        setIsPaused(false);
        setSeconds(0);
        setPauseSeconds(0);
        setStartTime(null);
        setNoteText('');
        setShowModal(false);
        setSessions([]);
        setCollapsedDates({});
        setArchiveMonth('all');
        setViewMode('active');

        localStorage.removeItem('workSessions');
        localStorage.removeItem('currentSeconds');
        localStorage.removeItem('pauseSeconds');
        localStorage.removeItem('startTime');
        localStorage.removeItem('lastTickTime');
        localStorage.setItem('isWorking', 'false');
        localStorage.setItem('isPaused', 'false');

        setShowSettingsModal(false);
        appendLog('בוצע איפוס משמרות וטיימר על ידי המשתמש.', 'warning');
        showToast('כל המשמרות והטיימר אופסו בהצלחה.', 'success');
      },
      'אפס משמרות',
      'ביטול'
    );
  };

  const handleFullSystemReset = () => {
    askConfirm(
      'איפוס מלא של המערכת להגדרות יצרן',
      'פעולה זו תאפס לחלוטין את כל המשמרות, הפרויקטים, פרטי העסק, שם התצוגה, התעריף השעתי, מפתח ה-AI והעדפות התצוגה.\nמזהה ההתקנה וסטטוס ה-VIP שלך יישמרו כדי שלא תאבד גישה.\nמומלץ להוריד גיבוי לפני האיפוס. האם להמשיך?',
      () => {
        setIsWorking(false);
        setIsPaused(false);
        setSeconds(0);
        setPauseSeconds(0);
        setStartTime(null);
        setNoteText('');
        setShowModal(false);
        setSessions([]);
        setHourlyRate(60);
        setProjects([{ id: 'default', name: 'פרויקט נוכחי (ראשי)', hourlyRate: 60, color: '#10b981' }]);
        setCurrentProjectId('default');
        setProjectFilter('all');
        setEnableOvertime(false);
        setBusinessDetails({ businessName: '', businessId: '', clientName: '', bankName: '', bankBranch: '', bankAccount: '' });
        setAiApiKey('');
        setThemeMode('auto');
        setUserDisplayName('');
        setVipOwnerName('');
        setWaitlistJoined(false);
        setCollapsedDates({});
        setArchiveMonth('all');
        setFilterType('month');
        setViewMode('active');
        setLogs([]);

        const keysToClear = [
          'workSessions',
          'currentSeconds',
          'pauseSeconds',
          'startTime',
          'lastTickTime',
          'hourlyRate',
          'vipProjects',
          'currentProjectId',
          'enableOvertime',
          'overtimeThresholdHours',
          'businessDetails',
          'aiApiKey',
          'tt_theme_mode',
          'tt_user_display_name',
          'vipOwnerName',
          'vipWaitlistJoined',
        ];
        keysToClear.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem('tt_name_cleared', 'true');
        localStorage.setItem('isWorking', 'false');
        localStorage.setItem('isPaused', 'false');

        setShowSettingsModal(false);
        showToast('המערכת אופסה במלואה להגדרות ברירת המחדל ✔️', 'success');
      },
      'כן, אפס הכל',
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

  const handleCycleTheme = () => {
    const nextMode: 'auto' | 'light' | 'dark' =
      themeMode === 'auto' ? (isDark ? 'light' : 'dark') : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
    if (nextMode === 'auto') {
      showToast('מצב בהירות אוטומטי הופעל (יום/לילה לפי השעה)', 'info');
    } else if (nextMode === 'light') {
      showToast('עברת לתצוגת יום בהירה ☀️', 'info');
    } else {
      showToast('עברת לתצוגת לילה כהה 🌙', 'info');
    }
  };

  // --- אסימוני עיצוב אחידים ליום ולילה (נקי, קריא ויוקרתי) ---
  const ui = {
    pageBg: isDark
      ? 'bg-[#0B1120] text-slate-100'
      : 'bg-[#F6F8FB] text-slate-900',
    surface: isDark
      ? 'bg-slate-900/75 border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.45)]'
      : 'bg-white/95 border-slate-200/90 shadow-[0_12px_36px_rgba(15,23,42,0.06)]',
    subtleSurface: isDark
      ? 'bg-white/[0.04] border-white/10'
      : 'bg-slate-50/90 border-slate-200/80',
    modalBackdrop: isDark
      ? 'bg-slate-950/75 backdrop-blur-md'
      : 'bg-slate-900/35 backdrop-blur-md',
    modalSurface: isDark
      ? 'bg-[#0F172A] border-white/15 text-slate-100 shadow-[0_24px_70px_rgba(0,0,0,0.65)]'
      : 'bg-white border-slate-200 text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.16)]',
    input: isDark
      ? 'bg-slate-950/70 text-white border-white/10 placeholder-slate-500 focus:border-emerald-400 focus:bg-slate-950'
      : 'bg-slate-50 text-slate-900 border-slate-200 placeholder-slate-400 focus:border-emerald-500 focus:bg-white',
    textPrimary: isDark ? 'text-white' : 'text-slate-900',
    textSecondary: isDark ? 'text-slate-300' : 'text-slate-600',
    textMuted: isDark ? 'text-slate-400' : 'text-slate-500',
    divider: isDark ? 'border-white/10' : 'border-slate-200/80',
    ghostBtn: isDark
      ? 'bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border-white/10'
      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200/90 shadow-sm',
    segmentWrap: isDark
      ? 'bg-slate-950/60 border-white/10'
      : 'bg-slate-100 border-slate-200/80',
    segmentActive: isDark
      ? 'bg-white/15 text-white shadow-sm'
      : 'bg-white text-slate-900 shadow-sm',
    segmentIdle: isDark
      ? 'text-slate-400 hover:text-white'
      : 'text-slate-500 hover:text-slate-900',
  };

  // --- תצוגת מצב מיני (חלון צף אמיתי בפינת המסך - VIP) ---
  if (isMiniMode) {
    const miniWidgetCard = (
      <div
        className={`flex flex-col justify-between transition-colors duration-300 ${
          isElectronEnv
            ? `w-screen h-screen p-4 overflow-hidden select-none ${ui.pageBg}`
            : `w-[320px] rounded-[1.75rem] p-4 border shadow-2xl backdrop-blur-xl ${ui.surface}`
        }`}
      >
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isWorking
                  ? isPaused
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-emerald-400 animate-pulse'
                  : isDark
                  ? 'bg-slate-600'
                  : 'bg-slate-300'
              }`}
            ></span>
            <span className={`font-bold text-xs truncate ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              👑 {currentProject.name}
            </span>
          </div>
          <button
            onClick={() => setIsMiniMode(false)}
            className={`text-[11px] px-2.5 py-1 rounded-lg border font-bold shrink-0 transition-all ${ui.ghostBtn}`}
            title="חזור לחלון המלא"
          >
            ⤢ הרחב
          </button>
        </div>

        <div className="flex flex-col items-center justify-center my-2">
          <div
            className={`text-4xl font-mono font-semibold tracking-wider tabular-nums leading-none ${
              isPaused
                ? isDark ? 'text-amber-400' : 'text-amber-600'
                : isWorking
                ? isDark ? 'text-emerald-400' : 'text-emerald-600'
                : ui.textPrimary
            }`}
          >
            {formatTime(seconds)}
          </div>
          <div className={`text-xs mt-2 px-3 py-0.5 rounded-full border ${ui.subtleSurface} ${ui.textSecondary}`}>
            שכר במשמרת: <span className={`font-bold font-mono ${ui.textPrimary}`}>₪{currentEarned}</span>
            {isPaused && <span className="mr-1.5 text-amber-500 font-bold">• הפסקה</span>}
          </div>
        </div>

        <div className="w-full flex gap-2">
          {isWorking ? (
            <>
              <button
                onClick={() => {
                  setIsMiniMode(false);
                  handleToggleWork();
                }}
                className={`flex-1 py-2.5 text-xs font-bold rounded-xl border transition-all ${
                  isDark
                    ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30 border-red-500/35'
                    : 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200'
                }`}
              >
                סיום משמרת
              </button>
              <button
                onClick={handleTogglePause}
                className={`flex-1 py-2.5 text-xs font-bold rounded-xl border transition-all ${
                  isPaused
                    ? isDark
                      ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 border-emerald-500/35'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'
                    : isDark
                    ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border-amber-500/35'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200'
                }`}
              >
                {isPaused ? '▶️ המשך' : '⏸️ הפסקה'}
              </button>
            </>
          ) : (
            <button
              onClick={handleToggleWork}
              className="w-full py-2.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all"
            >
              ▶ התחל עבודה
            </button>
          )}
        </div>
      </div>
    );

    if (isElectronEnv) {
      return (
        <div className="w-screen h-screen overflow-hidden text-right" dir="rtl">
          {miniWidgetCard}
        </div>
      );
    }

    return (
      <div className={`min-h-screen w-full relative transition-colors duration-500 text-right ${ui.pageBg}`} dir="rtl">
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center opacity-70">
          <p className={`text-sm font-semibold ${ui.textSecondary}`}>
            מצב מיני צף פעיל בפינת המסך ↙️
          </p>
          <p className={`text-xs mt-1 ${ui.textMuted}`}>
            בתוכנת המחשב המותקנת (Windows), החלון כולו מתכווץ ונצמד לפינת המסך מעל שאר התוכנות.
          </p>
        </div>
        <div className="fixed bottom-5 left-5 z-[100]">
          {miniWidgetCard}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col items-center p-4 md:p-8 print:bg-white print:text-black print:p-0 overflow-x-hidden overflow-y-auto relative text-right transition-colors duration-500 ${ui.pageBg}`} dir="rtl">
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
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl border backdrop-blur-xl transition-all ${
              t.type === 'success'
                ? isDark ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200' : 'bg-white border-emerald-200 text-emerald-800'
                : t.type === 'error'
                ? isDark ? 'bg-red-950/95 border-red-500/40 text-red-200' : 'bg-white border-red-200 text-red-700'
                : t.type === 'warning'
                ? isDark ? 'bg-amber-950/95 border-amber-500/40 text-amber-200' : 'bg-white border-amber-200 text-amber-800'
                : isDark ? 'bg-slate-900/95 border-white/15 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            <span className="text-sm font-medium">{t.text}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="opacity-50 hover:opacity-100 text-xs"
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

      {/* תאורת רקע עדינה ורגועה המותאמת ליום וללילה */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 print:hidden">
        {isDark ? (
          <>
            <div className="absolute top-[-18%] left-[-10%] w-[520px] h-[520px] bg-indigo-600/15 rounded-full blur-[140px]"></div>
            <div className="absolute bottom-[-15%] right-[-10%] w-[560px] h-[560px] bg-emerald-600/12 rounded-full blur-[150px]"></div>
          </>
        ) : (
          <>
            <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] bg-emerald-200/35 rounded-full blur-[130px]"></div>
            <div className="absolute bottom-[-15%] right-[-10%] w-[540px] h-[540px] bg-sky-200/30 rounded-full blur-[140px]"></div>
          </>
        )}
      </div>

      {/* סרגל ניווט עליון מינימליסטי, נקי ומאורגן */}
      <nav className={`w-full max-w-5xl backdrop-blur-xl border rounded-2xl px-4 py-2.5 flex flex-wrap justify-between items-center mb-8 print:hidden z-10 gap-3 transition-colors duration-500 ${ui.surface}`}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              autoCopyUserId(false);
              setPersonalAreaTab('overview');
              setShowPersonalAreaModal(true);
            }}
            className={`px-3.5 py-2 rounded-xl border transition-all flex items-center gap-2.5 text-sm font-bold relative ${
              isDark
                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/30'
                : 'bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border-emerald-200'
            }`}
          >
            <span className="text-base leading-none">{isVip ? '👑' : '👤'}</span>
            <span>אזור אישי</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              isVip
                ? isDark ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                : isDark ? 'bg-white/10 text-slate-300' : 'bg-white text-slate-600 border border-slate-200'
            }`}>
              {isVip ? 'VIP' : 'חינמי'}
            </span>
            {adminMessagesQueue.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
            )}
          </button>

          <button
            onClick={() => {
              if (isVip) {
                setShowProjectsModal(true);
              } else {
                autoCopyUserId(false);
                setShowVipPromoModal(true);
              }
            }}
            className={`px-3.5 py-2 rounded-xl border transition-all flex items-center gap-1.5 text-sm font-semibold ${
              isDark
                ? 'bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border-amber-500/25'
                : 'bg-amber-50/90 hover:bg-amber-100 text-amber-800 border-amber-200/90'
            }`}
          >
            <span>👑</span>
            <span>{isVip ? (vipOwnerName ? `לקוחות • ${vipOwnerName}` : 'לקוחות VIP') : 'VIP'}</span>
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            className={`px-3.5 py-2 rounded-xl border transition-all flex items-center gap-1.5 text-sm font-medium ${ui.ghostBtn}`}
          >
            <span>⚙️</span>
            <span>הגדרות</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={handleCycleTheme}
            title="לחץ להחלפה בין אוטומטי, יום ולילה"
            className={`px-3 py-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold ${ui.ghostBtn}`}
          >
            <span>{isDark ? '🌙' : '☀️'}</span>
            <span>{themeMode === 'auto' ? 'אוטומטי' : themeMode === 'light' ? 'יום' : 'לילה'}</span>
          </button>

          <button
            onClick={() => setShowLogsModal(true)}
            title="יומן מערכת ויועץ AI"
            className={`px-3 py-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold relative ${ui.ghostBtn}`}
          >
            <span>✨</span>
            <span>AI ויומן</span>
            {logs.some((l) => l.type === 'error' || l.type === 'warning') && (
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
            )}
          </button>

          <button
            onClick={handleCheckUpdates}
            title="בדוק עדכוני גרסה"
            className={`px-3 py-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold ${ui.ghostBtn}`}
          >
            <span>🔄</span>
            <span className="hidden sm:inline">עדכונים</span>
          </button>

          <button
            onClick={() => {
              if (isVip) {
                setIsMiniMode(true);
              } else {
                autoCopyUserId(false);
                setShowVipPromoModal(true);
              }
            }}
            title="מצב מיני (חלון צף)"
            className={`px-3 py-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold ${ui.ghostBtn}`}
          >
            <span>⤢</span>
            <span className="hidden sm:inline">מיני</span>
          </button>
        </div>
      </nav>

      {/* אזור מרכזי: כותרת שקטה וכרטיס השעון */}
      <div className="w-full max-w-5xl flex flex-col items-center space-y-5 mb-10 print:hidden z-10">
        {updateStatus && updateStatus.type !== 'not-available' && (
          <div className={`backdrop-blur-md border p-4 rounded-2xl w-full max-w-md text-center relative transition-colors ${ui.surface}`}>
            {(updateStatus.type === 'error' || updateStatus.type === 'available' || updateStatus.type === 'downloaded') && (
              <button
                onClick={() => setUpdateStatus(null)}
                className={`absolute top-3 left-3 text-sm ${ui.textMuted} hover:opacity-100`}
                title="סגור התראה"
              >
                ✕
              </button>
            )}
            {updateStatus.type === 'checking' && <p className="text-amber-500 font-medium text-sm">מחפש עדכונים בשרת...</p>}
            {updateStatus.type === 'error' && <p className="text-red-500 font-medium text-sm">שגיאה בבדיקת עדכונים: {updateStatus.message}</p>}
            {updateStatus.type === 'available' && (
              <div className="flex flex-col items-center gap-1.5">
                <span className={`font-bold text-sm ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>🎉 נמצאה גרסה חדשה ({updateStatus.version})</span>
                <p className={`text-xs ${ui.textMuted}`}>העדכון מורד אוטומטית ברקע ללא הפרעה לעבודה...</p>
              </div>
            )}
            {updateStatus.type === 'progress' && (
              <div className="w-full">
                <p className={`font-medium text-xs mb-2 ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>מוריד עדכון אוטומטי ברקע... {updateStatus.percent}%</p>
                <div className={`w-full rounded-full h-1.5 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                  <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${updateStatus.percent}%` }}></div>
                </div>
              </div>
            )}
            {updateStatus.type === 'downloaded' && (
              <div className="flex flex-col items-center gap-2.5">
                <span className={`font-bold text-sm ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>✨ העדכון ירד ויותקן אוטומטית בסגירה הבאה</span>
                <button onClick={handleInstallUpdate} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2 rounded-xl text-xs transition-all shadow-sm">
                  או התקן והפעל מחדש עכשיו 🚀
                </button>
              </div>
            )}
          </div>
        )}

        <header className="text-center">
          <h1 className={`text-3xl md:text-4xl font-bold tracking-tight ${ui.textPrimary}`}>
            TimeTracker
          </h1>
          <p className={`mt-1.5 text-sm font-medium ${ui.textMuted}`}>
            תעריף פעיל: ₪{activeRate} לשעה {isVip && enableOvertime ? '• כולל שעות נוספות אוטומטיות' : ''}
          </p>
        </header>

        {/* כרטיס הטיימר המרכזי */}
        <div className={`backdrop-blur-xl p-7 sm:p-9 rounded-[2.25rem] flex flex-col items-center w-full max-w-md border relative transition-colors duration-500 ${ui.surface}`}>
          {isPaused && (
            <div className={`mb-4 px-4 py-1 rounded-full text-xs font-bold border ${
              isDark
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              בהפסקה • {formatTime(pauseSeconds)}
            </div>
          )}

          <div className={`flex items-center justify-between w-full rounded-2xl p-2 border gap-2 ${ui.subtleSurface}`}>
            {isVip ? (
              <select
                value={currentProjectId}
                onChange={(e) => setCurrentProjectId(e.target.value)}
                disabled={isWorking}
                className={`bg-transparent text-sm font-semibold px-2.5 outline-none cursor-pointer flex-1 truncate ${ui.textPrimary}`}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className={isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}>
                    {p.name} (₪{p.hourlyRate}/שעה)
                  </option>
                ))}
              </select>
            ) : (
              <span className={`text-sm font-semibold px-3 ${ui.textSecondary}`}>פרויקט ראשי</span>
            )}
            <button
              onClick={() => (isVip ? setShowProjectsModal(true) : setShowVipPromoModal(true))}
              className={`text-xs px-3 py-1.5 rounded-xl border font-semibold transition-colors flex items-center gap-1 whitespace-nowrap ${
                isDark
                  ? 'bg-white/5 hover:bg-white/10 text-amber-300 border-white/10'
                  : 'bg-white hover:bg-amber-50 text-amber-700 border-slate-200'
              }`}
            >
              <span>👑</span>
              <span>{isVip ? 'ניהול פרויקטים' : 'לקוח נוסף'}</span>
            </button>
          </div>

          <div
            className={`text-6xl sm:text-7xl font-mono mt-8 mb-3 font-normal tracking-tight tabular-nums transition-colors ${
              isPaused
                ? isDark ? 'text-amber-400' : 'text-amber-600'
                : isDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            {formatTime(seconds)}
          </div>

          <div className={`text-sm mb-8 px-4 py-1.5 rounded-full border ${ui.subtleSurface} ${ui.textSecondary}`}>
            שכר נצבר במשמרת:{' '}
            <span className={`font-bold font-mono ${ui.textPrimary}`}>₪{currentEarned}</span>
          </div>

          <div className="w-full flex gap-3">
            {isWorking ? (
              <>
                <button
                  onClick={handleToggleWork}
                  className={`flex-1 py-4 text-lg font-bold rounded-2xl transition-all border ${
                    isDark
                      ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30 border-red-500/35'
                      : 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200'
                  }`}
                >
                  סיום משמרת
                </button>
                <button
                  onClick={handleTogglePause}
                  className={`flex-1 py-4 text-lg font-bold rounded-2xl transition-all border ${
                    isPaused
                      ? isDark
                        ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 border-emerald-500/35'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'
                      : isDark
                      ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border-amber-500/35'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200'
                  }`}
                >
                  {isPaused ? 'חזור מהפסקה' : 'הפסקה'}
                </button>
              </>
            ) : (
              <button
                onClick={handleToggleWork}
                className="w-full py-4 text-lg font-bold rounded-2xl transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_8px_24px_rgba(16,185,129,0.28)]"
              >
                התחל עבודה
              </button>
            )}
          </div>
        </div>
      </div>

      {/* כרטיס הטבלה וסיכומי התקופה */}
      <div className={`w-full max-w-5xl backdrop-blur-xl rounded-[2.25rem] border p-5 md:p-8 z-10 relative transition-colors duration-500 print:shadow-none print:border-none print:bg-white print:text-black print:p-0 ${ui.surface}`}>
        <div className={`flex flex-col gap-5 mb-7 border-b pb-6 print:border-gray-300 print:mb-4 print:pb-4 ${ui.divider}`}>
          <div className="flex flex-wrap justify-between items-center w-full gap-3">
            <div className={`flex gap-1 p-1 rounded-xl border print:hidden ${ui.segmentWrap}`}>
              <button
                onClick={() => setViewMode('active')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === 'active' ? ui.segmentActive : ui.segmentIdle
                }`}
              >
                תקופה פעילה
              </button>
              <button
                onClick={() => setViewMode('archived')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  viewMode === 'archived' ? ui.segmentActive : ui.segmentIdle
                }`}
              >
                ארכיון (שולמו)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {viewMode === 'active' && (
                <button
                  onClick={handleArchivePeriod}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                    isDark
                      ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/35 hover:bg-indigo-500/30'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                  }`}
                >
                  סגור תקופה
                </button>
              )}
              <button
                onClick={openManualAddSession}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-1.5 ${ui.ghostBtn}`}
              >
                <span className="text-amber-500 text-xs">👑</span>
                <span>הוסף משמרת</span>
              </button>
              <button
                onClick={handleExportCSV}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-1.5 ${ui.ghostBtn}`}
              >
                <span className="text-amber-500 text-xs">👑</span>
                <span>אקסל</span>
              </button>
              <button
                onClick={handleExportPDF}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                  isDark
                    ? 'bg-blue-500/20 text-blue-200 border-blue-500/35 hover:bg-blue-500/30'
                    : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                }`}
              >
                הפק PDF
              </button>
            </div>
          </div>

          <div className="flex flex-wrap justify-between items-center w-full gap-4">
            <div className="flex print:hidden items-center flex-wrap gap-2.5">
              <div className={`flex gap-1 p-1 rounded-xl border ${ui.segmentWrap}`}>
                <button
                  onClick={() => setFilterType('month')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    filterType === 'month' ? ui.segmentActive : ui.segmentIdle
                  }`}
                >
                  החודש
                </button>
                <button
                  onClick={() => setFilterType('week')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    filterType === 'week' ? ui.segmentActive : ui.segmentIdle
                  }`}
                >
                  השבוע
                </button>
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    filterType === 'all' ? ui.segmentActive : ui.segmentIdle
                  }`}
                >
                  הכל
                </button>
              </div>

              {isVip && projects.length > 1 && (
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${ui.input}`}
                >
                  <option value="all" className={isDark ? 'bg-slate-900' : 'bg-white'}>כל הפרויקטים</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className={isDark ? 'bg-slate-900' : 'bg-white'}>{p.name}</option>
                  ))}
                </select>
              )}

              {viewMode === 'archived' && availableArchiveMonths.length > 0 && (
                <select
                  value={archiveMonth}
                  onChange={(e) => setArchiveMonth(e.target.value)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${ui.input}`}
                >
                  <option value="all" className={isDark ? 'bg-slate-900' : 'bg-white'}>כל חודשי הארכיון</option>
                  {availableArchiveMonths.map((m) => (
                    <option key={m} value={m} className={isDark ? 'bg-slate-900' : 'bg-white'}>{m}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-8 print:w-full print:justify-around print:bg-gray-100 print:p-4 print:rounded-lg">
              <div>
                <span className={`block text-xs print:text-gray-600 mb-0.5 ${ui.textMuted}`}>סה"כ שעות</span>
                <span className={`text-2xl sm:text-3xl font-bold print:text-black font-mono tabular-nums ${ui.textPrimary}`}>{dashboardStats.hours}</span>
              </div>
              <div className={`h-9 w-px print:hidden ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}></div>
              <div>
                <span className={`block text-xs print:text-gray-600 mb-0.5 ${ui.textMuted}`}>סה"כ לתשלום</span>
                <span className={`text-2xl sm:text-3xl font-bold print:text-black tabular-nums ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>₪{dashboardStats.earned}</span>
              </div>
            </div>
          </div>
        </div>

        {/* טבלת המשמרות */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-right print:text-black">
            <thead className={`border-b print:border-gray-400 uppercase text-xs tracking-wider print:text-black ${ui.divider} ${ui.textMuted}`}>
              <tr>
                <th className="pb-3 px-2 md:px-4 font-semibold">תאריך</th>
                <th className="pb-3 px-2 md:px-4 font-semibold">התחלה</th>
                <th className="pb-3 px-2 md:px-4 font-semibold">סיום</th>
                <th className="pb-3 px-2 md:px-4 font-semibold">זמן</th>
                <th className="pb-3 px-2 md:px-4 font-semibold">שכר</th>
                <th className="pb-3 px-2 md:px-4 font-semibold w-full">הערות / משימות</th>
                <th className="pb-3 px-2 md:px-4 font-semibold text-left print:hidden">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-transparent print:divide-gray-300">
              {Object.keys(groupedSessions).length === 0 ? (
                <tr>
                  <td colSpan={7} className={`text-center py-14 text-sm ${ui.textMuted}`}>אין נתונים לתקופה זו.</td>
                </tr>
              ) : (
                Object.entries(groupedSessions)
                  .sort((a, b) => parseDateToTimestamp(b[0]) - parseDateToTimestamp(a[0]))
                  .map(([date, group]) => (
                    <Fragment key={date}>
                      <tr
                        className={`cursor-pointer transition-colors border-y print:bg-gray-100 print:border-gray-400 ${
                          isDark
                            ? 'bg-slate-950/55 hover:bg-slate-950/80 border-white/5'
                            : 'bg-slate-50 hover:bg-slate-100/90 border-slate-200/80'
                        }`}
                        onClick={() => toggleDateCollapse(date)}
                      >
                        <td className={`py-3 px-2 md:px-4 font-bold print:text-black align-middle whitespace-nowrap ${ui.textPrimary}`}>
                          <span className={`print:hidden ml-2.5 text-[10px] ${ui.textMuted}`}>{collapsedDates[date] ? '◀' : '▼'}</span>
                          {date}
                        </td>
                        <td colSpan={2} className={`py-3 px-2 md:px-4 print:text-gray-600 text-xs font-medium align-middle ${ui.textMuted}`}>
                          סה"כ יומי
                        </td>
                        <td className={`py-3 px-2 md:px-4 font-bold font-mono text-sm print:text-black align-middle ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          {formatTime(group.totalSeconds)}
                        </td>
                        <td className={`py-3 px-2 md:px-4 font-bold text-sm print:text-black align-middle ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          ₪{group.totalEarned.toFixed(2)}
                        </td>
                        <td colSpan={2} className="py-3 px-2 md:px-4 print:hidden"></td>
                      </tr>

                      {!collapsedDates[date] &&
                        group.sessions.map((session) => (
                          <tr
                            key={session.id}
                            className={`transition-colors print:hover:bg-transparent text-sm border-b last:border-0 ${
                              isDark
                                ? 'hover:bg-white/[0.03] border-white/5'
                                : 'hover:bg-slate-50/70 border-slate-100'
                            }`}
                          >
                            <td className={`py-3.5 px-2 md:px-4 font-mono text-xs whitespace-nowrap print:text-gray-700 print:font-normal align-middle ${ui.textMuted}`}>
                              {session.date}
                            </td>
                            <td className={`py-3.5 px-2 md:px-4 align-middle ${ui.textSecondary}`}>{session.start}</td>
                            <td className={`py-3.5 px-2 md:px-4 align-middle ${ui.textSecondary}`}>{session.end}</td>
                            <td className={`py-3.5 px-2 md:px-4 font-mono align-middle ${ui.textSecondary}`}>{session.duration}</td>
                            <td className={`py-3.5 px-2 md:px-4 font-bold print:font-normal align-middle ${ui.textPrimary}`}>
                              ₪{getValidEarned(session).toFixed(2)}
                            </td>
                            <td className={`py-3.5 px-2 md:px-4 whitespace-pre-wrap align-middle break-words min-w-[150px] ${ui.textSecondary}`}>
                              {isVip && session.projectName && session.projectName !== 'פרויקט נוכחי (ראשי)' && (
                                <span className={`inline-block text-xs px-2 py-0.5 rounded-md ml-2 mb-1 font-medium border ${
                                  isDark
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}>
                                  {session.projectName}
                                </span>
                              )}
                              {session.note}
                            </td>
                            <td className="py-3.5 px-2 md:px-4 print:hidden align-middle">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  title="ערוך הערה"
                                  onClick={() => {
                                    setEditingNoteId(session.id);
                                    setEditNoteText(session.note || '');
                                  }}
                                  className={`w-8 h-8 rounded-xl border text-xs transition-all flex items-center justify-center ${ui.ghostBtn}`}
                                >
                                  📝
                                </button>
                                <button
                                  title="ערוך שעות (VIP)"
                                  onClick={() => openFullEditSession(session)}
                                  className={`w-8 h-8 rounded-xl border text-xs transition-all flex items-center justify-center ${ui.ghostBtn}`}
                                >
                                  👑
                                </button>
                                <button
                                  title="מחק משמרת"
                                  onClick={() => handleDeleteSession(session.id)}
                                  className={`w-8 h-8 rounded-xl border text-xs transition-all flex items-center justify-center ${
                                    isDark
                                      ? 'bg-white/[0.04] hover:bg-red-500/20 text-red-400 border-white/10'
                                      : 'bg-white hover:bg-red-50 text-red-500 border-slate-200'
                                  }`}
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

      {/* פאנל תחתון נקי ושקט */}
      <footer className={`w-full max-w-5xl mt-8 mb-4 px-5 py-3.5 rounded-2xl border backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs print:hidden z-10 transition-colors duration-500 ${ui.subtleSurface} ${ui.textMuted}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`font-bold ${ui.textPrimary}`}>⏱️ TimeTracker</span>
          <span className="font-mono text-[11px] opacity-75">v{APP_CLIENT_VERSION}</span>
          <span className="opacity-40">•</span>
          <span>עדכונים אוטומטיים פעילים</span>
          <span className="opacity-40 hidden sm:inline">•</span>
          <span className="hidden sm:inline">שמירה מקומית מאובטחת על המחשב</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowAboutModal(true)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 ${ui.ghostBtn}`}
          >
            <span>ℹ️</span>
            <span>אודות והסבר על התוכנה</span>
          </button>
          <button
            onClick={() => setShowShareModal(true)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 ${
              isDark
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/25'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
            }`}
          >
            <span>🔗</span>
            <span>שתף את התוכנה</span>
          </button>
        </div>
      </footer>

      {/* --- מודאל אישור מותאם אישית --- */}
      {confirmDialog && confirmDialog.isOpen && (
        <div className={`fixed inset-0 flex items-center justify-center z-[105] p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-md border text-right ${ui.modalSurface}`}>
            <h3 className={`text-xl font-bold mb-2.5 ${ui.textPrimary}`}>{confirmDialog.title}</h3>
            <p className={`mb-6 text-sm leading-relaxed whitespace-pre-line ${ui.textSecondary}`}>{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  fn();
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm py-3 rounded-xl font-bold text-sm transition-all"
              >
                {confirmDialog.confirmText}
              </button>
              <button
                onClick={() => setConfirmDialog(null)}
                className={`flex-1 border py-3 rounded-xl text-sm font-semibold transition-all ${ui.ghostBtn}`}
              >
                {confirmDialog.cancelText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל חוסר פעילות (Idle) --- */}
      {showIdleModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-9 rounded-[2rem] w-full max-w-md border text-center max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <div className="text-6xl mb-4">💤</div>
            <h3 className={`text-2xl font-bold mb-2 ${ui.textPrimary}`}>עדיין פה?</h3>
            <p className={`mb-7 text-sm leading-relaxed ${ui.textSecondary}`}>
              זיהינו חוסר פעילות במחשב במשך 5 דקות. הטיימר הושהה בינתיים.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleStillHere}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md py-3.5 rounded-2xl font-bold text-sm transition-all"
              >
                כן, אני ממשיך לעבוד
              </button>
              <button
                onClick={handleStopFromIdle}
                className={`w-full border py-3.5 rounded-2xl font-semibold text-sm transition-all ${ui.ghostBtn}`}
              >
                לא, סיימתי כשהלכתי
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל עריכת הערת משמרת --- */}
      {editingNoteId !== null && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-lg border max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <h3 className={`text-xl font-bold mb-3 ${ui.textPrimary}`}>עריכת הערת משמרת</h3>
            <textarea
              value={editNoteText}
              onChange={(e) => setEditNoteText(e.target.value)}
              className={`w-full border rounded-xl p-4 mb-5 h-32 transition-all outline-none text-sm ${ui.input}`}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSessions(sessions.map((s) => (s.id === editingNoteId ? { ...s, note: editNoteText } : s)));
                  setEditingNoteId(null);
                  showToast('ההערה עודכנה בהצלחה!', 'success');
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white shadow-sm py-3 rounded-xl font-bold text-sm transition-all"
              >
                שמור שינויים
              </button>
              <button
                onClick={() => setEditingNoteId(null)}
                className={`flex-1 border py-3 rounded-xl text-sm font-semibold transition-all ${ui.ghostBtn}`}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל הוספה / עריכת שעות משמרת מלאה (VIP) --- */}
      {showSessionFormModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-lg border max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <h3 className={`text-xl font-bold mb-5 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              👑 {editingFullSessionId !== null ? 'עריכת משמרת' : 'הוספת משמרת ידנית'}
            </h3>
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${ui.textMuted}`}>תאריך (DD.MM.YYYY)</label>
                  <input
                    type="text"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className={`w-full p-3 rounded-xl border outline-none text-sm ${ui.input}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${ui.textMuted}`}>תעריף שעתי (₪)</label>
                  <input
                    type="number"
                    value={formRate}
                    onChange={(e) => setFormRate(Number(e.target.value) || 0)}
                    className={`w-full p-3 rounded-xl border outline-none text-sm ${ui.input}`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${ui.textMuted}`}>שעת התחלה</label>
                  <input
                    type="time"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className={`w-full p-3 rounded-xl border outline-none text-sm ${ui.input}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${ui.textMuted}`}>שעת סיום</label>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className={`w-full p-3 rounded-xl border outline-none text-sm ${ui.input}`}
                  />
                </div>
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${ui.textMuted}`}>לקוח / פרויקט</label>
                <select
                  value={formProjectId}
                  onChange={(e) => {
                    setFormProjectId(e.target.value);
                    const found = projects.find((p) => p.id === e.target.value);
                    if (found) setFormRate(found.hourlyRate);
                  }}
                  className={`w-full p-3 rounded-xl border outline-none text-sm ${ui.input}`}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className={isDark ? 'bg-slate-900' : 'bg-white'}>
                      {p.name} (₪{p.hourlyRate})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${ui.textMuted}`}>פירוט משימות / הערה</label>
                <textarea
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className={`w-full border rounded-xl p-3 h-24 outline-none text-sm ${ui.input}`}
                  placeholder="תיאור העבודה..."
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveFullSessionForm}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 py-3 rounded-xl font-bold text-sm transition-all shadow-sm"
              >
                שמור משמרת
              </button>
              <button
                onClick={() => setShowSessionFormModal(false)}
                className={`flex-1 border py-3 rounded-xl text-sm font-semibold transition-all ${ui.ghostBtn}`}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל ניהול לקוחות ופרויקטים (VIP) --- */}
      {showProjectsModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-md border max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <h3 className={`text-xl font-bold mb-4 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>👑 ניהול לקוחות ופרויקטים</h3>
            <div className="space-y-2 mb-5 max-h-52 overflow-y-auto">
              {projects.map((p) => (
                <div key={p.id} className={`flex items-center justify-between p-3 rounded-xl border ${ui.subtleSurface}`}>
                  <div>
                    <div className={`font-bold text-sm ${ui.textPrimary}`}>{p.name}</div>
                    <div className={`text-xs font-semibold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>₪{p.hourlyRate} לשעה</div>
                  </div>
                  <div className="flex gap-2">
                    {currentProjectId !== p.id && (
                      <button
                        onClick={() => setCurrentProjectId(p.id)}
                        className={`text-xs px-3 py-1 rounded-lg border font-semibold ${
                          isDark
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        בחר
                      </button>
                    )}
                    {p.id !== 'default' && (
                      <button
                        onClick={() => handleDeleteProject(p.id)}
                        className={`text-xs px-2.5 py-1 rounded-lg border ${
                          isDark
                            ? 'bg-red-500/15 text-red-300 border-red-500/30'
                            : 'bg-red-50 text-red-600 border-red-200'
                        }`}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className={`border-t pt-4 mb-5 space-y-3 ${ui.divider}`}>
              <span className={`block text-xs font-bold ${ui.textSecondary}`}>הוסף לקוח / פרויקט חדש</span>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="שם הלקוח או הפרויקט..."
                className={`w-full p-3 rounded-xl border outline-none text-sm ${ui.input}`}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={newProjectRate}
                  onChange={(e) => setNewProjectRate(Number(e.target.value) || 0)}
                  placeholder="תעריף"
                  className={`w-28 p-3 rounded-xl border outline-none text-sm ${ui.input}`}
                />
                <button
                  onClick={handleAddProject}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm transition-all"
                >
                  + הוסף פרויקט
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowProjectsModal(false)}
              className={`w-full border py-3 rounded-xl font-bold text-sm transition-all ${ui.ghostBtn}`}
            >
              סגור
            </button>
          </div>
        </div>
      )}

      {/* --- מודאל הגדרות וגיבוי --- */}
      {showSettingsModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-md border max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className={`text-xl font-bold ${ui.textPrimary}`}>הגדרות וגיבוי</h3>
              <button onClick={() => setShowSettingsModal(false)} className={`w-8 h-8 rounded-full flex items-center justify-center ${ui.ghostBtn}`}>✕</button>
            </div>

            <div className="space-y-5 mb-7">
              <div>
                <label className={`block text-xs font-bold mb-2 ${ui.textMuted}`}>תצוגת יום / לילה</label>
                <div className={`grid grid-cols-3 gap-1 p-1 rounded-xl border ${ui.segmentWrap}`}>
                  <button
                    onClick={() => setThemeMode('auto')}
                    className={`py-2 rounded-lg text-xs font-bold transition-all ${themeMode === 'auto' ? ui.segmentActive : ui.segmentIdle}`}
                  >
                    ✨ אוטומטי
                  </button>
                  <button
                    onClick={() => setThemeMode('light')}
                    className={`py-2 rounded-lg text-xs font-bold transition-all ${themeMode === 'light' ? ui.segmentActive : ui.segmentIdle}`}
                  >
                    ☀️ יום
                  </button>
                  <button
                    onClick={() => setThemeMode('dark')}
                    className={`py-2 rounded-lg text-xs font-bold transition-all ${themeMode === 'dark' ? ui.segmentActive : ui.segmentIdle}`}
                  >
                    🌙 לילה
                  </button>
                </div>
                <p className={`text-[11px] mt-1.5 ${ui.textMuted}`}>
                  במצב אוטומטי התוכנה עוברת לבהיר בשעות היום (06:00–19:00) ולכהה בלילה.
                </p>
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <label className={`block text-xs font-bold mb-2 ${ui.textMuted}`}>תעריף שעתי בסיסי (₪)</label>
                <input
                  type="number"
                  min={0}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Math.max(0, Number(e.target.value) || 0))}
                  className={`w-full p-3 rounded-xl border transition-all outline-none text-sm font-mono ${ui.input}`}
                  dir="ltr"
                />
                {isVip && (
                  <p className={`text-[11px] mt-1.5 ${ui.textMuted}`}>
                    במסלול VIP ניתן להגדיר תעריף נפרד לכל לקוח/פרויקט דרך "ניהול פרויקטים".
                  </p>
                )}
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <label className={`block text-xs font-bold mb-2 ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>🌐 מזהה התקנה וסנכרון ענן</label>
                <div className={`p-3.5 rounded-xl border space-y-3 ${ui.subtleSurface}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className={`text-[11px] block ${ui.textMuted}`}>מזהה אישי:</span>
                      <span className={`font-mono font-bold text-sm select-all ${isDark ? 'text-amber-300' : 'text-amber-700'}`} dir="ltr">{appUserId}</span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(appUserId);
                        showToast('מזהה ההתקנה הועתק!', 'success');
                      }}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${ui.ghostBtn}`}
                    >
                      📋 העתק
                    </button>
                  </div>
                  <input
                    type="text"
                    value={userDisplayName}
                    onChange={(e) => setUserDisplayName(e.target.value)}
                    placeholder="השם או האימייל שלך..."
                    className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                  />
                  <button
                    onClick={() => syncWithServer(true)}
                    disabled={isSyncingServer}
                    className={`w-full py-2 rounded-lg text-xs font-bold border transition-all disabled:opacity-50 ${
                      isDark
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    {isSyncingServer ? 'מסנכרן מול השרת...' : '🔄 סנכרן סטטוס מול השרת'}
                  </button>
                </div>
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className={`block text-xs font-bold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>🤖 מפתח API של Google Gemini</label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                      isDark
                        ? 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 border-purple-500/30'
                        : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                    }`}
                  >
                    🔑 קבל מפתח חינם ↗
                  </a>
                </div>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className={`w-full p-3 rounded-xl border transition-all outline-none text-sm ${ui.input}`}
                  dir="ltr"
                />
                <p className={`text-[11px] mt-1.5 leading-relaxed ${ui.textMuted}`}>
                  להפעלת יועץ ה-AI, היכנס ל-Google AI Studio דרך הקישור למעלה, לחץ על Create API key והדבק כאן.
                </p>
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <div className={`flex items-center justify-between p-3.5 rounded-xl border ${ui.subtleSurface}`}>
                  <div>
                    <span className={`block font-semibold text-sm ${ui.textPrimary}`}>חישוב שעות נוספות אוטומטי</span>
                    <span className={`block text-xs mt-0.5 ${ui.textMuted}`}>125% ו-150% מעל {overtimeThresholdHours} שעות</span>
                  </div>
                  {isVip ? (
                    <button
                      onClick={() => setEnableOvertime(!enableOvertime)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        enableOvertime
                          ? isDark ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : ui.ghostBtn
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
                      className={`px-3.5 py-1.5 rounded-lg text-xs border font-bold whitespace-nowrap ${
                        isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      👑 VIP
                    </button>
                  )}
                </div>
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <div className={`p-3.5 rounded-xl border space-y-3 ${ui.subtleSurface}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`block font-semibold text-sm ${ui.textPrimary}`}>פרטי עסק לדוח PDF</span>
                      <span className={`block text-xs mt-0.5 ${ui.textMuted}`}>שם עסק, ח.פ ופרטי בנק</span>
                    </div>
                    {!isVip && (
                      <button
                        onClick={() => {
                          setShowSettingsModal(false);
                          setShowVipPromoModal(true);
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-xs border font-bold whitespace-nowrap ${
                          isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        👑 VIP
                      </button>
                    )}
                  </div>
                  {isVip && (
                    <div className="space-y-2 pt-1">
                      <input
                        type="text"
                        value={businessDetails.businessName}
                        onChange={(e) => setBusinessDetails({ ...businessDetails, businessName: e.target.value })}
                        placeholder="שם מלא / שם העסק"
                        className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={businessDetails.businessId}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, businessId: e.target.value })}
                          placeholder="ח.פ / ת.ז"
                          className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                        />
                        <input
                          type="text"
                          value={businessDetails.clientName}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, clientName: e.target.value })}
                          placeholder="שם הלקוח לדוח"
                          className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={businessDetails.bankName}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, bankName: e.target.value })}
                          placeholder="בנק"
                          className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                        />
                        <input
                          type="text"
                          value={businessDetails.bankBranch}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, bankBranch: e.target.value })}
                          placeholder="סניף"
                          className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                        />
                        <input
                          type="text"
                          value={businessDetails.bankAccount}
                          onChange={(e) => setBusinessDetails({ ...businessDetails, bankAccount: e.target.value })}
                          placeholder="מס' חשבון"
                          className={`w-full p-2.5 rounded-lg border text-xs outline-none ${ui.input}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <label className={`block text-xs font-bold mb-2.5 ${ui.textMuted}`}>כספת גיבוי (JSON)</label>
                <div className="flex gap-2.5">
                  <button
                    onClick={handleDownloadBackupJSON}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-colors flex justify-center items-center gap-1.5 ${ui.ghostBtn}`}
                  >
                    <span className="text-amber-500">👑</span> הורד גיבוי
                  </button>
                  <button
                    onClick={() => (isVip ? fileInputRef.current?.click() : setShowVipPromoModal(true))}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-colors flex justify-center items-center gap-1.5 ${ui.ghostBtn}`}
                  >
                    <span className="text-amber-500">👑</span> שחזר מגיבוי
                  </button>
                </div>
              </div>

              <div className={`pt-5 border-t ${ui.divider}`}>
                <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>🔄 איפוס נתונים ומערכת</label>
                <p className={`text-[11px] mb-3 ${ui.textMuted}`}>
                  התחלה מחדש בצורה נקייה. מזהה ההתקנה וסטטוס ה-VIP שלך נשמרים גם לאחר האיפוס.
                </p>
                <div className="flex gap-2.5">
                  <button
                    onClick={handleResetSessionsOnly}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
                      isDark
                        ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                    }`}
                  >
                    🗑️ אפס משמרות
                  </button>
                  <button
                    onClick={handleFullSystemReset}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                      isDark
                        ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/35'
                        : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                    }`}
                  >
                    ⚠️ איפוס מלא
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold text-sm transition-all"
            >
              סגור הגדרות
            </button>
          </div>
        </div>
      )}

      {/* --- מודאל סיכום משמרת --- */}
      {showModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-lg border max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <h3 className={`text-xl font-bold mb-1.5 ${ui.textPrimary}`}>סיכום משמרת</h3>
            <p className={`text-xs mb-4 ${ui.textMuted}`}>
              משך: {formatTime(seconds)} • שכר: ₪{currentEarned}
            </p>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="פירוט משימות שבוצעו במשמרת..."
              className={`w-full border rounded-xl p-4 mb-5 h-32 transition-all outline-none text-sm ${ui.input}`}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleSaveSession}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm py-3 rounded-xl font-bold text-sm transition-all"
              >
                שמור וסיים
              </button>
              <button
                onClick={handleCancelSave}
                className={`flex-1 border py-3 rounded-xl text-sm font-semibold transition-all ${ui.ghostBtn}`}
              >
                בטל סיום
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל יומן מערכת ויועץ AI --- */}
      {showLogsModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-2xl border max-h-[90vh] flex flex-col ${ui.modalSurface}`}>
            <div className="flex justify-between items-center mb-4">
              <h3 className={`text-xl font-bold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>✨ יומן מערכת ויועץ AI</h3>
              <button onClick={() => setShowLogsModal(false)} className={`w-8 h-8 rounded-full flex items-center justify-center ${ui.ghostBtn}`}>✕</button>
            </div>
            <div className="flex gap-2.5 mb-4">
              <button
                onClick={askAIForProductivityReport}
                disabled={isAiLoading}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all disabled:opacity-50 ${
                  isDark
                    ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border-purple-500/30'
                    : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                }`}
              >
                {isAiLoading ? 'מנתח נתונים...' : '✨ הפק תובנות עבודה ב-AI'}
              </button>
              <button
                onClick={() => setLogs([])}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border ${ui.ghostBtn}`}
              >
                נקה יומן
              </button>
            </div>
            <div className={`flex-1 overflow-y-auto space-y-2.5 p-4 rounded-2xl border min-h-[260px] ${ui.subtleSurface}`}>
              {logs.length === 0 ? (
                <p className={`text-center py-10 text-sm ${ui.textMuted}`}>אין אירועים ביומן כרגע.</p>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-xl border text-sm ${
                      log.type === 'error'
                        ? isDark ? 'bg-red-950/40 border-red-500/30 text-red-200' : 'bg-red-50 border-red-200 text-red-700'
                        : log.type === 'warning'
                        ? isDark ? 'bg-amber-950/40 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'
                        : log.type === 'ai'
                        ? isDark ? 'bg-purple-950/50 border-purple-500/40 text-purple-100 whitespace-pre-wrap' : 'bg-purple-50 border-purple-200 text-purple-900 whitespace-pre-wrap'
                        : isDark ? 'bg-white/5 border-white/10 text-slate-200' : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <span className={`font-mono text-xs ml-2 ${ui.textMuted}`}>[{log.time}]</span>
                        <span>{log.msg}</span>
                      </div>
                      {log.type !== 'ai' && (
                        <button
                          onClick={() => askAIAboutLog(log.msg)}
                          disabled={isAiLoading}
                          className={`text-xs px-2.5 py-1 rounded-lg border whitespace-nowrap font-medium ${
                            isDark
                              ? 'bg-purple-500/20 hover:bg-purple-500/35 text-purple-200 border-purple-500/30'
                              : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                          }`}
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
        <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 sm:p-8 rounded-[2.25rem] w-full max-w-md border text-center relative max-h-[90vh] overflow-y-auto ${ui.modalSurface}`}>
            <button
              onClick={() => setShowVipPromoModal(false)}
              className={`absolute top-5 left-5 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${ui.ghostBtn}`}
            >
              ✕
            </button>

            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-3 border ${
              isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/35' : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              <span>👑</span>
              <span>מסלול VIP Pro • בטא חינמית</span>
            </div>

            <h3 className={`text-2xl font-bold mb-2 ${ui.textPrimary}`}>בקשת גישת בטא ל-VIP</h3>
            <p className={`mb-5 text-sm leading-relaxed ${ui.textSecondary}`}>
              ריבוי לקוחות ופרויקטים, עריכת שעות ידנית, חלון מיני צף בפינת המסך, שעות נוספות אוטומטיות, מיתוג PDF וייצוא לאקסל.
            </p>

            <div className={`border rounded-2xl p-3.5 mb-5 space-y-2 text-right ${ui.subtleSurface}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className={`block text-[11px] ${ui.textMuted}`}>מזהה התקנה (מצורף אוטומטית):</span>
                  <span className={`font-mono font-bold text-sm select-all ${isDark ? 'text-amber-300' : 'text-amber-700'}`} dir="ltr">{appUserId}</span>
                </div>
                <button
                  onClick={() => syncWithServer(true)}
                  disabled={isSyncingServer}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-bold disabled:opacity-50 whitespace-nowrap ${
                    isDark
                      ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                  }`}
                  title="בדוק אם נפתח לך VIP מרחוק"
                >
                  {isSyncingServer ? '...' : '🔄 בדוק אישור'}
                </button>
              </div>
              <div className={`flex items-center justify-between text-[11px] pt-1.5 border-t ${ui.divider}`}>
                <span className={`font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                  {idAutoCopied ? '✔️ הועתק אוטומטית ללוח' : '✔️ מצורף אוטומטית לפנייה'}
                </span>
                <button
                  onClick={() => autoCopyUserId(true)}
                  className={`underline transition-colors ${ui.textMuted}`}
                >
                  העתק שוב
                </button>
              </div>
            </div>

            {waitlistJoined ? (
              <div className={`border rounded-2xl p-5 mb-5 text-center ${
                isDark ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
              }`}>
                <div className="text-3xl mb-2">🎉</div>
                <p className={`font-bold text-base mb-1 ${isDark ? 'text-emerald-300' : 'text-emerald-800'}`}>הבקשה שלך התקבלה</p>
                <p className={`text-xs mb-3 ${ui.textSecondary}`}>
                  ברגע שייפתח לך VIP, התוכנה תתעדכן אצלך אוטומטית.
                </p>
                <button
                  onClick={() => setWaitlistJoined(false)}
                  className={`text-xs underline font-semibold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}
                >
                  שלח הודעה נוספת למנהל ✉️
                </button>
              </div>
            ) : (
              <div className={`border rounded-2xl p-4 mb-5 text-right space-y-3 ${ui.subtleSurface}`}>
                <span className={`block text-xs font-bold text-center ${ui.textPrimary}`}>
                  שלח בקשה לפתיחת VIP או הצטרפות לרשימת ההמתנה
                </span>
                <input
                  type="text"
                  value={waitlistName}
                  onChange={(e) => setWaitlistName(e.target.value)}
                  placeholder="שם מלא..."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none ${ui.input}`}
                />
                <input
                  type="text"
                  value={waitlistContact}
                  onChange={(e) => setWaitlistContact(e.target.value)}
                  placeholder="אימייל או טלפון לעדכון..."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none ${ui.input}`}
                />
                <textarea
                  value={waitlistMessage}
                  onChange={(e) => setWaitlistMessage(e.target.value)}
                  rows={2}
                  placeholder="הודעה למנהל (אופציונלי)..."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm outline-none resize-none ${ui.input}`}
                />
                <button
                  onClick={handleJoinWaitlist}
                  disabled={isSubmittingWaitlist}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm px-6 py-3 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {isSubmittingWaitlist ? 'שולח...' : 'שלח בקשה לפתיחת VIP 🔔'}
                </button>
              </div>
            )}

            <div className={`border-t pt-3 ${ui.divider}`}>
              <button
                onClick={() => setShowBetaCodeInput((prev) => !prev)}
                className={`text-xs transition-colors ${ui.textMuted}`}
              >
                {showBetaCodeInput ? 'הסתר הזנת קוד גישה ▲' : 'יש לך קוד גישה מוקדמת? ▼'}
              </button>

              {showBetaCodeInput && (
                <div className="mt-3 text-right space-y-2">
                  <input
                    type="text"
                    value={licenseClientInput}
                    onChange={(e) => setLicenseClientInput(e.target.value)}
                    placeholder="שם או אימייל (אופציונלי)..."
                    className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${ui.input}`}
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder="הזן קוד גישה..."
                      className={`flex-1 px-3 py-2 rounded-xl border text-xs font-mono uppercase outline-none ${ui.input}`}
                      dir="ltr"
                    />
                    <button
                      onClick={handleActivateLicense}
                      disabled={isActivating}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all disabled:opacity-50"
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
        <div className={`fixed inset-0 flex items-center justify-center z-[95] p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-md border text-right ${ui.modalSurface}`}>
            <h3 className={`text-xl font-bold mb-4 ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>🔐 מחולל רישיונות VIP למנהל</h3>
            <input
              type="text"
              value={keygenClientName}
              onChange={(e) => setKeygenClientName(e.target.value)}
              placeholder="הקלד אימייל או שם לקוח..."
              className={`w-full p-3 rounded-xl border mb-4 outline-none text-sm ${ui.input}`}
            />
            {keygenClientName.trim() && (
              <div className={`p-4 rounded-xl text-center mb-4 border ${ui.subtleSurface}`}>
                <span className={`text-2xl font-mono font-bold select-all ${ui.textPrimary}`}>
                  {generateLicenseKeyForClient(keygenClientName)}
                </span>
              </div>
            )}
            <button
              onClick={() => setShowKeygenModal(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-sm"
            >
              סגור מחולל
            </button>
          </div>
        </div>
      )}

      {/* --- מודאל הודעות מערכת מממשק המנהל --- */}
      {adminMessagesQueue.length > 0 && (() => {
        const currentMsg = adminMessagesQueue[0];
        const isVipStyle = currentMsg.style === 'vip';
        const isWarningStyle = currentMsg.style === 'warning';
        return (
          <div className={`fixed inset-0 flex items-center justify-center z-[115] p-4 print:hidden ${ui.modalBackdrop}`}>
            <div className={`p-8 rounded-[2rem] w-full max-w-md border text-center relative ${ui.modalSurface}`}>
              <div className="text-4xl mb-3">
                {isVipStyle ? '👑' : isWarningStyle ? '⚠️' : '📢'}
              </div>
              <span
                className={`inline-block text-xs font-bold px-3 py-1 rounded-full mb-3 border ${
                  isVipStyle
                    ? isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200'
                    : isWarningStyle
                    ? isDark ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' : 'bg-orange-50 text-orange-700 border-orange-200'
                    : isDark ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {currentMsg.target_user_id ? 'הודעה אישית עבורך' : 'הודעת מערכת • TimeTracker'}
              </span>
              <h3 className={`text-xl font-bold mb-2.5 ${ui.textPrimary}`}>{currentMsg.title}</h3>
              <p className={`text-sm leading-relaxed whitespace-pre-line mb-6 ${ui.textSecondary}`}>
                {currentMsg.body}
              </p>
              <button
                onClick={() => handleDismissAdminMessage(currentMsg.id)}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all shadow-sm ${
                  isVipStyle
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    : isWarningStyle
                    ? 'bg-orange-500 hover:bg-orange-400 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                הבנתי, תודה ✔️
              </button>
            </div>
          </div>
        );
      })()}

      {/* --- מודאל אזור אישי --- */}
      {showPersonalAreaModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-[90] p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`rounded-[2rem] w-full max-w-xl border text-right max-h-[88vh] flex flex-col overflow-hidden ${ui.modalSurface}`}>
            <div className={`px-7 pt-6 pb-5 border-b flex items-center justify-between gap-4 ${ui.divider}`}>
              <div className="flex items-center gap-3.5">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl border ${
                  isVip
                    ? isDark ? 'bg-amber-500/15 border-amber-500/35 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'
                    : isDark ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}>
                  {isVip ? '👑' : '👤'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className={`text-lg font-bold leading-tight ${ui.textPrimary}`}>
                      {vipOwnerName || userDisplayName || 'האזור האישי שלי'}
                    </h3>
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                      isVip
                        ? isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                        : isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {isVip ? 'VIP Pro' : 'חינמי'}
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 ${ui.textMuted}`}>
                    ניהול מנוי, פרטי חשבון והודעות מערכת
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPersonalAreaModal(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${ui.ghostBtn}`}
                title="סגור"
              >
                ✕
              </button>
            </div>

            <div className="px-7 pt-5">
              <div className={`grid grid-cols-3 gap-1 p-1 rounded-xl border ${ui.segmentWrap}`}>
                <button
                  onClick={() => setPersonalAreaTab('overview')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    personalAreaTab === 'overview' ? ui.segmentActive : ui.segmentIdle
                  }`}
                >
                  חשבון ומנוי
                </button>
                <button
                  onClick={() => setPersonalAreaTab('plan')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    personalAreaTab === 'plan' ? ui.segmentActive : ui.segmentIdle
                  }`}
                >
                  יכולות המסלול
                </button>
                <button
                  onClick={() => setPersonalAreaTab('messages')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    personalAreaTab === 'messages' ? ui.segmentActive : ui.segmentIdle
                  }`}
                >
                  <span>הודעות</span>
                  {allUserAdminMessages.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isDark ? 'bg-blue-500/25 text-blue-300' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {allUserAdminMessages.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
              {personalAreaTab === 'overview' && (
                <>
                  <div className={`p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isVip
                      ? isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50/70 border-amber-200'
                      : ui.subtleSurface
                  }`}>
                    <div>
                      <span className={`text-xs font-medium block ${ui.textMuted}`}>סטטוס מנוי</span>
                      <h4 className={`text-lg font-bold mt-0.5 ${isVip ? (isDark ? 'text-amber-300' : 'text-amber-800') : ui.textPrimary}`}>
                        {isVip ? '👑 מנוי VIP Pro פעיל' : 'גרסה חינמית (פתוחה לתמיד)'}
                      </h4>
                      <span className={`text-xs block mt-1 ${ui.textSecondary}`}>
                        {isVip
                          ? vipExpiresAt
                            ? `בתוקף עד ${new Date(vipExpiresAt).toLocaleDateString('he-IL')}`
                            : 'גישה מלאה ללא הגבלת זמן'
                          : waitlistJoined
                          ? '⏳ בקשת גישת הבטא שלך נשלחה וממתינה לאישור המנהל'
                          : 'בקש גישת בטא כדי לפתוח ריבוי לקוחות, אקסל וחלון מיני צף'}
                      </span>
                    </div>

                    {!isVip ? (
                      <button
                        onClick={() => {
                          setShowPersonalAreaModal(false);
                          autoCopyUserId(false);
                          setShowVipPromoModal(true);
                        }}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-sm whitespace-nowrap"
                      >
                        {waitlistJoined ? '🔄 בדוק אישור בטא' : '👑 בקש גישת בטא'}
                      </button>
                    ) : (
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap self-start sm:self-center ${
                        isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        ✓ פעיל ומאומת
                      </span>
                    )}
                  </div>

                  <div className={`rounded-2xl border divide-y overflow-hidden ${ui.subtleSurface} ${isDark ? 'divide-white/10' : 'divide-slate-200/80'}`}>
                    <div className="p-4 space-y-2">
                      <label className={`block text-xs font-semibold ${ui.textMuted}`}>שם תצוגה בחשבון</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={userDisplayName}
                          onChange={(e) => setUserDisplayName(e.target.value)}
                          placeholder="הזן שם מלא או אימייל..."
                          className={`flex-1 px-3.5 py-2 rounded-xl border text-sm outline-none ${ui.input}`}
                        />
                        <button
                          onClick={() => {
                            if (userDisplayName.trim()) {
                              localStorage.removeItem('tt_name_cleared');
                            }
                            syncWithServer(true);
                            showToast('הפרטים נשמרו וסונכרנו ✔️', 'success');
                          }}
                          disabled={isSyncingServer}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap disabled:opacity-50"
                        >
                          שמור
                        </button>
                      </div>
                    </div>

                    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className={`block text-xs font-semibold ${ui.textMuted}`}>מזהה התקנה אישי</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`font-mono text-sm font-bold select-all ${ui.textPrimary}`} dir="ltr">{appUserId}</span>
                          <span className={`text-[11px] font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            {idAutoCopied ? '• הועתק אוטומטית' : '• מצורף אוטומטית'}
                          </span>
                        </div>
                        {lastServerSyncTime && (
                          <span className={`block text-[11px] mt-0.5 ${ui.textMuted}`}>
                            סונכרן לאחרונה בשעה {lastServerSyncTime}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => syncWithServer(true)}
                        disabled={isSyncingServer}
                        className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50 ${ui.ghostBtn}`}
                      >
                        {isSyncingServer ? 'מסנכרן...' : '🔄 סנכרן עכשיו'}
                      </button>
                    </div>
                  </div>

                  <div className={`flex flex-wrap items-center justify-between gap-2 px-1 text-xs ${ui.textMuted}`}>
                    <span>משמרות פעילות: <strong className={ui.textPrimary}>{sessions.filter((s) => !s.isArchived).length}</strong></span>
                    <span>•</span>
                    <span>בארכיון: <strong className={ui.textPrimary}>{sessions.filter((s) => s.isArchived).length}</strong></span>
                    <span>•</span>
                    <span>פרויקטים: <strong className={ui.textPrimary}>{projects.length}</strong></span>
                    <span>•</span>
                    <span className="font-mono">v{APP_CLIENT_VERSION}</span>
                  </div>
                </>
              )}

              {personalAreaTab === 'plan' && (
                <div className="space-y-4">
                  <div className={`rounded-2xl border divide-y overflow-hidden ${ui.subtleSurface} ${isDark ? 'divide-white/10' : 'divide-slate-200/80'}`}>
                    {[
                      { title: 'טיימר חכם חסין כיבוי + הפסקות', vipOnly: false, actionLabel: null },
                      { title: 'זיהוי חוסר פעילות אוטומטי (5 דק׳)', vipOnly: false, actionLabel: null },
                      { title: 'הפקת דוחות PDF וארכיון תקופות', vipOnly: false, actionLabel: null },
                      { title: 'יועץ Gemini AI ויומן מערכת', vipOnly: false, actionLabel: null },
                      { title: 'ניהול מספר לקוחות ותעריפים שונים', vipOnly: true, actionLabel: 'פתח', onAction: () => { setShowPersonalAreaModal(false); setShowProjectsModal(true); } },
                      { title: 'הוספת משמרת ידנית ועריכת שעות', vipOnly: true, actionLabel: 'הוסף', onAction: () => { setShowPersonalAreaModal(false); openManualAddSession(); } },
                      { title: 'חישוב שעות נוספות (125% / 150%)', vipOnly: true, actionLabel: 'הגדר', onAction: () => { setShowPersonalAreaModal(false); setShowSettingsModal(true); } },
                      { title: 'מיתוג PDF (ח.פ ובנק) + ייצוא אקסל', vipOnly: true, actionLabel: 'הגדר', onAction: () => { setShowPersonalAreaModal(false); setShowSettingsModal(true); } },
                      { title: 'מצב מיני צף וגיבוי JSON מלא', vipOnly: true, actionLabel: 'הפעל', onAction: () => { setShowPersonalAreaModal(false); setIsMiniMode(true); } },
                    ].map((feat, idx) => {
                      const unlocked = !feat.vipOnly || isVip;
                      return (
                        <div
                          key={idx}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div className={`flex items-center gap-2.5 text-sm ${unlocked ? ui.textPrimary : ui.textMuted}`}>
                            <span className={`text-xs font-bold ${unlocked ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : ''}`}>
                              {unlocked ? '✓' : '🔒'}
                            </span>
                            <span className={unlocked ? 'font-medium' : ''}>{feat.title}</span>
                          </div>
                          {unlocked && feat.vipOnly && feat.actionLabel && feat.onAction ? (
                            <button
                              onClick={feat.onAction}
                              className={`text-xs px-3 py-1 rounded-lg border font-semibold whitespace-nowrap ${ui.ghostBtn}`}
                            >
                              {feat.actionLabel}
                            </button>
                          ) : (
                            <span className={`text-[11px] font-semibold whitespace-nowrap ${
                              feat.vipOnly
                                ? isDark ? 'text-amber-300/80' : 'text-amber-700'
                                : ui.textMuted
                            }`}>
                              {feat.vipOnly ? 'VIP' : 'כלול'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!isVip && (
                    <button
                      onClick={() => {
                        setShowPersonalAreaModal(false);
                        autoCopyUserId(false);
                        setShowVipPromoModal(true);
                      }}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-xl text-sm shadow-sm transition-all"
                    >
                      👑 בקש פתיחת VIP Pro
                    </button>
                  )}
                </div>
              )}

              {personalAreaTab === 'messages' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${ui.textMuted}`}>הודעות ועדכונים ממנהל המערכת</span>
                    <button
                      onClick={() => {
                        setShowPersonalAreaModal(false);
                        setWaitlistJoined(false);
                        autoCopyUserId(false);
                        setShowVipPromoModal(true);
                      }}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${ui.ghostBtn}`}
                    >
                      ✉️ פנייה למנהל
                    </button>
                  </div>

                  {allUserAdminMessages.length === 0 ? (
                    <div className={`border rounded-2xl p-10 text-center text-sm ${ui.subtleSurface} ${ui.textMuted}`}>
                      אין הודעות חדשות כרגע.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {allUserAdminMessages.map((msg) => {
                        const isVipStyle = msg.style === 'vip';
                        const isWarningStyle = msg.style === 'warning';
                        return (
                          <div
                            key={msg.id}
                            className={`p-4 rounded-2xl border space-y-1.5 ${ui.subtleSurface}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`font-bold text-sm ${ui.textPrimary}`}>
                                {isVipStyle ? '👑 ' : isWarningStyle ? '⚠️ ' : '📢 '}
                                {msg.title}
                              </span>
                              <span className={`text-[11px] ${ui.textMuted}`}>
                                {new Date(msg.created_at).toLocaleDateString('he-IL')}
                              </span>
                            </div>
                            <p className={`text-xs sm:text-sm whitespace-pre-line leading-relaxed ${ui.textSecondary}`}>{msg.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`px-7 py-4 border-t flex justify-between items-center gap-3 ${ui.divider}`}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowPersonalAreaModal(false);
                    setShowSettingsModal(true);
                  }}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all ${ui.ghostBtn}`}
                >
                  ⚙️ הגדרות
                </button>
                <button
                  onClick={() => {
                    setShowPersonalAreaModal(false);
                    setShowShareModal(true);
                  }}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all ${ui.ghostBtn}`}
                >
                  🔗 שתף
                </button>
              </div>
              <button
                onClick={() => setShowPersonalAreaModal(false)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all"
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל אודות והסבר על התוכנה --- */}
      {showAboutModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-[95] p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-lg border text-right max-h-[88vh] overflow-y-auto ${ui.modalSurface}`}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl border ${
                  isDark ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'
                }`}>
                  ⏱️
                </div>
                <div>
                  <h3 className={`text-xl font-bold leading-tight ${ui.textPrimary}`}>אודות TimeTracker</h3>
                  <p className={`text-xs ${ui.textMuted}`}>גרסה {APP_CLIENT_VERSION} • מבית ClickHub</p>
                </div>
              </div>
              <button
                onClick={() => setShowAboutModal(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${ui.ghostBtn}`}
              >
                ✕
              </button>
            </div>

            <p className={`text-sm leading-relaxed mb-5 ${ui.textSecondary}`}>
              <strong className={ui.textPrimary}>TimeTracker</strong> היא מערכת שולחנית חכמה למעקב שעות עבודה, חישוב שכר בזמן אמת והפקת דוחות מסודרים לפרילנסרים, עצמאים ועובדים שעתיים — בעיצוב נקי שעובד גם ללא אינטרנט.
            </p>

            <div className={`rounded-2xl border divide-y overflow-hidden mb-5 ${ui.subtleSurface} ${isDark ? 'divide-white/10' : 'divide-slate-200/80'}`}>
              <div className="p-3.5">
                <h4 className={`text-xs font-bold mb-1 ${ui.textPrimary}`}>1. טיימר חסין הפסקות חשמל</h4>
                <p className={`text-xs leading-relaxed ${ui.textMuted}`}>
                  השעון שומר את הזמן מדי שנייה במחשב שלך. גם אם המחשב כבה פתאום, הזמן משוחזר אוטומטית בפתיחה הבאה.
                </p>
              </div>
              <div className="p-3.5">
                <h4 className={`text-xs font-bold mb-1 ${ui.textPrimary}`}>2. זיהוי חוסר פעילות חכם</h4>
                <p className={`text-xs leading-relaxed ${ui.textMuted}`}>
                  קמת מהמחשב ושכחת לעצור? אחרי 5 דקות של חוסר פעילות המערכת משהה ושואלת אם לקזז את זמן ההפסקה.
                </p>
              </div>
              <div className="p-3.5">
                <h4 className={`text-xs font-bold mb-1 ${ui.textPrimary}`}>3. פרטיות ושקיפות מלאה</h4>
                <p className={`text-xs leading-relaxed ${ui.textMuted}`}>
                  כל המשמרות, הסכומים וההערות שלך נשמרים מקומית על המחשב שלך בלבד. אל השרת מסונכרנים רק מזהה ההתקנה וסטטוס המנוי לצורך עדכונים ופתיחת VIP.
                </p>
              </div>
              <div className="p-3.5">
                <h4 className={`text-xs font-bold mb-1 ${ui.textPrimary}`}>4. עדכונים אוטומטיים ברקע</h4>
                <p className={`text-xs leading-relaxed ${ui.textMuted}`}>
                  התוכנה בודקת ומורידה שדרוגים אוטומטית ברקע ומתקינה אותם בסגירה הבאה, כך שתמיד תעבוד על הגרסה העדכנית ביותר.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => {
                  setShowAboutModal(false);
                  setShowShareModal(true);
                }}
                className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all ${ui.ghostBtn}`}
              >
                🔗 אהבת? שתף עם חברים
              </button>
              <button
                onClick={() => setShowAboutModal(false)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- מודאל שיתוף התוכנה (קישור לאתר הנחיתה) --- */}
      {showShareModal && (
        <div className={`fixed inset-0 flex items-center justify-center z-[95] p-4 print:hidden ${ui.modalBackdrop}`}>
          <div className={`p-7 rounded-[2rem] w-full max-w-md border text-center relative ${ui.modalSurface}`}>
            <button
              onClick={() => setShowShareModal(false)}
              className={`absolute top-5 left-5 w-8 h-8 rounded-full flex items-center justify-center text-sm ${ui.ghostBtn}`}
            >
              ✕
            </button>

            <div className="text-4xl mb-2.5">🤝</div>
            <h3 className={`text-xl font-bold mb-1.5 ${ui.textPrimary}`}>שתף את TimeTracker</h3>
            <p className={`text-xs leading-relaxed mb-5 ${ui.textSecondary}`}>
              מכיר פרילנסר, עצמאי או עובד שעתי שהתוכנה תעזור לו? שלח לו קישור להורדה חינמית:
            </p>

            <div className={`flex items-center gap-2 p-2.5 rounded-xl border mb-4 ${ui.subtleSurface}`}>
              <input
                type="text"
                readOnly
                value={LANDING_PAGE_URL}
                dir="ltr"
                className={`flex-1 bg-transparent text-xs font-mono outline-none px-1 select-all ${ui.textPrimary}`}
              />
              <button
                onClick={handleCopyShareLink}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
              >
                📋 העתק
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`ממליץ לך על TimeTracker — תוכנה מעולה וחינמית למחשב למעקב שעות וחישוב שכר אוטומטי:\n${LANDING_PAGE_URL}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  isDark
                    ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                }`}
              >
                <span>💬</span>
                <span>שתף בוואטסאפ</span>
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent('המלצה על תוכנת ניהול שעות חינמית — TimeTracker')}&body=${encodeURIComponent(`היי,\nממליץ לך לבדוק את TimeTracker — תוכנה פשוטה ומעולה למעקב שעות עבודה וחישוב שכר:\n${LANDING_PAGE_URL}`)}`}
                className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${ui.ghostBtn}`}
              >
                <span>✉️</span>
                <span>שתף במייל</span>
              </a>
            </div>

            <button
              onClick={() => setShowShareModal(false)}
              className={`w-full py-2.5 rounded-xl border text-xs font-semibold transition-all ${ui.ghostBtn}`}
            >
              סגור
            </button>
          </div>
        </div>
      )}
    </div>
  );
}