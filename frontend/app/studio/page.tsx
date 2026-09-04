"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import type { Automation, Mapping, Event } from "@/lib/types";

const API = "http://localhost:3000";

function status(msg: string, isError = false) {
  return <p className={`text-[12px] mt-1 ${isError ? "text-red-600" : "text-[#716966]"}`}>{msg}</p>;
}

export default function StudioPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<{ name: string; handle: string } | null>(null);
  const [tab, setTab] = useState<"register" | "login">("register");
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [events, setEvents] = useState<Event[]>([]);

  // form states
  const [authStatus, setAuthStatus] = useState("");
  const [reelStatus, setReelStatus] = useState("");
  const [productStatus, setProductStatus] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

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
  }, [token]);

  function val(form: HTMLFormElement, name: string) {
    return (form.elements.namedItem(name) as HTMLInputElement).value;
  }

  async function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ token?: string; user?: { name: string; handle: string }; error?: string }>(
      `${API}/api/auth/register`,
      { name: val(f, "rname"), handle: val(f, "handle"), email: val(f, "email"), password: val(f, "password") }
    );
    if (res.error) { setAuthStatus(res.error); return; }
    localStorage.setItem("dream4deals_token", res.token!);
    setToken(res.token!);
    setUser(res.user!);
    setAuthStatus("");
  }

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ token?: string; user?: { name: string; handle: string }; error?: string }>(
      `${API}/api/auth/login`,
      { email: val(f, "email"), password: val(f, "password") }
    );
    if (res.error) { setAuthStatus(res.error); return; }
    localStorage.setItem("dream4deals_token", res.token!);
    setToken(res.token!);
    setUser(res.user!);
    setAuthStatus("");
  }

  function logout() {
    localStorage.removeItem("dream4deals_token");
    setToken("");
    setUser(null);
  }

  async function createReel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) { setReelStatus("Sign in first."); return; }
    const f = e.currentTarget;
    const res = await apiPost<{ url?: string; error?: string }>(
      `${API}/api/reels`,
      { instagramMediaId: val(f, "mediaId"), title: val(f, "title"), slug: val(f, "slug"), poster: val(f, "poster"), caption: val(f, "caption") },
      token
    );
    if (res.error) { setReelStatus(res.error); return; }
    setReelStatus(`✓ Created: ${res.url}`);
    f.reset();
    loadAutomation();
  }

  async function deleteReel(slug: string) {
    if (!confirm(`Delete reel "${slug}"?`)) return;
    await apiDelete(`${API}/api/reels/${slug}`, token);
    loadAutomation();
  }

  async function tagProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) { setProductStatus("Sign in first."); return; }
    const f = e.currentTarget;
    const slug = (f.querySelector("select") as HTMLSelectElement).value;
    if (!slug) { setProductStatus("Select a reel first."); return; }
    const res = await apiPost<{ name?: string; error?: string }>(
      `${API}/api/reels/${slug}/products`,
      { name: val(f, "pname"), category: val(f, "category"), price: val(f, "price"), image: val(f, "image") },
      token
    );
    if (res.error) { setProductStatus(res.error); return; }
    setProductStatus(`✓ "${res.name}" tagged.`);
    f.reset();
  }

  async function saveAutomation() {
    setSaveStatus("Saving…");
    const getInput = (id: string) => (document.getElementById(id) as HTMLInputElement);
    const getArea = (id: string) => (document.getElementById(id) as HTMLTextAreaElement);
    const saved = await apiPost<Automation>(`${API}/api/automation`, {
      enabled: getInput("auto-enabled").checked,
      replyComments: getInput("auto-comments").checked,
      replyDms: getInput("auto-dms").checked,
      triggers: getInput("auto-triggers").value.split(","),
      replyTemplate: getArea("auto-template").value,
    });
    setAutomation(saved);
    setSaveStatus("Saved.");
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const res = await apiPost<{ name?: string; error?: string }>(
      `${API}/api/creator/profile`,
      { name: val(f, "pname"), handle: val(f, "handle"), bio: val(f, "bio") },
      token
    );
    if (res.error) { setProfileStatus(res.error); return; }
    setUser((u) => u ? { ...u, name: res.name! } : u);
    setProfileStatus("Profile saved.");
  }

  const inputCls = "font-[inherit] p-2 border border-[#d8c5bf] bg-white text-[14px] w-full";
  const formCls = "grid gap-2 mt-6 pt-5 border-t border-[#6a5858]";
  const btnCls = "bg-[#e96050] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer justify-self-start";

  return (
    <main className="bg-[#291f20] text-white px-[12vw] py-[95px] grid md:grid-cols-[1.1fr_0.9fr] gap-[80px]">
      {/* Left column */}
      <div>
        <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">CREATOR STUDIO</p>
        <h2 className="font-serif text-[43px] leading-[1.15] tracking-[-1.5px] m-0">
          Automatic reel links in comments and DMs.
        </h2>
        <p className="text-[#d8c9c5] leading-[1.7] text-[14px] mt-4">
          Map each Instagram reel ID to a shopping page. Eligible comments and DMs that match your trigger words are answered through the official Meta API.
        </p>

        {/* Reel mappings list */}
        {automation?.mappings?.length ? (
          <div className="mt-7">
            {automation.mappings.map((m: Mapping) => (
              <div key={m.slug} className="flex gap-2 flex-wrap text-[12px] text-[#d8c9c5] my-2 items-center">
                <span>IG {m.instagramMediaId}</span>
                <span>→</span>
                <a href={m.url} className="text-white">{m.url}</a>
                <button onClick={() => deleteReel(m.slug)} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] text-[13px] p-0">🗑</button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Auth */}
        {!user ? (
          <>
            <div className="flex gap-2 mt-6 pt-5 border-t border-[#6a5858]">
              {(["register", "login"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`border px-4 py-1.5 text-[12px] cursor-pointer font-[inherit] ${tab === t ? "bg-[#e96050] border-[#e96050] text-white" : "bg-transparent border-[#6a5858] text-[#d8c9c5]"}`}
                >
                  {t === "register" ? "New account" : "Sign in"}
                </button>
              ))}
            </div>

            {tab === "register" && (
              <form onSubmit={register} className={formCls}>
                <h3 className="m-0 text-[16px]">Create creator account</h3>
                <input name="rname" placeholder="Your name" required className={inputCls} />
                <input name="handle" placeholder="@instagramhandle" required className={inputCls} />
                <input name="email" type="email" placeholder="Email" required className={inputCls} />
                <input name="password" type="password" minLength={8} placeholder="Password (8+ chars)" required className={inputCls} />
                <button type="submit" className={btnCls}>Create account</button>
                {authStatus && status(authStatus, true)}
              </form>
            )}

            {tab === "login" && (
              <form onSubmit={login} className={formCls}>
                <h3 className="m-0 text-[16px]">Sign in</h3>
                <input name="email" type="email" placeholder="Email" required className={inputCls} />
                <input name="password" type="password" placeholder="Password" required className={inputCls} />
                <button type="submit" className={btnCls}>Sign in</button>
                {authStatus && status(authStatus, true)}
              </form>
            )}
          </>
        ) : (
          <form onSubmit={saveProfile} className={formCls}>
            <h3 className="m-0 text-[16px]">Edit profile <span className="text-[#716966] font-normal">({user.name})</span></h3>
            <input name="pname" defaultValue={user.name} placeholder="Your name" required className={inputCls} />
            <input name="handle" defaultValue={user.handle} placeholder="@instagramhandle" required className={inputCls} />
            <textarea name="bio" rows={2} placeholder="Bio" className={inputCls} />
            <div className="flex gap-2">
              <button type="submit" className={btnCls}>Save profile</button>
              <button type="button" onClick={logout} className="bg-[#716966] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer">Sign out</button>
            </div>
            {profileStatus && status(profileStatus)}
          </form>
        )}

        {/* Add reel */}
        <form onSubmit={createReel} className={formCls}>
          <h3 className="m-0 text-[16px]">Add a reel</h3>
          <input name="mediaId" placeholder="Instagram Reel media ID" required className={inputCls} />
          <input name="title" placeholder="Reel title" required className={inputCls} />
          <input name="slug" placeholder="URL slug, e.g. summer-dress" required className={inputCls} />
          <input name="poster" placeholder="Poster image URL (optional)" className={inputCls} />
          <textarea name="caption" rows={2} placeholder="Caption (optional)" className={inputCls} />
          <button type="submit" className={btnCls}>Create reel URL</button>
          {reelStatus && status(reelStatus, reelStatus.startsWith("Sign") || reelStatus.includes("error"))}
        </form>

        {/* Tag product */}
        <form onSubmit={tagProduct} className={formCls}>
          <h3 className="m-0 text-[16px]">Tag a product</h3>
          <select required className={inputCls}>
            <option value="">— select reel —</option>
            {automation?.mappings?.map((m: Mapping) => (
              <option key={m.slug} value={m.slug}>{m.title || m.slug}</option>
            ))}
          </select>
          <input name="pname" placeholder="Product name" required className={inputCls} />
          <input name="category" placeholder="Category, e.g. Dresses" required className={inputCls} />
          <input name="price" type="number" min={1} placeholder="Price (₹)" required className={inputCls} />
          <input name="image" placeholder="Product image URL" required className={inputCls} />
          <button type="submit" className={btnCls}>Tag product</button>
          {productStatus && status(productStatus, productStatus.startsWith("Sign") || productStatus.startsWith("Select"))}
        </form>
      </div>

      {/* Right column — automation card */}
      <div className="bg-[#fffaf7] text-[#241d1d] p-6 self-start">
        <small className="text-[11px] font-bold tracking-[1.5px]">INSTAGRAM AUTOMATION</small>
        <h3 className="font-serif text-[22px] mt-2 mb-4">Auto link reply</h3>
        <p className="text-[12px] leading-relaxed">
          {automation?.metaConfigured
            ? <><strong className="text-[#2f7d4a]">● Meta connected</strong><br />Live replies can send when Meta approves the app.</>
            : <><strong className="text-[#b36b28]">● Setup required</strong><br />Add Meta credentials in <code className="bg-[#f4e8e3] px-1">backend/.env</code> and subscribe to comments + messages.</>
          }
        </p>

        {[
          { id: "auto-enabled", label: "Auto reply on", key: "enabled" },
          { id: "auto-comments", label: "Reply to comments", key: "replyComments" },
          { id: "auto-dms", label: "Reply to DMs", key: "replyDms" },
        ].map(({ id, label, key }) => (
          <label key={id} className="flex items-center gap-2 text-[12px] my-2 cursor-pointer">
            <input
              id={id}
              type="checkbox"
              defaultChecked={automation?.[key as keyof Automation] as boolean}
            />
            {label}
          </label>
        ))}

        <label className="block text-[12px] mt-3">
          Trigger words
          <input id="auto-triggers" defaultValue={automation?.triggers?.join(", ")} className="block w-full mt-1 p-2 border border-[#ebdfda] text-[13px]" />
        </label>
        <label className="block text-[12px] mt-3">
          Reply template
          <textarea id="auto-template" rows={3} defaultValue={automation?.replyTemplate} className="block w-full mt-1 p-2 border border-[#ebdfda] text-[13px]" />
        </label>
        <p className="text-[11px] text-[#716966]">Placeholders: {"{{url}} {{title}} {{name}}"}</p>
        <button onClick={saveAutomation} className="bg-[#241d1d] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer mt-2">
          Save automation
        </button>
        {saveStatus && <p className="text-[12px] text-[#716966] mt-1">{saveStatus}</p>}

        <h3 className="font-serif text-[18px] mt-7 mb-3">Event log</h3>
        <div className="max-h-[220px] overflow-auto bg-[#f4e8e3] p-3">
          {events.length === 0
            ? <p className="text-[12px] text-[#716966]">No events yet.</p>
            : events.slice(0, 12).map((e, i) => (
              <div key={i} className="border-b border-[#ebdfda] py-2">
                <b className="block text-[12px]">{e.type}</b>
                <small className="block text-[11px] text-[#716966] mt-0.5">{e.detail}</small>
              </div>
            ))
          }
        </div>
      </div>
    </main>
  );
}
