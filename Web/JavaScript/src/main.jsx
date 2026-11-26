import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeftIcon,
  BarChart3Icon,
  BookMarkedIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  CreditCardIcon,
  CrownIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  FolderOpenIcon,
  HourglassIcon,
  ImageIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  LockIcon,
  LogInIcon,
  LogOutIcon,
  MailIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SunIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
  ZapIcon
} from "lucide-react";
import { apiRequest, clearSession, saveSession } from "./services/api.js";
import { ROLE_LABELS, roleBadge, statusBadge } from "./components/Badge.jsx";
import { SkeletonStats, SkeletonTable } from "./components/Spinner.jsx";
import { Notice } from "./components/Notice.jsx";
import { Modal } from "./components/Modal.jsx";
import { WeeklyPerformanceChart } from "./components/WeeklyPerformanceChart.jsx";
import { Overview } from "./pages/Overview.jsx";
import { fmtDate, getGreeting } from "./utils/helpers.js";
import { formatMathText, splitPassageAndQuestion } from "./utils/questionContentParser.js";
import "../../CSS/styles.css";

const STAFF_ROLES = ["admin", "teacher", "content_manager", "cash_manager"];

function ThemeToggleSwitch({ theme, onToggle, compact = false }) {
  const isLight = theme === "light";
  if (compact) {
    return (
      <button
        type="button"
        className="theme-toggle-compact"
        onClick={onToggle}
        role="switch"
        aria-checked={isLight}
        aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
        title={`Switch to ${isLight ? "dark" : "light"} mode`}
      >
        {isLight ? <SunIcon size={17} /> : <MoonIcon size={17} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={onToggle}
      role="switch"
      aria-checked={isLight}
      aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
      title={`Switch to ${isLight ? "dark" : "light"} mode`}
    >
      <span className="theme-toggle-label">
        <span className="theme-toggle-icon">
          {isLight ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </span>
        <span>{isLight ? "Light Mode" : "Dark Mode"}</span>
      </span>
      <span className={`theme-switch-track ${isLight ? "light" : ""}`} aria-hidden="true">
        <span className="theme-switch-thumb" />
      </span>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════════ */

function Auth({ onLogin, theme, onToggleTheme }) {
  const [step, setStep] = useState("login"); // "login" | "verify"
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [verifyEmail, setVerifyEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [error, setError] = useState("");
  const [studentNotice, setStudentNotice] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function submitLogin(e) {
    e.preventDefault();
    setError("");
    setInfoMsg("");
    setStudentNotice(false);
    setLoading(true);
    try {
      const result = await apiRequest("/auth/login", { method: "POST", body: JSON.stringify(loginForm) });
      
      // Strict rule: Students must use Mobile Application only!
      if (result.user.role === "student") {
        clearSession();
        setStudentNotice(true);
        setError("Student accounts must use the Burka Exam Mobile Application. Please open the Burka Exam app on your mobile phone to practice, study offline, take mock exams, and manage payments.");
        return;
      }

      saveSession(result);
      onLogin(result.user);
    } catch (err) {
      if (err.requiresVerification) {
        setVerifyEmail(err.email || loginForm.email);
        setStep("verify");
        setInfoMsg("Your account email is not verified yet. A 6-digit verification code was sent to your inbox.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitVerifyOTP(e) {
    e.preventDefault();
    setError("");
    setInfoMsg("");
    setLoading(true);
    try {
      const result = await apiRequest("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: verifyEmail, otp: otp.trim() })
      });

      if (result.user.role === "student") {
        clearSession();
        setStudentNotice(true);
        setStep("login");
        setError("Student accounts must use the Burka Exam Mobile Application.");
        return;
      }

      saveSession(result);
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resendOTP() {
    setError("");
    setInfoMsg("");
    setResending(true);
    try {
      const res = await apiRequest("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: verifyEmail })
      });
      setInfoMsg(res.message || "A new 6-digit code has been sent to your email inbox.");
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-logo" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/pwa-192x192.png" alt="Burka Exam Logo" className="logo-mark" style={{ objectFit: "contain", borderRadius: "50%", background: "transparent" }} />
            <div>
              <div className="auth-logo-text">Burka <span>Exam</span></div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Staff &amp; Management Portal</div>
            </div>
          </div>
          <ThemeToggleSwitch theme={theme} onToggle={onToggleTheme} compact />
        </div>

        <div style={{
          background: "rgba(99, 102, 241, 0.08)",
          border: "1px solid rgba(99, 102, 241, 0.25)",
          borderRadius: "var(--r-md)",
          padding: "12px 14px",
          marginBottom: 20,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--text-2)"
        }}>
          <strong style={{ color: "var(--primary-light)", display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <ShieldCheckIcon size={15} /> Staff Access Only
          </strong>
          This portal is reserved for <strong>Administrators</strong>, <strong>Content Managers</strong>, and <strong>Cash Managers</strong>.
        </div>

        {step === "login" ? (
          <>
            <h1>Staff Sign In</h1>
            <p className="subtitle">Sign in to manage curriculum, exams, materials, and finances.</p>

            {error && (
              <div className="auth-error" role="alert">
                {studentNotice ? <SmartphoneIcon size={18} className="auth-error-icon" /> : <CircleAlertIcon size={18} className="auth-error-icon" />}
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={submitLogin}>
              <div className="field">
                <label htmlFor="auth-email">Staff Email address</label>
                <div className="input-with-icon">
                <MailIcon size={16} className="input-icon" aria-hidden="true" />
                <input
                  id="auth-email"
                  autoComplete="email"
                  type="email"
                  required
                  placeholder="admin@ethioprep.com"
                  value={loginForm.email}
                  onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
                />
                </div>
              </div>
              <div className="field">
                <label htmlFor="auth-password">Password</label>
                <div className="input-with-icon">
                <LockIcon size={16} className="input-icon" aria-hidden="true" />
                <input
                  id="auth-password"
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                />
                <button
                  type="button"
                  className="input-action"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(v => !v)}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: 8 }}>
                {loading
                  ? <><Loader2Icon size={16} className="spin" /> Authenticating…</>
                  : <><LogInIcon size={16} /> Sign In to Management Portal</>}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>Verify Staff Email</h1>
            <p className="subtitle">Enter the 6-digit OTP code sent to <strong>{verifyEmail}</strong></p>

            {infoMsg && (
              <div style={{
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                color: "#10b981",
                borderRadius: "var(--r-md)",
                padding: "10px 14px",
                fontSize: 13,
                marginBottom: 16
              }}>
                {infoMsg}
              </div>
            )}

            {error && (
              <div className="auth-error" role="alert">
                <CircleAlertIcon size={18} className="auth-error-icon" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={submitVerifyOTP}>
              <div className="field">
                <label htmlFor="auth-otp">6-Digit Verification Code</label>
                <div className="input-with-icon">
                  <KeyRoundIcon size={16} className="input-icon" aria-hidden="true" />
                  <input
                    id="auth-otp"
                    type="text"
                    maxLength={6}
                    required
                    autoFocus
                    placeholder="123456"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                    style={{ letterSpacing: "4px", fontSize: 18, fontWeight: 700 }}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading || otp.length < 6}
                style={{ marginTop: 8 }}
              >
                {loading ? <><Loader2Icon size={16} className="spin" /> Verifying…</> : <><CheckIcon size={16} /> Verify &amp; Sign In</>}
              </button>
            </form>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => { setStep("login"); setError(""); setInfoMsg(""); }}
              >
                <ArrowLeftIcon size={14} /> Back to Sign In
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={resendOTP}
                disabled={resending}
              >
                {resending ? "Sending…" : "Resend Code"}
              </button>
            </div>
          </>
        )}

        <div style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid var(--border)",
          textAlign: "center",
          fontSize: 12,
          color: "var(--text-3)",
          lineHeight: 1.5
        }}>
          <SmartphoneIcon size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} /><strong>Are you an entrance examination student?</strong><br />
          Students must use the <strong>Burka Exam Mobile Application</strong> to practice questions, study offline, take mock exams, and rank on the leaderboard.
        </div>
      </div>
    </div>
  );
}

/* Overview component imported from ./pages/Overview.jsx */

/* ════════════════════════════════════════════════════════════════
   SUBJECTS PAGE
   ════════════════════════════════════════════════════════════════ */

const GRADE_LEVEL_OPTIONS = [
  { id: "", label: "All Grades" },
  { id: "grade-9", label: "Grade 9" },
  { id: "grade-10", label: "Grade 10" },
  { id: "grade-11", label: "Grade 11" },
  { id: "grade-12", label: "Grade 12" },
  { id: "college", label: "College" }
];

function formatGradeLabel(gradeLevel) {
  if (!gradeLevel) return "Grade 12";
  const found = GRADE_LEVEL_OPTIONS.find((g) => g.id === String(gradeLevel));
  if (found && found.id) return found.label;
  return String(gradeLevel).replace("grade-", "Grade ");
}

function getDisciplinePrefix(subj) {
  if (!subj) return "";
  const code = String(subj.code || "").toUpperCase();
  const name = String(subj.name || "").toLowerCase();
  if (code.includes("BIO") || name.includes("bio")) return "BIO";
  if (code.includes("CHEM") || name.includes("chem")) return "CHEM";
  if (code.includes("PHYS") || name.includes("phys")) return "PHYS";
  if (code.includes("MATH") || name.includes("math")) return "MATH";
  if (code.includes("ENG") || name.includes("eng")) return "ENG";
  if (code.includes("GEOG") || name.includes("geog")) return "GEOG";
  if (code.includes("HIST") || name.includes("hist")) return "HIST";
  if (code.includes("ECON") || name.includes("econ")) return "ECON";
  if (code.includes("SAT") || name.includes("sat") || code.includes("APTITUDE")) return "SAT";
  return code.split("_")[0] || code;
}

function SubjectsPage({ user }) {
  const [subjects, setSubjects] = useState([]);
  const [gradeFilter, setGradeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [showModal, setShowModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", gradeLevel: "grade-12", stream: "both" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest("/question-bank/subjects?includeInactive=true");
      setSubjects(res.subjects);
    } catch (e) { setMsg({ text: e.message, type: "error" }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredSubjects = useMemo(() => {
    if (!gradeFilter) return subjects;
    return subjects.filter((s) => (s.gradeLevel || "grade-12") === gradeFilter);
  }, [subjects, gradeFilter]);

  async function saveSubject(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(editingSubject ? `/question-bank/subjects/${editingSubject._id}` : "/question-bank/subjects", { method: editingSubject ? "PATCH" : "POST", body: JSON.stringify(form) });
      setMsg({ text: editingSubject ? "Subject updated successfully." : "Subject created successfully.", type: "success" });
      setShowModal(false);
      setEditingSubject(null);
      setForm({ name: "", code: "", description: "", gradeLevel: "grade-12", stream: "both" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
    finally { setSaving(false); }
  }

  function openEdit(subject) {
    setEditingSubject(subject);
    setForm({ name: subject.name, code: subject.code, description: subject.description || "", gradeLevel: subject.gradeLevel || "grade-12", stream: subject.stream || "both" });
    setShowModal(true);
  }

  async function reactivate(id) {
    try {
      await apiRequest(`/question-bank/subjects/${id}/reactivate`, { method: "PATCH" });
      setMsg({ text: "Subject reactivated. Reactivate its chapters and questions separately as needed.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  async function deactivate(id) {
    if (!confirm("Deactivate this subject? All its chapters and questions will also be deactivated.")) return;
    try {
      await apiRequest(`/question-bank/subjects/${id}/deactivate`, { method: "PATCH" });
      setMsg({ text: "Subject deactivated.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  const canManage = ["admin", "teacher", "content_manager"].includes(user.role);

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Content</span><span className="sep">›</span><span>Subjects</span></div>
        <div className="page-header-row">
          <div>
            <h1>Subjects &amp; Courses</h1>
            <p className="page-desc">Manage Grade 9–12 and college subject categories for the question bank.</p>
          </div>
          {canManage && <button className="btn btn-primary" onClick={() => { setEditingSubject(null); setForm({ name: "", code: "", description: "", gradeLevel: gradeFilter || "grade-12", stream: "both" }); setShowModal(true); }}><PlusIcon size={16} /> New Subject</button>}
        </div>
      </div>
      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />
        <div className="panel">
          <div className="panel-header" style={{ flexWrap: "wrap", gap: 12 }}>
            <span className="panel-title">Subjects ({filteredSubjects.length})</span>
            <div className="filter-bar">
              {GRADE_LEVEL_OPTIONS.map((g) => (
                <button
                  key={g.id || "all"}
                  type="button"
                  className={`btn btn-sm ${gradeFilter === g.id ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setGradeFilter(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          {loading ? <SkeletonTable /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Code</th><th>Grade Level</th><th>Stream</th><th>Description</th><th>Status</th>{canManage && <th></th>}</tr>
                </thead>
                <tbody>
                  {filteredSubjects.length === 0 ? (
                    <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><BookOpenIcon size={26} strokeWidth={1.75} /></div><h3>No subjects found</h3><p>Create a subject for this grade level to start building the question bank.</p></div></td></tr>
                  ) : filteredSubjects.map(s => (
                    <tr key={s._id}>
                      <td><strong>{s.name}</strong></td>
                      <td><span className="badge badge-blue">{s.code}</span></td>
                      <td><span className="badge badge-purple">{formatGradeLabel(s.gradeLevel)}</span></td>
                      <td><span className={`badge ${s.stream === "natural" ? "badge-green" : s.stream === "social" ? "badge-amber" : "badge-gray"}`}>{s.stream === "natural" ? "Natural" : s.stream === "social" ? "Social" : "Both"}</span></td>
                      <td className="td-muted">{s.description || "—"}</td>
                      <td>{statusBadge(s.isActive ? "active" : "archived")}</td>
                      {canManage && <td><div className="td-actions"><button className="btn btn-sm btn-secondary" onClick={() => openEdit(s)}>Edit</button>{s.isActive ? <button className="btn btn-sm btn-danger" onClick={() => deactivate(s._id)}>Deactivate</button> : <button className="btn btn-sm btn-success" onClick={() => reactivate(s._id)}>Reactivate</button>}</div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>{editingSubject ? "Edit Subject" : "New Subject"}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close"><XIcon size={18} /></button>
            </div>
            <form onSubmit={saveSubject}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-row">
                    <div className="field"><label>Subject Name *</label><input required placeholder="e.g. Biology" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div className="field"><label>Code *</label><input required placeholder="e.g. BIO_9" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="field">
                      <label>Grade Level *</label>
                      <select required value={form.gradeLevel} onChange={e => setForm({ ...form, gradeLevel: e.target.value })}>
                        <option value="grade-9">Grade 9</option>
                        <option value="grade-10">Grade 10</option>
                        <option value="grade-11">Grade 11</option>
                        <option value="grade-12">Grade 12</option>
                        <option value="college">College</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Stream *</label>
                      <select value={form.stream} onChange={e => setForm({ ...form, stream: e.target.value })}>
                        <option value="both">Both streams</option>
                        <option value="natural">Natural Science</option>
                        <option value="social">Social Science</option>
                      </select>
                    </div>
                  </div>
                  <div className="field"><label>Description</label><textarea placeholder="Brief description of this subject…" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editingSubject ? "Save Changes" : "Create Subject"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   QUESTIONS PAGE
   ════════════════════════════════════════════════════════════════ */

function QuestionsPage({ user }) {
  const [subjects, setSubjects] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filterGrade, setFilterGrade] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [showModal, setShowModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modalGrade, setModalGrade] = useState("");
  const [form, setForm] = useState({
    subjectId: "", chapterId: "", prompt: "", correctAnswer: "",
    explanation: "", imageUrl: "", optionImages: {}, explanationImageUrl: "", difficulty: "medium", questionType: "multiple_choice",
    options: ["", "", "", ""],
  });
  const [chapters, setChapters] = useState([]);
  const [allChaptersMap, setAllChaptersMap] = useState({});
  const canManage = ["admin", "teacher", "content_manager"].includes(user.role);

  useEffect(() => {
    apiRequest("/question-bank/subjects?includeInactive=true").then(r => {
      setSubjects(r.subjects);
      Promise.all(
        (r.subjects || []).map(s =>
          apiRequest(`/question-bank/subjects/${s._id}/chapters?includeInactive=true`)
            .then(cr => cr.chapters || [])
            .catch(() => [])
        )
      ).then(lists => {
        const map = {};
        for (const list of lists) {
          for (const ch of list) map[String(ch._id)] = ch;
        }
        setAllChaptersMap(map);
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.subjectId) {
      apiRequest(`/question-bank/subjects/${form.subjectId}/chapters?includeInactive=true`).then(r => setChapters(r.chapters)).catch(() => setChapters([]));
    } else { setChapters([]); }
  }, [form.subjectId]);

  const gradeFilteredSubjects = useMemo(() => {
    if (!filterGrade) return subjects;
    return subjects.filter(s => (s.gradeLevel || "grade-12") === filterGrade);
  }, [subjects, filterGrade]);

  const modalFilteredSubjects = useMemo(() => {
    if (!modalGrade) return subjects;
    return subjects.filter(s => (s.gradeLevel || "grade-12") === modalGrade);
  }, [subjects, modalGrade]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ includeInactive: "true", limit: "5000" });
      if (filterSubject) params.set("subjectId", filterSubject);
      else if (filterGrade) params.set("gradeLevel", filterGrade);
      const res = await apiRequest(`/question-bank/questions?${params.toString()}`);
      setQuestions(res.questions || []);
      setTotalCount(res.totalCount ?? (res.questions || []).length);
      setPage(1);
    } catch (e) { setMsg({ text: e.message, type: "error" }); }
    finally { setLoading(false); }
  }, [filterSubject, filterGrade]);

  useEffect(() => { load(); }, [load]);

  const filteredQuestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter((item) => {
      const subj = subjects.find((s) => String(s._id) === String(item.subjectId));
      const chap = item.chapterId ? allChaptersMap[String(item.chapterId)] : null;
      return (
        String(item.prompt || "").toLowerCase().includes(q) ||
        String(subj?.name || "").toLowerCase().includes(q) ||
        String(chap?.title || "").toLowerCase().includes(q)
      );
    });
  }, [questions, searchQuery, subjects, allChaptersMap]);

  const totalPages = Math.max(1, Math.ceil(filteredQuestions.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedQuestions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredQuestions.slice(start, start + pageSize);
  }, [filteredQuestions, currentPage, pageSize]);

  async function saveQuestion(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        options: form.questionType === "multiple_choice" ? form.options.filter(o => o.trim()) : [],
        chapterId: form.chapterId || undefined,
      };
      await apiRequest(editingQuestion ? `/question-bank/questions/${editingQuestion._id}` : "/question-bank/questions", { method: editingQuestion ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setMsg({ text: editingQuestion ? "Question updated." : "Question created.", type: "success" });
      setShowModal(false);
      setEditingQuestion(null);
      setForm({ subjectId: "", chapterId: "", prompt: "", correctAnswer: "", explanation: "", imageUrl: "", optionImages: {}, explanationImageUrl: "", difficulty: "medium", questionType: "multiple_choice", options: ["", "", "", ""] });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
    finally { setSaving(false); }
  }

  function openEdit(question) {
    setEditingQuestion(question);
    const subj = subjects.find(s => String(s._id) === String(question.subjectId));
    setModalGrade(subj?.gradeLevel || "");
    setForm({ subjectId: String(question.subjectId), chapterId: question.chapterId ? String(question.chapterId) : "", prompt: question.prompt, correctAnswer: question.correctAnswer || "", explanation: question.explanation || "", imageUrl: question.imageUrl || "", optionImages: question.optionImages || {}, explanationImageUrl: question.explanationImageUrl || "", difficulty: question.difficulty || "medium", questionType: question.questionType || "multiple_choice", options: [...(question.options || []), "", "", "", ""].slice(0, 4) });
    setShowModal(true);
  }

  function attachImage(file, applyImage) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 4 * 1024 * 1024) {
      setMsg({ text: "Choose an image smaller than 4 MB.", type: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => applyImage(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function reactivate(id) {
    try {
      await apiRequest(`/question-bank/questions/${id}/reactivate`, { method: "PATCH" });
      setMsg({ text: "Question reactivated.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  async function deactivate(id) {
    try {
      await apiRequest(`/question-bank/questions/${id}/deactivate`, { method: "PATCH" });
      setMsg({ text: "Question deactivated.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Content</span><span className="sep">›</span><span>Question Bank</span></div>
        <div className="page-header-row">
          <div><h1>Question Bank</h1><p className="page-desc">Create and manage all {totalCount.toLocaleString()} questions mapped to Grade 9–12 curriculum units.</p></div>
          {canManage && <button className="btn btn-primary" onClick={() => { setEditingQuestion(null); setModalGrade(filterGrade || ""); setForm({ subjectId: filterSubject || "", chapterId: "", prompt: "", correctAnswer: "", explanation: "", imageUrl: "", optionImages: {}, explanationImageUrl: "", difficulty: "medium", questionType: "multiple_choice", options: ["", "", "", ""] }); setShowModal(true); }}><PlusIcon size={16} /> New Question</button>}
        </div>
      </div>
      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />
        <div className="panel">
          <div className="panel-header" style={{ flexWrap: "wrap", gap: 12 }}>
            <span className="panel-title">
              Questions ({filteredQuestions.length.toLocaleString()}{totalCount > filteredQuestions.length ? ` of ${totalCount.toLocaleString()}` : ""})
            </span>
            <div className="panel-actions" style={{ flexWrap: "wrap", gap: 8 }}>
              <input
                type="search"
                placeholder="Search question stem, unit, or topic…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                style={{ width: 240 }}
              />
              <div className="filter-bar">
                {GRADE_LEVEL_OPTIONS.map((g) => (
                  <button
                    key={g.id || "all"}
                    type="button"
                    className={`btn btn-sm ${filterGrade === g.id ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => { setFilterGrade(g.id); setFilterSubject(""); setPage(1); }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <select value={filterSubject} onChange={e => { setFilterSubject(e.target.value); setPage(1); }} style={{ width: 220 }}>
                <option value="">All subjects</option>
                {gradeFilteredSubjects.map(s => <option key={s._id} value={s._id}>{s.name} ({formatGradeLabel(s.gradeLevel)} - {s.code})</option>)}
              </select>
            </div>
          </div>
          {loading ? <SkeletonTable /> : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>#</th><th>Question Stem</th><th>Grade</th><th>Subject</th><th>Unit / Chapter</th><th>Difficulty</th><th>Status</th>{canManage && <th></th>}</tr>
                  </thead>
                  <tbody>
                    {pagedQuestions.length === 0 ? (
                      <tr><td colSpan={8}><div className="empty-state"><div className="empty-icon"><CircleHelpIcon size={26} strokeWidth={1.75} /></div><h3>No questions found</h3><p>Add questions to start building exams.</p></div></td></tr>
                    ) : pagedQuestions.map((q, i) => {
                      const subj = subjects.find(s => String(s._id) === String(q.subjectId));
                      const chap = q.chapterId ? allChaptersMap[String(q.chapterId)] : null;
                      const { prompt: cleanStem, passage: cleanPassage } = splitPassageAndQuestion(q.prompt || "", q.passage || "");
                      const rowNum = (currentPage - 1) * pageSize + i + 1;
                      return (
                        <tr key={q._id}>
                          <td className="td-muted">{rowNum}</td>
                          <td style={{ maxWidth: 380 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {cleanPassage && <span className="badge badge-blue" style={{ flexShrink: 0 }}>Passage</span>}
                              {q.imageUrl && <span className="badge badge-purple" style={{ flexShrink: 0 }}>Diagram</span>}
                              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {formatMathText(cleanStem)}
                              </span>
                            </div>
                          </td>
                          <td><span className="badge badge-purple">{formatGradeLabel(subj?.gradeLevel)}</span></td>
                          <td><strong>{subj?.name || "—"}</strong> <span className="td-muted" style={{ fontSize: 11 }}>({subj?.code || ""})</span></td>
                          <td className="td-muted">{chap ? `Unit ${chap.order}: ${chap.title}` : "General"}</td>
                          <td>{statusBadge(q.difficulty)}</td>
                          <td>{statusBadge(q.isActive ? "active" : "archived")}</td>
                          {canManage && <td><div className="td-actions"><button className="btn btn-sm btn-secondary" onClick={() => openEdit(q)}>Edit</button>{q.isActive ? <button className="btn btn-sm btn-danger" onClick={() => deactivate(q._id)}>Deactivate</button> : <button className="btn btn-sm btn-success" onClick={() => reactivate(q._id)}>Reactivate</button>}</div></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
                  <span className="td-muted" style={{ fontSize: 13 }}>
                    Showing {((currentPage - 1) * pageSize + 1).toLocaleString()}–{Math.min(currentPage * pageSize, filteredQuestions.length).toLocaleString()} of {filteredQuestions.length.toLocaleString()} questions
                  </span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2>{editingQuestion ? "Edit Question" : "New Question"}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close"><XIcon size={18} /></button>
            </div>
            <form onSubmit={saveQuestion}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-row">
                    <div className="field">
                      <label>Grade Level Filter</label>
                      <select value={modalGrade} onChange={e => { setModalGrade(e.target.value); setForm({ ...form, subjectId: "", chapterId: "" }); }}>
                        {GRADE_LEVEL_OPTIONS.map(g => <option key={g.id || "all"} value={g.id}>{g.label}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Subject *</label>
                      <select required value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value, chapterId: "" })}>
                        <option value="">Select subject</option>
                        {modalFilteredSubjects.map(s => <option key={s._id} value={s._id}>{s.name} ({formatGradeLabel(s.gradeLevel)} - {s.code})</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>Curriculum Unit / Chapter</label>
                    <select value={form.chapterId} onChange={e => setForm({ ...form, chapterId: e.target.value })} disabled={!chapters.length}>
                      <option value="">No specific chapter (General)</option>
                      {chapters.map(c => <option key={c._id} value={c._id}>Unit {c.order}: {c.title}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="field">
                      <label>Question Type</label>
                      <select value={form.questionType} onChange={e => setForm({ ...form, questionType: e.target.value })}>
                        <option value="multiple_choice">Multiple Choice</option>
                        <option value="true_false">True / False</option>
                        <option value="short_answer">Short Answer</option>
                        <option value="fill_blank">Fill in the Blank</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Difficulty</label>
                      <select value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>Question Prompt *</label>
                    <textarea required rows={4} placeholder={'Example: What is \\frac{1}{2} + \\sqrt{9}?  You can use LaTeX-style text: \\frac{a}{b}, \\sqrt{x}, \\int_a^b, \\pi, x^2.'} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} />
                    <small className="td-muted">Use plain text or LaTeX-style math. The mobile app formats common roots, fractions, powers, integrals, Greek letters, and π.</small>
                  </div>
                  <div className="field">
                    <label>Graph or diagram (optional)</label>
                    <input type="file" accept="image/*" onChange={e => attachImage(e.target.files?.[0], imageUrl => setForm(current => ({ ...current, imageUrl })))} />
                    <small className="td-muted">Upload a graph, geometry figure, or table image (max 4 MB), or paste an image URL below.</small>
                    <input type="url" placeholder="https://example.com/graph.png" value={form.imageUrl.startsWith("data:") ? "" : form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} />
                    {form.imageUrl ? <img src={form.imageUrl} alt="Question diagram preview" style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain", marginTop: 8, borderRadius: 8 }} /> : null}
                    {form.imageUrl.startsWith("data:") ? <button type="button" className="btn btn-sm btn-secondary" onClick={() => setForm({ ...form, imageUrl: "" })}>Remove uploaded diagram</button> : null}
                  </div>

                  {form.questionType === "multiple_choice" && (
                    <>
                      <div style={{ display: "grid", gap: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>Answer Options (A–D) *</label>
                        {["A", "B", "C", "D"].map((key, idx) => (
                          <div key={key} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <span className="badge badge-gray" style={{ width: 28, justifyContent: "center" }}>{key}</span>
                            <div style={{ flex: 1 }}>
                              <input placeholder={`Option ${key}`} value={form.options[idx]} onChange={e => { const opts = [...form.options]; opts[idx] = e.target.value; setForm({ ...form, options: opts }); }} />
                              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                                <input
                                  type="file"
                                  accept="image/*"
                                  aria-label={`Upload diagram for option ${key}`}
                                  onChange={e => attachImage(e.target.files?.[0], imageUrl => setForm(current => ({ ...current, optionImages: { ...current.optionImages, [key]: imageUrl } })))}
                                />
                                <input
                                  type="url"
                                  placeholder={`Option ${key} image URL (optional)`}
                                  value={form.optionImages?.[key]?.startsWith("data:") ? "" : (form.optionImages?.[key] || "")}
                                  onChange={e => setForm(current => ({ ...current, optionImages: { ...current.optionImages, [key]: e.target.value } }))}
                                />
                              </div>
                              {form.optionImages?.[key] ? (
                                <div style={{ marginTop: 6 }}>
                                  <img src={form.optionImages[key]} alt={`Option ${key} diagram preview`} style={{ maxWidth: 180, maxHeight: 100, objectFit: "contain", borderRadius: 6 }} />
                                  <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={() => {
                                    const optionImages = { ...form.optionImages };
                                    delete optionImages[key];
                                    setForm({ ...form, optionImages });
                                  }}>Remove image</button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="field">
                        <label>Correct Answer Key * (A, B, C, or D)</label>
                        <select value={form.correctAnswer} onChange={e => setForm({ ...form, correctAnswer: e.target.value })} required>
                          <option value="">Select correct option</option>
                          {["A", "B", "C", "D"].map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {form.questionType !== "multiple_choice" && (
                    <div className="field"><label>Correct Answer *</label><input required placeholder="Type the correct answer…" value={form.correctAnswer} onChange={e => setForm({ ...form, correctAnswer: e.target.value })} /></div>
                  )}

                  <div className="field">
                    <label>Explanation (optional)</label>
                    <textarea rows={2} placeholder="Why is this the correct answer? You can use LaTeX-style notation such as \frac{a}{b}, \sqrt{x}, x^2, and \pi." value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} />
                    <label style={{ marginTop: 8 }}>Explanation diagram (optional)</label>
                    <input type="file" accept="image/*" onChange={e => attachImage(e.target.files?.[0], imageUrl => setForm(current => ({ ...current, explanationImageUrl: imageUrl })))} />
                    <small className="td-muted">Upload a worked graph, geometry figure, table, or diagram (max 4 MB), or paste an image URL.</small>
                    <input type="url" placeholder="https://example.com/explanation.png" value={form.explanationImageUrl.startsWith("data:") ? "" : form.explanationImageUrl} onChange={e => setForm({ ...form, explanationImageUrl: e.target.value })} />
                    {form.explanationImageUrl ? <img src={form.explanationImageUrl} alt="Explanation diagram preview" style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain", marginTop: 8, borderRadius: 8 }} /> : null}
                    {form.explanationImageUrl.startsWith("data:") ? <button type="button" className="btn btn-sm btn-secondary" onClick={() => setForm({ ...form, explanationImageUrl: "" })}>Remove uploaded diagram</button> : null}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editingQuestion ? "Save Changes" : "Create Question"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   EXAMS PAGE
   ════════════════════════════════════════════════════════════════ */

function ExamsPage({ user }) {
  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [yearFilter, setYearFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [questionGradeTab, setQuestionGradeTab] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [showModal, setShowModal] = useState(false);
  const [editingExam, setEditingExam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", subjectId: "", examYear: "", durationMinutes: 60,
    passingScore: 50, accessLevel: "free", questionIds: [],
  });
  const canManage = ["admin", "teacher", "content_manager"].includes(user.role);

  useEffect(() => {
    apiRequest("/question-bank/subjects").then(r => setSubjects(r.subjects)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.subjectId) {
      setQuestions([]);
      return;
    }
    const primarySubj = subjects.find(s => String(s._id) === String(form.subjectId));
    const disc = getDisciplinePrefix(primarySubj);
    const matchingSubjects = disc
      ? subjects.filter(s => getDisciplinePrefix(s) === disc)
      : (primarySubj ? [primarySubj] : []);

    if (matchingSubjects.length === 0) {
      apiRequest(`/question-bank/questions?subjectId=${form.subjectId}`).then(r => setQuestions(r.questions)).catch(() => setQuestions([]));
      return;
    }

    Promise.all(
      matchingSubjects.map(s =>
        apiRequest(`/question-bank/questions?subjectId=${s._id}`)
          .then(r => (r.questions || []).map(q => ({ ...q, _gradeLevel: s.gradeLevel || "grade-12", _subjectCode: s.code })))
          .catch(() => [])
      )
    ).then(lists => {
      setQuestions(lists.flat());
    });
  }, [form.subjectId, subjects]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest("/exams?includeAll=true");
      setExams(res.exams);
    } catch (e) { setMsg({ text: e.message, type: "error" }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredExams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return exams.filter(ex => {
      if (yearFilter && String(ex.examYear || "") !== String(yearFilter)) return false;
      if (!q) return true;
      const titleMatch = String(ex.title || "").toLowerCase().includes(q);
      const subjMatch = String(ex.subjectId?.name || "").toLowerCase().includes(q);
      const yearMatch = String(ex.examYear || "").toLowerCase().includes(q);
      return titleMatch || subjMatch || yearMatch;
    });
  }, [exams, yearFilter, searchQuery]);

  const visibleModalQuestions = useMemo(() => {
    if (!questionGradeTab) return questions;
    return questions.filter(q => (q._gradeLevel || "grade-12") === questionGradeTab);
  }, [questions, questionGradeTab]);

  async function saveExam(e) {
    e.preventDefault();
    if (form.questionIds.length === 0) { setMsg({ text: "Select at least one question.", type: "error" }); return; }
    setSaving(true);
    try {
      await apiRequest(editingExam ? `/exams/${editingExam._id}` : "/exams", { method: editingExam ? "PATCH" : "POST", body: JSON.stringify({ ...form, examYear: Number(form.examYear), durationMinutes: Number(form.durationMinutes), passingScore: Number(form.passingScore) }) });
      setMsg({ text: editingExam ? "Exam updated." : "Exam created as draft.", type: "success" });
      setShowModal(false);
      setEditingExam(null);
      setForm({ title: "", description: "", subjectId: "", examYear: "", durationMinutes: 60, passingScore: 50, accessLevel: "free", questionIds: [] });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
    finally { setSaving(false); }
  }

  function openEdit(exam) {
    setEditingExam(exam);
    setQuestionGradeTab("");
    const titleYear = exam.title.match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    setForm({ title: exam.title, description: exam.description || "", subjectId: String(exam.subjectId?._id || exam.subjectId), examYear: exam.examYear || titleYear, durationMinutes: exam.durationMinutes, passingScore: exam.passingScore, accessLevel: exam.accessLevel, questionIds: (exam.questionIds || []).map(String) });
    setShowModal(true);
  }

  async function publish(id) {
    try {
      await apiRequest(`/exams/${id}/publish`, { method: "PATCH" });
      setMsg({ text: "Exam published.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  async function archive(id) {
    try {
      await apiRequest(`/exams/${id}/archive`, { method: "PATCH" });
      setMsg({ text: "Exam archived.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  async function restore(id) {
    try {
      await apiRequest(`/exams/${id}/restore`, { method: "PATCH" });
      setMsg({ text: "Exam restored as a draft.", type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  function toggleQuestion(id) {
    setForm(f => ({
      ...f, questionIds: f.questionIds.includes(id) ? f.questionIds.filter(q => q !== id) : [...f.questionIds, id],
    }));
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Content</span><span className="sep">›</span><span>Exams</span></div>
        <div className="page-header-row">
          <div><h1>Exams</h1><p className="page-desc">Create, publish, and archive multi-grade entrance and practice exams.</p></div>
          {canManage && <button className="btn btn-primary" onClick={() => { setEditingExam(null); setQuestionGradeTab(""); setForm({ title: "", description: "", subjectId: "", examYear: "", durationMinutes: 60, passingScore: 50, accessLevel: "free", questionIds: [] }); setShowModal(true); }}><PlusIcon size={16} /> New Exam</button>}
        </div>
      </div>
      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />
        <div className="panel">
          <div className="panel-header" style={{ flexWrap: "wrap", gap: 12 }}>
            <span className="panel-title">All Exams ({filteredExams.length})</span>
            <div className="filter-bar" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ position: "relative", minWidth: 260 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search exams by title..."
                  aria-label="Search exams by title"
                  style={{ width: "100%", paddingRight: searchQuery ? 30 : 12 }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      fontWeight: 700,
                      fontSize: 15,
                      padding: "0 4px"
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {["", "2013", "2014", "2015", "2016", "2017", "2018"].map(yr => (
                <button
                  key={yr || "all"}
                  type="button"
                  className={`btn btn-sm ${yearFilter === yr ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setYearFilter(yr)}
                >
                  {yr ? `${yr} E.C.` : "All Years"}
                </button>
              ))}
            </div>
          </div>
          {loading ? <SkeletonTable /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Title</th><th>Subject</th><th>Exam Year</th><th>Duration</th><th>Questions</th><th>Pass Score</th><th>Access</th><th>Status</th>{canManage && <th>Actions</th>}</tr>
                </thead>
                <tbody>
                  {filteredExams.length === 0 ? (
                    <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon"><FileTextIcon size={26} strokeWidth={1.75} /></div><h3>No exams found</h3><p>{searchQuery.trim() ? `No exams matched "${searchQuery.trim()}".` : "Create your first exam to make it available to students."}</p></div></td></tr>
                  ) : filteredExams.map(ex => (
                    <tr key={ex._id}>
                      <td><strong>{ex.title}</strong><div className="td-muted" style={{ fontSize: 12, marginTop: 2 }}>{ex.description || ""}</div></td>
                      <td className="td-muted">{ex.subjectId?.name || "—"}</td>
                      <td><span className="badge badge-blue">{ex.examYear || "Legacy"}</span></td>
                      <td className="td-muted">{ex.durationMinutes} min</td>
                      <td className="td-muted">{ex.questionIds?.length || 0}</td>
                      <td className="td-muted">{ex.passingScore}%</td>
                      <td><span className={`badge ${ex.accessLevel === "premium" ? "badge-purple" : "badge-green"}`}>{ex.accessLevel}</span></td>
                      <td>{statusBadge(ex.status)}</td>
                      {canManage && (
                        <td><div className="td-actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(ex)}>Edit</button>
                          {ex.status === "draft" && <button className="btn btn-sm btn-success" onClick={() => publish(ex._id)}>Publish</button>}
                          {ex.status === "published" && <button className="btn btn-sm btn-amber" onClick={() => archive(ex._id)}>Archive</button>}
                          {ex.status === "archived" && <button className="btn btn-sm btn-success" onClick={() => restore(ex._id)}>Restore</button>}
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2>{editingExam ? "Edit Exam" : "New Exam"}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close"><XIcon size={18} /></button>
            </div>
            <form onSubmit={saveExam}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="field"><label>Exam Title *</label><input required placeholder="e.g. Grade 12 Mathematics Mock Exam" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                  <div className="field"><label>Description</label><textarea placeholder="Brief overview of this exam…" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                  <div className="form-row">
                    <div className="field">
                      <label>Subject *</label>
                      <select required value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value, questionIds: [] })}>
                        <option value="">Select subject</option>
                        {subjects.map(s => <option key={s._id} value={s._id}>{s.name} ({formatGradeLabel(s.gradeLevel)} - {s.code})</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Access Level</label>
                      <select value={form.accessLevel} onChange={e => setForm({ ...form, accessLevel: e.target.value })}>
                        <option value="free">Free</option>
                        <option value="premium">Premium</option>
                      </select>
                    </div>
                    <div className="field"><label>Exam Year *</label><input type="number" min="1900" max="3000" required placeholder="e.g. 2017" value={form.examYear} onChange={e => setForm({ ...form, examYear: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="field"><label>Duration (minutes) *</label><input type="number" min="5" required value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} /></div>
                    <div className="field"><label>Passing Score (%) *</label><input type="number" min="1" max="100" required value={form.passingScore} onChange={e => setForm({ ...form, passingScore: e.target.value })} /></div>
                  </div>

                  {form.subjectId && (
                    <div className="field">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                        <label style={{ margin: 0 }}>Select Questions ({form.questionIds.length} selected) *</label>
                        <div className="filter-bar">
                          {GRADE_LEVEL_OPTIONS.filter(g => g.id !== "college").map(g => {
                            const countInGrade = g.id
                              ? questions.filter(q => (q._gradeLevel || "grade-12") === g.id && form.questionIds.includes(String(q._id))).length
                              : form.questionIds.length;
                            return (
                              <button
                                key={g.id || "all"}
                                type="button"
                                className={`btn btn-sm ${questionGradeTab === g.id ? "btn-primary" : "btn-secondary"}`}
                                onClick={() => setQuestionGradeTab(g.id)}
                              >
                                {g.label} ({countInGrade})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ maxHeight: 240, overflowY: "auto", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: 8, display: "grid", gap: 4 }}>
                        {visibleModalQuestions.length === 0
                          ? <p style={{ color: "var(--text-3)", padding: 8, textAlign: "center" }}>No questions for this grade/subject yet.</p>
                          : visibleModalQuestions.map((q, i) => (
                            <label key={q._id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: form.questionIds.includes(String(q._id)) ? "var(--green-bg)" : "transparent" }}>
                              <input type="checkbox" checked={form.questionIds.includes(String(q._id))} onChange={() => toggleQuestion(String(q._id))} style={{ width: "auto", marginTop: 2 }} />
                              <span style={{ fontSize: 13 }}>
                                <span className="badge badge-purple" style={{ marginRight: 6 }}>{formatGradeLabel(q._gradeLevel)}</span>
                                {i + 1}. {q.prompt}
                              </span>
                            </label>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editingExam ? "Save Changes" : "Create Exam"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   PAYMENTS PAGE
   ════════════════════════════════════════════════════════════════ */

function PaymentsPage({ user }) {
  const [payments, setPayments] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [verifying, setVerifying] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const canVerify = ["admin", "cash_manager"].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = statusFilter !== "all" ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const [pRes, dRes] = await Promise.all([
        apiRequest(`/payments${q}`),
        canVerify ? apiRequest("/payments/dashboard") : Promise.resolve(null)
      ]);
      setPayments(pRes.payments || []);
      setDashboard(dRes);
    } catch (e) { setMsg({ text: e.message, type: "error" }); }
    finally { setLoading(false); }
  }, [statusFilter, canVerify]);

  useEffect(() => { load(); }, [load]);

  async function verify(id, status, reviewNote) {
    setVerifying(id + status);
    try {
      await apiRequest(`/payments/${id}/verify`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote })
      });
      setMsg({ text: `Payment ${status}.`, type: "success" });
      load();
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
    finally { setVerifying(null); }
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Finance</span><span className="sep">›</span><span>Payments</span></div>
        <div className="page-header-row">
          <div>
            <h1>Payment Management</h1>
            <p className="page-desc">Review, verify, and reject student subscription payments.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {["all", "pending", "verified", "rejected"].map(st => (
              <button
                key={st}
                type="button"
                className={`btn btn-sm ${statusFilter === st ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStatusFilter(st)}
              >
                {st === "all" ? "All" : st === "pending" ? `Pending${dashboard?.pendingPayments ? ` (${dashboard.pendingPayments})` : ""}` : st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
            <button type="button" className="btn btn-sm btn-secondary" onClick={load} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCwIcon size={14} /> Refresh
            </button>
          </div>
        </div>
      </div>
      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />

        {dashboard && (
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 24 }}>
            {[
              { label: "Pending Review", value: dashboard.pendingPayments || 0, icon: <HourglassIcon size={18} strokeWidth={2} />, cls: "icon-amber" },
              { label: "Approved Payments", value: dashboard.approvedPayments ?? dashboard.verifiedPayments ?? 0, icon: <CircleCheckIcon size={18} strokeWidth={2} />, cls: "icon-green" },
              { label: "Rejected Payments", value: dashboard.rejectedPayments || 0, icon: <CircleXIcon size={18} strokeWidth={2} />, cls: "icon-red" },
              { label: "Today's Revenue", value: `${dashboard.todayRevenue?.toLocaleString() || 0} ETB`, icon: <CalendarDaysIcon size={18} strokeWidth={2} />, cls: "icon-blue" },
              { label: "Monthly Revenue", value: `${dashboard.monthlyRevenue?.toLocaleString() || 0} ETB`, icon: <TrendingUpIcon size={18} strokeWidth={2} />, cls: "icon-purple" },
              { label: "Total Revenue", value: `${(dashboard.totalRevenue ?? dashboard.totalVerifiedAmount)?.toLocaleString() || 0} ETB`, icon: <WalletIcon size={18} strokeWidth={2} />, cls: "icon-green" },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-header"><span className="stat-label">{s.label}</span><div className={`stat-icon ${s.cls}`}>{s.icon}</div></div>
                <div className="stat-value">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="panel">
          <div className="panel-header"><span className="panel-title">{statusFilter === "all" ? "All Payments" : `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Payments`} ({payments.length})</span></div>
          {loading ? <SkeletonTable /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Amount</th>
                    <th>Provider</th>
                    <th>Transaction Ref / Evidence</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    {canVerify && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><CreditCardIcon size={26} strokeWidth={1.75} /></div><h3>No payments yet</h3></div></td></tr>
                  ) : payments.map(p => (
                    <tr key={p._id}>
                      <td>
                        <strong>{p.fullName || p.userId?.displayName || "Student"}</strong>
                        {p.userId?.email && <div className="td-muted" style={{ fontSize: 12 }}>{p.userId.email}</div>}
                      </td>
                      <td><strong>{p.amount?.toLocaleString()} {p.currency || "ETB"}</strong></td>
                      <td><span className="badge badge-info">{p.provider?.toUpperCase()}</span></td>
                      <td className="td-muted" style={{ fontSize: 12 }}>
                        {p.transactionReference && (
                          <div style={{ fontFamily: "monospace", fontWeight: "bold" }}>
                            {p.transactionReference}
                          </div>
                        )}
                        {p.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewImage(p.receiptUrl)}
                            style={{
                              background: "rgba(0, 200, 150, 0.12)",
                              border: "1px solid rgba(0, 200, 150, 0.35)",
                              color: "#00c896",
                              borderRadius: 4,
                              padding: "2px 8px",
                              fontSize: 11,
                              fontWeight: "600",
                              cursor: "pointer",
                              display: "inline-block",
                              marginTop: 4
                            }}
                          >
                            <ImageIcon size={14} /> View Receipt
                          </button>
                        )}
                        {!p.transactionReference && !p.receiptUrl && "—"}
                      </td>
                      <td>{statusBadge(p.status)}</td>
                      <td className="td-muted">{fmtDate(p.submittedAt || p.createdAt)}</td>
                      {canVerify && (
                        <td><div className="td-actions">
                          {p.status === "pending" && (
                            <>
                              <button
                                className="btn btn-sm btn-success"
                                disabled={verifying === p._id + "verified"}
                                onClick={() => verify(p._id, "verified")}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                disabled={verifying === p._id + "rejected"}
                                onClick={() => {
                                  const reason = prompt("Select or enter rejection reason:\n1: Invalid Transaction Number\n2: Incorrect Amount\n3: Duplicate Payment\n4: Unclear Receipt", "Invalid Transaction Number");
                                  if (reason !== null) {
                                    verify(p._id, "rejected", reason);
                                  }
                                }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {p.status === "verified" && (
                            <button className="btn btn-sm btn-amber" disabled={verifying === p._id + "refunded"} onClick={() => verify(p._id, "refunded")}>Refund</button>
                          )}
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 20,
              maxWidth: "90vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 12, alignItems: "center" }}>
              <strong style={{ fontSize: 15, color: "var(--text)" }}><ReceiptIcon size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />Receipt Evidence Screenshot</strong>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setPreviewImage(null)}
                style={{ fontSize: 13, cursor: "pointer" }}
              >
                <XIcon size={14} /> Close
              </button>
            </div>
            <img
              src={previewImage}
              alt="Receipt Evidence"
              style={{
                maxWidth: "100%",
                maxHeight: "75vh",
                borderRadius: 8,
                objectFit: "contain",
                border: "1px solid var(--border)"
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   STAFF NOTES PAGE  (Content Managers & Admins)
   ════════════════════════════════════════════════════════════════ */

function StaffNotesPage({ user }) {
  const [notes, setNotes] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [showModal, setShowModal] = useState(false);
  const [viewingNote, setViewingNote] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    subjectId: "",
    chapterId: "",
    fileType: "pdf",
    fileUrl: "",
    body: "",
    isPublic: true,
    isPremium: false
  });

  const canManage = ["admin", "teacher", "content_manager"].includes(user.role);

  useEffect(() => {
    apiRequest("/question-bank/subjects").then(r => setSubjects(r.subjects || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.subjectId) {
      apiRequest(`/question-bank/subjects/${form.subjectId}/chapters`)
        .then(r => setChapters(r.chapters || []))
        .catch(() => setChapters([]));
    } else {
      setChapters([]);
    }
  }, [form.subjectId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedSubject ? `?subjectId=${selectedSubject}` : "";
      const res = await apiRequest(`/notes${q}`);
      setNotes(res.notes || []);
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    } finally {
      setLoading(false);
    }
  }, [selectedSubject]);

  useEffect(() => { load(); }, [load]);

  async function createNote(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/notes", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setMsg({ text: "Educational study material created successfully.", type: "success" });
      closeModal();
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(id) {
    if (!confirm("Are you sure you want to remove this study note?")) return;
    try {
      await apiRequest(`/notes/${id}`, { method: "DELETE" });
      setMsg({ text: "Note deleted.", type: "success" });
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
  }

 
  function openEditModal(note) {
    setEditingNote(note);
    setForm({
      title: note.title || "",
      subjectId: note.subjectId?._id || note.subjectId || "",
      chapterId: note.chapterId?._id || note.chapterId || "",
      fileType: note.fileType || "pdf",
      fileUrl: note.fileUrl || "",
      body: note.body || "",
      isPublic: note.isPublic !== false,
      isPremium: note.isPremium === true
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingNote(null);
    setForm({ title: "", subjectId: "", chapterId: "", fileType: "pdf", fileUrl: "", body: "", isPublic: true, isPremium: false });
  }

  async function updateNote(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/notes/${editingNote._id}`, {
        method: "PUT",
        body: JSON.stringify(form)
      });
      setMsg({ text: "Study note updated successfully.", type: "success" });
      closeModal();
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    } finally {
      setSaving(false);
    }
  }
 return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Content</span><span className="sep">›</span><span>Study Notes</span></div>
        <div className="page-header-row">
          <div>
            <h1>Educational Study Notes</h1>
            <p className="page-desc">Teachers and content managers can publish PDF guides, slides, handouts, and concept summaries for students.</p>
          </div>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <PlusIcon size={16} /> Upload / Create Note
            </button>
          )}
        </div>
      </div>

      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />

        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><span className="panel-title">Filter by Subject</span></div>
          <div className="panel-body">
            <select value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} style={{ maxWidth: 320 }}>
              <option value="">All Subjects</option>
              {subjects.map(s => <option key={s._id} value={s._id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Study Materials & Notes ({notes.length})</span>
          </div>
          {loading ? <SkeletonTable /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Subject</th>
                    <th>Topic / Chapter</th>
                    <th>Format</th>
                    <th>Uploaded By</th>
                    <th>Access</th>
                    <th>File / Link</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {notes.length === 0 ? (
                    <tr><td colSpan={8}><div className="empty-state">No notes uploaded yet.</div></td></tr>
                  ) : notes.map(n => (
                    <tr key={n._id}>
                      <td>
                        <strong>{n.title}</strong>
                        {n.body && <div className="td-muted" style={{ fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</div>}
                      </td>
                      <td><span className="badge badge-info">{n.subjectId?.name || "—"}</span></td>
                      <td className="td-muted">{n.chapterId?.title || "—"}</td>
                      <td>
                        <span className={`badge ${n.fileType === "pdf" ? "badge-red" : n.fileType?.includes("ppt") ? "badge-amber" : "badge-blue"}`}>
                          {(n.fileType || "pdf").toUpperCase()}
                        </span>
                      </td>
                      <td><span className="td-muted">{n.uploadedBy?.displayName || "Teacher / Staff"}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <span className={`badge ${n.isPublic ? "badge-green" : "badge-gray"}`}>
                            {n.isPublic ? "Public" : "Private"}
                          </span>
                          <span className={`badge ${n.isPremium ? "badge-amber" : "badge-gray"}`}>
                            {n.isPremium ? "Premium" : "Free"}
                          </span>
                        </div>
                      </td>
                      <td>
                        {n.fileUrl ? (
                          <a href={n.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary-light)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <DownloadIcon size={13} /> View Link
                          </a>
                        ) : (
                          <span className="td-muted">In-App Text</span>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-sm btn-secondary" onClick={() => setViewingNote(n)}>
                              Read
                            </button>
                            <button className="btn btn-sm btn-primary" onClick={() => openEditModal(n)}>
                              Edit
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => deleteNote(n._id)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal show={showModal} onClose={closeModal} title={editingNote ? "Edit Study Note" : "Upload / Create Study Note"}>
        <form onSubmit={editingNote ? updateNote : createNote}>
          <div className="field">
            <label>Title *</label>
            <input
              required
              placeholder="e.g. Grade 12 Physics: Electromagnetism Summary"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="form-row">
            <div className="field">
              <label>Subject *</label>
              <select required value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })}>
                <option value="">— Select Subject —</option>
                {subjects.map(s => <option key={s._id} value={s._id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div className="field">
              <label>Topic / Chapter</label>
              <select value={form.chapterId} onChange={e => setForm({ ...form, chapterId: e.target.value })}>
                <option value="">— General / Entire Subject —</option>
                {chapters.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Format</label>
              <select value={form.fileType} onChange={e => setForm({ ...form, fileType: e.target.value })}>
                <option value="pdf">PDF Document (.pdf)</option>
                <option value="ppt">PowerPoint Presentation (.ppt, .pptx)</option>
                <option value="docx">Word Document (.doc, .docx)</option>
                <option value="text">Text Handout / Syllabus</option>
              </select>
            </div>
            <div className="field">
              <label>Access Tier</label>
              <select value={form.isPremium ? "premium" : "free"} onChange={e => setForm({ ...form, isPremium: e.target.value === "premium" })}>
                <option value="free">Free for All Students</option>
                <option value="premium">Premium Students Only</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>File URL / Cloud Link (Optional)</label>
            <input
              placeholder="https://drive.google.com/... or https://res.cloudinary.com/..."
              value={form.fileUrl}
              onChange={e => setForm({ ...form, fileUrl: e.target.value })}
            />
            <span style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
              Paste a link to Google Drive, Dropbox, OneDrive, Cloudinary, or any shared file.
            </span>
          </div>

          <div className="field">
            <label>Overview, Key Formulas &amp; Study Text *</label>
            <textarea
              rows={6}
              placeholder="Write formulas, definitions, rules, and core concepts. Students can read this directly in the mobile app offline without downloading any external app..."
              value={form.body}
              onChange={e => setForm({ ...form, body: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (editingNote ? "Updating…" : "Publishing…") : (editingNote ? "Update Study Note" : "Publish Study Note")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal show={Boolean(viewingNote)} onClose={() => setViewingNote(null)} title={viewingNote?.title || "Study Note"}>
        {viewingNote && (
          <div style={{ lineHeight: 1.6 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <span className="badge badge-info">{viewingNote.subjectId?.name || "General Subject"}</span>
              {viewingNote.chapterId?.title && <span className="badge badge-gray">{viewingNote.chapterId.title}</span>}
              <span className="badge badge-blue">{(viewingNote.fileType || "pdf").toUpperCase()}</span>
              <span className={`badge ${viewingNote.isPremium ? "badge-amber" : "badge-green"}`}>{viewingNote.isPremium ? "Premium" : "Free"}</span>
              <span className="badge badge-gray">By {viewingNote.uploadedBy?.displayName || "Teacher"}</span>
            </div>

            {viewingNote.fileUrl && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <strong>Attached Document: </strong>
                <a href={viewingNote.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary-light)", textDecoration: "underline", marginLeft: 6 }}>
                  Open / Download {viewingNote.fileType?.toUpperCase()}
                </a>
              </div>
            )}

            <div className="field">
              <label>Study Material Content:</label>
              <div style={{
                background: "var(--bg-card)",
                padding: 14,
                borderRadius: "var(--r-md)",
                border: "1px solid var(--border)",
                whiteSpace: "pre-wrap",
                fontSize: 13,
                maxHeight: 350,
                overflowY: "auto"
              }}>
                {viewingNote.body || "No text summary provided. Please use the attached link above."}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setViewingNote(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   USERS PAGE  (Admin Role Management)
   ════════════════════════════════════════════════════════════════ */

function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStaff, setNewStaff] = useState({
    displayName: "",
    email: "",
    password: "",
    role: "content_manager",
    phoneNumber: ""
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await apiRequest(`/users${q}`);
      setUsers(res.users || []);
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function updateRole(userId, newRole) {
    try {
      await apiRequest(`/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole })
      });
      setMsg({ text: "User role updated successfully.", type: "success" });
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
  }

  async function toggleStatus(userId, currentStatus) {
    const nextStatus = currentStatus === "active" ? "suspended" : "active";
    try {
      await apiRequest(`/users/${userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, emailVerified: nextStatus === "active" ? true : undefined })
      });
      setMsg({ text: `User marked as ${nextStatus}.`, type: "success" });
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
  }

  async function verifyEmailManual(userId) {
    try {
      await apiRequest(`/users/${userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ emailVerified: true, status: "active" })
      });
      setMsg({ text: "User email verified and account activated successfully.", type: "success" });
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    }
  }

  async function handleCreateStaff(e) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiRequest("/users", {
        method: "POST",
        body: JSON.stringify(newStaff)
      });
      setMsg({ text: `Staff account created for ${newStaff.email} with verified access.`, type: "success" });
      setShowAddModal(false);
      setNewStaff({ displayName: "", email: "", password: "", role: "content_manager", phoneNumber: "" });
      load();
    } catch (err) {
      setMsg({ text: err.message, type: "error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Admin</span><span className="sep">›</span><span>Users</span></div>
        <div className="page-header-row">
          <div>
            <h1>User Account Management</h1>
            <p className="page-desc">View registered students and staff, verify emails, reassign roles, and manage access privileges.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
            {["all", "pending", "active", "suspended"].map(st => (
              <button
                key={st}
                type="button"
                className={`btn btn-sm ${statusFilter === st ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStatusFilter(st)}
              >
                {st === "all" ? "All" : st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
            <button type="button" className="btn btn-sm btn-secondary" onClick={load} disabled={loading} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCwIcon size={14} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PlusIcon size={16} /> Add Staff Member
            </button>
          </div>
        </div>
      </div>

      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />

        <div className="panel">
          <div className="panel-header"><span className="panel-title">Registered Accounts ({users.length})</span></div>
          {loading ? <SkeletonTable /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Display Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Email Verified</th>
                    <th>Stream</th>
                    <th>Subscription</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={8}><div className="empty-state">No users matching search.</div></td></tr>
                  ) : users.map(u => (
                    <tr key={u._id}>
                      <td><strong>{u.displayName}</strong></td>
                      <td className="td-muted">{u.email}</td>
                      <td>
                        <select
                          value={u.role}
                          onChange={e => updateRole(u._id, e.target.value)}
                          style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6 }}
                        >
                          <option value="student">Student</option>
                          <option value="teacher">Teacher</option>
                          <option value="content_manager">Content Manager</option>
                          <option value="cash_manager">Cash Manager</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </td>
                      <td>
                        {u.emailVerified ? (
                          <span className="badge badge-green" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <CheckIcon size={12} /> Verified
                          </span>
                        ) : (
                          <span className="badge badge-amber" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <CircleAlertIcon size={12} /> Unverified
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-gray">{u.stream ? u.stream.toUpperCase() : "NATURAL"}</span>
                      </td>
                      <td>
                        <span className={`badge ${u.isPremium ? "badge-green" : "badge-gray"}`}>
                          {u.isPremium ? <><CrownIcon size={12} /> Premium</> : "Free"}
                        </span>
                      </td>
                      <td>{statusBadge(u.status)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          {!u.emailVerified && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => verifyEmailManual(u._id)}
                              title="Manually verify email and activate user"
                            >
                              Verify
                            </button>
                          )}
                          <button
                            className={`btn btn-sm ${u.status === "active" ? "btn-secondary" : "btn-success"}`}
                            onClick={() => toggleStatus(u._id, u.status)}
                          >
                            {u.status === "active" ? "Suspend" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal show={showAddModal} onClose={() => setShowAddModal(false)} title="Register New Staff Member">
        <form onSubmit={handleCreateStaff}>
          <div className="field">
            <label>Full Display Name</label>
            <input
              required
              placeholder="e.g. Abebe Balcha"
              value={newStaff.displayName}
              onChange={e => setNewStaff({ ...newStaff, displayName: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email Address</label>
            <input
              type="email"
              required
              placeholder="e.g. staff@ethioprep.com"
              value={newStaff.email}
              onChange={e => setNewStaff({ ...newStaff, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Temporary Password (min 8 characters)</label>
            <input
              type="password"
              required
              minLength={8}
              placeholder="••••••••"
              value={newStaff.password}
              onChange={e => setNewStaff({ ...newStaff, password: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Role</label>
            <select
              value={newStaff.role}
              onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
            >
              <option value="content_manager">Content Manager (Curriculum &amp; Exams)</option>
              <option value="cash_manager">Cash Manager (Payment Verification)</option>
              <option value="admin">Administrator (Full Access)</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>
          <div className="field">
            <label>Phone Number (optional)</label>
            <input
              placeholder="+251 9..."
              value={newStaff.phoneNumber}
              onChange={e => setNewStaff({ ...newStaff, phoneNumber: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create & Activate Staff"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   ADMIN ANALYTICS PAGE
   ════════════════════════════════════════════════════════════════ */

function AnalyticsPage() {
  const [adminStats, setAdminStats] = useState(null);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiRequest("/analytics/admin").catch(() => null),
      apiRequest("/analytics/summary").catch(() => ({ summary: [] }))
    ]).then(([adm, sum]) => {
      setAdminStats(adm);
      setSummary(sum?.summary || []);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Admin</span><span className="sep">›</span><span>Analytics</span></div>
        <h1>Platform System Analytics</h1>
        <p className="page-desc">Comprehensive system KPIs, user growth, revenue metrics, and activity logs.</p>
      </div>

      <div className="content-body">
        {loading ? <SkeletonStats count={6} /> : (
          <>
            {adminStats && (
              <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
                {[
                  { label: "Total Registered Users", value: adminStats.totalUsers, icon: <UsersIcon size={18} strokeWidth={2} />, cls: "icon-blue" },
                  { label: "Active Platform Users", value: adminStats.activeUsers, icon: <ZapIcon size={18} strokeWidth={2} />, cls: "icon-green" },
                  { label: "Premium Paid Users", value: adminStats.premiumUsers, icon: <CrownIcon size={18} strokeWidth={2} />, cls: "icon-amber" },
                  { label: "Questions in Bank", value: adminStats.totalQuestions, icon: <CircleHelpIcon size={18} strokeWidth={2} />, cls: "icon-purple" },
                  { label: "Published Mock Exams", value: adminStats.totalExams, icon: <FileTextIcon size={18} strokeWidth={2} />, cls: "icon-blue" },
                  { label: "Total Revenue Generated", value: `${adminStats.totalRevenue?.toLocaleString() || 0} ETB`, icon: <WalletIcon size={18} strokeWidth={2} />, cls: "icon-green" },
                ].map(s => (
                  <div key={s.label} className="stat-card">
                    <div className="stat-header"><span className="stat-label">{s.label}</span><div className={`stat-icon ${s.cls}`}>{s.icon}</div></div>
                    <div className="stat-value">{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            <WeeklyPerformanceChart />

            <div className="panel">
              <div className="panel-header"><span className="panel-title">Recent Activity Trends</span></div>
              <div className="panel-body">
                {summary.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon"><BarChart3Icon size={26} strokeWidth={1.75} /></div>
                    <h3>Activity tracking active</h3>
                    <p>Usage metrics will aggregate here as students continue practicing offline and online.</p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Date</th><th>Metric</th><th>Count</th></tr></thead>
                      <tbody>
                        {summary.map((row, i) => (
                          <tr key={i}>
                            <td className="td-muted">{fmtDate(row.date)}</td>
                            <td><span className="badge badge-blue">{row.metric}</span></td>
                            <td><strong>{row.count}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   CHAPTERS PAGE
   ════════════════════════════════════════════════════════════════ */

function ChaptersPage({ user }) {
  const [subjects, setSubjects] = useState([]);
  const [gradeFilter, setGradeFilter] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [showModal, setShowModal] = useState(false);
  const [editingChapter, setEditingChapter] = useState(null);
  const [form, setForm] = useState({ title: "", description: "", order: 1 });
  const [saving, setSaving] = useState(false);
  const canManage = ["admin", "teacher", "content_manager"].includes(user.role);

  useEffect(() => {
    apiRequest("/question-bank/subjects?includeInactive=true").then(r => setSubjects(r.subjects)).catch(() => {});
  }, []);

  const filteredSubjects = useMemo(() => {
    if (!gradeFilter) return subjects;
    return subjects.filter(s => (s.gradeLevel || "grade-12") === gradeFilter);
  }, [subjects, gradeFilter]);

  useEffect(() => {
    if (!selectedSubject) { setChapters([]); return; }
    setLoading(true);
    apiRequest(`/question-bank/subjects/${selectedSubject}/chapters?includeInactive=true`)
      .then(r => setChapters(r.chapters))
      .catch(e => setMsg({ text: e.message, type: "error" }))
      .finally(() => setLoading(false));
  }, [selectedSubject]);

  async function saveChapter(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(editingChapter ? `/question-bank/chapters/${editingChapter._id}` : `/question-bank/subjects/${selectedSubject}/chapters`, { method: editingChapter ? "PATCH" : "POST", body: JSON.stringify(form) });
      setMsg({ text: editingChapter ? "Chapter updated." : "Chapter created.", type: "success" });
      setShowModal(false);
      setEditingChapter(null);
      setForm({ title: "", description: "", order: 1 });
      const r = await apiRequest(`/question-bank/subjects/${selectedSubject}/chapters?includeInactive=true`);
      setChapters(r.chapters);
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
    finally { setSaving(false); }
  }

  function openEdit(chapter) {
    setEditingChapter(chapter);
    setForm({ title: chapter.title, description: chapter.description || "", order: chapter.order || 1 });
    setShowModal(true);
  }

  async function reactivate(id) {
    try {
      await apiRequest(`/question-bank/chapters/${id}/reactivate`, { method: "PATCH" });
      setMsg({ text: "Chapter reactivated.", type: "success" });
      const r = await apiRequest(`/question-bank/subjects/${selectedSubject}/chapters?includeInactive=true`);
      setChapters(r.chapters);
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  async function deactivate(id) {
    try {
      await apiRequest(`/question-bank/chapters/${id}/deactivate`, { method: "PATCH" });
      setMsg({ text: "Chapter deactivated.", type: "success" });
      const r = await apiRequest(`/question-bank/subjects/${selectedSubject}/chapters?includeInactive=true`);
      setChapters(r.chapters);
    } catch (err) { setMsg({ text: err.message, type: "error" }); }
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb"><span>Content</span><span className="sep">›</span><span>Chapters</span></div>
        <div className="page-header-row">
          <div><h1>Chapters</h1><p className="page-desc">Organise Grade 9–12 subjects into curriculum chapters for structured learning.</p></div>
          {canManage && selectedSubject && <button className="btn btn-primary" onClick={() => { setEditingChapter(null); setForm({ title: "", description: "", order: chapters.length + 1 }); setShowModal(true); }}><PlusIcon size={16} /> New Chapter</button>}
        </div>
      </div>
      <div className="content-body">
        <Notice text={msg.text} type={msg.type} onClose={() => setMsg({ text: "" })} />
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header" style={{ flexWrap: "wrap", gap: 12 }}>
            <span className="panel-title">Select Grade &amp; Subject</span>
            <div className="filter-bar">
              {GRADE_LEVEL_OPTIONS.map((g) => (
                <button
                  key={g.id || "all"}
                  type="button"
                  className={`btn btn-sm ${gradeFilter === g.id ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => { setGradeFilter(g.id); setSelectedSubject(""); }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            <select value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} style={{ maxWidth: 380 }}>
              <option value="">— Choose a subject —</option>
              {filteredSubjects.map(s => <option key={s._id} value={s._id}>{s.name} ({formatGradeLabel(s.gradeLevel)} - {s.code})</option>)}
            </select>
          </div>
        </div>

        {selectedSubject && (
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Chapters ({chapters.length})</span></div>
            {loading ? <SkeletonTable /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Order</th><th>Title</th><th>Description</th><th>Status</th>{canManage && <th></th>}</tr></thead>
                  <tbody>
                    {chapters.length === 0 ? (
                      <tr><td colSpan={5}><div className="empty-state"><div className="empty-icon"><FolderOpenIcon size={26} strokeWidth={1.75} /></div><h3>No chapters yet</h3></div></td></tr>
                    ) : chapters.map(c => (
                      <tr key={c._id}>
                        <td className="td-muted">{c.order}</td>
                        <td><strong>{c.title}</strong></td>
                        <td className="td-muted">{c.description || "—"}</td>
                        <td>{statusBadge(c.isActive ? "active" : "archived")}</td>
                        {canManage && <td><div className="td-actions"><button className="btn btn-sm btn-secondary" onClick={() => openEdit(c)}>Edit</button>{c.isActive ? <button className="btn btn-sm btn-danger" onClick={() => deactivate(c._id)}>Deactivate</button> : <button className="btn btn-sm btn-success" onClick={() => reactivate(c._id)}>Reactivate</button>}</div></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header"><h2>{editingChapter ? "Edit Chapter" : "New Chapter"}</h2><button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close"><XIcon size={18} /></button></div>
            <form onSubmit={saveChapter}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="field"><label>Chapter Title *</label><input required placeholder="e.g. Algebra Fundamentals" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                  <div className="field"><label>Order</label><input type="number" min="1" value={form.order} onChange={e => setForm({ ...form, order: Number(e.target.value) })} /></div>
                  <div className="field"><label>Description</label><textarea placeholder="Brief description…" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editingChapter ? "Save Changes" : "Create Chapter"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD SHELL — SIDEBAR + ROUTING
   ════════════════════════════════════════════════════════════════ */

function Dashboard({ user, onLogout, theme, onToggleTheme }) {
  const [page, setPage] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = e => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);
  const [stats, setStats] = useState({ subjects: 0, questions: 0, exams: 0, pendingPayments: 0 });

  useEffect(() => {
    // Load overview stats in background
    Promise.all([
      apiRequest("/question-bank/subjects").then(r => r.subjects.length).catch(() => 0),
      apiRequest("/question-bank/questions").then(r => r.totalCount ?? r.questions.length).catch(() => 0),
      apiRequest("/exams").then(r => r.exams.length).catch(() => 0),
      apiRequest("/payments/dashboard").then(r => r.pendingPayments).catch(() => 0),
    ]).then(([subjects, questions, exams, pendingPayments]) => {
      setStats({ subjects, questions, exams, pendingPayments });
    });
  }, []);

  const canContent = ["admin", "teacher", "content_manager"].includes(user.role);
  const canFinance = ["admin", "cash_manager"].includes(user.role);
  const isAdmin = user.role === "admin";

  const nav = [
    { id: "overview", label: "Overview", icon: <LayoutDashboardIcon size={18} strokeWidth={2} /> },
    ...(canContent ? [
      { section: "Content Management" },
      { id: "subjects",  label: "Subjects",      icon: <BookOpenIcon size={18} strokeWidth={2} /> },
      { id: "chapters",  label: "Chapters",       icon: <FolderOpenIcon size={18} strokeWidth={2} /> },
      { id: "questions", label: "Question Bank",  icon: <CircleHelpIcon size={18} strokeWidth={2} /> },
      { id: "exams",     label: "Exams",          icon: <FileTextIcon size={18} strokeWidth={2} /> },
      { id: "notes",     label: "Study Notes",    icon: <BookMarkedIcon size={18} strokeWidth={2} /> },
    ] : []),
    ...(canFinance ? [
      { section: "Finance" },
      { id: "payments",  label: "Payments",       icon: <CreditCardIcon size={18} strokeWidth={2} /> },
    ] : []),
    ...(isAdmin ? [
      { section: "Administration" },
      { id: "users",     label: "Users",          icon: <UsersIcon size={18} strokeWidth={2} /> },
      { id: "analytics", label: "Analytics",      icon: <BarChart3Icon size={18} strokeWidth={2} /> },
    ] : []),
  ];

  function renderPage() {
    switch (page) {
      case "overview":   return <Overview user={user} stats={stats} />;
      case "subjects":   return <SubjectsPage user={user} />;
      case "chapters":   return <ChaptersPage user={user} />;
      case "questions":  return <QuestionsPage user={user} />;
      case "exams":      return <ExamsPage user={user} />;
      case "notes":      return <StaffNotesPage user={user} />;
      case "payments":   return <PaymentsPage user={user} />;
      case "users":      return <UsersPage />;
      case "analytics":  return <AnalyticsPage />;
      default:           return <Overview user={user} stats={stats} />;
    }
  }

  return (
    <div className="app-shell">
      {/* ── Mobile top bar ── */}
      <header className="mobile-topbar">
        <button className="icon-btn" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
          <MenuIcon size={20} />
        </button>
        <div className="mobile-brand">
          <img src="/pwa-192x192.png" alt="Burka Exam Logo" className="sidebar-logo" style={{ objectFit: "contain", borderRadius: "50%", background: "transparent" }} />
          <span>Burka <b>Exam</b></span>
        </div>
        <ThemeToggleSwitch theme={theme} onToggle={onToggleTheme} compact />
        <div className="user-avatar" title={user.displayName}>{user.displayName[0].toUpperCase()}</div>
      </header>
      <div className={`drawer-backdrop ${navOpen ? "open" : ""}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${navOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="sidebar-header">
          <img src="/pwa-192x192.png" alt="Burka Exam Logo" className="sidebar-logo" style={{ objectFit: "contain", borderRadius: "50%", background: "transparent" }} />
          <div>
            <div className="sidebar-title">Burka Exam</div>
            <div className="sidebar-subtitle">Staff Portal</div>
          </div>
          <button className="icon-btn drawer-close" aria-label="Close navigation" onClick={() => setNavOpen(false)}>
            <XIcon size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item, i) => {
            if (item.section) return <div key={i} className="nav-section-label">{item.section}</div>;
            return (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                aria-current={page === item.id ? "page" : undefined}
                title={item.label}
                onClick={() => { setPage(item.id); setNavOpen(false); }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <ThemeToggleSwitch theme={theme} onToggle={onToggleTheme} />
          <div className="user-card">
            <div className="user-avatar">{user.displayName[0].toUpperCase()}</div>
            <div className="user-info">
              <div className="user-name">{user.displayName}</div>
              <div className="user-role">{ROLE_LABELS[user.role] || user.role}</div>
            </div>
            <button className="signout-btn" title="Sign out" aria-label="Sign out" onClick={() => { clearSession(); onLogout(); }}><LogOutIcon size={16} /></button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   APP ROOT
   ════════════════════════════════════════════════════════════════ */

const THEME_STORAGE_KEY = "ethioprep_theme";

function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // ignore storage errors
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === "dark" ? "light" : "dark"));
  }, []);

  const [user, setUser] = useState(() => {
    try {
      const token = localStorage.getItem("ethioprep_token");
      const u = JSON.parse(localStorage.getItem("ethioprep_user") || "null");
      // Require an active token and reject student sessions in the staff portal
      if (!token || !u || u.role === "student") {
        clearSession();
        return null;
      }
      return u;
    } catch {
      clearSession();
      return null;
    }
  });

  useEffect(() => {
    const handleSessionExpired = () => {
      clearSession();
      setUser(null);
    };
    window.addEventListener("burka:session-expired", handleSessionExpired);
    return () => window.removeEventListener("burka:session-expired", handleSessionExpired);
  }, []);

  if (!user || user.role === "student") {
    return (
      <Auth
        onLogin={setUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        
      />
    );
  }

  return <Dashboard user={user} onLogout={() => setUser(null)} theme={theme} onToggleTheme={toggleTheme} />;
}

createRoot(document.getElementById("root")).render(<App />);
