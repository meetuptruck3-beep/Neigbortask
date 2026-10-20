import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "./supabase.js";

const roles = [
  { value: "customer", label: "I need help", detail: "Post a task and find someone local." },
  { value: "provider", label: "I offer services", detail: "Find tasks that match your skills." },
  { value: "both", label: "Both", detail: "Get help and offer your skills." },
];

export default function App() {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("customer");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) loadDashboard(session.user);
    else { setProfile(null); setJobs([]); }
  }, [session]);

  async function loadDashboard(user) {
    setError("");
    const { data: profileData, error: profileError } = await supabase
      .from("profiles").select("display_name, role").eq("id", user.id).maybeSingle();
    if (profileError) setError("Signed in, but your profile could not be loaded. " + profileError.message);
    setProfile(profileData || { display_name: user.user_metadata?.display_name || user.email, role: user.user_metadata?.role || "customer" });
    setLoadingJobs(true);
    const { data, error: jobsError } = await supabase.from("jobs").select("id,title,description,category,location,budget,created_at")
      .eq("status", "open").order("created_at", { ascending: false }).limit(20);
    if (!jobsError) setJobs(data || []);
    else setError((current) => current ? current + " " + jobsError.message : "Could not load open tasks. " + jobsError.message);
    setLoadingJobs(false);
  }

  async function submit(event) {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (!supabaseConfigured) throw new Error("The app is not connected yet. Add the Supabase environment variables before signing in.");
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Enter your name.");
        if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim(), role } },
        });
        if (authError) throw authError;
        if (data.session) setNotice("Your account is ready. Welcome to Neighbortask.");
        else setNotice("Check your email for a confirmation link. After confirming, return here and sign in.");
        setMode("login");
        setPassword("");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      }
    } catch (err) { setError(err.message || "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    else { setNotice("You have signed out."); setError(""); }
  }

  if (!supabaseConfigured) return <main className="page"><header className="brand"><div className="brand-mark">N</div><span>neighbor<span className="brand-light">task</span></span></header><section className="setup-card"><p className="eyebrow">ONE COMMUNITY. MORE HELP.</p><h1>Your local help starts here.</h1><p className="muted">The login and registration screens are built. Add your Supabase project settings to connect them.</p><div className="setup-note"><strong>Setup required</strong><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your hosting provider's environment variables.</p></div></section></main>;

  if (session?.user) return <main className="page dashboard-page"><header className="topbar"><a className="brand" href="#"><div className="brand-mark">N</div><span>neighbor<span className="brand-light">task</span></span></a><button className="button button-outline small" onClick={signOut}>Sign out</button></header><section className="welcome"><p className="eyebrow">YOUR NEIGHBORHOOD, CONNECTED</p><h1>Welcome{profile?.display_name ? ", " + profile.display_name : ""}.</h1><p className="muted">You're signed in to Neighbortask.</p><span className="role-pill">{roles.find((item) => item.value === profile?.role)?.label || "Member"}</span></section><section className="jobs-section"><div className="section-heading"><div><p className="eyebrow">COMMUNITY TASKS</p><h2>Open tasks</h2></div><span className="count">{jobs.length}</span></div>{loadingJobs ? <p className="muted">Loading tasks…</p> : jobs.length ? <div className="job-grid">{jobs.map((job) => <article className="job-card" key={job.id}><span className="category">{job.category || "Local task"}</span><h3>{job.title}</h3><p>{job.description}</p><div className="job-meta"><span>{job.location || "Location not specified"}</span><strong>{job.budget != null ? "$" + Number(job.budget).toFixed(0) : "Budget flexible"}</strong></div></article>)}</div> : <div className="empty-state"><div className="empty-icon">⌂</div><h3>No open tasks yet</h3><p>When neighbors post tasks, they will show up here.</p></div>}</section><footer className="footer">Built for neighbors, powered by community.</footer></main>;

  return <main className="page auth-page"><div className="auth-left"><header className="brand"><div className="brand-mark">N</div><span>neighbor<span className="brand-light">task</span></span></header><div className="hero-copy"><p className="eyebrow">GOOD HELP IS CLOSER THAN YOU THINK</p><h1>Neighbors helping<br/><em>neighbors.</em></h1><p>Find a helping hand nearby, or share your skills with people in your community.</p><div className="hero-points"><div><span className="point-icon">✓</span><span>Local tasks, real people</span></div><div><span className="point-icon">✓</span><span>A simple way to lend a hand</span></div><div><span className="point-icon">✓</span><span>Built around your community</span></div></div></div><div className="left-foot">Small tasks. Stronger neighborhoods.</div></div><section className="auth-right"><div className="auth-card"><div className="mobile-brand brand"><div className="brand-mark">N</div><span>neighbor<span className="brand-light">task</span></span></div><div className="switcher" role="tablist" aria-label="Account access"><button className={mode === "signup" ? "active" : ""} onClick={() => {setMode("signup");setError("");setNotice("");}} role="tab" aria-selected={mode === "signup"}>Create account</button><button className={mode === "login" ? "active" : ""} onClick={() => {setMode("login");setError("");setNotice("");}} role="tab" aria-selected={mode === "login"}>Sign in</button></div><p className="eyebrow">{mode === "signup" ? "GET STARTED" : "WELCOME BACK"}</p><h2>{mode === "signup" ? "Join your neighborhood." : "Good to see you again."}</h2><p className="muted">{mode === "signup" ? "Create an account to get started." : "Sign in to continue to your account."}</p>{notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error" role="alert">{error}</div>}<form onSubmit={submit} className="auth-form">{mode === "signup" && <><label htmlFor="name">Your name</label><input id="name" autoComplete="name" value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Taylor Morgan" required/><label>How will you use Neighbortask?</label><div className="role-options">{roles.map((item)=><button type="button" key={item.value} className={"role-option " + (role===item.value ? "selected" : "")} onClick={()=>setRole(item.value)}><span className="radio-dot"/><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</div></>}<label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" required/><div className="password-label"><label htmlFor="password">Password</label>{mode === "signup" && <span>At least 8 characters</span>}</div><input id="password" type="password" autoComplete={mode==="signup"?"new-password":"current-password"} minLength={mode==="signup"?8:undefined} value={password} onChange={(e)=>setPassword(e.target.value)} placeholder={mode==="signup"?"Create a strong password":"Enter your password"} required/><button className="button button-primary submit-button" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create my account" : "Sign in"} <span aria-hidden="true">→</span></button></form><p className="legal">By continuing, you agree to use Neighbortask respectfully and keep your account details secure.</p><p className="switch-copy">{mode==="signup"?"Already have an account?":"New to Neighbortask?"} <button onClick={()=>{setMode(mode==="signup"?"login":"signup");setError("");setNotice("");}}>{mode==="signup"?"Sign in":"Create an account"}</button></p></div></section></main>;
}
