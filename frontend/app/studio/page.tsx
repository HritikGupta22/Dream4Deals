"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch, apiPost, apiDelete, apiPatch, money } from "@/lib/api";
import type { Automation, Mapping, Event, Product, Dashboard, Offer, Platform, Analytics } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function Msg({ msg, error }: { msg: string; error?: boolean }) {
  if (!msg) return null;
  return <p className={`text-[12px] mt-1 ${error ? "text-red-500" : "text-[#716966]"}`}>{msg}</p>;
}

export default function StudioPage() {
  const [token, setToken]         = useState("");
  const [user, setUser]           = useState<{ name: string; handle: string } | null>(null);
  const [tab, setTab]             = useState<"register" | "login" | "reset">("register");
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [events, setEvents]       = useState<Event[]>([]);
  const [editingProduct, setEditingProduct] = useState<(Product & { slug: string }) | null>(null);
  const [dash, setDash]           = useState<Dashboard | null>(null);
  const [editingReel, setEditingReel] = useState<Mapping | null>(null);
  const [offerProduct, setOfferProduct] = useState<Product & { slug: string } | null>(null);
  const [platforms, setPlatforms]  = useState<Platform[]>([]);
  const [analytics, setAnalytics]  = useState<Analytics | null>(null);
  const [activity, setActivity]   = useState<any[]>([]);
  const [reelAutomation, setReelAutomation] = useState<{ [key: string]: any }>({});
  const [editingReelAuto, setEditingReelAuto] = useState<string | null>(null);
  const [reelMsg,    setReelMsg]    = useState("");
  const [editReelMsg, setEditReelMsg] = useState("");
  const [authMsg,    setAuthMsg]    = useState("");
  const [productMsg, setProductMsg] = useState("");
  const [editMsg,    setEditMsg]    = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [saveMsg,    setSaveMsg]    = useState("");
  const [testMsg,    setTestMsg]    = useState("");
  const [autoMsg,    setAutoMsg]    = useState("");

  const loadAutomation = useCallback(async () => {
    const data = await apiFetch<Automation>(`${API}/api/automation`);
    setAutomation(data);
  }, []);

  const loadEvents = useCallback(async () => {
    const data = await apiFetch<Event[]>(`${API}/api/events`);
    setEvents(data);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("dream4deals_token") ?? "";
    setToken(saved);
    loadAutomation();
    loadEvents();
    const iv = setInterval(loadEvents, 8000);
    return () => clearInterval(iv);
  }, [loadAutomation, loadEvents]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ user?: { name: string; handle: string } }>(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => { if (r.user) setUser(r.user); });
    apiFetch<Dashboard>(`${API}/api/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then(setDash);
    apiFetch<Platform[]>(`${API}/api/platforms`).then(setPlatforms);
    apiFetch<Analytics>(`${API}/api/analytics`, { headers: { Authorization: `Bearer ${token}` } })
      .then(setAnalytics);
    apiFetch<any[]>(`${API}/api/activity`, { headers: { Authorization: `Bearer ${token}` } })
      .then(setActivity);
  }, [token]);

  function val(form: HTMLFormElement, name: string) {
    return (form.elements.namedItem(name) as HTMLInputElement).value;
  }

  async function uploadFile(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    return data.url ?? "";
  }

  async function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ token?: string; user?: { name: string; handle: string }; error?: string }>(
      `${API}/api/auth/register`,
      { name: val(f, "rname"), handle: val(f, "handle"), email: val(f, "email"), password: val(f, "password") }
    );
    if (res.error) { setAuthMsg(res.error); return; }
    localStorage.setItem("dream4deals_token", res.token!);
    setToken(res.token!); setUser(res.user!); setAuthMsg("");
  }

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ token?: string; user?: { name: string; handle: string }; error?: string }>(
      `${API}/api/auth/login`,
      { email: val(f, "email"), password: val(f, "password") }
    );
    if (res.error) { setAuthMsg(res.error); return; }
    localStorage.setItem("dream4deals_token", res.token!);
    setToken(res.token!); setUser(res.user!); setAuthMsg("");
  }

  async function requestPasswordReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ token?: string; message?: string; error?: string }>(
      `${API}/api/auth/password-reset-request`,
      { email: val(f, "resetEmail") }
    );
    if (res.error) { setAuthMsg(res.error); return; }
    setAuthMsg("✓ Reset email sent. Check your inbox for the reset link.");
    f.reset();
  }

  async function resetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ message?: string; error?: string }>(
      `${API}/api/auth/password-reset`,
      { token: val(f, "resetToken"), password: val(f, "newPassword") }
    );
    if (res.error) { setAuthMsg(res.error); return; }
    setAuthMsg("✓ Password reset successfully. You can now sign in with your new password.");
    setTab("login");
    f.reset();
  }

  function logout() {
    localStorage.removeItem("dream4deals_token");
    setToken(""); setUser(null);
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ name?: string; error?: string }>(
      `${API}/api/creator/profile`,
      { name: val(f, "pname"), handle: val(f, "handle"), bio: val(f, "bio") }, token
    );
    if (res.error) { setProfileMsg(res.error); return; }
    setUser((u) => u ? { ...u, name: res.name! } : u);
    setProfileMsg("Profile saved.");
  }

  async function createReel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) { setReelMsg("Sign in first."); return; }
    const f = e.currentTarget;
    let posterUrl = val(f, "poster");
    const fileInput = f.elements.namedItem("posterFile") as HTMLInputElement;
    if (fileInput?.files?.[0]) {
      setReelMsg("Uploading poster…");
      posterUrl = await uploadFile(fileInput.files[0]);
    }
    const res = await apiPost<{ url?: string; error?: string }>(
      `${API}/api/reels`,
      { instagramMediaId: val(f, "mediaId"), title: val(f, "title"), slug: val(f, "slug"), poster: posterUrl, caption: val(f, "caption") },
      token
    );
    if (res.error) { setReelMsg(res.error); return; }
    setReelMsg(`✓ Created: ${res.url}`);
    f.reset(); loadAutomation();
  }

  async function deleteReel(slug: string) {
    if (!confirm(`Delete reel "${slug}"?`)) return;
    await apiDelete(`${API}/api/reels/${slug}`, token);
    loadAutomation();
  }

  async function tagProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) { setProductMsg("Sign in first."); return; }
    const f = e.currentTarget;
    const slug = (f.querySelector("select") as HTMLSelectElement).value;
    if (!slug) { setProductMsg("Select a reel first."); return; }
    let imageUrl = val(f, "image");
    const fileInput = f.elements.namedItem("imageFile") as HTMLInputElement;
    if (fileInput?.files?.[0]) {
      setProductMsg("Uploading image…");
      imageUrl = await uploadFile(fileInput.files[0]);
    }
    const res = await apiPost<{ name?: string; error?: string }>(
      `${API}/api/reels/${slug}/products`,
      { name: val(f, "pname"), category: val(f, "category"), price: val(f, "price"), image: imageUrl },
      token
    );
    if (res.error) { setProductMsg(res.error); return; }
    setProductMsg(`✓ "${res.name}" tagged.`);
    f.reset();
  }

  async function saveEditProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingProduct) return;
    const f = e.currentTarget;
    let imageUrl = val(f, "image");
    const fileInput = f.elements.namedItem("imageFile") as HTMLInputElement;
    if (fileInput?.files?.[0]) {
      setEditMsg("Uploading image…");
      imageUrl = await uploadFile(fileInput.files[0]);
    }
    const res = await fetch(`${API}/api/reels/${editingProduct.slug}/products/${editingProduct.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: val(f, "pname"), category: val(f, "category"), price: val(f, "price"), image: imageUrl }),
    }).then((r) => r.json());
    if (res.error) { setEditMsg(res.error); return; }
    setEditMsg(`✓ "${res.name}" updated.`);
    setEditingProduct(null);
  }

  async function saveEditReel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingReel) return;
    const f = e.currentTarget;
    let posterUrl = val(f, "poster");
    const fileInput = f.elements.namedItem("posterFile") as HTMLInputElement;
    if (fileInput?.files?.[0]) {
      setEditReelMsg("Uploading…");
      posterUrl = await uploadFile(fileInput.files[0]);
    }
    const res = await apiPatch<{ error?: string }>(
      `${API}/api/reels/${editingReel.slug}`,
      { title: val(f, "title"), caption: val(f, "caption"), poster: posterUrl },
      token
    );
    if (res.error) { setEditReelMsg(res.error); return; }
    setEditReelMsg("✓ Reel updated.");
    setEditingReel(null);
    loadAutomation();
  }

  async function runWebhookTest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    setTestMsg("Simulating…");
    const res = await apiPost<{ simulated?: boolean; error?: string }>(`${API}/api/webhooks/test`, {
      kind:     (f.elements.namedItem("testKind") as HTMLSelectElement).value,
      text:     (f.elements.namedItem("testText") as HTMLInputElement).value,
      mediaId:  (f.elements.namedItem("testMediaId") as HTMLInputElement).value,
      username: (f.elements.namedItem("testUsername") as HTMLInputElement).value,
    });
    if (res.error) { setTestMsg(`Error: ${res.error}`); return; }
    setTestMsg("✓ Simulated — check event log below.");
    setTimeout(loadEvents, 500);
  }

  async function saveAutomation() {
    setSaveMsg("Saving…");
    const gi = (id: string) => (document.getElementById(id) as HTMLInputElement);
    const ga = (id: string) => (document.getElementById(id) as HTMLTextAreaElement);
    const saved = await apiPost<Automation>(`${API}/api/automation`, {
      enabled: gi("auto-enabled").checked,
      replyComments: gi("auto-comments").checked,
      replyDms: gi("auto-dms").checked,
      triggers: gi("auto-triggers").value.split(","),
      replyTemplate: ga("auto-template").value,
    });
    setAutomation(saved); setSaveMsg("Saved.");
  }

  async function loadReelAutomation(slug: string) {
    const rule = await apiFetch<any>(`${API}/api/reels/${encodeURIComponent(slug)}/automation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setReelAutomation((prev) => ({ ...prev, [slug]: rule }));
    return rule;
  }

  async function saveReelAutomation(slug: string, e?: React.FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    setAutoMsg("Saving…");
    const rule = reelAutomation[slug] || {};
    const saved = await apiPost<any>(`${API}/api/reels/${encodeURIComponent(slug)}/automation`, {
      enabled: rule.enabled ?? true,
      replyComments: rule.replyComments ?? true,
      replyDms: rule.replyDms ?? true,
      triggers: typeof rule.triggers === 'string' ? rule.triggers.split(",").map((t: string) => t.trim()).filter(Boolean) : rule.triggers || [],
      replyTemplate: rule.replyTemplate || '',
    }, token);
    if (saved.error) { setAutoMsg(saved.error); return; }
    setReelAutomation((prev) => ({ ...prev, [slug]: saved }));
    setAutoMsg("✓ Saved.");
  }

  async function deleteReelAutomation(slug: string) {
    if (!confirm("Delete this per-reel automation rule?")) return;
    await apiDelete(`${API}/api/reels/${encodeURIComponent(slug)}/automation`, token);
    setReelAutomation((prev) => {
      const newRules = { ...prev };
      delete newRules[slug];
      return newRules;
    });
    setAutoMsg("✓ Deleted.");
  }

  function exportCsv() {
    if (!analytics) return;
    const rows = [
      ["type", "label", "clicks"],
      ...analytics.byReel.map((r) => ["reel", r.label, r.clicks]),
      ...analytics.byPlatform.map((r) => ["platform", r.label, r.clicks]),
      ...analytics.byProduct.map((r) => ["product", r.label, r.clicks]),
      ...analytics.daily.map((r) => ["daily", r.day, r.clicks]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "dream4deals-analytics.csv";
    a.click();
  }

  const inp = "font-[inherit] p-2 border border-[#d8c5bf] bg-white text-[14px] w-full";
  const frm = "grid gap-2 mt-6 pt-5 border-t border-[#6a5858]";
  const btn = "bg-[#e96050] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer justify-self-start";

  return (
    <main className="bg-[#291f20] text-white px-[8vw] py-[80px] grid md:grid-cols-[1.1fr_0.9fr] gap-[80px]">
      {/* ── Summary cards (signed in only) ── */}
      {user && dash && (
        <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { label: "Reels",       value: dash.totalReels },
            { label: "Total clicks", value: dash.totalClicks },
            { label: "Top platform", value: dash.topPlatform ?? "—" },
            { label: "Est. revenue", value: typeof dash.estRevenue === "number" ? money(dash.estRevenue) : "—" },
          ] as { label: string; value: string | number }[]).map(({ label, value }) => (
            <div key={label} className="bg-[#fffaf7] text-[#241d1d] p-4">
              <p className="text-[10px] font-bold tracking-[1.5px] text-[#716966] mb-1">{label.toUpperCase()}</p>
              <p className="text-[28px] font-serif leading-none">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Analytics Panel ── */}
      {user && analytics && (
        <div className="md:col-span-2 mt-8 pt-6 border-t border-[#6a5858]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-[20px] font-serif m-0">📊 Click Analytics</h3>
              <p className="text-[11px] text-[#d8c9c5] mt-1">Last 14 days</p>
            </div>
            <button onClick={exportCsv} className="bg-[#e96050] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">
              Download CSV
            </button>
          </div>

          {/* Daily chart */}
          {analytics.daily.length > 0 && (
            <div className="mb-6 p-4 bg-[#3a2e2e] rounded">
              <p className="text-[12px] text-[#d8c9c5] mb-3">Daily clicks</p>
              <div className="flex items-end gap-1 h-[120px] mb-2">
                {analytics.daily.map((d, i) => {
                  const max = Math.max(...analytics.daily.map(x => x.clicks), 1);
                  const height = ((d.clicks / max) * 100);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div className="w-full bg-[#e96050] rounded-t" style={{ height: `${height}%`, minHeight: d.clicks > 0 ? "4px" : "0" }} />
                      <span className="text-[9px] text-[#716966] mt-1">{d.clicks > 0 ? d.clicks : ""}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-[#716966] text-center">{analytics.daily.length} days</p>
            </div>
          )}

          {/* Clicks by reel */}
          {analytics.byReel.length > 0 && (
            <div className="mb-4 p-4 bg-[#3a2e2e] rounded">
              <p className="text-[12px] font-bold text-[#d8c9c5] mb-2">Clicks by reel (top 5)</p>
              {analytics.byReel.map((r, i) => (
                <div key={i} className="flex justify-between items-center text-[12px] text-[#d8c9c5] py-1 border-b border-[#4a3e3e] last:border-0">
                  <span>{r.label || "unknown"}</span>
                  <span className="text-[#e96050] font-bold">{r.clicks}</span>
                </div>
              ))}
            </div>
          )}

          {/* Clicks by platform */}
          {analytics.byPlatform.length > 0 && (
            <div className="mb-4 p-4 bg-[#3a2e2e] rounded">
              <p className="text-[12px] font-bold text-[#d8c9c5] mb-2">Clicks by platform (top 5)</p>
              {analytics.byPlatform.map((p, i) => (
                <div key={i} className="flex justify-between items-center text-[12px] text-[#d8c9c5] py-1 border-b border-[#4a3e3e] last:border-0">
                  <span>{p.label}</span>
                  <span className="text-[#e96050] font-bold">{p.clicks}</span>
                </div>
              ))}
            </div>
          )}

          {/* Clicks by product */}
          {analytics.byProduct.length > 0 && (
            <div className="mb-4 p-4 bg-[#3a2e2e] rounded">
              <p className="text-[12px] font-bold text-[#d8c9c5] mb-2">Clicks by product (top 5)</p>
              {analytics.byProduct.map((p, i) => (
                <div key={i} className="flex justify-between items-center text-[12px] text-[#d8c9c5] py-1 border-b border-[#4a3e3e] last:border-0">
                  <span>{p.label}</span>
                  <span className="text-[#e96050] font-bold">{p.clicks}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Left column ── */}
      <div>
        <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">CREATOR STUDIO</p>
        <h2 className="font-serif text-[40px] leading-[1.15] tracking-[-1.5px] m-0">
          Automatic reel links in comments and DMs.
        </h2>
        <p className="text-[#d8c9c5] leading-[1.7] text-[14px] mt-4">
          Map each Instagram reel ID to a shopping page. Comments with your trigger word get a public reply + a DM with the link.
        </p>

        {/* Reel mappings */}
        {automation?.mappings?.length ? (
          <div className="mt-7 space-y-2">
            {automation.mappings.map((m: Mapping) => (
              <div key={m.slug} className="flex gap-2 flex-wrap text-[12px] text-[#d8c9c5] items-center">
                <span>IG {m.instagramMediaId}</span><span>→</span>
                <a href={m.url} className="text-white underline">{m.url}</a>
                <button onClick={() => { setEditingReel(m); setEditReelMsg(""); }}
                  className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0">✏️</button>
                <button onClick={() => deleteReel(m.slug)} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0">🗑</button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Edit reel */}
        {editingReel && (
          <form onSubmit={saveEditReel} className={frm}>
            <h3 className="m-0 text-[16px]">Edit reel — <span className="text-[#e96050]">{editingReel.slug}</span></h3>
            <input name="title" defaultValue={editingReel.title} placeholder="Title" required className={inp} />
            <textarea name="caption" rows={2} placeholder="Caption" className={inp} />
            <label className="text-[12px] text-[#d8c9c5]">
              New poster — upload file
              <input name="posterFile" type="file" accept="image/*" className="block mt-1 text-[12px] text-[#d8c9c5]" />
            </label>
            <input name="poster" placeholder="…or paste poster URL" className={inp} />
            <div className="flex gap-2">
              <button type="submit" className={btn}>Save reel</button>
              <button type="button" onClick={() => setEditingReel(null)} className="bg-[#716966] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">Cancel</button>
            </div>
            <Msg msg={editReelMsg} error={editReelMsg.includes("not found")} />
          </form>
        )}

        {/* Auth */}
        {!user ? (
          <>
            <div className="flex gap-2 mt-6 pt-5 border-t border-[#6a5858]">
              {(["register", "login", "reset"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`border px-4 py-1.5 text-[12px] cursor-pointer font-[inherit] ${tab === t ? "bg-[#e96050] border-[#e96050] text-white" : "bg-transparent border-[#6a5858] text-[#d8c9c5]"}`}>
                  {t === "register" ? "New account" : t === "login" ? "Sign in" : "Reset password"}
                </button>
              ))}
            </div>
            {tab === "register" && (
              <form onSubmit={register} className={frm}>
                <h3 className="m-0 text-[16px]">Create creator account</h3>
                <input name="rname" placeholder="Your name" required className={inp} />
                <input name="handle" placeholder="@instagramhandle" required className={inp} />
                <input name="email" type="email" placeholder="Email" required className={inp} />
                <input name="password" type="password" minLength={8} placeholder="Password (8+ chars)" required className={inp} />
                <button type="submit" className={btn}>Create account</button>
                <Msg msg={authMsg} error />
              </form>
            )}
            {tab === "login" && (
              <form onSubmit={login} className={frm}>
                <h3 className="m-0 text-[16px]">Sign in</h3>
                <input name="email" type="email" placeholder="Email" required className={inp} />
                <input name="password" type="password" placeholder="Password" required className={inp} />
                <button type="submit" className={btn}>Sign in</button>
                <Msg msg={authMsg} error />
              </form>
            )}
            {tab === "reset" && (
              <form onSubmit={requestPasswordReset} className={frm}>
                <h3 className="m-0 text-[16px]">Reset password</h3>
                <input name="resetEmail" type="email" placeholder="Email" required className={inp} />
                <button type="submit" className={btn}>Send reset link</button>
                <Msg msg={authMsg} />
                <div className="mt-3 text-[12px] text-[#d8c9c5]">
                  <p className="m-0 mb-2">Already have a reset token?</p>
                  <input name="resetToken" placeholder="Paste your reset token" className={inp} />
                  <input name="newPassword" type="password" minLength={8} placeholder="New password (8+ chars)" className={inp} />
                  <button type="button" onClick={(e) => resetPassword(e as any)} className={btn}>Set new password</button>
                </div>
              </form>
            )}
          </>
        ) : (
          <form onSubmit={saveProfile} className={frm}>
            <h3 className="m-0 text-[16px]">Edit profile <span className="text-[#716966] font-normal">({user.name})</span></h3>
            <input name="pname" defaultValue={user.name} placeholder="Your name" required className={inp} />
            <input name="handle" defaultValue={user.handle} placeholder="@instagramhandle" required className={inp} />
            <textarea name="bio" rows={2} placeholder="Bio" className={inp} />
            <div className="flex gap-2">
              <button type="submit" className={btn}>Save profile</button>
              <button type="button" onClick={logout} className="bg-[#716966] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">Sign out</button>
            </div>
            <Msg msg={profileMsg} />
          </form>
        )}

        {/* Add reel */}
        <form onSubmit={createReel} className={frm}>
          <h3 className="m-0 text-[16px]">Add a reel</h3>
          <input name="mediaId" placeholder="Instagram Reel media ID" required className={inp} />
          <input name="title" placeholder="Reel title" required className={inp} />
          <input name="slug" placeholder="URL slug, e.g. summer-dress" required className={inp} />
          <label className="text-[12px] text-[#d8c9c5]">
            Poster image — upload file
            <input name="posterFile" type="file" accept="image/*" className="block mt-1 text-[12px] text-[#d8c9c5]" />
          </label>
          <input name="poster" placeholder="…or paste image URL" className={inp} />
          <textarea name="caption" rows={2} placeholder="Caption (optional)" className={inp} />
          <button type="submit" className={btn}>Create reel URL</button>
          <Msg msg={reelMsg} error={reelMsg.startsWith("Sign")} />
        </form>

        {/* Tag product */}
        <form onSubmit={tagProduct} className={frm}>
          <h3 className="m-0 text-[16px]">Tag a product</h3>
          <select required className={inp}>
            <option value="">— select reel —</option>
            {automation?.mappings?.map((m: Mapping) => (
              <option key={m.slug} value={m.slug}>{m.title || m.slug}</option>
            ))}
          </select>
          <input name="pname" placeholder="Product name" required className={inp} />
          <input name="category" placeholder="Category, e.g. Dresses" required className={inp} />
          <input name="price" type="number" min={1} placeholder="Price (₹)" required className={inp} />
          <label className="text-[12px] text-[#d8c9c5]">
            Product image — upload file
            <input name="imageFile" type="file" accept="image/*" className="block mt-1 text-[12px] text-[#d8c9c5]" />
          </label>
          <input name="image" placeholder="…or paste image URL" className={inp} />
          <button type="submit" className={btn}>Tag product</button>
          <Msg msg={productMsg} error={productMsg.startsWith("Sign") || productMsg.startsWith("Select")} />
        </form>

        {/* Edit product */}
        {editingProduct && (
          <form onSubmit={saveEditProduct} className={frm}>
            <h3 className="m-0 text-[16px]">Edit product — <span className="text-[#e96050]">{editingProduct.name}</span></h3>
            <input name="pname" defaultValue={editingProduct.name} placeholder="Product name" required className={inp} />
            <input name="category" defaultValue={editingProduct.category} placeholder="Category" required className={inp} />
            <input name="price" type="number" min={1} defaultValue={editingProduct.price} placeholder="Price (₹)" required className={inp} />
            <label className="text-[12px] text-[#d8c9c5]">
              New image — upload file
              <input name="imageFile" type="file" accept="image/*" className="block mt-1 text-[12px] text-[#d8c9c5]" />
            </label>
            <input name="image" defaultValue={editingProduct.image} placeholder="…or paste image URL" className={inp} />
            <div className="flex gap-2">
              <button type="submit" className={btn}>Save changes</button>
              <button type="button" onClick={() => setEditingProduct(null)} className="bg-[#716966] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">Cancel</button>
            </div>
            <Msg msg={editMsg} error={editMsg.includes("error") || editMsg.includes("not found")} />
          </form>
        )}

        {/* Activity Feed */}
        {activity.length > 0 && (
          <div className="mt-7 pt-5 border-t border-[#6a5858]">
            <h3 className="font-serif text-[18px] mb-3">📊 Recent Activity</h3>
            <div className="max-h-[300px] overflow-auto bg-[#3a2e2e] p-3 rounded">
              {activity.map((item, i) => (
                <div key={i} className="border-b border-[#4a3e3e] py-2 last:border-0">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1">
                      <b className="text-[12px] text-[#e96050]">{item.type === 'click' ? '🛍️ Click' : '📩 Event'}</b>
                      <p className="text-[12px] text-[#d8c9c5] mt-0.5">{item.label}</p>
                    </div>
                    <small className="text-[10px] text-[#716966] shrink-0">
                      {item.at ? new Date(item.at).toLocaleTimeString() : ''}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Webhook test simulator */}
        <div className="mt-7 pt-5 border-t border-[#6a5858]">
          <h3 className="font-serif text-[18px] mb-1">🧪 Test webhook locally</h3>
          <p className="text-[11px] text-[#d8c9c5] mb-3">Simulate a comment or DM without a real Meta app. Checks trigger matching, idempotency, and logs the result.</p>
          <form onSubmit={runWebhookTest} className="grid gap-2">
            <select name="testKind" className={inp}>
              <option value="comment">Comment</option>
              <option value="dm">DM</option>
            </select>
            <input name="testText" defaultValue="link" placeholder="Message text (e.g. link)" className={inp} />
            <input name="testMediaId" defaultValue="178923456" placeholder="Instagram media ID" className={inp} />
            <input name="testUsername" defaultValue="testuser" placeholder="Username" className={inp} />
            <button type="submit" className={btn}>Run simulation</button>
            <Msg msg={testMsg} error={testMsg.startsWith("Error")} />
          </form>
        </div>

        {/* Products list per reel (for edit/delete/offers) */}
        {automation?.mappings?.length && token ? (
          <div className={frm}>
            <h3 className="m-0 text-[16px]">Manage products &amp; offers</h3>
            {automation.mappings.map((m: Mapping) => (
              <ReelProducts key={m.slug} mapping={m} token={token}
                onEdit={setEditingProduct}
                onOffers={(p) => setOfferProduct({ ...p, slug: m.slug })}
                onAutomation={(slug) => { setEditingReelAuto(slug); loadReelAutomation(slug); setAutoMsg(""); }}
                API={API} />
            ))}
          </div>
        ) : null}

        {/* Offer manager */}
        {offerProduct && (
          <OfferManager
            product={offerProduct}
            platforms={platforms}
            token={token}
            API={API}
            onClose={() => setOfferProduct(null)}
          />
        )}

        {/* Per-reel automation editor */}
        {editingReelAuto && (
          <ReelAutomationEditor
            slug={editingReelAuto}
            rule={reelAutomation[editingReelAuto] || {}}
            token={token}
            API={API}
            onSave={saveReelAutomation}
            onDelete={deleteReelAutomation}
            onClose={() => setEditingReelAuto(null)}
            msg={autoMsg}
          />
        )}
      </div>

      {/* ── Right column — automation ── */}
      <div className="bg-[#fffaf7] text-[#241d1d] p-6 self-start">
        <small className="text-[11px] font-bold tracking-[1.5px]">INSTAGRAM AUTOMATION</small>
        <h3 className="font-serif text-[22px] mt-2 mb-4">Auto link reply</h3>
        <p className="text-[12px] leading-relaxed mb-3">
          {automation?.metaConfigured
            ? <><strong className="text-[#2f7d4a]">● Meta connected</strong><br />Live replies active.</>
            : <><strong className="text-[#b36b28]">● Setup required</strong><br />Add Meta credentials in <code className="bg-[#f4e8e3] px-1">backend/.env</code>.</>}
        </p>
        <p className="text-[11px] bg-[#fff0eb] p-2 mb-3 leading-relaxed">
          💡 When someone comments a trigger word:<br />
          1. Public reply: &ldquo;Link has been sent to your DM! 📩&rdquo;<br />
          2. DM: the actual reel shopping link
        </p>
        {[
          { id: "auto-enabled",  label: "Auto reply on",        key: "enabled" },
          { id: "auto-comments", label: "Reply to comments",    key: "replyComments" },
          { id: "auto-dms",      label: "Reply to DMs",         key: "replyDms" },
        ].map(({ id, label, key }) => (
          <label key={id} className="flex items-center gap-2 text-[12px] my-2 cursor-pointer">
            <input id={id} type="checkbox" defaultChecked={automation?.[key as keyof Automation] as boolean} />
            {label}
          </label>
        ))}
        <label className="block text-[12px] mt-3">
          Trigger words (comma separated)
          <input id="auto-triggers" defaultValue={automation?.triggers?.join(", ")} className="block w-full mt-1 p-2 border border-[#ebdfda] text-[13px]" />
        </label>
        <label className="block text-[12px] mt-3">
          DM reply template
          <textarea id="auto-template" rows={3} defaultValue={automation?.replyTemplate} className="block w-full mt-1 p-2 border border-[#ebdfda] text-[13px]" />
        </label>
        <p className="text-[11px] text-[#716966]">Placeholders: {"{{url}} {{title}} {{name}}"}</p>
        <button onClick={saveAutomation} className="bg-[#241d1d] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer mt-2">
          Save automation
        </button>
        <Msg msg={saveMsg} />

        <h3 className="font-serif text-[18px] mt-7 mb-3">Event log</h3>
        <div className="max-h-[280px] overflow-auto bg-[#f4e8e3] p-3">
          {events.length === 0
            ? <p className="text-[12px] text-[#716966]">No events yet.</p>
            : events.map((e, i) => (
              <div key={i} className="border-b border-[#ebdfda] py-2">
                <div className="flex justify-between items-start gap-2">
                  <b className="block text-[12px]">{e.type}</b>
                  {"at" in e && <small className="text-[10px] text-[#716966] shrink-0">{new Date((e as {at: string}).at).toLocaleTimeString()}</small>}
                </div>
                <small className="block text-[11px] text-[#716966] mt-0.5">{e.detail}</small>
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}

// Sub-component: loads and lists products for a reel with edit/delete/offers buttons
function ReelProducts({
  mapping, token, onEdit, onOffers, API, onAutomation,
}: {
  mapping: Mapping;
  token: string;
  onEdit: (p: Product & { slug: string }) => void;
  onOffers: (p: Product) => void;
  API: string;
  onAutomation?: (slug: string) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    apiFetch<{ products?: Product[] }>(`${API}/api/reels/${mapping.slug}`)
      .then((r) => setProducts(r.products ?? []));
  }, [mapping.slug, API]);

  async function remove(id: string) {
    if (!confirm("Delete this product?")) return;
    await fetch(`${API}/api/reels/${mapping.slug}/products/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  if (!products.length) return null;

  return (
    <div className="mt-3">
      <div className="flex justify-between items-center mb-1">
        <p className="text-[11px] text-[#d8c9c5] m-0">{mapping.title || mapping.slug}</p>
        {onAutomation && (
          <button onClick={() => onAutomation(mapping.slug)} className="text-[11px] text-[#e96050] hover:underline bg-transparent border-0 cursor-pointer p-0">
            automation ⚙️
          </button>
        )}
      </div>
      {products.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-[12px] text-[#d8c9c5] py-1 border-b border-[#3a2e2e]">
          <span className="flex-1">{p.name}</span>
          <button onClick={() => onOffers(p)}
            className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0 text-[11px]">offers</button>
          <button onClick={() => onEdit({ ...p, slug: mapping.slug })}
            className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0 text-[13px]">✏️</button>
          <button onClick={() => remove(p.id)}
            className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0 text-[13px]">🗑</button>
        </div>
      ))}
    </div>
  );
}

// Sub-component: manage offers for a product
function OfferManager({
  product, platforms, token, API, onClose,
}: {
  product: Product & { slug: string };
  platforms: Platform[];
  token: string;
  API: string;
  onClose: () => void;
}) {
  const [offers, setOffers]   = useState<Offer[]>([]);
  const [msg, setMsg]         = useState("");
  const [editing, setEditing] = useState<Offer | null>(null);

  const inp = "font-[inherit] p-2 border border-[#d8c5bf] bg-white text-[14px] w-full";
  const btn = "bg-[#e96050] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer justify-self-start";

  const load = useCallback(() => {
    apiFetch<Offer[]>(`${API}/api/offers/product/${product.id}`).then(setOffers);
  }, [product.id, API]);

  useEffect(() => { load(); }, [load]);

  async function addOffer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const platformId = (f.elements.namedItem("platformId") as HTMLSelectElement).value;
    const res = await apiPost<{ error?: string }>(`${API}/api/offers/product/${product.id}`, {
      platformId: Number(platformId),
      seller:       (f.elements.namedItem("seller")   as HTMLInputElement).value,
      price:        Number((f.elements.namedItem("price") as HTMLInputElement).value),
      delivery:     (f.elements.namedItem("delivery") as HTMLInputElement).value,
      rating:       (f.elements.namedItem("rating")   as HTMLInputElement).value,
      affiliateUrl: (f.elements.namedItem("link")     as HTMLInputElement).value,
    }, token);
    if (res.error) { setMsg(res.error); return; }
    setMsg("✓ Offer added."); f.reset(); load();
  }

  async function saveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = e.currentTarget;
    const res = await apiPatch<{ error?: string }>(`${API}/api/offers/${editing.id}`, {
      seller:       (f.elements.namedItem("seller")   as HTMLInputElement).value,
      price:        Number((f.elements.namedItem("price") as HTMLInputElement).value),
      delivery:     (f.elements.namedItem("delivery") as HTMLInputElement).value,
      rating:       (f.elements.namedItem("rating")   as HTMLInputElement).value,
      affiliateUrl: (f.elements.namedItem("link")     as HTMLInputElement).value,
      available:    (f.elements.namedItem("available") as HTMLInputElement).checked,
    }, token);
    if (res.error) { setMsg(res.error); return; }
    setMsg("✓ Updated."); setEditing(null); load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this offer?")) return;
    await fetch(`${API}/api/offers/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    load();
  }

  return (
    <div className="mt-6 pt-5 border-t border-[#6a5858]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="m-0 text-[16px]">Offers — <span className="text-[#e96050]">{product.name}</span></h3>
        <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] text-[13px]">Close ×</button>
      </div>

      {/* Existing offers */}
      {offers.map((o) =>
        editing?.id === o.id ? (
          <form key={o.id} onSubmit={saveEdit} className="grid gap-2 mb-3 p-3 bg-[#3a2e2e]">
            <input name="seller"   defaultValue={o.seller}   placeholder="Seller"   required className={inp} />
            <input name="price"    defaultValue={o.price}    type="number" min={1}   required className={inp} />
            <input name="delivery" defaultValue={o.delivery} placeholder="Delivery"          className={inp} />
            <input name="rating"   defaultValue={o.rating}   placeholder="Rating"            className={inp} />
            <input name="link"     defaultValue={o.link}     placeholder="Affiliate URL"     className={inp} />
            <label className="flex items-center gap-2 text-[12px]">
              <input name="available" type="checkbox" defaultChecked={o.available} /> Available
            </label>
            <div className="flex gap-2">
              <button type="submit" className={btn}>Save</button>
              <button type="button" onClick={() => setEditing(null)} className="bg-[#716966] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">Cancel</button>
            </div>
          </form>
        ) : (
          <div key={o.id} className="flex items-center gap-2 text-[12px] text-[#d8c9c5] py-1 border-b border-[#3a2e2e]">
            <span className="w-20 shrink-0 text-[#e96050]">{o.platform}</span>
            <span className="flex-1">{o.seller}</span>
            <span>&#8377;{o.price}</span>
            <span className={o.available ? "text-green-400" : "text-red-400"}>{o.available ? "live" : "off"}</span>
            <button onClick={() => setEditing(o)} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0">✏️</button>
            <button onClick={() => remove(o.id)} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0">🗑</button>
          </div>
        )
      )}

      {/* Add offer form */}
      <form onSubmit={addOffer} className="grid gap-2 mt-4">
        <p className="text-[11px] text-[#d8c9c5] m-0">Add offer</p>
        <select name="platformId" required className={inp}>
          <option value="">— platform —</option>
          {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input name="seller"   placeholder="Seller name"   required className={inp} />
        <input name="price"    placeholder="Price (₹)" type="number" min={1} required className={inp} />
        <input name="delivery" placeholder="Delivery (e.g. Free, 2 days)"  className={inp} />
        <input name="rating"   placeholder="Rating (e.g. 4.2★)"            className={inp} />
        <input name="link"     placeholder="Affiliate URL"                  className={inp} />
        <button type="submit" className={btn}>Add offer</button>
        <Msg msg={msg} error={msg.includes("required") || msg.includes("not found")} />
      </form>
    </div>
  );
}

// Sub-component: per-reel automation rule editor
function ReelAutomationEditor({
  slug, rule, token, API, onSave, onDelete, onClose, msg,
}: {
  slug: string;
  rule: any;
  token: string;
  API: string;
  onSave: (slug: string, e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onDelete: (slug: string) => Promise<void>;
  onClose: () => void;
  msg: string;
}) {
  const inp = "font-[inherit] p-2 border border-[#d8c5bf] bg-white text-[14px] w-full";
  const btn = "bg-[#e96050] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer justify-self-start";

  return (
    <div className="mt-6 pt-5 border-t border-[#6a5858]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="m-0 text-[16px]">Automation rules — <span className="text-[#e96050]">{slug}</span></h3>
        <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] text-[13px]">Close ×</button>
      </div>

      <form onSubmit={(e) => onSave(slug, e)} className="grid gap-2">
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" defaultChecked={rule.enabled ?? true}
            onChange={(e) => rule.enabled = e.target.checked} />
          Enable automation for this reel
        </label>
        <label className="block text-[12px]">
          Trigger words (comma-separated)
          <input type="text" defaultValue={Array.isArray(rule.triggers) ? rule.triggers.join(", ") : ""} placeholder="e.g. link, shop, buy"
            onChange={(e) => rule.triggers = e.target.value}
            className={inp} />
        </label>
        <label className="block text-[12px]">
          DM reply template
          <textarea rows={3} defaultValue={rule.replyTemplate || ""}
            onChange={(e) => rule.replyTemplate = e.target.value}
            placeholder="Hey{{name}}! Here are the shopping links: {{url}} 🛍️"
            className={inp} />
        </label>
        <p className="text-[11px] text-[#716966] m-0">Placeholders: {"{{url}} {{title}} {{name}}"}</p>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" defaultChecked={rule.replyComments ?? true}
            onChange={(e) => rule.replyComments = e.target.checked} />
          Reply to comments
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" defaultChecked={rule.replyDms ?? true}
            onChange={(e) => rule.replyDms = e.target.checked} />
          Reply to DMs
        </label>
        <div className="flex gap-2">
          <button type="submit" className={btn}>Save rule</button>
          <button type="button" onClick={() => onDelete(slug)} className="bg-[#b36b28] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">Delete</button>
        </div>
        <p className={`text-[12px] mt-1 ${msg.includes("error") ? "text-red-500" : "text-[#716966]"}`}>{msg}</p>
      </form>
    </div>
  );
}
