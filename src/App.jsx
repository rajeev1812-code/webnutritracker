import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Camera, Upload, Plus, Trash2, Flame, User, Share2, 
  Calendar, Check, AlertCircle, Sparkles, ChevronLeft, ChevronRight, 
  Scale, ArrowRight, RefreshCw, ShieldCheck, 
  BarChart3, Utensils, Copy, Smartphone,
  UserPlus, CheckCircle2, X, Lock, Mail, KeyRound, QrCode
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, 
  ReferenceLine, Cell, PieChart, Pie, Legend 
} from 'recharts';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  GoogleAuthProvider, signInWithPopup 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, onSnapshot, 
  collection, addDoc, deleteDoc 
} from 'firebase/firestore';

// --- VERCEL ENVIRONMENT VARIABLES INITIALIZATION ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = 'webnutritracker-prod';

const DEFAULT_PROFILE = {
  name: 'Alex Rivera',
  email: '',
  sex: 'female',
  age: 28,
  weightKg: 74,
  heightCm: 168,
  targetWeightKg: 65,
  timelineWeeks: 12,
  activityLevel: 'moderate',
};

const ACTIVITY_MULTIPLIERS = {
  sedentary: { label: 'Sedentary (Office job, little exercise)', factor: 1.2 },
  light: { label: 'Lightly Active (1-3 days/week)', factor: 1.375 },
  moderate: { label: 'Moderately Active (3-5 days/week)', factor: 1.55 },
  active: { label: 'Very Active (6-7 days/week)', factor: 1.725 },
  very_active: { label: 'Extra Active (Physical job / 2x training)', factor: 1.9 },
};

function calculateHealthMetrics(profile) {
  const weight = Math.max(20, Number(profile.weightKg) || 70);
  const targetWeight = Math.max(20, Number(profile.targetWeightKg) || 65);
  const heightCm = Math.max(100, Number(profile.heightCm) || 170);
  const age = Math.max(10, Number(profile.age) || 28);
  const weeks = Math.max(1, Number(profile.timelineWeeks) || 12);
  const heightM = heightCm / 100;

  const currentBmi = +(weight / (heightM * heightM)).toFixed(1);
  const targetBmi = +(targetWeight / (heightM * heightM)).toFixed(1);

  const getBmiCategory = (bmi) => {
    if (bmi < 18.5) return { label: 'Underweight', color: 'text-blue-600', bg: 'bg-blue-100' };
    if (bmi < 25) return { label: 'Normal Weight', color: 'text-emerald-600', bg: 'bg-emerald-100' };
    if (bmi < 30) return { label: 'Overweight', color: 'text-amber-600', bg: 'bg-amber-100' };
    return { label: 'Obese', color: 'text-rose-600', bg: 'bg-rose-100' };
  };

  let bmr = 10 * weight + 6.25 * heightCm - 5 * age;
  bmr += profile.sex === 'male' ? 5 : -161;

  const activityObj = ACTIVITY_MULTIPLIERS[profile.activityLevel] || ACTIVITY_MULTIPLIERS.moderate;
  const tdee = Math.round(bmr * activityObj.factor);

  const weightDiffKg = targetWeight - weight;
  const totalCalorieDelta = weightDiffKg * 7700;
  const rawDailyAdjustment = Math.round(totalCalorieDelta / (weeks * 7));

  const minSafeCalories = profile.sex === 'male' ? 1400 : 1200;
  let recommendedCalories = tdee + rawDailyAdjustment;
  let safetyNote = null;

  if (recommendedCalories < minSafeCalories) {
    safetyNote = `Adjusted to safe daily minimum (${minSafeCalories} kcal). Consider extending your timeline.`;
    recommendedCalories = minSafeCalories;
  } else if (Math.abs(rawDailyAdjustment) > 1100) {
    safetyNote = `A daily ${rawDailyAdjustment > 0 ? 'surplus' : 'deficit'} of ${Math.abs(rawDailyAdjustment)} kcal is aggressive. Extending your weeks is recommended.`;
  }

  return {
    currentBmi,
    targetBmi,
    currentCategory: getBmiCategory(currentBmi),
    targetCategory: getBmiCategory(targetBmi),
    bmr: Math.round(bmr),
    tdee,
    recommendedCalories: Math.round(recommendedCalories),
    proteinGrams: Math.round((recommendedCalories * 0.30) / 4),
    carbsGrams: Math.round((recommendedCalories * 0.40) / 4),
    fatGrams: Math.round((recommendedCalories * 0.30) / 9),
    weightDiffKg: +weightDiffKg.toFixed(1),
    weeklyChangeKg: +(weightDiffKg / weeks).toFixed(2),
    minHealthyWeight: +(18.5 * heightM * heightM).toFixed(1),
    maxHealthyWeight: +(24.9 * heightM * heightM).toFixed(1),
    safetyNote,
  };
}

const getTodayStr = () => new Date().toISOString().split('T')[0];

const getPast7Days = (endDateStr) => {
  const days = [];
  const base = new Date(endDateStr + 'T12:00:00');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    days.push({ date: iso, label });
  }
  return days;
};

const emailToAccountId = (emailStr) =>
  'user_' + emailStr.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');

export default function App() {
  const [user, setUser] = useState(null);
  const [activeAccountId, setActiveAccountId] = useState(() => localStorage.getItem('wnt_active_acc') || 'default');
  const [accountsList, setAccountsList] = useState(() => {
    const saved = localStorage.getItem('wnt_accounts_list');
    return saved ? JSON.parse(saved) : [{ id: 'default', name: 'Alex Rivera', email: 'alex@webnutritracker.app', avatarBg: 'bg-emerald-600' }];
  });
  const [publicAccountsMap, setPublicAccountsMap] = useState(() => {
    const saved = localStorage.getItem('wnt_accounts_map');
    return saved ? JSON.parse(saved) : {};
  });

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', pin: '' });
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [showShareModal, setShowShareModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const [profile, setProfile] = useState(() => {
    const saved = localStorage.getItem(`wnt_profile_${activeAccountId}`);
    return saved ? JSON.parse(saved) : DEFAULT_PROFILE;
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [foodLogs, setFoodLogs] = useState(() => {
    const saved = localStorage.getItem(`wnt_logs_${activeAccountId}`);
    return saved ? JSON.parse(saved) : [];
  });

  const [inputMode, setInputMode] = useState('photo');
  const [selectedImage, setSelectedImage] = useState(null);
  const [foodDescription, setFoodDescription] = useState('');
  const [mealType, setMealType] = useState('Lunch');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // --- FIREBASE OR LOCALSTORAGE HYBRID SYNC ---
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    signInAnonymously(auth).catch((e) => console.error(e));
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    localStorage.setItem('wnt_active_acc', activeAccountId);
    if (!isFirebaseConfigured || !user || !db) {
      const localProf = localStorage.getItem(`wnt_profile_${activeAccountId}`);
      if (localProf) setProfile(JSON.parse(localProf));
      const localLogs = localStorage.getItem(`wnt_logs_${activeAccountId}`);
      setFoodLogs(localLogs ? JSON.parse(localLogs) : []);
      return;
    }

    const publicUsersRef = collection(db, 'artifacts', appId, 'public', 'data', 'registered_accounts');
    const unsubUsers = onSnapshot(publicUsersRef, (snap) => {
      const directory = {};
      const list = [];
      snap.forEach((d) => {
        const data = d.data();
        directory[d.id] = { id: d.id, ...data };
        list.push({ id: d.id, name: data.name || 'User', email: data.email || '', avatarBg: data.avatarBg || 'bg-emerald-600' });
      });
      setPublicAccountsMap(directory);
      if (list.length > 0) setAccountsList(list);
    });

    const profileDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', activeAccountId);
    const unsubProf = onSnapshot(profileDocRef, (snap) => {
      if (snap.exists()) setProfile({ ...DEFAULT_PROFILE, ...snap.data() });
    });

    const logsColRef = collection(db, 'artifacts', appId, 'public', 'data', 'food_logs');
    const unsubLogs = onSnapshot(logsColRef, (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if ((data.accountId || 'default') === activeAccountId) {
          items.push({ id: docSnap.id, ...data });
        }
      });
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setFoodLogs(items);
    });

    return () => {
      unsubUsers();
      unsubProf();
      unsubLogs();
    };
  }, [user, activeAccountId]);

  const handleProfileChange = (field, value) => {
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    localStorage.setItem(`wnt_profile_${activeAccountId}`, JSON.stringify(updated));
  };

  const saveProfileToCloud = async (customProfile = profile) => {
    setIsSavingProfile(true);
    localStorage.setItem(`wnt_profile_${activeAccountId}`, JSON.stringify(customProfile));
    if (isFirebaseConfigured && user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', activeAccountId), {
          ...customProfile,
          updatedAt: Date.now(),
        });
      } catch (e) {
        console.error(e);
      }
    }
    setIsSavingProfile(false);
    showToast('Personal Profile & Calorie Goals saved!');
  };

  const handleAccountAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    const cleanEmail = authForm.email.trim().toLowerCase();
    const cleanPin = authForm.pin.trim();
    const cleanName = authForm.name.trim();

    if (!cleanEmail || !cleanPin) {
      setAuthError('Please enter both your Email / Username and 4-digit PIN.');
      return;
    }

    const accId = emailToAccountId(cleanEmail);
    const existingAccount = publicAccountsMap[accId];

    if (authMode === 'signup') {
      if (!cleanName) {
        setAuthError('Please enter your Full Name.');
        return;
      }
      const newAcc = { id: accId, name: cleanName, email: cleanEmail, pin: cleanPin, avatarBg: 'bg-emerald-600' };
      const updatedMap = { ...publicAccountsMap, [accId]: newAcc };
      const updatedList = [...accountsList.filter((a) => a.id !== accId), newAcc];
      setPublicAccountsMap(updatedMap);
      setAccountsList(updatedList);
      localStorage.setItem('wnt_accounts_map', JSON.stringify(updatedMap));
      localStorage.setItem('wnt_accounts_list', JSON.stringify(updatedList));

      const newProfileData = { ...DEFAULT_PROFILE, name: cleanName, email: cleanEmail };
      localStorage.setItem(`wnt_profile_${accId}`, JSON.stringify(newProfileData));

      if (isFirebaseConfigured && user && db) {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'registered_accounts', accId), newAcc);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', accId), newProfileData);
      }

      setActiveAccountId(accId);
      setProfile(newProfileData);
      setShowAccountModal(false);
      showToast(`Welcome, ${cleanName}!`);
    } else {
      if (existingAccount && existingAccount.pin && existingAccount.pin !== cleanPin) {
        setAuthError('Incorrect PIN.');
        return;
      }
      setActiveAccountId(accId);
      setShowAccountModal(false);
      showToast(`Logged in as ${existingAccount?.name || cleanEmail}`);
    }
  };

  const startCamera = async () => {
    setAnalysisError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setAnalysisError('Camera access unavailable. Please use Upload Photo instead.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const captureSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setSelectedImage(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result);
      setAnalysisResult(null);
      setAnalysisError(null);
    };
    reader.readAsDataURL(file);
  };

  const analyzeFoodWithGemini = async () => {
    if (!selectedImage && !foodDescription.trim()) {
      setAnalysisError('Please upload a food photo or enter a description first.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const parts = [];
    let promptText = `Analyze the meal and return a JSON object with: mealTitle (string), totalCalories (int), proteinGrams (int), carbsGrams (int), fatGrams (int), healthTip (string), and items (array of {name, portion, calories, protein, carbs, fat}).`;
    if (foodDescription.trim()) promptText += `\nUser description: "${foodDescription.trim()}"`;
    parts.push({ text: promptText });

    if (selectedImage) {
      const base64Data = selectedImage.split(',')[1];
      const mimeType = selectedImage.substring(selectedImage.indexOf(':') + 1, selectedImage.indexOf(';'));
      parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Data } });
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const result = await response.json();
      const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      setAnalysisResult(JSON.parse(jsonText));
    } catch (err) {
      setAnalysisError('Make sure VITE_GEMINI_API_KEY is configured in your Vercel Environment Variables.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const logAnalyzedMeal = async () => {
    if (!analysisResult) return;
    const newEntry = {
      id: 'log_' + Date.now(),
      accountId: activeAccountId,
      date: selectedDate,
      mealType,
      mealTitle: analysisResult.mealTitle,
      totalCalories: Number(analysisResult.totalCalories) || 0,
      proteinGrams: Number(analysisResult.proteinGrams) || 0,
      carbsGrams: Number(analysisResult.carbsGrams) || 0,
      fatGrams: Number(analysisResult.fatGrams) || 0,
      items: analysisResult.items || [],
      healthTip: analysisResult.healthTip || '',
      createdAt: Date.now(),
    };

    const updatedLogs = [newEntry, ...foodLogs];
    setFoodLogs(updatedLogs);
    localStorage.setItem(`wnt_logs_${activeAccountId}`, JSON.stringify(updatedLogs));

    if (isFirebaseConfigured && user && db) {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'food_logs'), newEntry);
    }

    setAnalysisResult(null);
    setSelectedImage(null);
    setFoodDescription('');
    showToast(`Logged "${newEntry.mealTitle}" (${newEntry.totalCalories} kcal)!`);
  };

  const deleteFoodLog = async (logId) => {
    const updated = foodLogs.filter((l) => l.id !== logId);
    setFoodLogs(updated);
    localStorage.setItem(`wnt_logs_${activeAccountId}`, JSON.stringify(updated));
    if (isFirebaseConfigured && user && db) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'food_logs', logId));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const metrics = useMemo(() => calculateHealthMetrics(profile), [profile]);
  const logsForSelectedDate = useMemo(() => foodLogs.filter((l) => l.date === selectedDate), [foodLogs, selectedDate]);
  const dailyTotals = useMemo(
    () =>
      logsForSelectedDate.reduce(
        (acc, item) => ({
          calories: acc.calories + (Number(item.totalCalories) || 0),
          protein: acc.protein + (Number(item.proteinGrams) || 0),
          carbs: acc.carbs + (Number(item.carbsGrams) || 0),
          fat: acc.fat + (Number(item.fatGrams) || 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [logsForSelectedDate]
  );

  const weeklyChartData = useMemo(() => {
    return getPast7Days(selectedDate).map((d) => {
      const dayLogs = foodLogs.filter((l) => l.date === d.date);
      return {
        name: d.label,
        calories: dayLogs.reduce((sum, l) => sum + (Number(l.totalCalories) || 0), 0),
      };
    });
  }, [foodLogs, selectedDate]);

  const macroPieData = useMemo(() => {
    const { protein: p, carbs: c, fat: f } = dailyTotals;
    if (p + c + f === 0) {
      return [
        { name: 'Target Protein (g)', value: metrics.proteinGrams, color: '#10b981' },
        { name: 'Target Carbs (g)', value: metrics.carbsGrams, color: '#3b82f6' },
        { name: 'Target Fats (g)', value: metrics.fatGrams, color: '#f59e0b' },
      ];
    }
    return [
      { name: 'Protein (g)', value: p, color: '#10b981' },
      { name: 'Carbs (g)', value: c, color: '#3b82f6' },
      { name: 'Fats (g)', value: f, color: '#f59e0b' },
    ];
  }, [dailyTotals, metrics]);

  const shareUrl = typeof window !== 'undefined' ? window.location.origin : 'https://webnutritracker.vercel.app';
  const caloriesRemaining = metrics.recommendedCalories - dailyTotals.calories;
  const calorieProgressPct = Math.min(100, Math.round((dailyTotals.calories / (metrics.recommendedCalories || 2000)) * 100));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-20 sm:pb-0">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
              <Flame className="w-6 h-6 text-slate-950 fill-slate-950" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">
                Webnutritracker
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">AI Calorie & BMI Dashboard</p>
            </div>
          </div>

          <nav className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700">
            <button onClick={() => setActiveTab('dashboard')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activeTab === 'dashboard' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
              BMI & Goal
            </button>
            <button onClick={() => setActiveTab('logger')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activeTab === 'logger' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
              AI Food Logger
            </button>
            <button onClick={() => setActiveTab('analytics')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activeTab === 'analytics' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
              Graphs
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowShareModal(true)} className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5">
              <Share2 className="w-4 h-4" />
              <span>Share Link</span>
            </button>
            <button onClick={() => setShowAccountModal(true)} className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-emerald-300">
              {profile.name || 'Account'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 space-y-6">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-white">Personal Body & Goal Calculator</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Name</label>
                  <input type="text" value={profile.name} onChange={(e) => handleProfileChange('name', e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Sex</label>
                  <select value={profile.sex} onChange={(e) => handleProfileChange('sex', e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white">
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Age (Years)</label>
                  <input type="number" value={profile.age} onChange={(e) => handleProfileChange('age', Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Height (CM)</label>
                  <input type="number" value={profile.heightCm} onChange={(e) => handleProfileChange('heightCm', Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Current Weight (KG)</label>
                  <input type="number" step="0.5" value={profile.weightKg} onChange={(e) => handleProfileChange('weightKg', Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-emerald-400">Desired Weight (KG)</label>
                  <input type="number" step="0.5" value={profile.targetWeightKg} onChange={(e) => handleProfileChange('targetWeightKg', Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-emerald-500/40 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Timeline: {profile.timelineWeeks} Weeks</label>
                <input type="range" min="2" max="52" value={profile.timelineWeeks} onChange={(e) => handleProfileChange('timelineWeeks', Number(e.target.value))} className="w-full accent-emerald-500 mt-1" />
              </div>
              <div>
                <label className="text-xs text-slate-400">Activity Level</label>
                <select value={profile.activityLevel} onChange={(e) => handleProfileChange('activityLevel', e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white">
                  {Object.entries(ACTIVITY_MULTIPLIERS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => saveProfileToCloud(profile)} className="w-full py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm">
                {isSavingProfile ? 'Saving...' : 'Save Personal Plan'}
              </button>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700">
                  <span className="text-xs text-slate-400 uppercase font-bold">Current BMI</span>
                  <div className="text-4xl font-black text-white my-1">{metrics.currentBmi}</div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${metrics.currentCategory.bg} ${metrics.currentCategory.color}`}>
                    {metrics.currentCategory.label}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40">
                  <span className="text-xs text-emerald-300 uppercase font-bold">Proposed Target BMI</span>
                  <div className="text-4xl font-black text-emerald-400 my-1">{metrics.targetBmi}</div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${metrics.targetCategory.bg} ${metrics.targetCategory.color}`}>
                    {metrics.targetCategory.label}
                  </span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-extrabold text-white">Recommended Daily Calorie Intake</h3>
                    <p className="text-xs text-slate-400">To reach {profile.targetWeightKg} kg in {profile.timelineWeeks} weeks</p>
                  </div>
                  <div className="text-3xl font-black text-emerald-400">{metrics.recommendedCalories} kcal/day</div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-slate-800">
                    <div className="text-xs text-emerald-400 font-bold">Protein</div>
                    <div className="text-xl font-black text-white">{metrics.proteinGrams}g</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800">
                    <div className="text-xs text-blue-400 font-bold">Carbs</div>
                    <div className="text-xl font-black text-white">{metrics.carbsGrams}g</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800">
                    <div className="text-xs text-amber-400 font-bold">Fats</div>
                    <div className="text-xl font-black text-white">{metrics.fatGrams}g</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logger' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-lg font-extrabold text-white">AI Food Photo & Calorie Scanner</h2>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => { stopCamera(); setInputMode('photo'); }} className={`py-2 rounded-xl text-xs font-bold ${inputMode === 'photo' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Upload Photo</button>
                <button onClick={() => { setInputMode('camera'); startCamera(); }} className={`py-2 rounded-xl text-xs font-bold ${inputMode === 'camera' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Use Camera</button>
                <button onClick={() => { stopCamera(); setInputMode('text'); }} className={`py-2 rounded-xl text-xs font-bold ${inputMode === 'text' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Describe</button>
              </div>

              {inputMode === 'photo' && (
                <label className="block border-2 border-dashed border-slate-700 rounded-2xl p-6 text-center cursor-pointer bg-slate-800/40">
                  {selectedImage ? (
                    <img src={selectedImage} alt="Meal" className="max-h-56 mx-auto rounded-xl" />
                  ) : (
                    <span className="text-sm font-bold text-emerald-400">Tap to Upload or Take Food Photo</span>
                  )}
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              )}

              {inputMode === 'camera' && (
                <div className="space-y-2 text-center">
                  <video ref={videoRef} autoPlay playsInline className="w-full max-h-60 bg-black rounded-xl" />
                  <canvas ref={canvasRef} className="hidden" />
                  <button onClick={captureSnapshot} className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs">Capture Photo</button>
                </div>
              )}

              <textarea
                rows={3}
                value={foodDescription}
                onChange={(e) => setFoodDescription(e.target.value)}
                placeholder="Describe your meal (e.g., 2 eggs, avocado toast)..."
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />

              {analysisError && <div className="text-xs text-rose-400">{analysisError}</div>}

              <button onClick={analyzeFoodWithGemini} disabled={isAnalyzing} className="w-full py-3 rounded-xl bg-emerald-500 text-slate-950 font-extrabold text-sm">
                {isAnalyzing ? 'Analyzing with Gemini AI...' : 'Calculate Calories & Macros'}
              </button>

              {analysisResult && (
                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-3">
                  <div className="flex justify-between">
                    <strong className="text-white">{analysisResult.mealTitle}</strong>
                    <strong className="text-emerald-400">{analysisResult.totalCalories} kcal</strong>
                  </div>
                  <button onClick={logAnalyzedMeal} className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs">
                    + Add to {selectedDate} Log
                  </button>
                </div>
              )}
            </div>

            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-extrabold text-white">Logged Meals ({selectedDate})</h2>
                <span className="text-sm font-bold text-emerald-400">{dailyTotals.calories} / {metrics.recommendedCalories} kcal</span>
              </div>
              <div className="space-y-2">
                {logsForSelectedDate.map((log) => (
                  <div key={log.id} className="p-3 rounded-xl bg-slate-800 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-bold text-white">{log.mealTitle}</div>
                      <div className="text-xs text-slate-400">P: {log.proteinGrams}g • C: {log.carbsGrams}g • F: {log.fatGrams}g</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-emerald-400">{log.totalCalories} kcal</span>
                      <button onClick={() => deleteFoodLog(log.id)} className="text-rose-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 h-80">
              <h3 className="text-sm font-bold text-white mb-3">7-Day Calorie Trend</h3>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={weeklyChartData}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip />
                  <ReferenceLine y={metrics.recommendedCalories} stroke="#10b981" strokeDasharray="4 4" />
                  <Bar dataKey="calories" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 h-80">
              <h3 className="text-sm font-bold text-white mb-3">Macro Split</h3>
              <ResponsiveContainer width="100%" height="90%">
                <PieChart>
                  <Pie data={macroPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                    {macroPieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </main>

      {showShareModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Share Webnutritracker</h3>
              <button onClick={() => setShowShareModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <input type="text" readOnly value={shareUrl} className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-emerald-300 font-mono" />
            <button onClick={() => { navigator.clipboard?.writeText(shareUrl); setCopiedLink(true); }} className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs">
              {copiedLink ? 'Copied!' : 'Copy App Link'}
            </button>
          </div>
        </div>
      )}

      {showAccountModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Account Login / Sign Up</h3>
              <button onClick={() => setShowAccountModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setAuthMode('login')} className={`py-2 rounded-xl text-xs font-bold ${authMode === 'login' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Login</button>
              <button onClick={() => setAuthMode('signup')} className={`py-2 rounded-xl text-xs font-bold ${authMode === 'signup' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Sign Up</button>
            </div>
            <form onSubmit={handleAccountAuthSubmit} className="space-y-3">
              {authMode === 'signup' && (
                <input type="text" placeholder="Full Name" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
              )}
              <input type="text" placeholder="Email or Username" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
              <input type="password" placeholder="4-Digit PIN" value={authForm.pin} onChange={(e) => setAuthForm({ ...authForm, pin: e.target.value })} className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white" />
              {authError && <div className="text-xs text-rose-400">{authError}</div>}
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm">
                {authMode === 'signup' ? 'Create Account' : 'Log In'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

