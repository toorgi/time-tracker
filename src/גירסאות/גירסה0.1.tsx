import { useState, useEffect, useMemo, Fragment, useRef } from 'react';

function App() {
  const [isWorking, setIsWorking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [startTime, setStartTime] = useState<string | null>(null);
  
  const [isPaused, setIsPaused] = useState(false);
  const [pauseSeconds, setPauseSeconds] = useState(0);
  
  const [showModal, setShowModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  
  // VIP Promo Modal State
  const [showVipPromoModal, setShowVipPromoModal] = useState(false);

  const [hourlyRate, setHourlyRate] = useState<number>(() => {
    const saved = localStorage.getItem('hourlyRate');
    const parsed = saved ? Number(saved) : 60;
    return isNaN(parsed) || parsed < 0 ? 60 : parsed;
  });

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [archiveMonth, setArchiveMonth] = useState('all');

  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [showIdleModal, setShowIdleModal] = useState(false);
  const [filterType, setFilterType] = useState('month');
  
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');

  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem('workSessions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    localStorage.setItem('workSessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('hourlyRate', hourlyRate.toString());
  }, [hourlyRate]);

  const playNotificationSound = (type: 'start' | 'stop' | 'alert' | 'pause') => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    } catch {
      console.error("Audio API not supported");
    }
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    lastTickRef.current = Date.now();
    
    if (isWorking && !isPaused && !showIdleModal) {
      interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - lastTickRef.current) / 1000);
        if (diff > 0) {
          setSeconds((prev) => prev + diff);
          lastTickRef.current += diff * 1000;
        }
      }, 1000);
    } else if (isWorking && isPaused) {
      interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - lastTickRef.current) / 1000);
        if (diff > 0) {
          setPauseSeconds((prev) => prev + diff);
          lastTickRef.current += diff * 1000;
        }
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isWorking, isPaused, showIdleModal]);

  useEffect(() => {
    if (!isWorking || isPaused || showIdleModal) return;

    const handleSystemIdle = (_event: unknown, idleSeconds: number) => {
      if (idleSeconds >= 300) {
        playNotificationSound('alert');
        setShowIdleModal(true);
      }
    };

    const globalWin = window as unknown as { ipcRenderer?: { on: (event: string, fn: (e: unknown, secs: number) => void) => void; removeAllListeners: (event: string) => void } };

    if (globalWin.ipcRenderer) {
      globalWin.ipcRenderer.on('system-idle-time', handleSystemIdle);
    }

    return () => {
      if (globalWin.ipcRenderer) {
        globalWin.ipcRenderer.removeAllListeners('system-idle-time');
      }
    };
  }, [isWorking, isPaused, showIdleModal]);

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
      setIsWorking(true);
      setIsPaused(false);
      if (!startTime) setStartTime(new Date().toISOString());
    } else {
      playNotificationSound('stop');
      setIsWorking(false);
      setShowModal(true);
    }
  };

  const handleTogglePause = () => {
    playNotificationSound('pause');
    setIsPaused(!isPaused);
  };

  const handleSaveSession = () => {
    const endTime = new Date().toISOString();
    const earnedAmount = ((seconds / 3600) * hourlyRate).toFixed(2);
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

    const newSession = {
      id: Date.now(),
      date: dateStr,
      start: startStr,
      end: endStr,
      duration: formatTime(seconds),
      earned: earnedAmount,
      note: finalNote,
      timestamp: Date.now(),
      isArchived: false,
      hourlyRate: hourlyRate
    };

    setSessions([newSession, ...sessions]);
    setSeconds(0);
    setPauseSeconds(0);
    setIsPaused(false);
    setStartTime(null);
    setNoteText('');
    setShowModal(false);
  };

  const handleDeleteSession = (id: number) => {
    if (window.confirm('האם אתה בטוח שברצונך למחוק משמרת זו לחלוטין? פעולה זו אינה הפיכה.')) {
      setSessions(sessions.filter((s: { id: number }) => s.id !== id));
    }
  };

  const handleArchivePeriod = () => {
    const unarchivedCount = sessions.filter((s: { isArchived?: boolean }) => !s.isArchived).length;
    if (unarchivedCount === 0) {
      alert('אין משמרות פעילות לסגירה כרגע.');
      return;
    }
    
    if (window.confirm('האם אתה בטוח שברצונך לסגור את התקופה הנוכחית?\n\nכל המשמרות הפעילות יסומנו כ"שולמו" ויועברו לארכיון התקופות. המונים בדף הראשי יאופסו ותתחיל תקופה חדשה.')) {
      const archiveTimestamp = Date.now();
      const updatedSessions = sessions.map((s: { isArchived?: boolean }) => 
        !s.isArchived ? { ...s, isArchived: true, archiveTimestamp } : s
      );
      setSessions(updatedSessions);
    }
  };

  const handleStillHere = () => setShowIdleModal(false);
  const handleStopFromIdle = () => {
    setShowIdleModal(false);
    setSeconds((prev) => Math.max(0, prev - 300));
    setIsWorking(false);
    setShowModal(true);
  };

  const cleanDateStr = (str: string) => String(str || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();

  const parseDateToTimestamp = (dateStr: string): number => {
    const cleaned = cleanDateStr(dateStr);
    const parts = cleaned.split('.').map(p => parseInt(p, 10));
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
    sessions.forEach((s: { isArchived?: boolean; date?: string }) => {
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
    return sessions.filter((session: { isArchived?: boolean; date?: string; timestamp?: number }) => {
      const isArchived = Boolean(session.isArchived);
      if (viewMode === 'active' && isArchived) return false;
      if (viewMode === 'archived' && !isArchived) return false;

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
  }, [sessions, filterType, viewMode, archiveMonth]);

  const getValidEarned = (session: { earned?: number | string; hourlyRate?: number; duration?: string }) => {
    let parsed = parseFloat(String(session.earned || '0').replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) {
      const appliedRate = typeof session.hourlyRate === 'number' && session.hourlyRate > 0 ? session.hourlyRate : hourlyRate;
      if (session.duration) {
        const parts = String(session.duration).split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;
        const totalSecs = (h * 3600) + (m * 60) + s;
        parsed = (totalSecs / 3600) * appliedRate;
      } else {
        parsed = 0;
      }
    }
    return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
  };

  const groupedSessions = useMemo(() => {
    type SessionType = typeof sessions[0];
    const groups: Record<string, { sessions: SessionType[], totalSeconds: number, totalEarned: number }> = {};
    filteredSessions.forEach((session: SessionType) => {
      const key = cleanDateStr(session.date);
      if (!groups[key]) {
        groups[key] = { sessions: [], totalSeconds: 0, totalEarned: 0 };
      }
      groups[key].sessions.push(session);
      const [h, m, s] = (session.duration || '0:0:0').split(':').map(Number);
      groups[key].totalSeconds += ((h || 0) * 3600) + ((m || 0) * 60) + (s || 0);
      groups[key].totalEarned += getValidEarned(session);
    });
    return groups;
  }, [filteredSessions]);

  const dashboardStats = useMemo(() => {
    type SessionType = typeof sessions[0];
    const totalMoney = filteredSessions.reduce((acc: number, curr: SessionType) => acc + getValidEarned(curr), 0);
    let totalSeconds = 0;
    filteredSessions.forEach((session: SessionType) => {
      const [h, m, s] = (session.duration || '0:0:0').split(':').map(Number);
      totalSeconds += ((h || 0) * 3600) + ((m || 0) * 60) + (s || 0);
    });
    
    return { earned: totalMoney.toFixed(2), hours: formatTime(totalSeconds) };
  }, [filteredSessions]);

  const toggleDateCollapse = (date: string) => {
    setCollapsedDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  const currentEarned = ((seconds / 3600) * hourlyRate).toFixed(2);
  
  const handleExportPDF = () => {
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        tr { page-break-inside: avoid; }
        thead { display: table-header-group; }
      }
    `;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.head.removeChild(style), 1000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-8 bg-gray-900 print:bg-white print:p-0 overflow-y-auto relative text-right text-gray-100" dir="rtl">
      
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 print:hidden">
        <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] bg-purple-600/30 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-emerald-600/20 rounded-full blur-[150px]"></div>
        <div className="absolute top-[30%] left-[60%] w-[400px] h-[400px] bg-blue-600/20 rounded-full blur-[100px]"></div>
      </div>

      <div className="w-full max-w-5xl flex justify-between items-center mb-4 print:hidden z-10">
        
        <div className="flex gap-4">
            <button 
            onClick={() => setShowSettingsModal(true)}
            className="bg-white/5 hover:bg-white/10 backdrop-blur-md text-white px-4 py-2 rounded-xl border border-white/10 shadow-lg transition-all flex items-center gap-2"
            >
            <span>⚙️ הגדרות (ותעריפים)</span>
            </button>
            <a 
                href="https://playful-wisp-0af7ed.netlify.app/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-gradient-to-r from-amber-400/20 to-yellow-600/20 hover:from-amber-400/30 hover:to-yellow-600/30 backdrop-blur-md text-amber-300 px-5 py-2 rounded-xl border border-amber-500/30 shadow-[0_0_15px_rgba(251,191,36,0.15)] transition-all duration-300 flex items-center gap-2 font-bold transform hover:scale-105"
            >
                👑 שדרוג למסלול VIP
            </a>
        </div>

        {/* Locked Mini Mode Button */}
        <button 
          onClick={() => setShowVipPromoModal(true)}
          className="bg-white/5 hover:bg-white/10 backdrop-blur-md text-white/70 px-4 py-2 rounded-xl border border-white/10 shadow-lg transition-all flex items-center gap-2"
        >
          <span className="text-amber-400">👑</span>
          <span>מצב מיני (חלון צף)</span>
          <span className="text-xl">⤢</span>
        </button>
      </div>

      <div className="w-full max-w-5xl flex flex-col items-center space-y-6 mb-12 print:hidden z-10">
        <header className="text-center drop-shadow-md">
          <h1 className="text-4xl font-bold text-white tracking-tight">מערכת שעות - (גרסה חינמית)</h1>
          <p className="text-gray-300 mt-2 font-light">מעקב זמן ותמחור לפי {hourlyRate} ₪ לשעה</p>
        </header>

        <div className="bg-white/10 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] flex flex-col items-center w-full max-w-md border border-white/20 relative">
          
          {isPaused && (
            <div className="absolute top-4 bg-amber-500/20 text-amber-300 px-4 py-1 rounded-full text-sm font-bold animate-pulse border border-amber-500/30 shadow-lg">
              מושהה - זמן הפסקה: {formatTime(pauseSeconds)}
            </div>
          )}

          <div className={`text-7xl font-mono mt-6 mb-4 font-light tracking-wider transition-colors ${isPaused ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.3)]' : 'text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)]'}`}>
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

      <div className="w-full max-w-5xl bg-white/5 backdrop-blur-xl rounded-[2.5rem] border border-white/10 p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] z-10 relative print:shadow-none print:border-none print:bg-white print:text-black print:p-0">
        
        <div className="flex flex-col gap-6 mb-8 border-b border-white/10 pb-6 print:border-gray-300 print:mb-4 print:pb-4">
          
          <div className="flex flex-wrap justify-between items-center w-full gap-4">
            <div className="flex space-x-reverse space-x-2 bg-black/20 p-1 rounded-xl border border-white/5 print:hidden">
              <button onClick={() => setViewMode('active')} className={`px-5 py-2 rounded-lg font-bold transition-all ${viewMode === 'active' ? 'bg-emerald-500/20 text-emerald-300 shadow-md border border-emerald-500/30' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>תקופה פעילה (פתוחה)</button>
              <button onClick={() => setViewMode('archived')} className={`px-5 py-2 rounded-lg font-bold transition-all ${viewMode === 'archived' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>ארכיון תקופות (שולמו)</button>
            </div>

            <div className="flex gap-3 print:hidden">
              {viewMode === 'active' && (
                <button 
                  onClick={handleArchivePeriod} 
                  className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-5 py-2 rounded-xl font-bold hover:bg-purple-500/30 hover:text-white transition-all shadow-lg"
                >
                  סגור תקופה (לתשלום)
                </button>
              )}
              {/* Locked Manual Session Button */}
              <button 
                onClick={() => setShowVipPromoModal(true)} 
                className="bg-white/5 text-white/70 border border-white/10 px-5 py-2 rounded-xl font-medium hover:bg-white/10 hover:text-white transition-all shadow-lg flex items-center gap-2"
              >
                <span className="text-amber-400 text-sm">👑</span>
                הוסף משמרת ידנית
              </button>
              
              {/* Unlocked Export PDF Button */}
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
                <button onClick={() => setFilterType('month')} className={`px-5 py-2 rounded-lg font-medium transition-all ${filterType === 'month' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>החודש</button>
                <button onClick={() => setFilterType('week')} className={`px-5 py-2 rounded-lg font-medium transition-all ${filterType === 'week' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>השבוע</button>
                <button onClick={() => setFilterType('all')} className={`px-5 py-2 rounded-lg font-medium transition-all ${filterType === 'all' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>הכל</button>
              </div>

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

        <div className="overflow-x-auto">
          <table className="w-full text-right print:text-black">
            <thead className="text-white/50 border-b border-white/10 print:border-gray-400 uppercase text-xs tracking-wider print:text-black">
              <tr>
                <th className="pb-4 px-4 font-medium w-32">תאריך</th>
                <th className="pb-4 px-4 font-medium">התחלה</th>
                <th className="pb-4 px-4 font-medium">סיום</th>
                <th className="pb-4 px-4 font-medium">זמן</th>
                <th className="pb-4 px-4 font-medium">שכר</th>
                <th className="pb-4 px-4 font-medium w-1/3">הערות / משימות</th>
                <th className="pb-4 px-4 font-medium text-center print:hidden">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 print:divide-gray-300">
              {Object.keys(groupedSessions).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-white/40">אין נתונים לתקופה זו.</td>
                </tr>
              ) : (
                Object.entries(groupedSessions)
                  .sort((a, b) => {
                    const dateA = parseDateToTimestamp(a[0]);
                    const dateB = parseDateToTimestamp(b[0]);
                    return dateB - dateA;
                  })
                  .map(([date, group]) => (
                    <Fragment key={date}>
                      <tr 
                        className="bg-black/20 cursor-pointer hover:bg-black/30 transition-colors print:bg-gray-100 print:border-gray-400"
                        onClick={() => toggleDateCollapse(date)}
                      >
                        <td className="py-4 px-4 font-bold text-white print:text-black">
                          <span className="text-white/30 print:hidden ml-3 text-xs">{collapsedDates[date] ? '▶' : '▼'}</span>
                          {date}
                        </td>
                        <td colSpan={2} className="py-4 px-4 text-white/50 print:text-gray-600 font-medium">סה"כ יומי:</td>
                        <td className="py-4 px-4 font-bold font-mono text-emerald-400 print:text-black">
                          {formatTime(group.totalSeconds)}
                        </td>
                        <td className="py-4 px-4 font-bold text-emerald-400 print:text-black">₪{group.totalEarned.toFixed(2)}</td>
                        <td colSpan={2} className="py-4 px-4 print:hidden"></td>
                      </tr>
                      
                      {!collapsedDates[date] && group.sessions.map((session: { id: number; date?: string; start?: string; end?: string; duration?: string; note?: string }) => (
                        <tr key={session.id} className="hover:bg-white/5 transition-colors print:hover:bg-transparent text-sm">
                          <td className="py-4 px-4 text-white/80 font-mono text-xs whitespace-nowrap print:text-gray-700 print:font-normal">{session.date}</td>
                          <td className="py-4 px-4 text-white/80">{session.start}</td>
                          <td className="py-4 px-4 text-white/80">{session.end}</td>
                          <td className="py-4 px-4 font-mono text-white/80">{session.duration}</td>
                          <td className="py-4 px-4 font-bold text-white print:font-normal">₪{getValidEarned(session).toFixed(2)}</td>
                          <td className="py-4 px-4 text-white/70 whitespace-pre-wrap">{session.note}</td>
                          <td className="py-4 px-4 text-center print:hidden space-x-reverse space-x-2">
                            {/* Locked Edit Button */}
                            <button 
                              onClick={() => setShowVipPromoModal(true)}
                              className="text-amber-400/70 hover:text-amber-300 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 text-xs transition-colors backdrop-blur-sm"
                            >
                              👑 ערוך
                            </button>
                            <button 
                              onClick={() => handleDeleteSession(session.id)}
                              className="text-red-400/70 hover:text-red-300 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 text-xs transition-colors backdrop-blur-sm"
                            >
                              מחק
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showIdleModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-10 rounded-[2.5rem] w-full max-w-md border border-amber-500/30 text-center shadow-[0_8px_32px_0_rgba(245,158,11,0.2)]">
            <div className="text-7xl mb-6 drop-shadow-lg">💤</div>
            <h3 className="text-3xl font-bold text-white mb-3">עדיין פה?</h3>
            <p className="text-white/70 mb-8 text-lg font-light">זיהינו חוסר פעילות בכל המחשב במשך 5 דקות. הטיימר הושהה בינתיים.</p>
            <div className="flex flex-col gap-4">
              <button onClick={handleStillHere} className="w-full bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-lg py-4 rounded-2xl font-bold text-lg transition-all backdrop-blur-md">כן, אני ממשיך לעבוד!</button>
              <button onClick={handleStopFromIdle} className="w-full bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-4 rounded-2xl font-bold text-lg transition-all backdrop-blur-md">לא, סיימתי לפני 5 דקות</button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-md border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
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
                <p className="text-white/40 text-xs mt-2 font-light">שינוי התעריף ישפיע רק על משמרות שיירשמו מעכשיו והלאה. דוחות ארכיון ישנים לא ייפגעו.</p>
              </div>

              {/* Locked Data Vault */}
              <div className="pt-6 border-t border-white/10">
                <label className="block text-sm text-white/60 mb-3 pl-1">כספת נתונים (ייבוא וייצוא)</label>
                <div className="flex gap-3">
                  <button onClick={() => {setShowSettingsModal(false); setShowVipPromoModal(true);}} className="flex-1 bg-white/5 hover:bg-white/10 text-white/50 py-3 rounded-xl text-sm border border-white/10 transition-colors shadow-lg flex justify-center items-center gap-2">
                    <span className="text-amber-400">👑</span> הורד גיבוי
                  </button>
                  <button onClick={() => {setShowSettingsModal(false); setShowVipPromoModal(true);}} className="flex-1 bg-white/5 hover:bg-white/10 text-white/50 py-3 rounded-xl text-sm border border-white/10 transition-colors shadow-lg flex justify-center items-center gap-2">
                    <span className="text-amber-400">👑</span> שחזר מגיבוי
                  </button>
                </div>
              </div>
            </div>
            
            <button onClick={() => setShowSettingsModal(false)} className="w-full bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 shadow-lg py-3 rounded-xl font-bold transition-all">
              סגור הגדרות
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
            <h3 className="text-2xl font-bold text-white mb-2">סיכום משמרת</h3>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="פירוט משימות..." className="w-full bg-black/30 text-white border border-white/10 rounded-xl p-4 mb-6 h-32 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none placeholder-white/30" autoFocus />
            <div className="flex gap-4">
              <button onClick={handleSaveSession} className="flex-1 bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-lg py-3 rounded-xl font-bold transition-all">שמור וסיים</button>
              <button onClick={() => {setShowModal(false); setIsWorking(true);}} className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all">בטל סיום</button>
            </div>
          </div>
        </div>
      )}

      {/* VIP Promo Modal */}
      {showVipPromoModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gradient-to-b from-gray-900 to-gray-800 backdrop-blur-xl p-10 rounded-[2.5rem] w-full max-w-md border-2 border-amber-500/50 shadow-[0_10px_40px_rgba(251,191,36,0.3)] text-center relative">
            <button 
              onClick={() => setShowVipPromoModal(false)} 
              className="absolute top-5 left-5 text-gray-500 hover:text-white text-2xl transition-colors"
            >
              ✕
            </button>
            <div className="text-7xl mb-6 drop-shadow-lg">👑</div>
            <h3 className="text-3xl font-bold text-amber-400 mb-3">פיצ'ר ל-VIP בלבד</h3>
            <p className="text-gray-300 mb-8 text-lg font-light leading-relaxed">
              הפיצ'ר שניסית להפעיל סגור בגרסה החינמית. שדרג עכשיו כדי לפתוח אפשרויות מתקדמות כמו <strong className="text-white">עריכת שעות, חלון צף, ייצוא ל-PDF וניהול לקוחות.</strong>
            </p>
            <a 
              href="https://playful-wisp-0af7ed.netlify.app/" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="block w-full bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-gray-900 font-bold text-xl px-6 py-4 rounded-xl shadow-lg transition-all transform hover:scale-105"
            >
              שדרג עכשיו למסלול VIP 🚀
            </a>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;