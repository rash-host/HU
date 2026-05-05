// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  TT — Time Trade  |  Zoom via CF Worker + Delete approved requests      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ── SETUP CHECKLIST ──────────────────────────────────────────────────────────
// 1. Deploy cloudflare-worker.js to Cloudflare Workers (see that file)
// 2. Paste your Worker URL into ZOOM_PROXY_URL below (line ~60)
// 3. Supabase: make sure these columns exist in "requests" table:
//      course_id text, course_title text,
//      zoom_meeting_id text, zoom_password text
//    SQL: ALTER TABLE requests
//           ADD COLUMN IF NOT EXISTS course_id text,
//           ADD COLUMN IF NOT EXISTS course_title text,
//           ADD COLUMN IF NOT EXISTS zoom_meeting_id text,
//           ADD COLUMN IF NOT EXISTS zoom_password text;
// ─────────────────────────────────────────────────────────────────────────────

import {
  useState, useEffect, useContext, createContext,
  useRef, useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame, CheckCircle, XCircle, Video, LogOut, User, Bell,
  Zap, Search, Award, Loader2, MessageSquare,
  AlertTriangle, Coins, Globe, X, Check, Plus,
  BookOpen, Code2, Database, Cpu, Palette, TrendingUp,
  Music, Camera, PenLine, Star, Clock,
  ChevronRight, Sparkles, Shield, Hash, Calendar,
  ExternalLink, RefreshCw, LayoutDashboard, Upload, Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase, ref as dbRef, set as dbSet, get as dbGet,
  update as dbUpdate, onValue, off,
} from "firebase/database";
import { createClient } from "@supabase/supabase-js";

// ── FIREBASE CONFIG ───────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCjaty20ZFloU5VrA4OfaqIZwaOnnEKR3k",
  authDomain: "timetrade-c2424.firebaseapp.com",
  databaseURL: "https://timetrade-c2424-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "timetrade-c2424",
  storageBucket: "timetrade-c2424.firebasestorage.app",
  messagingSenderId: "37103569098",
  appId: "1:37103569098:web:b335e391f91dd1edae8c33",
};

const SUPABASE_URL      = "https://nsyydxayplotyxwuhdsz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zeXlkeGF5cGxvdHl4d3VoZHN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NzI2OTYsImV4cCI6MjA5MzE0ODY5Nn0.zvWiDuVUoqSA4zxybp9QSw3c4wVKS1ylpyzsWRb1Qhc";

// ── ZOOM PROXY URL ────────────────────────────────────────────────────────────
// Paste your Cloudflare Worker URL here after deploying cloudflare-worker.js
// Example: "https://zoom-proxy.yourname.workers.dev"
const ZOOM_PROXY_URL = "https://zoom-proxy.rajeshwarisons3134.workers.dev"; // ← REPLACE THIS

// ─────────────────────────────────────────────────────────────────────────────

const firebaseApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const auth        = getAuth(firebaseApp);
const rtdb        = getDatabase(firebaseApp);
const gProvider   = new GoogleAuthProvider();
const supabase    = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── RTDB HELPERS ──────────────────────────────────────────────────────────────
async function rtGet(path) {
  const snap = await dbGet(dbRef(rtdb, path));
  return snap.exists() ? snap.val() : null;
}
async function rtSet(path, data)    { await dbSet(dbRef(rtdb, path), data); }
async function rtUpdate(path, data) { await dbUpdate(dbRef(rtdb, path), data); }
function rtListen(path, cb) {
  const r = dbRef(rtdb, path);
  onValue(r, (snap) => cb(snap.exists() ? snap.val() : null));
  return () => off(r);
}

// ── SUPABASE HELPERS ──────────────────────────────────────────────────────────
async function sbInsertRequest(data) {
  const { data: row, error } = await supabase.from("requests").insert([data]).select().single();
  if (error) throw new Error(error.message);
  return row;
}
async function sbUpdateRequest(id, data) {
  const { error } = await supabase.from("requests").update(data).eq("id", id);
  if (error) throw new Error(error.message);
}
async function sbDeleteRequest(id) {
  const { error } = await supabase.from("requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
async function sbGetRequests(field, uid) {
  const { data, error } = await supabase
    .from("requests").select("*").eq(field, uid)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// ── COURSE SUPABASE HELPERS ───────────────────────────────────────────────────
async function sbInsertCourse(data) {
  const { data: row, error } = await supabase.from("courses").insert([data]).select().single();
  if (error) throw new Error(error.message);
  return row;
}
async function sbGetAllCourses() {
  const { data, error } = await supabase.from("courses").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
async function sbGetMentorCourses(mentorUid) {
  const { data, error } = await supabase.from("courses").select("*").eq("mentor_uid", mentorUid).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
async function sbDeleteCourse(id) {
  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
async function sbUploadCourseImage(file, mentorUid) {
  const ext  = file.name.split(".").pop();
  const path = `course-images/${mentorUid}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("course-images").upload(path, file, { upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("course-images").getPublicUrl(path);
  return data.publicUrl;
}

// ── ZOOM API (via Cloudflare Worker proxy) ────────────────────────────────────
async function createZoomMeeting(mentorEmail, learnerName, skill) {
  // Check proxy URL is configured
  if (!ZOOM_PROXY_URL || ZOOM_PROXY_URL.includes("YOUR_SUBDOMAIN")) {
    console.warn("[Zoom] Proxy URL not set — using fallback link");
    return generateFallbackZoomLink(skill);
  }

  try {
    const res = await fetch(`${ZOOM_PROXY_URL}?action=create_meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mentorEmail, learnerName, skill }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.detail || data.error || "Proxy returned error");
    }

    return {
      meetingId: data.meetingId,
      joinUrl:   data.joinUrl,
      startUrl:  data.startUrl,
      password:  data.password || "",
    };
  } catch (err) {
    console.error("[Zoom proxy]", err);
    throw err;
  }
}

/** Fallback: generates a dummy Zoom-looking link for development */
function generateFallbackZoomLink(skill = "") {
  const id  = Math.floor(Math.random() * 9000000000) + 1000000000;
  const pwd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    meetingId: String(id),
    joinUrl:   `https://zoom.us/j/${id}?pwd=${pwd}`,
    startUrl:  `https://zoom.us/s/${id}?zak=PLACEHOLDER`,
    password:  pwd,
  };
}

// ── MENTOR ID HELPERS ─────────────────────────────────────────────────────────
function generateMentorId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "MENTOR";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
async function verifyMentorId(mentorId, userId) {
  try { return (await rtGet(`users/${userId}/mentorId`)) === mentorId; } catch { return false; }
}
async function mentorIdExists(mentorId) {
  try {
    const snap = await rtGet("users");
    if (!snap) return false;
    return Object.values(snap).some((u) => u.mentorId === mentorId);
  } catch { return false; }
}
async function storeMentorId(userId, mentorId) {
  try {
    await rtUpdate(`users/${userId}`, { mentorId, role: "mentor", mentorCreatedAt: Date.now() });
    await rtSet(`mentorIds/${mentorId}`, { userId, createdAt: Date.now() });
    return true;
  } catch { return false; }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function formatTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// ── DESIGN TOKENS ─────────────────────────────────────────────────────────────
const T = {
  bg:       "#F5F3EE",
  surface:  "#FFFFFF",
  alt:      "#EFECE5",
  dark:     "#1A1A1A",
  yellow:   "#F5C842",
  yellowLt: "#FEF3C7",
  text:     "#1A1A1A",
  muted:    "#8A8680",
  border:   "#E4E0D8",
  danger:   "#DC2626",
  success:  "#16A34A",
  mentor:   "#7C3AED",
  mentorLt: "#EDE9FE",
};

const pillStyle = (active = false, yellow = false, extra = {}) => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "10px 20px", borderRadius: 999, cursor: "pointer",
  border: "none", fontFamily: "inherit", fontWeight: 600,
  fontSize: 14, transition: "all 0.15s ease",
  background: yellow ? T.yellow : active ? T.dark : T.surface,
  color:      yellow ? T.dark   : active ? "#fff" : T.text,
  boxShadow:  active || yellow ? "none" : `0 0 0 1.5px ${T.border}`,
  ...extra,
});
const cardStyle = (extra = {}) => ({
  background: T.surface, borderRadius: 20,
  border: `1px solid ${T.border}`,
  boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
  padding: 20, ...extra,
});

// ── GLOBAL CSS ────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;0,9..40,800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; font-family: 'DM Sans','Segoe UI',sans-serif; color: ${T.text}; }
  button { font-family: inherit; cursor: pointer; }
  input, select, textarea { font-family: inherit; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
  input:focus, textarea:focus, select:focus { outline: 2px solid ${T.yellow}; outline-offset: 0; }
  @keyframes spin  { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1;}50%{opacity:0.5;} }
  .spin  { animation: spin  1s linear infinite; }
  .pulse { animation: pulse 2s ease-in-out infinite; }
`;
function GlobalStyles() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
  return null;
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3800);
  }, []);
  const iconFor = (type) => {
    if (type === "success") return <CheckCircle size={15} color={T.yellow} />;
    if (type === "error")   return <XCircle     size={15} color="#fca5a5" />;
    return <Bell size={15} color={T.yellow} />;
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999,
        display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id}
              initial={{ opacity:0, x:60, scale:0.9 }}
              animate={{ opacity:1, x:0,  scale:1   }}
              exit={{   opacity:0, x:60,  scale:0.9 }}
              style={{ background:T.dark, color:"#fff", padding:"12px 18px",
                borderRadius:14, fontSize:14, fontWeight:500, maxWidth:320,
                boxShadow:"0 6px 24px rgba(0,0,0,0.2)",
                display:"flex", alignItems:"center", gap:10, pointerEvents:"auto" }}>
              {iconFor(t.type)}{t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ── AUTH CONTEXT ──────────────────────────────────────────────────────────────
const AuthCtx = createContext(null);
function AuthProvider({ children }) {
  const [user,    setUser]    = useState(undefined);
  const [profile, setProfile] = useState(null);
  const toast = useContext(ToastCtx);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setUser(null); setProfile(null); return; }
      setUser(u);
      const profilePath = `users/${u.uid}`;
      try {
        const existing = await rtGet(profilePath);
        if (!existing) {
          const p = {
            uid: u.uid, email: u.email,
            displayName: u.displayName || u.email.split("@")[0],
            photoURL: u.photoURL || "",
            credits: 2, totalEarned: 0, streak: 0,
            skills: [], sessionsAsMentor: 0, sessionsAsLearner: 0,
            createdAt: Date.now(),
          };
          await rtSet(profilePath, p);
          setProfile(p);
          toast?.("Welcome! You got 2 free credits 🎉", "success");
        } else {
          setProfile(existing);
        }
      } catch {
        setProfile({
          uid: u.uid, email: u.email,
          displayName: u.displayName || u.email.split("@")[0],
          photoURL: u.photoURL || "", credits: 0,
          totalEarned: 0, streak: 0, skills: [],
          sessionsAsMentor: 0, sessionsAsLearner: 0,
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = rtListen(`users/${user.uid}`, (data) => { if (data) setProfile(data); });
    return unsub;
  }, [user]);

  const login  = () => signInWithPopup(auth, gProvider).catch((e) => toast?.(e.message, "error"));
  const logout = () => signOut(auth);
  return (
    <AuthCtx.Provider value={{ user, profile, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ── SKILLS LIST ───────────────────────────────────────────────────────────────
const ALL_SKILLS = [
  "React","TypeScript","Python","UI/UX","NodeJS","GraphQL",
  "Figma","Data Science","DevOps","Flutter","Go","Rust",
  "Machine Learning","SQL","AWS","Kubernetes","Web3",
  "Photography","Music Theory","Technical Writing",
];
const SKILL_ICONS = {
  React: Code2, TypeScript: Code2, Python: Cpu, "UI/UX": Palette,
  NodeJS: Database, GraphQL: Globe, Figma: Palette, "Data Science": TrendingUp,
  DevOps: Database, Flutter: Code2, Go: Code2, Rust: Code2,
  "Machine Learning": Cpu, SQL: Database, AWS: Globe, Kubernetes: Globe,
  Web3: Globe, Photography: Camera, "Music Theory": Music,
  "Technical Writing": PenLine,
};
const SKILL_COLORS = {
  React: "#1d4ed8", TypeScript: "#5b21b6", Python: "#713f12",
  "UI/UX": "#9d174d", NodeJS: "#9f1239", GraphQL: "#7e22ce",
  Figma: "#be185d", "Data Science": "#065f46", DevOps: "#1e40af",
  Flutter: "#0369a1", Go: "#0f766e", Rust: "#92400e",
  "Machine Learning": "#3730a3", SQL: "#064e3b", AWS: "#b45309",
  Kubernetes: "#1e3a8a", Web3: "#7e22ce", Photography: "#991b1b",
  "Music Theory": "#6b21a8", "Technical Writing": "#166534",
};
const SKILL_BG = {
  React: "#DBEAFE", TypeScript: "#EDE9FE", Python: "#FEF9C3",
  "UI/UX": "#FCE7F3", NodeJS: "#FFE4E6", GraphQL: "#F3E8FF",
  Figma: "#FCE7F3", "Data Science": "#D1FAE5", DevOps: "#DBEAFE",
  Flutter: "#E0F2FE", Go: "#CCFBF1", Rust: "#FEF3C7",
  "Machine Learning": "#E0E7FF", SQL: "#D1FAE5", AWS: "#FEF3C7",
  Kubernetes: "#DBEAFE", Web3: "#F3E8FF", Photography: "#FEE2E2",
  "Music Theory": "#F3E8FF", "Technical Writing": "#F0FDF4",
};

// ── ANIMATED CREDITS ──────────────────────────────────────────────────────────
function AnimatedCredits({ value, size = 32 }) {
  const [display, setDisplay] = useState(value);
  const [bump,    setBump]    = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    setBump(true);
    const start = prev.current, end = value, dur = 600;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      setDisplay(Math.round(start + (end - start) * p));
      if (p < 1) requestAnimationFrame(step);
      else { setBump(false); prev.current = value; }
    };
    requestAnimationFrame(step);
  }, [value]);
  return (
    <motion.span animate={{ scale: bump ? [1,1.35,1] : 1 }} transition={{ duration:0.4 }}
      style={{ fontSize:size, fontWeight:800, color:T.dark,
        fontVariantNumeric:"tabular-nums", lineHeight:1 }}>
      {display}
    </motion.span>
  );
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending:    { bg:"#FEF3C7", color:"#92400e" },
    approved:   { bg:"#D1FAE5", color:"#065f46" },
    declined:   { bg:"#FEE2E2", color:"#991b1b" },
    confirming: { bg:"#DBEAFE", color:"#1e40af" },
    completed:  { bg:T.dark,    color:"#fff"     },
  };
  const st    = map[status] || { bg:T.alt, color:T.muted };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span style={{ background:st.bg, color:st.color, borderRadius:99,
      padding:"3px 12px", fontSize:12, fontWeight:700 }}>{label}</span>
  );
}

// ── SKILL GRAPH ───────────────────────────────────────────────────────────────
function SkillGraph({ skills = [] }) {
  if (!skills.length) return (
    <div style={{ textAlign:"center", color:T.muted, padding:"40px 0", fontSize:14 }}>
      Complete sessions to grow your skill graph
    </div>
  );
  const cx = 180, cy = 170, r = 110;
  return (
    <svg width="100%" viewBox="0 0 360 340" style={{ overflow:"visible" }}>
      <circle cx={cx} cy={cy} r={28} fill={T.dark} />
      <text x={cx} y={cy+5} textAnchor="middle" fontSize={11}
        fill="#fff" fontFamily="DM Sans,sans-serif" fontWeight={700}>YOU</text>
      {skills.map((s, i) => {
        const a  = (2*Math.PI*i/skills.length) - Math.PI/2;
        const x  = cx + r*Math.cos(a);
        const y  = cy + r*Math.sin(a);
        const sz = Math.min(14+(s.count||1)*5, 32);
        return (
          <g key={s.name||s}>
            <motion.line x1={cx} y1={cy} x2={x} y2={y}
              stroke={T.border} strokeWidth={1.5}
              initial={{ pathLength:0 }} animate={{ pathLength:1 }}
              transition={{ duration:0.7, delay:i*0.08 }} />
            <motion.circle cx={x} cy={y} r={sz} fill={T.yellow} opacity={0.9}
              initial={{ scale:0 }} animate={{ scale:1 }}
              transition={{ type:"spring", delay:i*0.08+0.3 }} />
            <text x={x} y={y+sz+14} textAnchor="middle"
              fontSize={11} fill={T.muted} fontFamily="DM Sans,sans-serif">
              {typeof s==="string" ? s : s.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  CREATE COURSE MODAL
// ═════════════════════════════════════════════════════════════════════════════
function CreateCourseModal({ profile, mentorId, onClose, onCreated }) {
  const toast = useContext(ToastCtx);
  const fileRef = useRef();
  const [form, setForm] = useState({
    title: "", skill: profile.skills?.[0] || ALL_SKILLS[0],
    subtitle: "", level: "Beginner", topics: "", credits: 1,
  });
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving,       setSaving]       = useState(false);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const handleImage = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast("Course title is required", "error"); return; }
    setSaving(true);
    try {
      let imageUrl = profile.photoURL || "";
      if (imageFile) {
        try { imageUrl = await sbUploadCourseImage(imageFile, profile.uid); }
        catch { toast("Image upload failed, using default.", "info"); }
      }
      const topicsArr = form.topics.split(",").map((t) => t.trim()).filter(Boolean);
      const row = await sbInsertCourse({
        mentor_uid: profile.uid, mentor_name: profile.displayName,
        mentor_photo: imageUrl, mentor_id: mentorId,
        mentor_email: profile.email, title: form.title.trim(),
        skill: form.skill, subtitle: form.subtitle.trim(),
        level: form.level, topics: topicsArr,
        credits: Number(form.credits), rating: 0, sessions_count: 0,
      });
      await rtUpdate(`users/${profile.uid}`, {
        role: "mentor",
        skills: Array.from(new Set([...(profile.skills||[]), form.skill])),
      });
      toast("Course published to Marketplace! 🎉", "success");
      onCreated(row); onClose();
    } catch (e) { toast(e.message, "error"); }
    setSaving(false);
  };

  const mentorSkills = Array.isArray(profile.skills) && profile.skills.length > 0
    ? profile.skills : ALL_SKILLS;

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)",
        zIndex:700, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <motion.div initial={{ scale:0.88, opacity:0 }} animate={{ scale:1, opacity:1 }}
        exit={{ scale:0.88, opacity:0 }} onClick={(e) => e.stopPropagation()}
        style={{ ...cardStyle({ padding:0 }), width:"100%", maxWidth:540,
          maxHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"22px 24px 18px", borderBottom:`1px solid ${T.border}`,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:800, fontSize:20 }}>Create Course</div>
            <div style={{ fontSize:13, color:T.muted }}>Publish to the Marketplace</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none" }}><X size={20} color={T.muted} /></button>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"22px 24px" }}>
          {/* Photo */}
          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:10 }}>Course / Mentor Photo</label>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ width:72, height:72, borderRadius:16, overflow:"hidden",
                background:T.alt, border:`2px dashed ${T.border}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0, cursor:"pointer" }}
                onClick={() => fileRef.current?.click()}>
                {imagePreview
                  ? <img src={imagePreview} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                  : <ImageIcon size={24} color={T.muted} />}
              </div>
              <motion.button whileTap={{ scale:0.95 }} onClick={() => fileRef.current?.click()}
                style={{ ...pillStyle(false,false,{ padding:"8px 16px", fontSize:13 }) }}>
                <Upload size={13} /> Upload Image
              </motion.button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleImage} />
            </div>
          </div>
          {/* Title */}
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:8 }}>Course Title *</label>
            <input value={form.title} onChange={(e) => upd("title", e.target.value)}
              placeholder="e.g. React from Scratch"
              style={{ width:"100%", padding:"11px 14px", borderRadius:12,
                border:`1.5px solid ${T.border}`, background:T.surface, fontSize:14, outline:"none" }} />
          </div>
          {/* Skill */}
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:8 }}>Skill / Category *</label>
            <select value={form.skill} onChange={(e) => upd("skill", e.target.value)}
              style={{ width:"100%", padding:"11px 14px", borderRadius:12,
                border:`1.5px solid ${T.border}`, background:T.surface, fontSize:14, outline:"none", appearance:"none" }}>
              {mentorSkills.map((s) => <option key={s} value={s}>{s}</option>)}
              {ALL_SKILLS.filter((s) => !mentorSkills.includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* Subtitle */}
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:8 }}>Short Description</label>
            <input value={form.subtitle} onChange={(e) => upd("subtitle", e.target.value)}
              placeholder="e.g. Hooks, Context & real projects"
              style={{ width:"100%", padding:"11px 14px", borderRadius:12,
                border:`1.5px solid ${T.border}`, background:T.surface, fontSize:14, outline:"none" }} />
          </div>
          {/* Level */}
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:8 }}>Level</label>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["Beginner","Intermediate","Advanced","All levels"].map((lvl) => (
                <motion.button key={lvl} whileTap={{ scale:0.93 }} onClick={() => upd("level", lvl)}
                  style={{ ...pillStyle(form.level===lvl, false, { padding:"7px 14px", fontSize:13 }) }}>
                  {form.level===lvl && <Check size={11} />} {lvl}
                </motion.button>
              ))}
            </div>
          </div>
          {/* Topics */}
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:8 }}>
              Topics <span style={{ fontWeight:400 }}>(comma-separated)</span>
            </label>
            <input value={form.topics} onChange={(e) => upd("topics", e.target.value)}
              placeholder="e.g. useState, useEffect, Custom Hooks"
              style={{ width:"100%", padding:"11px 14px", borderRadius:12,
                border:`1.5px solid ${T.border}`, background:T.surface, fontSize:14, outline:"none" }} />
          </div>
          {/* Credits */}
          <div style={{ marginBottom:24 }}>
            <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:8 }}>Credits per session</label>
            <div style={{ display:"flex", gap:8 }}>
              {[1, 2, 3].map((n) => (
                <motion.button key={n} whileTap={{ scale:0.93 }} onClick={() => upd("credits", n)}
                  style={{ ...pillStyle(form.credits===n, form.credits===n, { padding:"7px 18px", fontSize:14 }) }}>
                  {n}
                </motion.button>
              ))}
            </div>
          </div>
          <motion.button whileTap={{ scale:0.96 }} disabled={saving} onClick={handleSubmit}
            style={{ ...pillStyle(true, false, { width:"100%", justifyContent:"center",
              padding:"13px", fontSize:15, opacity:saving?0.6:1 }) }}>
            {saving ? <><Loader2 size={15} className="spin" /> Publishing…</> : <><Sparkles size={15} /> Publish to Marketplace</>}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  COURSE CARD
// ═════════════════════════════════════════════════════════════════════════════
function CourseCard({ course, profile, onRequest }) {
  const [hover,    setHover]    = useState(false);
  const [reqModal, setReqModal] = useState(false);
  const canBook   = (profile?.credits || 0) >= (course.credits || 1);
  const isSelf    = profile?.uid === course.mentor_uid;
  const Icon      = SKILL_ICONS[course.skill] || BookOpen;
  const iconColor = SKILL_COLORS[course.skill] || "#1d4ed8";
  const iconBg    = SKILL_BG[course.skill]    || "#DBEAFE";

  return (
    <>
      <motion.div
        onHoverStart={() => setHover(true)} onHoverEnd={() => setHover(false)}
        animate={{ y:hover?-5:0, boxShadow:hover?"0 12px 36px rgba(0,0,0,0.11)":"0 1px 6px rgba(0,0,0,0.05)" }}
        style={{ ...cardStyle({ padding:0 }), overflow:"hidden", display:"flex", flexDirection:"column" }}>
        <div style={{ background:iconBg, padding:"18px 18px 14px", borderBottom:`1px solid ${T.border}` }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {course.mentor_photo
                ? <img src={course.mentor_photo} alt=""
                    style={{ width:44, height:44, borderRadius:12, objectFit:"cover",
                      border:"2px solid rgba(255,255,255,0.7)" }} />
                : <div style={{ width:44, height:44, borderRadius:12,
                    background:"rgba(255,255,255,0.7)", backdropFilter:"blur(4px)",
                    display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Icon size={22} color={iconColor} />
                  </div>}
              <div>
                <div style={{ fontWeight:700, fontSize:12, color:iconColor,
                  background:"rgba(255,255,255,0.6)", borderRadius:99,
                  padding:"2px 8px", display:"inline-block", marginBottom:3 }}>
                  {course.skill}
                </div>
                <div style={{ fontSize:12, color:T.muted }}>{course.mentor_name}</div>
              </div>
            </div>
            {course.rating > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <Star size={11} color="#f59e0b" fill="#f59e0b" />
                <span style={{ fontSize:12, fontWeight:700, color:T.dark }}>{course.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
          <div style={{ fontWeight:800, fontSize:17, color:T.dark, marginBottom:3 }}>{course.title}</div>
          {course.subtitle && <div style={{ fontSize:13, color:T.muted, lineHeight:1.4 }}>{course.subtitle}</div>}
        </div>
        <div style={{ padding:"14px 18px 0", flex:1 }}>
          <div style={{ display:"flex", gap:12, marginBottom:10 }}>
            <span style={{ fontSize:11, color:T.muted, display:"flex", alignItems:"center", gap:4 }}>
              <BookOpen size={11} /> {course.level || "All levels"}
            </span>
            <span style={{ fontSize:11, color:T.muted, display:"flex", alignItems:"center", gap:4 }}>
              <Clock size={11} /> 1 hr / session
            </span>
            {course.sessions_count > 0 && (
              <span style={{ fontSize:11, color:T.muted, display:"flex", alignItems:"center", gap:4 }}>
                <User size={11} /> {course.sessions_count} sessions
              </span>
            )}
          </div>
          {Array.isArray(course.topics) && course.topics.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:14 }}>
              {course.topics.slice(0,4).map((t) => (
                <span key={t} style={{ background:T.alt, borderRadius:99,
                  padding:"3px 9px", fontSize:11, color:T.muted, fontWeight:500 }}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding:"10px 18px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <Coins size={13} color={T.yellow} />
            <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>{course.credits || 1} credit / hr</span>
          </div>
          {isSelf ? (
            <span style={{ fontSize:12, color:T.muted, fontStyle:"italic" }}>Your course</span>
          ) : (
            <motion.button whileTap={{ scale:0.93 }}
              disabled={!canBook} onClick={() => setReqModal(true)}
              style={{ ...pillStyle(false, canBook, { padding:"8px 16px", fontSize:13,
                opacity:canBook?1:0.4, cursor:canBook?"pointer":"not-allowed" }) }}>
              <Video size={13} /> Book via Zoom
            </motion.button>
          )}
        </div>
      </motion.div>
      <AnimatePresence>
        {reqModal && (
          <ZoomRequestModal course={course} profile={profile}
            onClose={() => setReqModal(false)}
            onConfirm={() => { onRequest(course); setReqModal(false); }} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── ZOOM REQUEST MODAL ────────────────────────────────────────────────────────
function ZoomRequestModal({ course, profile, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
        zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <motion.div initial={{ scale:0.88, opacity:0 }} animate={{ scale:1, opacity:1 }}
        exit={{ scale:0.88, opacity:0 }} onClick={(e) => e.stopPropagation()}
        style={{ ...cardStyle({ padding:28 }), width:"100%", maxWidth:420 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <div style={{ fontWeight:800, fontSize:19 }}>Request Zoom Session</div>
          <button onClick={onClose} style={{ background:"none", border:"none" }}><X size={20} color={T.muted} /></button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12, background:T.alt,
          borderRadius:14, padding:"12px 14px", marginBottom:20 }}>
          {course.mentor_photo
            ? <img src={course.mentor_photo} alt=""
                style={{ width:44, height:44, borderRadius:10, objectFit:"cover", flexShrink:0 }} />
            : <div style={{ width:44, height:44, borderRadius:10, background:T.dark,
                display:"flex", alignItems:"center", justifyContent:"center",
                color:"#fff", fontWeight:700, flexShrink:0 }}>
                {(course.mentor_name?.[0]||"?").toUpperCase()}
              </div>}
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>{course.title}</div>
            <div style={{ fontSize:12, color:T.muted }}>with {course.mentor_name} · {course.skill}</div>
          </div>
        </div>
        <div style={{ background:"#DBEAFE", borderRadius:12, padding:"12px 14px", marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:13, color:"#1e40af", marginBottom:8 }}>How it works:</div>
          {["1. Request sent to mentor","2. Mentor approves → Zoom meeting auto-created",
            "3. 1 credit deducted from your account","4. Both join via the Zoom link"].map((s) => (
            <div key={s} style={{ fontSize:13, color:"#1e40af", marginBottom:4 }}>{s}</div>
          ))}
        </div>
        <div style={{ background:T.yellowLt, borderRadius:12, padding:"10px 14px",
          marginBottom:22, display:"flex", alignItems:"center", gap:8 }}>
          <Coins size={14} color="#92400e" />
          <span style={{ fontSize:13, color:"#92400e", fontWeight:500 }}>
            {course.credits||1} credit deducted on mentor approval
          </span>
        </div>
        <motion.button whileTap={{ scale:0.96 }} disabled={loading}
          onClick={() => { setLoading(true); onConfirm(); }}
          style={{ ...pillStyle(true, false, { width:"100%", justifyContent:"center",
            padding:"13px", fontSize:15, opacity:loading?0.6:1 }) }}>
          {loading ? <><Loader2 size={15} className="spin" /> Sending…</> : <><Video size={15} /> Send Zoom Request</>}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  MARKETPLACE
// ═════════════════════════════════════════════════════════════════════════════
function Marketplace({ profile }) {
  const toast = useContext(ToastCtx);
  const [courses,    setCourses]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [category,   setCategory]   = useState("All");
  const [reqLoading, setReqLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    sbGetAllCourses()
      .then((rows) => { setCourses(rows); setLoading(false); })
      .catch((e)   => { toast("Could not load courses: "+e.message, "error"); setLoading(false); });
  }, []);

  const categories = ["All", ...new Set(courses.map((c) => c.skill))];
  const filtered = courses.filter((c) => {
    const byCat    = category === "All" || c.skill === category;
    const bySearch = !search ||
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.skill?.toLowerCase().includes(search.toLowerCase()) ||
      c.mentor_name?.toLowerCase().includes(search.toLowerCase()) ||
      (c.topics||[]).some((t) => t.toLowerCase().includes(search.toLowerCase()));
    return byCat && bySearch;
  });

  const handleRequest = async (course) => {
    if (!course?.id)                                 { toast("Course data missing. Refresh.", "error"); return; }
    if ((profile.credits||0) < (course.credits||1)) { toast("Not enough credits", "error"); return; }
    if (profile.uid === course.mentor_uid)           { toast("You can't book your own course.", "error"); return; }
    setReqLoading(true);
    try {
      await sbInsertRequest({
        learner_uid: profile.uid, learner_name: profile.displayName,
        mentor_uid: course.mentor_uid, mentor_name: course.mentor_name,
        skill: course.skill, course_id: course.id, course_title: course.title,
        status: "pending", credit_escrow: true, confirmed_by: {},
        meet_link: "", zoom_meeting_id: null, zoom_password: null,
      });
      toast("Zoom request sent! Credit deducted on approval 🔒", "success");
    } catch (e) { toast("Request failed: " + e.message, "error"); }
    setReqLoading(false);
  };

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:28 }}>
        {[
          { label:"Courses",      value:courses.length,      icon:BookOpen, color:"#1d4ed8" },
          { label:"Your Credits", value:profile.credits||0,  icon:Coins,    color:"#92400e" },
          { label:"Categories",   value:categories.length-1, icon:Globe,    color:"#7e22ce" },
        ].map(({ label, value, icon:Icon, color }) => (
          <div key={label} style={{ ...cardStyle({ padding:"14px 18px" }), display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:color+"18",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Icon size={16} color={color} />
            </div>
            <div>
              <div style={{ fontWeight:800, fontSize:22, lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position:"relative", marginBottom:18 }}>
        <Search size={15} color={T.muted} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses, skills or mentors…"
          style={{ width:"100%", padding:"12px 14px 12px 40px", borderRadius:12,
            border:`1.5px solid ${T.border}`, background:T.surface, fontSize:14, outline:"none" }} />
      </div>
      {categories.length > 1 && (
        <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6, marginBottom:20 }}>
          {categories.map((cat) => (
            <motion.button key={cat} whileTap={{ scale:0.93 }} onClick={() => setCategory(cat)}
              style={{ ...pillStyle(category===cat, false, { whiteSpace:"nowrap", padding:"8px 16px", fontSize:13 }) }}>
              {cat}
            </motion.button>
          ))}
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:16 }}>
          {category==="All" ? "All Courses" : category}
          <span style={{ color:T.muted, fontWeight:400, fontSize:14 }}> · {filtered.length} available</span>
        </div>
        {(profile.credits||0) < 1 && (
          <div style={{ background:"#FEE2E2", color:"#991b1b", borderRadius:99,
            padding:"4px 12px", fontSize:12, fontWeight:600 }}>⚠️ Need credits to book</div>
        )}
      </div>
      {loading ? (
        <div style={{ textAlign:"center", padding:80, color:T.muted }}>
          <Loader2 size={28} className="spin" style={{ marginBottom:10 }} />
          <div style={{ fontSize:14 }}>Loading courses…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle({ padding:"80px 20px" }), textAlign:"center", color:T.muted }}>
          <BookOpen size={40} style={{ marginBottom:16, opacity:0.2 }} />
          <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>
            {courses.length === 0 ? "No courses yet" : "No courses match your search"}
          </div>
          <div style={{ fontSize:14 }}>
            {courses.length === 0 ? "Mentors haven't published any courses yet." : "Try a different search."}
          </div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))", gap:16 }}>
          <AnimatePresence>
            {filtered.map((course, i) => (
              <motion.div key={course.id}
                initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }}
                exit={{ opacity:0 }} transition={{ delay:i*0.04 }}>
                <CourseCard course={course} profile={profile} onRequest={handleRequest} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  MENTOR DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function MentorDashboard({ profile, mentorId, onExit }) {
  const toast = useContext(ToastCtx);
  const [requests,    setRequests]    = useState([]);
  const [courses,     setCourses]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [coursesLoad, setCoursesLoad] = useState(true);
  const [busy,        setBusy]        = useState({});
  const [tab,         setTab]         = useState("pending");
  const [showCreate,  setShowCreate]  = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try { setRequests(await sbGetRequests("mentor_uid", profile.uid)); setLastRefresh(new Date()); }
    catch(e) { toast("Could not load requests: "+e.message, "error"); }
    setLoading(false);
  }, [profile.uid]);

  const fetchCourses = useCallback(async () => {
    setCoursesLoad(true);
    try { setCourses(await sbGetMentorCourses(profile.uid)); }
    catch(e) { toast("Could not load courses: "+e.message, "error"); }
    setCoursesLoad(false);
  }, [profile.uid]);

  useEffect(() => { fetchRequests(); fetchCourses(); }, [fetchRequests, fetchCourses]);
  useEffect(() => { const id = setInterval(fetchRequests, 10000); return () => clearInterval(id); }, [fetchRequests]);

  const setOne = (id, v) => setBusy((p) => ({ ...p, [id]: v }));

  // ── Approve: calls Cloudflare Worker proxy ────────────────────────────────
  const handleApprove = async (req) => {
    setOne(req.id, "approving");
    try {
      toast("Creating Zoom meeting via proxy…", "info");
      let zoomData;
      try {
        zoomData = await createZoomMeeting(profile.email, req.learner_name, req.skill);
      } catch (zoomErr) {
        toast("Zoom unavailable — using fallback link.", "info");
        zoomData = generateFallbackZoomLink(req.skill);
      }
      await sbUpdateRequest(req.id, {
        status: "approved", meet_link: zoomData.joinUrl,
        zoom_meeting_id: zoomData.meetingId, zoom_password: zoomData.password,
        confirmed_by: { mentor: true },
      });
      const lc = await rtGet(`users/${req.learner_uid}/credits`);
      if ((lc||0) >= 1) {
        await rtUpdate(`users/${req.learner_uid}`, { credits: (lc||0) - 1 });
        toast("Approved! Zoom link created. 1 credit deducted ✅", "success");
      } else {
        toast("Approved (learner has no credits).", "info");
      }
      const ms = await rtGet(`users/${profile.uid}/sessionsAsMentor`);
      await rtUpdate(`users/${profile.uid}`, { sessionsAsMentor: (ms||0)+1 });
      fetchRequests();
    } catch(e) { toast("Approve failed: " + e.message, "error"); }
    setOne(req.id, false);
  };

  const handleDecline = async (req) => {
    setOne(req.id, "declining");
    try {
      await sbUpdateRequest(req.id, { status: "declined" });
      toast("Request declined.", "info");
      fetchRequests();
    } catch(e) { toast(e.message, "error"); }
    setOne(req.id, false);
  };

  // ── NEW: Delete any request (approved/completed/declined) ─────────────────
  const handleDeleteRequest = async (req) => {
    if (!window.confirm(`Delete this request from ${req.learner_name}?`)) return;
    setOne(req.id, "deleting");
    try {
      await sbDeleteRequest(req.id);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      toast("Request deleted.", "info");
    } catch(e) { toast("Delete failed: " + e.message, "error"); }
    setOne(req.id, false);
  };

  const handleDeleteCourse = async (courseId) => {
    if (!window.confirm("Delete this course?")) return;
    try {
      await sbDeleteCourse(courseId);
      setCourses((p) => p.filter((c) => c.id !== courseId));
      toast("Course deleted.", "info");
    } catch(e) { toast(e.message, "error"); }
  };

  const filtered = requests.filter((r) => {
    if (tab==="pending")  return r.status==="pending";
    if (tab==="approved") return ["approved","confirming","completed"].includes(r.status);
    if (tab==="declined") return r.status==="declined";
    return true;
  });
  const pendingCount  = requests.filter((r) => r.status==="pending").length;
  const approvedCount = requests.filter((r) => ["approved","confirming","completed"].includes(r.status)).length;
  const stats = [
    { label:"Pending",  value:pendingCount,                icon:Clock,       color:"#92400e", bg:"#FEF3C7" },
    { label:"Approved", value:approvedCount,               icon:CheckCircle, color:T.success, bg:"#D1FAE5" },
    { label:"Courses",  value:courses.length,              icon:BookOpen,    color:T.mentor,  bg:T.mentorLt },
    { label:"Sessions", value:profile.sessionsAsMentor||0, icon:Award,       color:"#1d4ed8", bg:"#DBEAFE" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg }}>
      <GlobalStyles />
      <nav style={{ position:"sticky", top:0, zIndex:100,
        background:"rgba(245,243,238,0.92)", backdropFilter:"blur(14px)",
        borderBottom:`1px solid ${T.border}`,
        display:"flex", alignItems:"center", padding:"11px 24px", gap:14, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ background:T.mentor, borderRadius:10, width:36, height:36,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Shield size={17} color="#fff" />
          </div>
          <div>
            <span style={{ fontWeight:800, fontSize:16, letterSpacing:"-0.5px" }}>Mentor Dashboard</span>
            <span style={{ display:"block", fontSize:11, color:T.muted, lineHeight:1 }}>ID: {mentorId}</span>
          </div>
        </div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", alignItems:"center", gap:6,
          background:T.dark, borderRadius:999, padding:"8px 16px" }}>
          <span className="pulse"><Coins size={14} color={T.yellow} /></span>
          <AnimatedCredits value={profile.credits||0} size={18} />
          <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:400 }}>credits</span>
        </div>
        <motion.button whileTap={{ scale:0.9 }} onClick={onExit}
          style={{ ...pillStyle(false,false,{ padding:"8px 14px", fontSize:13, gap:6 }) }}>
          <Globe size={13} /> Learner View
        </motion.button>
      </nav>

      <main style={{ maxWidth:1080, margin:"0 auto", padding:"28px 20px 60px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
          flexWrap:"wrap", gap:12, marginBottom:28 }}>
          <div>
            <h1 style={{ fontSize:28, fontWeight:800, letterSpacing:"-1px", marginBottom:4 }}>
              Welcome back, {profile.displayName?.split(" ")?.[0] || "Mentor"} 👋
            </h1>
            <div style={{ fontSize:14, color:T.muted, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <RefreshCw size={13} />
              Last updated: {lastRefresh.toLocaleTimeString()} · auto-refreshes every 10s
              <motion.button whileTap={{ scale:0.9 }} onClick={fetchRequests}
                style={{ background:T.mentorLt, border:"none", cursor:"pointer",
                  fontSize:13, color:T.mentor, fontWeight:600, fontFamily:"inherit",
                  padding:"2px 10px", borderRadius:8 }}>
                Refresh now
              </motion.button>
            </div>
          </div>
          <motion.button whileTap={{ scale:0.96 }} onClick={() => setShowCreate(true)}
            style={{ ...pillStyle(true, false, { padding:"11px 20px", fontSize:14, background:T.mentor, color:"#fff" }) }}>
            <Plus size={15} /> Create Course
          </motion.button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:28 }}>
          {stats.map(({ label, value, icon:Icon, color, bg }) => (
            <div key={label} style={{ ...cardStyle({ padding:"16px 18px" }), display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:38, height:38, borderRadius:10, background:bg,
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Icon size={17} color={color} />
              </div>
              <div>
                <div style={{ fontWeight:800, fontSize:24, lineHeight:1 }}>{value}</div>
                <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* My Courses */}
        <div style={{ ...cardStyle({ marginBottom:28 }) }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:16 }}>My Courses</div>
              <div style={{ fontSize:13, color:T.muted }}>Published to the Marketplace</div>
            </div>
            <motion.button whileTap={{ scale:0.96 }} onClick={() => setShowCreate(true)}
              style={{ ...pillStyle(false, false, { padding:"8px 14px", fontSize:13 }) }}>
              <Plus size={13} /> New Course
            </motion.button>
          </div>
          {coursesLoad ? (
            <div style={{ textAlign:"center", padding:40, color:T.muted }}><Loader2 size={22} className="spin" /></div>
          ) : courses.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 20px", color:T.muted }}>
              <BookOpen size={32} style={{ marginBottom:10, opacity:0.3 }} />
              <div style={{ fontWeight:600, fontSize:14, marginBottom:6 }}>No courses yet</div>
              <motion.button whileTap={{ scale:0.95 }} onClick={() => setShowCreate(true)}
                style={{ ...pillStyle(true, false, { marginTop:16, padding:"10px 20px", fontSize:14 }) }}>
                <Plus size={14} /> Create First Course
              </motion.button>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
              {courses.map((course) => {
                const Icon      = SKILL_ICONS[course.skill] || BookOpen;
                const iconColor = SKILL_COLORS[course.skill] || "#1d4ed8";
                const iconBg    = SKILL_BG[course.skill]    || "#DBEAFE";
                return (
                  <div key={course.id} style={{ background:T.alt, borderRadius:14, padding:16,
                    border:`1px solid ${T.border}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                      {course.mentor_photo
                        ? <img src={course.mentor_photo} alt=""
                            style={{ width:40, height:40, borderRadius:10, objectFit:"cover" }} />
                        : <div style={{ width:40, height:40, borderRadius:10, background:iconBg,
                            display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <Icon size={18} color={iconColor} />
                          </div>}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:14,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {course.title}
                        </div>
                        <div style={{ fontSize:12, color:T.muted }}>{course.skill} · {course.level}</div>
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"space-between" }}>
                      <span style={{ fontSize:12, color:"#065f46", background:"#D1FAE5",
                        borderRadius:99, padding:"3px 10px", fontWeight:600 }}>✓ Live</span>
                      <motion.button whileTap={{ scale:0.9 }} onClick={() => handleDeleteCourse(course.id)}
                        style={{ background:"#FEE2E2", border:"none", borderRadius:8,
                          padding:"6px 8px", cursor:"pointer", display:"flex", alignItems:"center" }}>
                        <Trash2 size={13} color={T.danger} />
                      </motion.button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Session Requests */}
        <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.5px", marginBottom:14 }}>Session Requests</div>
        <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          {[
            { key:"pending",  label:`Pending (${pendingCount})`   },
            { key:"approved", label:`Approved (${approvedCount})` },
            { key:"declined", label:"Declined" },
            { key:"all",      label:"All" },
          ].map(({ key, label }) => (
            <motion.button key={key} whileTap={{ scale:0.93 }} onClick={() => setTab(key)}
              style={{ ...pillStyle(tab===key, false, { padding:"9px 18px", fontSize:13 }) }}>
              {label}
            </motion.button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:80, color:T.muted }}>
            <Loader2 size={28} className="spin" style={{ marginBottom:10 }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ ...cardStyle({ padding:"60px 20px" }), textAlign:"center", color:T.muted }}>
            <MessageSquare size={32} style={{ marginBottom:12, opacity:0.3 }} />
            <div style={{ fontWeight:600, fontSize:15, marginBottom:6 }}>No {tab} requests</div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <AnimatePresence>
              {filtered.map((req) => (
                <MentorRequestCard key={req.id} req={req}
                  busy={busy[req.id]}
                  onApprove={handleApprove}
                  onDecline={handleDecline}
                  onDelete={handleDeleteRequest} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <AnimatePresence>
        {showCreate && (
          <CreateCourseModal profile={profile} mentorId={mentorId}
            onClose={() => setShowCreate(false)}
            onCreated={(row) => setCourses((p) => [row, ...p])} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── MENTOR REQUEST CARD (with delete button) ──────────────────────────────────
function MentorRequestCard({ req, busy, onApprove, onDecline, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const isNonPending = ["approved","confirming","completed","declined"].includes(req.status);

  return (
    <motion.div layout initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
      exit={{ opacity:0, scale:0.97 }}
      style={{ ...cardStyle({ padding:0 }), overflow:"hidden" }}>
      <div style={{ padding:"18px 20px", display:"flex", flexWrap:"wrap",
        alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, flex:1, minWidth:0 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:T.dark,
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"#fff", fontWeight:800, fontSize:18, flexShrink:0 }}>
            {(req.learner_name?.[0]||"?").toUpperCase()}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:3 }}>
              {req.learner_name}
              <span style={{ color:T.muted, fontWeight:400, fontSize:13 }}> wants to learn </span>
              <span style={{ fontWeight:700, color:T.mentor }}>{req.skill}</span>
              {req.course_title && (
                <span style={{ color:T.muted, fontWeight:400, fontSize:13 }}> · {req.course_title}</span>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <StatusBadge status={req.status} />
              <span style={{ fontSize:12, color:T.muted, display:"flex", alignItems:"center", gap:4 }}>
                <Calendar size={11} /> {formatTime(req.created_at)}
              </span>
              <span style={{ fontSize:12, color:"#1d4ed8", background:"#DBEAFE",
                borderRadius:99, padding:"2px 8px", fontWeight:600,
                display:"flex", alignItems:"center", gap:4 }}>
                <Video size={11} /> Zoom
              </span>
            </div>
          </div>
        </div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          {/* Pending actions */}
          {req.status==="pending" && (
            <>
              <motion.button whileTap={{ scale:0.93 }}
                disabled={!!busy} onClick={() => onApprove(req)}
                style={{ ...pillStyle(true, false, { padding:"9px 18px", fontSize:13,
                  opacity:busy?0.5:1, background:"#16A34A" }) }}>
                {busy==="approving"
                  ? <><Loader2 size={13} className="spin" /> Creating Zoom…</>
                  : <><CheckCircle size={13} /> Approve &amp; Create Zoom</>}
              </motion.button>
              <motion.button whileTap={{ scale:0.93 }}
                disabled={!!busy} onClick={() => onDecline(req)}
                style={{ ...pillStyle(false, false, { padding:"9px 18px", fontSize:13,
                  opacity:busy?0.5:1, color:T.danger }) }}>
                {busy==="declining"
                  ? <><Loader2 size={13} className="spin" /> Declining…</>
                  : <><XCircle size={13} /> Decline</>}
              </motion.button>
            </>
          )}

          {/* Join Zoom button for approved sessions */}
          {["approved","confirming","completed"].includes(req.status) && req.meet_link && (
            <a href={req.meet_link} target="_blank" rel="noopener noreferrer"
              style={{ ...pillStyle(false, true, { padding:"9px 18px", fontSize:13, textDecoration:"none" }) }}>
              <Video size={13} /> Join Zoom
            </a>
          )}

          {/* DELETE button — shown for all non-pending statuses */}
          {isNonPending && (
            <motion.button whileTap={{ scale:0.93 }}
              disabled={busy==="deleting"} onClick={() => onDelete(req)}
              style={{ background:"#FEE2E2", border:"none", borderRadius:10,
                padding:"9px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
                fontSize:13, fontWeight:600, color:T.danger,
                opacity:busy==="deleting"?0.5:1 }}>
              {busy==="deleting"
                ? <Loader2 size={13} className="spin" />
                : <Trash2 size={13} />}
              {busy==="deleting" ? "Deleting…" : "Delete"}
            </motion.button>
          )}

          {/* Expand toggle */}
          <motion.button whileTap={{ scale:0.93 }} onClick={() => setExpanded(!expanded)}
            style={{ ...pillStyle(false, false, { padding:"9px 14px", fontSize:13 }) }}>
            <ChevronRight size={14} style={{ transform:expanded?"rotate(90deg)":"rotate(0deg)", transition:"0.2s" }} />
          </motion.button>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }}
            exit={{ height:0, opacity:0 }} style={{ overflow:"hidden" }}>
            <div style={{ borderTop:`1px solid ${T.border}`, padding:"16px 20px",
              background:T.alt, display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:16 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:T.muted, marginBottom:6,
                  textTransform:"uppercase", letterSpacing:"0.05em" }}>Learner ID</div>
                <div style={{ fontSize:13, fontFamily:"monospace" }}>{req.learner_uid?.slice(0,16)}…</div>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:T.muted, marginBottom:6,
                  textTransform:"uppercase", letterSpacing:"0.05em" }}>Course ID</div>
                <div style={{ fontSize:13, fontFamily:"monospace" }}>{req.course_id || "—"}</div>
              </div>
              {req.zoom_meeting_id && (
                <div>
                  <div style={{ fontSize:11, fontWeight:600, color:T.muted, marginBottom:6,
                    textTransform:"uppercase", letterSpacing:"0.05em" }}>Zoom Meeting ID</div>
                  <div style={{ fontSize:13, fontFamily:"monospace" }}>{req.zoom_meeting_id}</div>
                </div>
              )}
              {req.zoom_password && (
                <div>
                  <div style={{ fontSize:11, fontWeight:600, color:T.muted, marginBottom:6,
                    textTransform:"uppercase", letterSpacing:"0.05em" }}>Password</div>
                  <div style={{ fontSize:13, fontFamily:"monospace" }}>{req.zoom_password}</div>
                </div>
              )}
              {req.meet_link && (
                <div style={{ gridColumn:"1/-1" }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.muted, marginBottom:6,
                    textTransform:"uppercase", letterSpacing:"0.05em" }}>Zoom Link</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ flex:1, fontSize:12, color:"#1d4ed8", fontFamily:"monospace",
                      background:"#DBEAFE", borderRadius:8, padding:"8px 12px",
                      wordBreak:"break-all", lineHeight:1.5 }}>{req.meet_link}</div>
                    <a href={req.meet_link} target="_blank" rel="noopener noreferrer"
                      style={{ ...pillStyle(false, false, { padding:"8px 12px", fontSize:12, textDecoration:"none" }) }}>
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  REQUESTS PAGE (learner view)
// ═════════════════════════════════════════════════════════════════════════════
function Requests({ profile }) {
  const toast = useContext(ToastCtx);
  const [tab,      setTab]      = useState("outgoing");
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState({});

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const field = tab==="incoming" ? "mentor_uid" : "learner_uid";
      setRequests(await sbGetRequests(field, profile.uid));
    } catch(e) { toast("Could not load requests: "+e.message, "error"); }
    setLoading(false);
  }, [tab, profile.uid]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { const id = setInterval(fetchRequests, 8000); return () => clearInterval(id); }, [fetchRequests]);

  const setOne = (id, v) => setBusy((p) => ({ ...p, [id]: v }));

  const confirm = async (req) => {
    setOne(req.id, true);
    const myRole      = profile.uid===req.mentor_uid ? "mentor" : "learner";
    const confirmedBy = { ...(req.confirmed_by||{}), [myRole]: true };
    const both        = confirmedBy.mentor && confirmedBy.learner;
    try {
      await sbUpdateRequest(req.id, { confirmed_by:confirmedBy, status:both?"completed":"confirming" });
      if (both) {
        const mc  = await rtGet(`users/${req.mentor_uid}/credits`);
        const me  = await rtGet(`users/${req.mentor_uid}/totalEarned`);
        const ms  = await rtGet(`users/${req.mentor_uid}/sessionsAsMentor`);
        const mst = await rtGet(`users/${req.mentor_uid}/streak`);
        await rtUpdate(`users/${req.mentor_uid}`, {
          credits:(mc||0)+1, totalEarned:(me||0)+1,
          sessionsAsMentor:(ms||0)+1, streak:(mst||0)+1,
        });
        const ls      = await rtGet(`users/${req.learner_uid}/sessionsAsLearner`);
        const lSkills = await rtGet(`users/${req.learner_uid}/skills`) || [];
        const exists  = lSkills.some((s) => (typeof s==="string"?s:s.name)===req.skill);
        await rtUpdate(`users/${req.learner_uid}`, {
          sessionsAsLearner: (ls||0)+1,
          skills: exists
            ? lSkills.map((s) => { const n=typeof s==="string"?s:s.name; return n===req.skill?{name:n,count:(s.count||1)+1}:s; })
            : [...lSkills, { name:req.skill, count:1 }],
        });
      }
      toast(both?"Both confirmed! Credits settled 🎉":"Confirmed! Waiting for other party…","success");
      fetchRequests();
    } catch(e) { toast(e.message,"error"); }
    setOne(req.id, false);
  };

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:24 }}>
        {["outgoing","incoming"].map((t) => (
          <motion.button key={t} whileTap={{ scale:0.93 }} onClick={() => setTab(t)}
            style={{ ...pillStyle(tab===t, false, { padding:"9px 20px", textTransform:"capitalize" }) }}>
            {t}
          </motion.button>
        ))}
      </div>
      {loading
        ? <div style={{ textAlign:"center", padding:80, color:T.muted }}><Loader2 size={24} className="spin" /></div>
        : requests.length === 0
        ? <div style={{ textAlign:"center", padding:80, color:T.muted, fontSize:14 }}>No {tab} requests yet.</div>
        : (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {requests.map((req) => {
              const myRole    = profile.uid===req.mentor_uid ? "mentor" : "learner";
              const confirmed = req.confirmed_by?.[myRole];
              const showConfirm = (req.status==="approved"||req.status==="confirming") && !confirmed;
              return (
                <motion.div key={req.id} layout initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
                  style={{ ...cardStyle() }}>
                  <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center",
                    justifyContent:"space-between", gap:12 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>
                        {tab==="incoming" ? req.learner_name : req.mentor_name}
                        <span style={{ color:T.muted, fontWeight:400, fontSize:13 }}> — {req.skill}</span>
                        {req.course_title && (
                          <span style={{ color:T.muted, fontWeight:400, fontSize:13 }}> · {req.course_title}</span>
                        )}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <StatusBadge status={req.status} />
                        {req.created_at && (
                          <span style={{ fontSize:12, color:T.muted }}>
                            {new Date(req.created_at).toLocaleDateString()}
                          </span>
                        )}
                        <span style={{ fontSize:12, color:"#1d4ed8", background:"#DBEAFE",
                          borderRadius:99, padding:"2px 8px", fontWeight:600,
                          display:"flex", alignItems:"center", gap:4 }}>
                          <Video size={11} /> Zoom
                        </span>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      {req.status==="approved" && req.meet_link && (
                        <a href={req.meet_link} target="_blank" rel="noopener noreferrer"
                          style={{ ...pillStyle(false, true, { padding:"8px 16px", fontSize:13, textDecoration:"none" }) }}>
                          <Video size={13} /> Join Zoom
                        </a>
                      )}
                      {showConfirm && (
                        <motion.button whileTap={{ scale:0.93 }}
                          disabled={busy[req.id]} onClick={() => confirm(req)}
                          style={{ ...pillStyle(false, false, { padding:"8px 16px", fontSize:13 }) }}>
                          {busy[req.id] ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                          Confirm Done
                        </motion.button>
                      )}
                    </div>
                  </div>
                  {req.meet_link && (
                    <div style={{ marginTop:14, background:"#DBEAFE", borderRadius:10,
                      padding:"10px 14px", fontSize:12, color:"#1e40af",
                      display:"flex", alignItems:"center", gap:8, wordBreak:"break-all" }}>
                      <Video size={13} style={{ flexShrink:0 }} />
                      <span style={{ flex:1 }}>{req.meet_link}</span>
                      <a href={req.meet_link} target="_blank" rel="noopener noreferrer" style={{ color:"#1e40af", flexShrink:0 }}>
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  PROFILE PAGE
// ═════════════════════════════════════════════════════════════════════════════
function ProfilePage({ profile }) {
  const toast = useContext(ToastCtx);
  const [selSkills, setSelSkills] = useState(
    (profile.skills||[]).map((s) => typeof s==="string" ? s : s.name)
  );
  const [saving, setSaving] = useState(false);

  const toggle = (s) => setSelSkills((p) => p.includes(s) ? p.filter((x) => x!==s) : [...p, s]);
  const save   = async () => {
    setSaving(true);
    try { await rtUpdate(`users/${profile.uid}`, { skills:selSkills }); toast("Profile saved!","success"); }
    catch(e) { toast(e.message,"error"); }
    setSaving(false);
  };

  const skillObjs = (profile.skills||[])
    .map((s) => typeof s==="string" ? { name:s, count:1 } : s).filter(Boolean);

  const stats = [
    { label:"Credits",   value:<AnimatedCredits value={profile.credits||0} size={26} />, icon:<Coins size={15} color={T.yellow} /> },
    { label:"Taught",    value:profile.sessionsAsMentor||0,  icon:<Award size={15} color={T.muted} /> },
    { label:"Learned",   value:profile.sessionsAsLearner||0, icon:<User  size={15} color={T.muted} /> },
    { label:"🔥 Streak", value:profile.streak||0,            icon:<Flame size={15} color="#f97316" /> },
  ];

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20 }}>
      <div style={{ ...cardStyle() }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:22 }}>
          <div style={{ width:60, height:60, borderRadius:16, overflow:"hidden",
            background:T.dark, flexShrink:0, display:"flex", alignItems:"center",
            justifyContent:"center", color:"#fff", fontSize:24, fontWeight:800 }}>
            {profile.photoURL
              ? <img src={profile.photoURL} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
              : (profile.displayName?.[0]||"?").toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight:800, fontSize:18 }}>{profile.displayName}</div>
            <div style={{ fontSize:13, color:T.muted }}>{profile.email}</div>
            {profile.mentorId && (
              <div style={{ marginTop:4, fontSize:12, color:T.mentor, fontWeight:600,
                background:T.mentorLt, borderRadius:99, padding:"2px 10px", display:"inline-block" }}>
                <Shield size={10} style={{ verticalAlign:"middle", marginRight:4 }} />
                Mentor ID: {profile.mentorId}
              </div>
            )}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:22 }}>
          {stats.map(({ label, value, icon }) => (
            <div key={label} style={{ background:T.alt, borderRadius:14, padding:"14px 12px", textAlign:"center" }}>
              <div style={{ display:"flex", justifyContent:"center", marginBottom:4 }}>{icon}</div>
              <div style={{ fontWeight:800, fontSize:22, lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:11, color:T.muted, marginTop:3 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...cardStyle() }}>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Skills</div>
        <div style={{ fontSize:13, color:T.muted, marginBottom:16 }}>Select skills you can teach or learn</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
          {ALL_SKILLS.map((s) => {
            const sel = selSkills.includes(s);
            return (
              <motion.button key={s} whileTap={{ scale:0.90 }} onClick={() => toggle(s)}
                style={{ ...pillStyle(sel, sel, { padding:"7px 14px", fontSize:13 }) }}>
                {sel && <Check size={11} />} {s}
              </motion.button>
            );
          })}
        </div>
        <motion.button whileTap={{ scale:0.96 }} onClick={save} disabled={saving}
          style={{ ...pillStyle(true, false, { width:"100%", justifyContent:"center", padding:"13px", fontSize:15 }) }}>
          {saving ? <Loader2 size={15} className="spin" /> : null} Save Profile
        </motion.button>
      </div>
      <div style={{ gridColumn:"1/-1" }}>
        <div style={{ ...cardStyle() }}>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Your Skill Graph</div>
          <div style={{ fontSize:13, color:T.muted, marginBottom:16 }}>Nodes grow with each completed session</div>
          <SkillGraph skills={skillObjs} />
        </div>
      </div>
    </div>
  );
}

// ── MENTOR ID GATE ────────────────────────────────────────────────────────────
function MentorIdGate({ profile, onEnterMentorDashboard, onContinueAsLearner }) {
  const [mentorId, setMentorId] = useState(profile?.mentorId || "");
  const [error,    setError]    = useState("");
  const [checking, setChecking] = useState(false);
  const toast = useContext(ToastCtx);

  const handleGenerate = async () => {
    setChecking(true); setError("");
    try {
      let newId, attempts = 0;
      do { newId = generateMentorId(); } while (await mentorIdExists(newId) && ++attempts < 10);
      if (attempts >= 10) { setError("Failed to generate unique ID."); setChecking(false); return; }
      if (!await storeMentorId(profile.uid, newId)) { setError("Failed to save ID."); setChecking(false); return; }
      setMentorId(newId);
      toast(`Your Mentor ID: ${newId} 🎉`, "success");
    } catch(e) { setError(e.message); }
    setChecking(false);
  };

  const handleEnter = async () => {
    if (!mentorId.trim()) { setError("Please enter your Mentor ID."); return; }
    setChecking(true); setError("");
    try {
      const isValid = await verifyMentorId(mentorId.trim().toUpperCase(), profile.uid);
      if (!isValid) { setError("Invalid Mentor ID or it doesn't belong to you."); setChecking(false); return; }
      await rtUpdate(`users/${profile.uid}`, {
        mentorId: mentorId.trim().toUpperCase(), role:"mentor",
        skills: Array.isArray(profile.skills) && profile.skills.length > 0 ? profile.skills : ["React","Python","SQL"],
      });
      toast("Mentor dashboard unlocked 🎉","success");
      onEnterMentorDashboard(mentorId.trim().toUpperCase());
    } catch(e) { setError(e.message); }
    setChecking(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg,
      display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <motion.div initial={{ opacity:0, y:24 }} animate={{ opacity:1, y:0 }}
        style={{ width:"100%", maxWidth:460 }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:10,
          background:T.dark, borderRadius:18, padding:"10px 20px", marginBottom:36 }}>
          <Zap size={20} color={T.yellow} fill={T.yellow} />
          <span style={{ color:"#fff", fontWeight:800, fontSize:20 }}>TT</span>
          <span style={{ color:"rgba(255,255,255,0.4)", fontSize:12 }}>Time Trade</span>
        </div>
        <div style={{ marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:44, height:44, borderRadius:12, background:T.mentorLt,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Shield size={20} color={T.mentor} />
            </div>
            <div>
              <div style={{ fontWeight:800, fontSize:22, letterSpacing:"-0.5px" }}>
                {profile?.mentorId ? "Welcome Back, Mentor!" : "Become a Mentor"}
              </div>
              <div style={{ fontSize:14, color:T.muted }}>Hey {profile.displayName?.split(" ")?.[0] || "there"} 👋</div>
            </div>
          </div>
        </div>
        <div style={{ ...cardStyle({ padding:24 }), marginBottom:14 }}>
          <label style={{ fontSize:13, fontWeight:600, color:T.muted, display:"block", marginBottom:10 }}>
            <Hash size={12} style={{ verticalAlign:"middle", marginRight:4 }} />Mentor ID
          </label>
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            <input value={mentorId}
              onChange={(e) => { setMentorId(e.target.value.toUpperCase()); setError(""); }}
              onKeyDown={(e) => e.key==="Enter" && mentorId && handleEnter()}
              placeholder="e.g. MENTOR001"
              disabled={!!profile?.mentorId}
              style={{ flex:1, padding:"12px 14px", borderRadius:12,
                border:`1.5px solid ${error?T.danger:T.border}`,
                background:profile?.mentorId ? T.alt : T.surface,
                fontSize:15, fontWeight:600, letterSpacing:"0.05em", outline:"none" }} />
            {!profile?.mentorId && (
              <motion.button whileTap={{ scale:0.95 }} onClick={handleGenerate} disabled={checking}
                style={{ ...pillStyle(false, true, { padding:"12px 18px", fontSize:13, opacity:checking?0.6:1 }) }}>
                {checking ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Generate
              </motion.button>
            )}
          </div>
          {error && (
            <div style={{ fontSize:12, color:T.danger, marginBottom:12, display:"flex", alignItems:"center", gap:6 }}>
              <AlertTriangle size={12} /> {error}
            </div>
          )}
          {mentorId && !error && (
            <div style={{ fontSize:12, color:T.success, marginBottom:12,
              background:"#D1FAE5", borderRadius:8, padding:"8px 12px",
              display:"flex", alignItems:"center", gap:6 }}>
              <CheckCircle size={12} /> {profile?.mentorId ? "Your existing Mentor ID" : "Save this ID securely!"}
            </div>
          )}
          <motion.button whileTap={{ scale:0.96 }} onClick={handleEnter}
            disabled={checking || !mentorId}
            style={{ ...pillStyle(true, false, { width:"100%", justifyContent:"center",
              padding:"13px", fontSize:15, opacity:(checking||!mentorId)?0.6:1 }) }}>
            {checking
              ? <><Loader2 size={15} className="spin" /> Verifying…</>
              : <><LayoutDashboard size={15} /> Enter Mentor Dashboard</>}
          </motion.button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
          <div style={{ flex:1, height:1, background:T.border }} />
          <span style={{ fontSize:12, color:T.muted }}>or</span>
          <div style={{ flex:1, height:1, background:T.border }} />
        </div>
        <motion.button whileTap={{ scale:0.96 }} onClick={onContinueAsLearner}
          style={{ ...pillStyle(false, false, { width:"100%", justifyContent:"center", padding:"13px", fontSize:15 }) }}>
          <User size={15} /> Continue as Learner
        </motion.button>
      </motion.div>
    </div>
  );
}

// ── WALLET + NAV + LOGIN ──────────────────────────────────────────────────────
function WalletWidget({ credits }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6,
      background:T.dark, borderRadius:999, padding:"8px 16px" }}>
      <span className="pulse"><Coins size={14} color={T.yellow} /></span>
      <AnimatedCredits value={credits||0} size={18} />
      <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:400 }}>credits</span>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg,
      display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <motion.div initial={{ opacity:0, y:32 }} animate={{ opacity:1, y:0 }}
        style={{ textAlign:"center", maxWidth:460 }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:10,
          background:T.dark, borderRadius:18, padding:"12px 24px", marginBottom:44 }}>
          <Zap size={22} color={T.yellow} fill={T.yellow} />
          <span style={{ color:"#fff", fontWeight:800, fontSize:24 }}>TT</span>
          <span style={{ color:"rgba(255,255,255,0.4)", fontSize:13 }}>Time Trade</span>
        </div>
        <h1 style={{ fontSize:42, fontWeight:800, letterSpacing:"-2px", color:T.text, margin:"0 0 14px", lineHeight:1.1 }}>
          Trade time.<br /><span style={{ color:T.yellow }}>Build skills.</span>
        </h1>
        <p style={{ fontSize:16, color:T.muted, marginBottom:44, lineHeight:1.65 }}>
          Teach 1 hour → earn 1 credit<br />Learn 1 hour → spend 1 credit
        </p>
        <motion.button whileTap={{ scale:0.95 }} whileHover={{ scale:1.02 }} onClick={onLogin}
          style={{ ...pillStyle(true, false, { fontSize:16, padding:"15px 36px", gap:12,
            boxShadow:"0 4px 24px rgba(0,0,0,0.15)" }) }}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="G" style={{ width:18, height:18 }} />
          Continue with Google
        </motion.button>
        <div style={{ marginTop:18, fontSize:12, color:T.muted }}>New users receive +2 free credits</div>
      </motion.div>
    </div>
  );
}

const NAV_ITEMS = [
  { id:"marketplace", label:"Marketplace", icon:Globe },
  { id:"requests",    label:"My Requests", icon:MessageSquare },
  { id:"profile",     label:"Profile",     icon:User },
];

function Navbar({ page, onNav, profile, onLogout, onMentorDash }) {
  return (
    <nav style={{ position:"sticky", top:0, zIndex:100,
      background:"rgba(245,243,238,0.88)", backdropFilter:"blur(14px)",
      borderBottom:`1px solid ${T.border}`,
      display:"flex", alignItems:"center", padding:"11px 24px", gap:12, flexWrap:"wrap" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:6 }}>
        <div style={{ background:T.dark, borderRadius:10, width:36, height:36,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Zap size={17} color={T.yellow} fill={T.yellow} />
        </div>
        <span style={{ fontWeight:800, fontSize:18, letterSpacing:"-0.5px" }}>TT</span>
      </div>
      <div style={{ display:"flex", gap:4, flex:1, flexWrap:"wrap" }}>
        {NAV_ITEMS.map(({ id, label, icon:Icon }) => (
          <motion.button key={id} whileTap={{ scale:0.93 }} onClick={() => onNav(id)}
            style={{ ...pillStyle(page===id, false, { padding:"8px 16px", fontSize:13 }) }}>
            <Icon size={13} />{label}
          </motion.button>
        ))}
        {profile?.mentorId && (
          <motion.button whileTap={{ scale:0.93 }} onClick={onMentorDash}
            style={{ ...pillStyle(false, false, { padding:"8px 16px", fontSize:13,
              background:T.mentorLt, color:T.mentor, boxShadow:`0 0 0 1.5px ${T.mentor}30` }) }}>
            <Shield size={13} /> Mentor Dashboard
          </motion.button>
        )}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <WalletWidget credits={profile?.credits} />
        <div style={{ width:36, height:36, borderRadius:10, overflow:"hidden",
          background:T.dark, display:"flex", alignItems:"center",
          justifyContent:"center", color:"#fff", fontWeight:700, fontSize:14 }}>
          {profile?.photoURL
            ? <img src={profile.photoURL} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            : (profile?.displayName?.[0]||"?").toUpperCase()}
        </div>
        <motion.button whileTap={{ scale:0.9 }} onClick={onLogout}
          style={{ ...pillStyle(false, false, { padding:"8px 12px" }) }}>
          <LogOut size={14} />
        </motion.button>
      </div>
    </nav>
  );
}

function FullLoader() {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center",
      justifyContent:"center", background:T.bg }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ background:T.dark, borderRadius:14, width:52, height:52,
          display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
          <Zap size={24} color={T.yellow} fill={T.yellow} className="pulse" />
        </div>
        <div style={{ fontSize:14, color:T.muted }}>Loading TT…</div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ██  APP SHELL
// ═════════════════════════════════════════════════════════════════════════════
function App() {
  const { user, profile, login, logout } = useContext(AuthCtx);
  const [mode,           setMode]           = useState(null);
  const [activeMentorId, setActiveMentorId] = useState(null);
  const [page,           setPage]           = useState("marketplace");

  useEffect(() => { if (!profile || mode !== null) return; setMode("gate"); }, [profile]);

  if (user === undefined)        return <FullLoader />;
  if (!user)                     return <LoginScreen onLogin={login} />;
  if (!profile || mode === null) return <FullLoader />;

  if (mode === "gate") {
    return (
      <>
        <GlobalStyles />
        <MentorIdGate
          profile={profile}
          onEnterMentorDashboard={(id) => { setActiveMentorId(id); setMode("mentor"); }}
          onContinueAsLearner={() => setMode("app")}
        />
      </>
    );
  }

  if (mode === "mentor") {
    return (
      <MentorDashboard
        profile={profile}
        mentorId={activeMentorId || profile.mentorId || "MENTOR"}
        onExit={() => setMode("app")}
      />
    );
  }

  const pageTitle = {
    marketplace: `Welcome, ${profile?.displayName?.split(" ")?.[0]||""} 👋`,
    requests:    "Your Requests",
    profile:     "Your Profile",
  }[page];
  const pageSub = {
    marketplace: "Browse mentor-created courses — request a Zoom session, credit deducted on approval",
    requests:    "Track your Zoom session requests",
    profile:     "Manage your skills and track progress",
  }[page];

  return (
    <div style={{ minHeight:"100vh", background:T.bg }}>
      <GlobalStyles />
      <Navbar page={page} onNav={setPage} profile={profile} onLogout={logout}
        onMentorDash={() => {
          if (profile.mentorId) { setActiveMentorId(profile.mentorId); setMode("mentor"); }
          else setMode("gate");
        }} />
      <main style={{ maxWidth:1120, margin:"0 auto", padding:"28px 20px 60px" }}>
        <AnimatePresence mode="wait">
          <motion.div key={page+"_head"}
            initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            style={{ marginBottom:26 }}>
            <h1 style={{ fontSize:30, fontWeight:800, letterSpacing:"-1px", marginBottom:4 }}>{pageTitle}</h1>
            <p style={{ color:T.muted, fontSize:15 }}>{pageSub}</p>
          </motion.div>
        </AnimatePresence>
        <AnimatePresence mode="wait">
          <motion.div key={page}
            initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, y:-10 }} transition={{ duration:0.22 }}>
            {page==="marketplace" && <Marketplace profile={profile} />}
            {page==="requests"    && <Requests    profile={profile} />}
            {page==="profile"     && <ProfilePage profile={profile} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export function Root() {
  return (
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  );
}
export default App;
export { ToastProvider, AuthProvider };
