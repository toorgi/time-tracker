import { useState, useEffect, useMemo, Fragment, useRef } from 'react';

function App() {
  const [isWorking, setIsWorking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [startTime, setStartTime] = useState<string | null>(null);
  
  const [isPaused, setIsPaused] = useState(false);
  const [pauseSeconds, setPauseSeconds] = useState(0);
  
  const [showModal, setShowModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [editForm, setEditForm] = useState<any>(null);
  
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: new Date().toLocaleDateString('he-IL'),
    start: '',
    end: '',
    note: ''
  });

  // --- פיצ'רים חדשים מהסימולציה ---
  const [hourlyRate, setHourlyRate] = useState(() => {
    const saved = localStorage.getItem('hourlyRate');
    return saved ? Number(saved) : 60;
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [archiveMonth, setArchiveMonth] = useState('all');

  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [showIdleModal, setShowIdleModal] = useState(false);
  const [filterType, setFilterType] = useState('month');
  
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
  const [isMiniMode, setIsMiniMode] = useState(false);

  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('workSessions');
    return saved ? JSON.parse(saved) : [];
  });

  // רפרנסים למניעת עצירת הטיימר כשהחלון ממוזער
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    localStorage.setItem('workSessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('hourlyRate', hourlyRate.toString());
  }, [hourlyRate]);

  const playNotificationSound = (type: 'start' | 'stop' | 'alert' | 'pause') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    } catch (e) {
      console.error("Audio API not supported");
    }
  };

  // מנגנון הריפוי החכם נגד מזעור החלון לפרקי זמן ארוכים
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    lastTickRef.current = Date.now(); // עדכון חותמת זמן בתחילת הפעולה
    
    if (isWorking && !isPaused && !showIdleModal) {
      interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - lastTickRef.current) / 1000);
        if (diff > 0) {
          setSeconds((prev) => prev + diff);
          lastTickRef.current += diff * 1000; // שומרים על המילי-שניות הנותרות
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

    const handleSystemIdle = (_event: any, idleSeconds: number) => {
      if (idleSeconds >= 300) {
        playNotificationSound('alert');
        setShowIdleModal(true);
      }
    };

    if ((window as any).ipcRenderer) {
      (window as any).ipcRenderer.on('system-idle-time', handleSystemIdle);
    }

    return () => {
      if ((window as any).ipcRenderer) {
        (window as any).ipcRenderer.removeAllListeners('system-idle-time');
      }
    };
  }, [isWorking, isPaused, showIdleModal]);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
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
      if (isMiniMode) toggleMiniMode(); 
    }
  };

  const handleTogglePause = () => {
    playNotificationSound('pause');
    setIsPaused(!isPaused);
  };

  const toggleMiniMode = () => {
    const newMode = !isMiniMode;
    setIsMiniMode(newMode);
    if ((window as any).ipcRenderer) {
      (window as any).ipcRenderer.send('toggle-mini-mode', newMode);
    }
  };

  const handleSaveSession = () => {
    const endTime = new Date().toISOString();
    const earnedAmount = ((seconds / 3600) * hourlyRate).toFixed(2);
    const startStr = new Date(startTime!).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const endStr = new Date(endTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(startTime!).toLocaleDateString('he-IL');

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
      hourlyRate: hourlyRate // שומרים את התעריף ההיסטורי של משמרת זו
    };

    setSessions([newSession, ...sessions]);
    setSeconds(0);
    setPauseSeconds(0);
    setIsPaused(false);
    setStartTime(null);
    setNoteText('');
    setShowModal(false);
  };

  const calculateDurationAndEarned = (start: string, end: string, rate: number) => {
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    if (totalMinutes < 0) totalMinutes += 24 * 60;
    const newHours = Math.floor(totalMinutes / 60);
    const newMins = totalMinutes % 60;
    const recalculatedDuration = `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}:00`;
    const recalculatedEarned = ((totalMinutes / 60) * rate).toFixed(2);
    return { duration: recalculatedDuration, earned: recalculatedEarned };
  };

  const handleSaveEdit = () => {
    if (!editForm) return;
    const appliedRate = editForm.hourlyRate || hourlyRate;
    const { duration, earned } = calculateDurationAndEarned(editForm.start, editForm.end, appliedRate);

    const updatedSessions = sessions.map((s: any) => 
      s.id === editForm.id ? { ...editForm, duration, earned } : s
    );
    setSessions(updatedSessions);
    setEditForm(null);
  };

  const handleSaveManualSession = () => {
    if (!manualForm.date || !manualForm.start || !manualForm.end) return;
    
    const { duration, earned } = calculateDurationAndEarned(manualForm.start, manualForm.end, hourlyRate);
    
    let timestamp = Date.now();
    try {
      const [day, month, year] = manualForm.date.split('.');
      const parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);
      if (!isNaN(parsedDate.getTime())) timestamp = parsedDate.getTime();
    } catch (e) {}

    const newSession = {
      id: Date.now(),
      date: manualForm.date,
      start: manualForm.start,
      end: manualForm.end,
      duration,
      earned,
      note: manualForm.note.trim() || 'ללא הערה',
      timestamp,
      isArchived: false,
      hourlyRate: hourlyRate
    };

    setSessions([newSession, ...sessions]);
    setShowManualForm(false);
    setManualForm({ date: new Date().toLocaleDateString('he-IL'), start: '', end: '', note: '' });
  };

  const handleDeleteSession = (id: number) => {
    if (window.confirm('האם אתה בטוח שברצונך למחוק משמרת זו לחלוטין? פעולה זו אינה הפיכה.')) {
      setSessions(sessions.filter((s: any) => s.id !== id));
    }
  };

  const handleArchivePeriod = () => {
    const unarchivedCount = sessions.filter((s: any) => !s.isArchived).length;
    if (unarchivedCount === 0) {
      alert('אין משמרות פעילות לסגירה כרגע.');
      return;
    }
    
    if (window.confirm('האם אתה בטוח שברצונך לסגור את התקופה הנוכחית?\n\nכל המשמרות הפעילות יסומנו כ"שולמו" ויועברו לארכיון התקופות. המונים בדף הראשי יאופסו ותתחיל תקופה חדשה.')) {
      const archiveTimestamp = Date.now();
      const updatedSessions = sessions.map((s: any) => 
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
    if (isMiniMode) toggleMiniMode();
  };

  // בניית רשימת חודשים קיימים בארכיון למטרת סינון
  const availableArchiveMonths = useMemo(() => {
    const months = new Set<string>();
    sessions.forEach((s: any) => {
       if (s.isArchived) {
         const parts = s.date.split('.');
         if (parts.length === 3) {
           months.add(`${parts[1]}.${parts[2]}`);
         }
       }
    });
    return Array.from(months).sort((a, b) => {
       const [m1, y1] = a.split('.');
       const [m2, y2] = b.split('.');
       return new Date(Number(y2), Number(m2) - 1).getTime() - new Date(Number(y1), Number(m1) - 1).getTime();
    });
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const now = new Date();
    return sessions.filter((session: any) => {
      const isArchived = Boolean(session.isArchived);
      if (viewMode === 'active' && isArchived) return false;
      if (viewMode === 'archived' && !isArchived) return false;

      // סינון חודש בתוך ארכיון
      if (viewMode === 'archived' && archiveMonth !== 'all') {
         const parts = session.date.split('.');
         if (parts.length === 3) {
           const mYYYY = `${parts[1]}.${parts[2]}`;
           if (mYYYY !== archiveMonth) return false;
         }
      }

      // סינון חודש/שבוע/הכל בתוך תקופה פעילה
      if (filterType === 'all') return true;
      const sessionDate = new Date(session.timestamp);
      if (filterType === 'month') return sessionDate.getMonth() === now.getMonth() && sessionDate.getFullYear() === now.getFullYear();
      if (filterType === 'week') {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);
        return sessionDate >= oneWeekAgo && sessionDate <= now;
      }
      return true;
    });
  }, [sessions, filterType, viewMode, archiveMonth]);

  const getValidEarned = (session: any) => {
    let parsed = parseFloat(String(session.earned).replace(',', '.'));
    if (isNaN(parsed)) {
      const appliedRate = session.hourlyRate || hourlyRate;
      if (session.duration) {
        const parts = String(session.duration).split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;
        const totalMins = (h * 60) + m + (s / 60);
        parsed = (totalMins / 60) * appliedRate;
      } else {
        parsed = 0;
      }
    }
    return parsed;
  };

  const groupedSessions = useMemo(() => {
    const groups: Record<string, { sessions: any[], totalSeconds: number, totalEarned: number }> = {};
    filteredSessions.forEach((session: any) => {
      if (!groups[session.date]) {
        groups[session.date] = { sessions: [], totalSeconds: 0, totalEarned: 0 };
      }
      groups[session.date].sessions.push(session);
      const [h, m, s] = session.duration.split(':').map(Number);
      groups[session.date].totalSeconds += (h * 3600) + (m * 60) + s;
      groups[session.date].totalEarned += getValidEarned(session);
    });
    return groups;
  }, [filteredSessions]);

  const dashboardStats = useMemo(() => {
    const totalMoney = filteredSessions.reduce((acc: number, curr: any) => acc + getValidEarned(curr), 0);
    let totalSeconds = 0;
    filteredSessions.forEach((session: any) => {
      const [h, m, s] = session.duration.split(':').map(Number);
      totalSeconds += (h * 3600) + (m * 60) + s;
    });
    return { earned: totalMoney.toFixed(2), hours: formatTime(totalSeconds).slice(0, 5) };
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

  // הורדת גיבוי JSON למחשב
  const handleExportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessions));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `TimeTracker_Backup_${new Date().toLocaleDateString('he-IL').replace(/\./g, '-')}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // העלאת קובץ גיבוי
  const handleImportData = (event: any) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        if (Array.isArray(imported)) {
          if (window.confirm('האם אתה בטוח שברצונך לדרוס את הנתונים הקיימים עם נתוני הגיבוי? פעולה זו אינה הפיכה.')) {
            setSessions(imported);
            setShowSettingsModal(false);
          }
        }
      } catch (err) {
        alert('שגיאה בקריאת הקובץ. ודא שזהו קובץ גיבוי תקין של המערכת.');
      }
    };
    reader.readAsText(file);
    event.target.value = null; // איפוס כדי שיהיה אפשר לטעון שוב את אותו קובץ
  };

  if (isMiniMode) {
    return (
      <div 
        className="h-screen w-screen bg-gray-900/60 backdrop-blur-xl flex flex-col items-center justify-center p-4 border border-white/10 rounded-xl overflow-hidden shadow-2xl relative"
        style={{ WebkitAppRegion: 'drag' } as any}
        dir="rtl"
      >
        <button 
          onClick={toggleMiniMode} 
          className="absolute top-2 right-2 text-white/50 hover:text-white transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          ⤡
        </button>
        <div className={`text-4xl font-mono mb-4 transition-colors ${isPaused ? 'text-amber-400 animate-pulse drop-shadow-[0_0_10px_rgba(251,191,36,0.4)]' : 'text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]'}`}>
          {formatTime(seconds)}
        </div>
        
        <div className="w-full flex gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {isWorking ? (
            <>
              <button 
                onClick={handleToggleWork}
                className="flex-1 py-2 text-sm font-bold rounded-xl transition-all shadow-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30"
              >
                עצור
              </button>
              <button 
                onClick={handleTogglePause}
                className={`flex-1 py-2 text-sm font-bold rounded-xl transition-all shadow-lg border ${
                  isPaused ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30'
                }`}
              >
                {isPaused ? 'חזור' : 'הפסקה'}
              </button>
            </>
          ) : (
            <button 
              onClick={handleToggleWork}
              className="w-full py-3 text-lg font-bold rounded-xl transition-all shadow-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
            >
              התחל
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-8 bg-gray-900 print:bg-white print:p-0 overflow-y-auto relative text-right text-gray-100" dir="rtl">
      
      {/* פילטר צבעים מופשטים ברקע כדי ליצור את אפקט הזכוכית החלבית */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 print:hidden">
        <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] bg-purple-600/30 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-emerald-600/20 rounded-full blur-[150px]"></div>
        <div className="absolute top-[30%] left-[60%] w-[400px] h-[400px] bg-blue-600/20 rounded-full blur-[100px]"></div>
      </div>

      <div className="w-full max-w-5xl flex justify-between items-center mb-4 print:hidden z-10">
        <button 
          onClick={() => setShowSettingsModal(true)}
          className="bg-white/5 hover:bg-white/10 backdrop-blur-md text-white px-4 py-2 rounded-xl border border-white/10 shadow-lg transition-all flex items-center gap-2"
        >
          <span>⚙️ הגדרות וגיבוי</span>
        </button>
        <button 
          onClick={toggleMiniMode}
          className="bg-white/5 hover:bg-white/10 backdrop-blur-md text-white px-4 py-2 rounded-xl border border-white/10 shadow-lg transition-all flex items-center gap-2"
        >
          <span>מצב מיני (חלון צף)</span>
          <span className="text-xl">⤢</span>
        </button>
      </div>

      <div className="w-full max-w-5xl flex flex-col items-center space-y-6 mb-12 print:hidden z-10">
        <header className="text-center drop-shadow-md">
          <h1 className="text-4xl font-bold text-white tracking-tight">מערכת שעות - מזכירות</h1>
          <p className="text-gray-300 mt-2 font-light">מעקב זמן ותמחור לפי {hourlyRate} ₪ לשעה</p>
        </header>

        {/* כרטיסיית טיימר מזכוכית חלבית */}
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

      {/* טבלת נתונים מזכוכית חלבית */}
      <div className="w-full max-w-5xl bg-white/5 backdrop-blur-xl rounded-[2.5rem] border border-white/10 p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] z-10 relative print:shadow-none print:border-none print:bg-white print:text-black print:p-0">
        
        <div className="hidden print:block mb-8 text-center border-b-2 border-gray-300 pb-4">
          <h1 className="text-3xl font-bold mb-2">דוח שעות עבודה {viewMode === 'archived' ? '(היסטוריית תקופות קודמות)' : ''}</h1>
          <p className="text-lg">הופק בתאריך: {new Date().toLocaleDateString('he-IL')}</p>
        </div>

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
              <button 
                onClick={() => setShowManualForm(true)} 
                className="bg-white/5 text-white/80 border border-white/10 px-5 py-2 rounded-xl font-medium hover:bg-white/10 hover:text-white transition-all shadow-lg"
              >
                + הוסף משמרת ידנית
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
                <button onClick={() => setFilterType('month')} className={`px-5 py-2 rounded-lg font-medium transition-all ${filterType === 'month' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>החודש</button>
                <button onClick={() => setFilterType('week')} className={`px-5 py-2 rounded-lg font-medium transition-all ${filterType === 'week' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>השבוע</button>
                <button onClick={() => setFilterType('all')} className={`px-5 py-2 rounded-lg font-medium transition-all ${filterType === 'all' ? 'bg-white/20 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>הכל</button>
              </div>

              {/* בורר חודשים היסטורי שמוצג רק בארכיון */}
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
                    const [d1, m1, y1] = a[0].split('.');
                    const [d2, m2, y2] = b[0].split('.');
                    return new Date(`${y2}-${m2}-${d2}`).getTime() - new Date(`${y1}-${m1}-${d1}`).getTime();
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
                        <td className="py-4 px-4 font-bold font-mono text-emerald-400 print:text-black">{formatTime(group.totalSeconds).slice(0, 5)}</td>
                        <td className="py-4 px-4 font-bold text-emerald-400 print:text-black">₪{group.totalEarned.toFixed(2)}</td>
                        <td colSpan={2} className="py-4 px-4 print:hidden"></td>
                      </tr>
                      
                      {!collapsedDates[date] && group.sessions.map((session: any) => (
                        <tr key={session.id} className="hover:bg-white/5 transition-colors print:hover:bg-transparent text-sm">
                          <td className="py-4 px-4 text-white/80 font-mono text-xs whitespace-nowrap print:text-gray-700 print:font-normal">{session.date}</td>
                          <td className="py-4 px-4 text-white/80">{session.start}</td>
                          <td className="py-4 px-4 text-white/80">{session.end}</td>
                          <td className="py-4 px-4 font-mono text-white/80">{session.duration}</td>
                          <td className="py-4 px-4 font-bold text-white print:font-normal">₪{getValidEarned(session).toFixed(2)}</td>
                          <td className="py-4 px-4 text-white/70 whitespace-pre-wrap">{session.note}</td>
                          <td className="py-4 px-4 text-center print:hidden space-x-reverse space-x-2">
                            <button 
                              onClick={() => setEditForm(session)}
                              className="text-white/50 hover:text-blue-300 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 text-xs transition-colors backdrop-blur-sm"
                            >
                              ערוך
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

      {/* מודאל הגדרות וגיבוי */}
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
                  onChange={(e) => setHourlyRate(Number(e.target.value))} 
                  className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none" 
                  dir="ltr" 
                />
                <p className="text-white/40 text-xs mt-2 font-light">שינוי התעריף ישפיע רק על משמרות שיירשמו מעכשיו והלאה. דוחות ארכיון ישנים לא ייפגעו.</p>
              </div>

              <div className="pt-6 border-t border-white/10">
                <label className="block text-sm text-white/60 mb-3 pl-1">כספת נתונים (ייבוא וייצוא)</label>
                <div className="flex gap-3">
                  <button onClick={handleExportData} className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl text-sm border border-white/10 transition-colors shadow-lg">
                    📥 הורד גיבוי נתונים
                  </button>
                  <label className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl text-sm border border-white/10 transition-colors text-center cursor-pointer shadow-lg">
                    📤 שחזר מגיבוי
                    <input type="file" accept=".json" onChange={handleImportData} className="hidden" />
                  </label>
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

      {editForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
            <h3 className="text-2xl font-bold text-white mb-6">עריכת משמרת</h3>
            <div className="space-y-5 mb-8">
              <div>
                <label className="block text-sm text-white/60 mb-2 pl-1">תאריך</label>
                <input 
                  type="text" 
                  value={editForm.date} 
                  onChange={(e) => setEditForm({...editForm, date: e.target.value})} 
                  className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-blue-400 focus:bg-black/50 transition-all outline-none" 
                  dir="ltr" 
                  placeholder="DD.MM.YYYY"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm text-white/60 mb-2 pl-1">התחלה (HH:MM)</label>
                  <input type="time" value={editForm.start} onChange={(e) => setEditForm({...editForm, start: e.target.value})} className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-blue-400 focus:bg-black/50 transition-all outline-none text-left" dir="ltr" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-white/60 mb-2 pl-1">סיום (HH:MM)</label>
                  <input type="time" value={editForm.end} onChange={(e) => setEditForm({...editForm, end: e.target.value})} className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-blue-400 focus:bg-black/50 transition-all outline-none text-left" dir="ltr" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2 pl-1">הערות / משימות</label>
                <textarea value={editForm.note} onChange={(e) => setEditForm({...editForm, note: e.target.value})} className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-blue-400 focus:bg-black/50 transition-all outline-none h-24" />
              </div>
            </div>
            
            <div className="flex gap-4">
              <button onClick={handleSaveEdit} className="flex-1 bg-blue-500/80 hover:bg-blue-500 text-white shadow-lg py-3 rounded-xl font-bold transition-all">שמור שינויים</button>
              <button onClick={() => setEditForm(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all">ביטול</button>
            </div>
          </div>
        </div>
      )}

      {showManualForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-gray-900/60 backdrop-blur-xl p-8 rounded-[2rem] w-full max-w-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
            <h3 className="text-2xl font-bold text-white mb-6">הוספת משמרת ידנית</h3>
            <div className="space-y-5 mb-8">
              <div>
                <label className="block text-sm text-white/60 mb-2 pl-1">תאריך</label>
                <input 
                  type="text" 
                  value={manualForm.date} 
                  onChange={(e) => setManualForm({...manualForm, date: e.target.value})} 
                  className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none" 
                  dir="ltr" 
                  placeholder="DD.MM.YYYY"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm text-white/60 mb-2 pl-1">התחלה (HH:MM)</label>
                  <input type="time" value={manualForm.start} onChange={(e) => setManualForm({...manualForm, start: e.target.value})} className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none text-left" dir="ltr" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-white/60 mb-2 pl-1">סיום (HH:MM)</label>
                  <input type="time" value={manualForm.end} onChange={(e) => setManualForm({...manualForm, end: e.target.value})} className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none text-left" dir="ltr" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2 pl-1">הערות / משימות</label>
                <textarea value={manualForm.note} onChange={(e) => setManualForm({...manualForm, note: e.target.value})} className="w-full bg-black/30 text-white p-3 rounded-xl border border-white/10 focus:border-emerald-400 focus:bg-black/50 transition-all outline-none h-24" />
              </div>
            </div>
            
            <div className="flex gap-4">
              <button onClick={handleSaveManualSession} className="flex-1 bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-lg py-3 rounded-xl font-bold transition-all">הוסף משמרת</button>
              <button onClick={() => setShowManualForm(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 py-3 rounded-xl transition-all">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;