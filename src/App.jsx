import React, { useEffect, useState } from "react";
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
  const [resetBusy, setResetBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [jobSearch, setJobSearch] = useState("");
  const [jobCategoryFilter, setJobCategoryFilter] = useState("All");
  const [jobLocationFilter, setJobLocationFilter] = useState("");
  const [minBudgetFilter, setMinBudgetFilter] = useState("");
  const [maxBudgetFilter, setMaxBudgetFilter] = useState("");
  const [offers, setOffers] = useState([]);
  const [showOffers, setShowOffers] = useState(true);
  const [appliedJobIds, setAppliedJobIds] = useState([]);
  const [applyingJobId, setApplyingJobId] = useState("");
  const [proposalAmounts, setProposalAmounts] = useState({});
  const [respondingOfferId, setRespondingOfferId] = useState("");
  const [counterAmounts, setCounterAmounts] = useState({});
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskCategory, setTaskCategory] = useState("General");
  const [taskLocation, setTaskLocation] = useState("");
  const [taskBudget, setTaskBudget] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [communityProfiles, setCommunityProfiles] = useState([]);
  const [profileStats, setProfileStats] = useState({});
  const [accountReviews, setAccountReviews] = useState([]);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [providerAcceptedTasks, setProviderAcceptedTasks] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) loadDashboard(session.user);
    else { setProfile(null); setJobs([]); setOffers([]); }
  }, [session]);

  useEffect(() => {
    if (!session?.user || !supabase) return;
    const channel = supabase
      .channel("handyneighbor-application-notifications-" + session.user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_applications" }, () => {
        loadDashboard(session.user);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  async function loadDashboard(user) {
    setError("");
    const { data: profileData, error: profileError } = await supabase
      .from("profiles").select("id,display_name,role,created_at,bio,service_area,skills").eq("id", user.id).maybeSingle();
    if (profileError) setError("Signed in, but your profile could not be loaded. " + profileError.message);
    const activeProfile = profileData || { display_name: user.user_metadata?.display_name || user.email, role: user.user_metadata?.role || "customer" };
    setProfile(activeProfile);
    const [{ data: profilesData }, { data: reviewsData }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,role,created_at,bio,service_area,skills").order("created_at", { ascending: false }).limit(100),
      supabase.from("account_reviews").select("id,job_id,reviewer_id,reviewed_user_id,rating,review_text,created_at").order("created_at", { ascending: false }).limit(500),
    ]);
    setCommunityProfiles(profilesData || []);
    setAccountReviews(reviewsData || []);
    const idsForStats = [...new Set([user.id, ...((profilesData || []).map((item) => item.id))])];
    const { data: statsData } = await supabase.rpc("get_profile_stats", { profile_ids: idsForStats });
    setProfileStats(Object.fromEntries((statsData || []).map((item) => [item.profile_id, item])));
    if (["provider", "both"].includes(activeProfile.role)) {
      const { data: applications, error: applicationsError } = await supabase
        .from("job_applications").select("job_id,status").eq("provider_id", user.id);
      if (applicationsError) setError("Could not load your applications. " + applicationsError.message);
      else {
        setAppliedJobIds((applications || []).map((application) => application.job_id));
        const acceptedIds = (applications || []).filter((application) => application.status === "accepted").map((application) => application.job_id);
        if (acceptedIds.length) {
          const { data: acceptedJobs } = await supabase.from("jobs").select("id,title,customer_id").in("id", acceptedIds);
          const customerIds = [...new Set((acceptedJobs || []).map((job) => job.customer_id))];
          const { data: customerProfiles } = customerIds.length ? await supabase.from("profiles").select("id,display_name").in("id", customerIds) : { data: [] };
          const customerNames = Object.fromEntries((customerProfiles || []).map((person) => [person.id, person.display_name || "A neighbor"]));
          setProviderAcceptedTasks((acceptedJobs || []).map((job) => ({ ...job, customerName: customerNames[job.customer_id] || "A neighbor" })));
        } else setProviderAcceptedTasks([]);
      }
    } else setAppliedJobIds([]);
    setLoadingJobs(true);
    // Load every open task in pages instead of limiting the task feed to the newest 20.
    // Paging avoids the API's per-request row cap while keeping search/filter results comprehensive.
    const allOpenJobs = [];
    const pageSize = 1000;
    let jobsError = null;
    for (let offset = 0; ; offset += pageSize) {
      const { data: jobPage, error: pageError } = await supabase.from("jobs")
        .select("id,title,description,category,location,budget,created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (pageError) {
        jobsError = pageError;
        break;
      }
      allOpenJobs.push(...(jobPage || []));
      if (!jobPage || jobPage.length < pageSize) break;
    }
    if (!jobsError) setJobs(allOpenJobs);
    else setError((current) => current ? current + " " + jobsError.message : "Could not load open tasks. " + jobsError.message);
    const { data: myTasks, error: myTasksError } = await supabase
      .from("jobs").select("id,title").eq("customer_id", user.id);
    if (myTasksError) {
      setError((current) => current ? current + " " + myTasksError.message : "Could not load your task offers. " + myTasksError.message);
      setOffers([]);
    } else if (!myTasks?.length) {
      setOffers([]);
    } else {
      const taskIds = myTasks.map((task) => task.id);
      const { data: taskApplications, error: offerError } = await supabase
        .from("job_applications")
        .select("id,job_id,provider_id,status,created_at,proposed_amount,counter_amount")
        .in("job_id", taskIds)
        .order("created_at", { ascending: false });
      if (offerError) {
        setError((current) => current ? current + " " + offerError.message : "Could not load offers. " + offerError.message);
        setOffers([]);
      } else {
        const providerIds = [...new Set((taskApplications || []).map((application) => application.provider_id))];
        let providerNames = {};
        if (providerIds.length) {
          const { data: providers } = await supabase.from("profiles").select("id,display_name").in("id", providerIds);
          providerNames = Object.fromEntries((providers || []).map((provider) => [provider.id, provider.display_name || "A neighbor"]));
        }
        const taskTitles = Object.fromEntries(myTasks.map((task) => [task.id, task.title]));
        setOffers((taskApplications || []).map((application) => ({
          ...application,
          taskTitle: taskTitles[application.job_id] || "Your task",
          providerName: providerNames[application.provider_id] || "A neighbor",
        })));
      }
    }
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
          options: {
            data: { display_name: name.trim(), role },
            emailRedirectTo: window.location.origin,
          },
        });
        if (authError) throw authError;
        if (data.session) setNotice("Your account is ready. Welcome to HandyNeighbor.");
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

  async function sendPasswordReset() {
    setError("");
    setNotice("");
    if (!email.trim()) return setError("Enter your email address first, then choose Forgot password.");
    setResetBusy(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setNotice("If an account exists for that email, a password-reset link has been sent. Check your inbox and spam folder.");
    } catch (err) {
      setError(err.message || "Could not send a password-reset email. Please try again.");
    } finally {
      setResetBusy(false);
    }
  }

  async function createTask(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!session?.user) return setError("Please sign in before posting a task.");
    if (taskTitle.trim().length < 5) return setError("Task titles must be at least 5 characters.");
    if (taskDescription.trim().length < 10) return setError("Please provide at least 10 characters describing the task.");
    const budget = taskBudget.trim() === "" ? null : Number(taskBudget);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return setError("Enter a valid non-negative budget.");
    setSavingTask(true);
    try {
      const { error: insertError } = await supabase.from("jobs").insert({
        customer_id: session.user.id,
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        category: taskCategory,
        location: taskLocation.trim() || null,
        budget,
        status: "open",
      });
      if (insertError) throw insertError;
      setTaskTitle("");
      setTaskDescription("");
      setTaskCategory("General");
      setTaskLocation("");
      setTaskBudget("");
      setShowTaskForm(false);
      setNotice("Your task has been posted.");
      await loadDashboard(session.user);
    } catch (err) {
      setError("Could not post your task. " + (err.message || "Please try again."));
    } finally {
      setSavingTask(false);
    }
  }

  async function applyToJob(jobId) {
    if (!session?.user) return setError("Please sign in before applying.");
    const proposedAmount = Number(proposalAmounts[jobId]);
    if (proposalAmounts[jobId] === undefined || proposalAmounts[jobId] === "" || !Number.isFinite(proposedAmount) || proposedAmount < 0) return setError("Enter the cash amount you propose for this task.");
    setError("");
    setNotice("");
    setApplyingJobId(jobId);
    try {
      const { error: applicationError } = await supabase.from("job_applications").insert({ job_id: jobId, provider_id: session.user.id, proposed_amount: proposedAmount });
      if (applicationError) throw applicationError;
      setAppliedJobIds((current) => [...current, jobId]);
      setProposalAmounts((current) => ({ ...current, [jobId]: "" }));
      setNotice("Your cash proposal was sent to the task poster.");
    } catch (err) {
      setError("Could not send your application. " + (err.message || "Please try again."));
    } finally { setApplyingJobId(""); }
  }

  async function sendCounterOffer(offerId) {
    const rawAmount = counterAmounts[offerId];
    const amount = Number(rawAmount);
    if (rawAmount === undefined || rawAmount === "" || !Number.isFinite(amount) || amount < 0) {
      setError("Enter the price you want to offer.");
      return;
    }
    setError("");
    setNotice("");
    setRespondingOfferId(offerId);
    try {
      const { error: updateError } = await supabase.from("job_applications")
        .update({ counter_amount: amount }).eq("id", offerId).eq("status", "pending");
      if (updateError) throw updateError;
      setNotice("Your different price has been sent to the service provider.");
      setCounterAmounts((current) => ({ ...current, [offerId]: "" }));
      await loadDashboard(session.user);
    } catch (err) {
      setError("Could not send your different price. " + (err.message || "Please try again."));
    } finally { setRespondingOfferId(""); }
  }

  async function respondToOffer(offerId, status) {
    if (!session?.user) return;
    setError("");
    setNotice("");
    setRespondingOfferId(offerId);
    try {
      const { error: updateError } = await supabase.from("job_applications")
        .update({ status }).eq("id", offerId).eq("status", "pending");
      if (updateError) throw updateError;
      setNotice(status === "accepted" ? "You accepted the cash proposal." : "You declined the cash proposal.");
      await loadDashboard(session.user);
    } catch (err) {
      setError("Could not update this offer. " + (err.message || "Please try again."));
    } finally { setRespondingOfferId(""); }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!session?.user) return;
    setSavingProfile(true); setError(""); setNotice("");
    try {
      const updates = { display_name: (profile?.display_name || "").trim(), bio: (profile?.bio || "").trim().slice(0, 500), service_area: (profile?.service_area || "").trim().slice(0, 160), skills: (profile?.skills || "").trim().slice(0, 300) };
      if (!updates.display_name) throw new Error("Please enter a display name.");
      const { error: updateError } = await supabase.from("profiles").update(updates).eq("id", session.user.id);
      if (updateError) throw updateError;
      const { error: metadataError } = await supabase.auth.updateUser({ data: { ...(session.user.user_metadata || {}), display_name: updates.display_name } });
      if (metadataError) throw metadataError;
      setProfile((current) => ({ ...current, ...updates }));
      setCommunityProfiles((current) => current.map((item) => item.id === session.user.id ? { ...item, ...updates } : item));
      setNotice("Your profile has been saved.");
    } catch (err) { setError("Could not save your profile. " + (err.message || "Please try again.")); }
    finally { setSavingProfile(false); }
  }

  async function submitReview(jobId, reviewedUserId) {
    const key = jobId + ":" + reviewedUserId;
    const draft = reviewDrafts[key] || {};
    const rating = Number(draft.rating || 5);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return setError("Choose a rating from 1 to 5 stars.");
    setError(""); setNotice("");
    try {
      const { error: reviewError } = await supabase.from("account_reviews").insert({ job_id: jobId, reviewer_id: session.user.id, reviewed_user_id: reviewedUserId, rating, review_text: (draft.text || "").trim().slice(0, 1000) });
      if (reviewError) throw reviewError;
      setNotice("Your review has been submitted.");
      await loadDashboard(session.user);
    } catch (err) { setError("Could not submit your review. " + (err.message || "You may have already reviewed this task.")); }
  }

  async function enableBothRoles() {
    if (!session?.user) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ role: "both" })
        .eq("id", session.user.id);
      if (profileUpdateError) throw profileUpdateError;

      const { error: metadataError } = await supabase.auth.updateUser({
        data: { ...(session.user.user_metadata || {}), role: "both" },
      });
      if (metadataError) throw metadataError;

      setProfile((current) => ({ ...(current || {}), role: "both" }));
      setNotice("Your account is now set to Both. You can post tasks and offer services.");
      await loadDashboard(session.user);
    } catch (err) {
      setError("Could not update your account role. " + (err.message || "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    else { setNotice("You have signed out."); setError(""); }
  }

  if (!supabaseConfigured) return <main className="page"><header className="brand"><div className="brand-mark">H</div><span>handy<span className="brand-light">neighbor</span></span></header><section className="setup-card"><p className="eyebrow">ONE COMMUNITY. MORE HELP.</p><h1>Your local help starts here.</h1><p className="muted">The login and registration screens are built. Add your Supabase project settings to connect them.</p><div className="setup-note"><strong>Setup required</strong><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your hosting provider's environment variables.</p></div></section></main>;

  if (session?.user) return <main className="page dashboard-page"><header className="topbar"><a className="brand" href="#"><div className="brand-mark">H</div><span>handy<span className="brand-light">neighbor</span></span></a><button className="button button-outline small" onClick={signOut}>Sign out</button></header><section className="welcome"><p className="eyebrow">YOUR NEIGHBORHOOD, CONNECTED</p><h1>Welcome{profile?.display_name ? ", " + profile.display_name : ""}.</h1><p className="muted">You're signed in to HandyNeighbor.</p><span className="role-pill">{roles.find((item) => item.value === profile?.role)?.label || "Member"}</span>{profile?.role !== "both" && <div className="role-upgrade"><p className="muted">Want to post tasks as well as offer services?</p><button className="button button-outline small" onClick={enableBothRoles} disabled={busy}>{busy ? "Updating account…" : "Enable both: post tasks + offer services"}</button></div>}{notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error" role="alert">{error}</div>}</section>
<section className="profile-section">
  <div className="section-heading"><div><p className="eyebrow">YOUR PUBLIC PROFILE</p><h2>Personalize your account</h2></div></div>
  <form className="profile-editor" onSubmit={saveProfile}>
    <label htmlFor="profile-display-name">Display name</label><input id="profile-display-name" maxLength={80} value={profile?.display_name || ""} onChange={(e)=>setProfile((current)=>({...current,display_name:e.target.value}))} required/>
    <label htmlFor="profile-bio">About you</label><textarea id="profile-bio" rows={3} maxLength={500} value={profile?.bio || ""} onChange={(e)=>setProfile((current)=>({...current,bio:e.target.value}))} placeholder="Tell neighbors a little about yourself."/>
    <label htmlFor="profile-skills">Skills and services</label><input id="profile-skills" maxLength={300} value={profile?.skills || ""} onChange={(e)=>setProfile((current)=>({...current,skills:e.target.value}))} placeholder="e.g. lawn care, cleaning, furniture assembly"/>
    <label htmlFor="profile-service-area">Town or service area</label><input id="profile-service-area" maxLength={160} value={profile?.service_area || ""} onChange={(e)=>setProfile((current)=>({...current,service_area:e.target.value}))} placeholder="Town or neighborhood only"/>
    <button className="button button-primary profile-save" disabled={savingProfile}>{savingProfile ? "Saving profile…" : "Save profile"}</button>
  </form>
  <div className="profile-stats">
    <div><strong>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString(undefined,{month:"short",year:"numeric"}) : "—"}</strong><span>Member since</span></div>
    <div><strong>{profileStats[session.user.id]?.tasks_completed ?? 0}</strong><span>Tasks completed as a poster</span></div>
    <div><strong>{profileStats[session.user.id]?.tasks_paid ?? 0}</strong><span>Tasks paid for</span></div>
    <div><strong>{profileStats[session.user.id]?.jobs_completed ?? 0}</strong><span>Jobs completed as a provider</span></div>
    <div><strong>{profileStats[session.user.id]?.jobs_paid ?? 0}</strong><span>Jobs paid for</span></div>
  </div>
</section>
<section className="provider-reviews-section">
  <div className="section-heading"><div><p className="eyebrow">YOUR ACCEPTED TASKS</p><h2>Rate task posters</h2></div></div>
  {providerAcceptedTasks.length ? <div className="provider-review-list">{providerAcceptedTasks.map((task)=>{
    const alreadyReviewed=accountReviews.some((review)=>review.job_id===task.id && review.reviewer_id===session.user.id);
    const key=task.id+":"+task.customer_id;
    return <article className="provider-review-card" key={task.id}><div><strong>{task.title}</strong><p>Task posted by {task.customerName}</p></div>
      {alreadyReviewed ? <span className="offer-status offer-status-accepted">Rating submitted</span> : <div className="review-controls"><label htmlFor={"provider-review-rating-"+task.id}>Rate your experience</label><select id={"provider-review-rating-"+task.id} value={reviewDrafts[key]?.rating || "5"} onChange={(e)=>setReviewDrafts((current)=>({...current,[key]:{...(current[key]||{}),rating:e.target.value}}))}><option value="5">★★★★★ — Excellent</option><option value="4">★★★★☆ — Good</option><option value="3">★★★☆☆ — Okay</option><option value="2">★★☆☆☆ — Poor</option><option value="1">★☆☆☆☆ — Very poor</option></select><textarea rows={2} maxLength={1000} placeholder="Share your experience (optional)" value={reviewDrafts[key]?.text || ""} onChange={(e)=>setReviewDrafts((current)=>({...current,[key]:{...(current[key]||{}),text:e.target.value}}))}/><button className="button button-outline small" onClick={()=>submitReview(task.id,task.customer_id)}>Submit rating</button></div>}
    </article>;
  })}</div> : <div className="empty-offers">When a task poster accepts one of your proposals, you can rate your experience here.</div>}
</section>
<section className="community-section">
  <div className="section-heading"><div><p className="eyebrow">MEET YOUR NEIGHBORS</p><h2>Community profiles & ratings</h2></div><span className="count">{communityProfiles.length}</span></div>
  <div className="community-grid">{communityProfiles.map((person)=>{
    const reviews=accountReviews.filter((review)=>review.reviewed_user_id===person.id);
    const average=reviews.length ? (reviews.reduce((sum,review)=>sum+review.rating,0)/reviews.length).toFixed(1) : null;
    const stats=profileStats[person.id] || {};
    return <article className="community-card" key={person.id}><div className="community-avatar">{(person.display_name || "N").trim().charAt(0).toUpperCase()}</div><div className="community-card-main"><h3>{person.display_name || "HandyNeighbor member"}</h3><span className="role-pill">{roles.find((item)=>item.value===person.role)?.label || "Member"}</span>
      <p className="community-rating">{average ? "★".repeat(Math.round(Number(average))) + "☆".repeat(5-Math.round(Number(average))) + " " + average + " / 5" : "No ratings yet"} <span>({reviews.length} {reviews.length===1?"review":"reviews"})</span></p>
      {person.bio && <p>{person.bio}</p>}{person.skills && <p><b>Skills:</b> {person.skills}</p>}{person.service_area && <p><b>Area:</b> {person.service_area}</p>}
      <small>Member since {person.created_at ? new Date(person.created_at).toLocaleDateString(undefined,{month:"short",year:"numeric"}) : "date unavailable"} · {stats.tasks_completed || 0} tasks completed · {stats.jobs_completed || 0} jobs completed</small>
      {reviews.filter((review)=>review.review_text).slice(0,2).map((review)=><blockquote key={review.id}>“{review.review_text}” <span>— {review.rating}/5</span></blockquote>)}
    </div></article>;
  })}</div>
</section>
<section className="offers-section">
  <div className="section-heading">
    <div><p className="eyebrow">TASK RESPONSES</p><h2>Offers & notifications</h2></div>
    <div className="section-actions">
      <span className="count">{offers.filter((offer) => offer.status === "pending").length}</span>
      <button className="button button-outline small" onClick={() => loadDashboard(session.user)}>Refresh</button>
      <button className="button button-outline small" onClick={() => setShowOffers((value) => !value)}>{showOffers ? "Hide" : "Show"}</button>
    </div>
  </div>
  {showOffers && (offers.length ? <div className="offer-list">{offers.map((offer) => <article className="offer-card" key={offer.id}><div className="offer-icon" aria-hidden="true">✉</div><div className="offer-content"><strong>{offer.status === "pending" ? "New offer on your task" : "Task application update"}</strong><p><b>{offer.providerName}</b> proposed <b>{offer.proposed_amount != null ? "$" + Number(offer.proposed_amount).toFixed(2) : "an amount not specified"}</b> for <b>{offer.taskTitle}</b>.</p>{offer.counter_amount != null && <p className="counter-summary">Your different price: <b>${Number(offer.counter_amount).toFixed(2)}</b></p>}<span className={"offer-status offer-status-" + offer.status}>{offer.status === "pending" ? "Awaiting your response" : offer.status === "accepted" ? "Accepted" : offer.status === "rejected" ? "Declined" : offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}</span>{offer.status === "accepted" && !accountReviews.some((review)=>review.job_id===offer.job_id && review.reviewer_id===session.user.id) && <div className="review-controls"><label htmlFor={"review-rating-"+offer.id}>Rate your experience with {offer.providerName}</label><select id={"review-rating-"+offer.id} value={reviewDrafts[offer.job_id+":"+offer.provider_id]?.rating || "5"} onChange={(e)=>setReviewDrafts((current)=>({...current,[offer.job_id+":"+offer.provider_id]:{...(current[offer.job_id+":"+offer.provider_id]||{}),rating:e.target.value}}))}><option value="5">★★★★★ — Excellent</option><option value="4">★★★★☆ — Good</option><option value="3">★★★☆☆ — Okay</option><option value="2">★★☆☆☆ — Poor</option><option value="1">★☆☆☆☆ — Very poor</option></select><textarea rows={2} maxLength={1000} placeholder="Share your experience (optional)" value={reviewDrafts[offer.job_id+":"+offer.provider_id]?.text || ""} onChange={(e)=>setReviewDrafts((current)=>({...current,[offer.job_id+":"+offer.provider_id]:{...(current[offer.job_id+":"+offer.provider_id]||{}),text:e.target.value}}))}/><button className="button button-outline small" onClick={()=>submitReview(offer.job_id,offer.provider_id)}>Submit rating</button></div>}{offer.status === "pending" && <div className="offer-response-actions"><button className="button button-primary small" disabled={respondingOfferId === offer.id} onClick={() => respondToOffer(offer.id, "accepted")}>{respondingOfferId === offer.id ? "Saving…" : "Accept amount"}</button><button className="button button-outline small" disabled={respondingOfferId === offer.id} onClick={() => respondToOffer(offer.id, "rejected")}>Decline</button></div>}{offer.status === "pending" && <div className="counter-offer-controls"><label htmlFor={"counter-" + offer.id}>Or offer a different price ($)</label><input id={"counter-" + offer.id} type="number" min="0" step="0.01" placeholder="Enter your price" value={counterAmounts[offer.id] ?? (offer.counter_amount == null ? "" : String(offer.counter_amount))} onChange={(e) => setCounterAmounts((current) => ({ ...current, [offer.id]: e.target.value }))} disabled={respondingOfferId === offer.id}/><button className="button button-outline small" disabled={respondingOfferId === offer.id} onClick={() => sendCounterOffer(offer.id)}>{respondingOfferId === offer.id ? "Sending…" : "Send different price"}</button></div>}</div><span className="offer-date">{new Date(offer.created_at).toLocaleDateString()}</span></article>)}</div> : <div className="empty-offers">No offers yet. When someone applies to one of your tasks, their offer will appear here.</div>)}
</section><section className="jobs-section"><div className="section-heading"><div><p className="eyebrow">COMMUNITY TASKS</p><h2>Open tasks</h2></div><div className="section-actions"><span className="count">{jobs.length}</span>{["customer","both"].includes(profile?.role) && <button className="button button-primary post-task-button" onClick={()=>{setShowTaskForm((v)=>!v);setError("");setNotice("");}}>{showTaskForm ? "Cancel" : "＋ Post a task"}</button>}</div></div><div className="job-filters"><div className="filter-search"><label htmlFor="job-search">Search tasks</label><input id="job-search" type="search" value={jobSearch} onChange={(e)=>setJobSearch(e.target.value)} placeholder="Search by task, skill, or keyword"/></div><div><label htmlFor="job-category-filter">Category</label><select id="job-category-filter" value={jobCategoryFilter} onChange={(e)=>setJobCategoryFilter(e.target.value)}><option>All</option>{[...new Set(jobs.map((job)=>job.category).filter(Boolean))].map((category)=><option key={category}>{category}</option>)}</select></div><div><label htmlFor="job-location-filter">Location</label><input id="job-location-filter" value={jobLocationFilter} onChange={(e)=>setJobLocationFilter(e.target.value)} placeholder="Town or neighborhood"/></div><div><label htmlFor="job-min-budget">Min budget ($)</label><input id="job-min-budget" type="number" min="0" step="0.01" value={minBudgetFilter} onChange={(e)=>setMinBudgetFilter(e.target.value)} placeholder="Any"/></div><div><label htmlFor="job-max-budget">Max budget ($)</label><input id="job-max-budget" type="number" min="0" step="0.01" value={maxBudgetFilter} onChange={(e)=>setMaxBudgetFilter(e.target.value)} placeholder="Any"/></div><button className="button button-outline small" onClick={()=>{setJobSearch("");setJobCategoryFilter("All");setJobLocationFilter("");setMinBudgetFilter("");setMaxBudgetFilter("");}}>Clear filters</button></div>{showTaskForm && <form className="task-form" onSubmit={createTask}><h3>Tell your neighbors what you need</h3><label htmlFor="task-title">Task title</label><input id="task-title" value={taskTitle} onChange={(e)=>setTaskTitle(e.target.value)} minLength={5} maxLength={120} placeholder="e.g. Help move a sofa" required/><label htmlFor="task-description">Description</label><textarea id="task-description" value={taskDescription} onChange={(e)=>setTaskDescription(e.target.value)} minLength={10} maxLength={3000} rows={4} placeholder="Describe the task and any important details" required/><div className="task-form-row"><div><label htmlFor="task-category">Category</label><select id="task-category" value={taskCategory} onChange={(e)=>setTaskCategory(e.target.value)}><option>General</option><option>Home help</option><option>Yard work</option><option>Moving</option><option>Cleaning</option><option>Pet care</option><option>Errands</option><option>Repairs</option><option>Tutoring</option></select></div><div><label htmlFor="task-budget">Budget (optional, USD)</label><input id="task-budget" type="number" min="0" step="0.01" value={taskBudget} onChange={(e)=>setTaskBudget(e.target.value)} placeholder="e.g. 25"/></div></div><label htmlFor="task-location">General location (optional)</label><input id="task-location" value={taskLocation} onChange={(e)=>setTaskLocation(e.target.value)} maxLength={160} placeholder="Neighborhood or town — avoid posting your home address"/><button className="button button-primary submit-button" disabled={savingTask}>{savingTask ? "Posting…" : "Publish task"} <span aria-hidden="true">→</span></button><p className="task-form-note">Only share a general location publicly. Coordinate private details directly and safely.</p></form>}{loadingJobs ? <p className="muted">Loading tasks…</p> : jobs.filter((job)=>{const q=jobSearch.trim().toLowerCase();const text=[job.title,job.description,job.category,job.location].filter(Boolean).join(" ").toLowerCase();const location=jobLocationFilter.trim().toLowerCase();const min=minBudgetFilter===""?null:Number(minBudgetFilter);const max=maxBudgetFilter===""?null:Number(maxBudgetFilter);return (!q||text.includes(q))&&(jobCategoryFilter==="All"||job.category===jobCategoryFilter)&&(!location||(job.location||"").toLowerCase().includes(location))&&(min===null||(job.budget!==null&&job.budget!==undefined&&Number(job.budget)>=min))&&(max===null||(job.budget!==null&&job.budget!==undefined&&Number(job.budget)<=max));}).length ? <div className="job-grid">{jobs.filter((job)=>{const q=jobSearch.trim().toLowerCase();const text=[job.title,job.description,job.category,job.location].filter(Boolean).join(" ").toLowerCase();const location=jobLocationFilter.trim().toLowerCase();const min=minBudgetFilter===""?null:Number(minBudgetFilter);const max=maxBudgetFilter===""?null:Number(maxBudgetFilter);return (!q||text.includes(q))&&(jobCategoryFilter==="All"||job.category===jobCategoryFilter)&&(!location||(job.location||"").toLowerCase().includes(location))&&(min===null||(job.budget!==null&&job.budget!==undefined&&Number(job.budget)>=min))&&(max===null||(job.budget!==null&&job.budget!==undefined&&Number(job.budget)<=max));}).map((job) => <article className="job-card" key={job.id}><span className="category">{job.category || "Local task"}</span><h3>{job.title}</h3><p>{job.description}</p><div className="job-meta"><span>{job.location || "Location not specified"}</span><strong>{job.budget != null ? "$" + Number(job.budget).toFixed(0) : "Budget flexible"}</strong></div>{["provider","both"].includes(profile?.role) && <div className="apply-controls"><label htmlFor={"proposal-" + job.id}>Your cash proposal ($)</label><input id={"proposal-" + job.id} type="number" min="0" step="0.01" value={proposalAmounts[job.id] ?? ""} onChange={(e) => setProposalAmounts((current) => ({ ...current, [job.id]: e.target.value }))} placeholder="Enter amount" disabled={appliedJobIds.includes(job.id) || applyingJobId === job.id}/><button className="button button-outline small apply-button" disabled={appliedJobIds.includes(job.id) || applyingJobId === job.id} onClick={() => applyToJob(job.id)}>{appliedJobIds.includes(job.id) ? "Applied" : applyingJobId === job.id ? "Sending…" : "Send cash proposal"}</button></div>}</article>)}</div> : <div className="empty-state"><div className="empty-icon">⌂</div><h3>{jobs.length ? "No tasks match those filters" : "No open tasks yet"}</h3><p>{jobs.length ? "Try another keyword or clear the filters." : "When neighbors post tasks, they will show up here."}</p></div>}</section><footer className="footer">Built for neighbors, powered by community.</footer></main>;

  return <main className="page auth-page"><div className="auth-left"><header className="brand"><div className="brand-mark">H</div><span>handy<span className="brand-light">neighbor</span></span></header><div className="hero-copy"><p className="eyebrow">LOCAL HELP. FRIENDLY NEIGHBORS.</p><h1>Hand Jobs<br/><em>for Every Task!</em></h1><p>Find local help for home repairs, yard work, cleaning, moving, and everyday tasks—or offer your skills to neighbors nearby.</p><div className="hero-points"><div><span className="point-icon">✓</span><span>Local tasks, real people</span></div><div><span className="point-icon">✓</span><span>A simple way to lend a hand</span></div><div><span className="point-icon">✓</span><span>Built around your community</span></div></div></div><div className="left-foot">Hand Jobs for Every Task!</div></div><section className="auth-right"><div className="auth-card"><div className="mobile-brand brand"><div className="brand-mark">H</div><span>handy<span className="brand-light">neighbor</span></span></div><div className="switcher" role="tablist" aria-label="Account access"><button className={mode === "signup" ? "active" : ""} onClick={() => {setMode("signup");setError("");setNotice("");}} role="tab" aria-selected={mode === "signup"}>Create account</button><button className={mode === "login" ? "active" : ""} onClick={() => {setMode("login");setError("");setNotice("");}} role="tab" aria-selected={mode === "login"}>Sign in</button></div><p className="eyebrow">{mode === "signup" ? "GET STARTED" : "WELCOME BACK"}</p><h2>{mode === "signup" ? "Join your neighborhood." : "Good to see you again."}</h2><p className="muted">{mode === "signup" ? "Create an account to get started." : "Sign in to continue to your account."}</p>{notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error" role="alert">{error}</div>}<form onSubmit={submit} className="auth-form">{mode === "signup" && <><label htmlFor="name">Your name</label><input id="name" autoComplete="name" value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Taylor Morgan" required/><label>How will you use HandyNeighbor?</label><div className="role-options">{roles.map((item)=><button type="button" key={item.value} className={"role-option " + (role===item.value ? "selected" : "")} onClick={()=>setRole(item.value)}><span className="radio-dot"/><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</div></>}<label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" required/><div className="password-label"><label htmlFor="password">Password</label>{mode === "signup" && <span>At least 8 characters</span>}</div><input id="password" type="password" autoComplete={mode==="signup"?"new-password":"current-password"} minLength={mode==="signup"?8:undefined} value={password} onChange={(e)=>setPassword(e.target.value)} placeholder={mode==="signup"?"Create a strong password":"Enter your password"} required/>{mode === "login" && <button type="button" className="forgot-password" onClick={sendPasswordReset} disabled={resetBusy}>{resetBusy ? "Sending reset link…" : "Forgot password?"}</button>}<button className="button button-primary submit-button" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create my account" : "Sign in"} <span aria-hidden="true">→</span></button></form><p className="legal">By continuing, you agree to use HandyNeighbor respectfully and keep your account details secure.</p><p className="switch-copy">{mode==="signup"?"Already have an account?":"New to HandyNeighbor?"} <button onClick={()=>{setMode(mode==="signup"?"login":"signup");setError("");setNotice("");}}>{mode==="signup"?"Sign in":"Create an account"}</button></p></div></section></main>;
}
