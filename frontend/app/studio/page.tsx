"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import type { Automation, Mapping, Event, Product } from "@/lib/types";

const API = "http://localhost:3000";

function Msg({ msg, error }: { msg: string; error?: boolean }) {
  if (!msg) return null;
  return <p className={`text-[12px] mt-1 ${error ? "text-red-500" : "text-[#716966]"}`}>{msg}</p>;
}

export default function StudioPage() {
  const [token, setToken]         = useState("");
  const [user, setUser]           = useState<{ name: string; handle: string } | null>(null);
  const [tab, setTab]             = useState<"register" | "login">("register");
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [events, setEvents]       = useState<Event[]>([]);
  const [editingProduct, setEditingProduct] = useState<(Product & { slug: string }) | null>(null);

  const [authMsg,    setAuthMsg]    = useState("");
  const [reelMsg,    setReelMsg]    = useState("");
  const [productMsg, setProductMsg] = useState("");
  const [editMsg,    setEditMsg]    = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [saveMsg,    setSaveMsg]    = useState("");

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

  const inp = "font-[inherit] p-2 border border-[#d8c5bf] bg-white text-[14px] w-full";
  const frm = "grid gap-2 mt-6 pt-5 border-t border-[#6a5858]";
  const btn = "bg-[#e96050] text-white border-0 px-4 py-2 text-[13px] font-bold cursor-pointer justify-self-start";

  return (
    <main className="bg-[#291f20] text-white px-[8vw] py-[80px] grid md:grid-cols-[1.1fr_0.9fr] gap-[80px]">
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
                <button onClick={() => deleteReel(m.slug)} className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0">🗑</button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Auth */}
        {!user ? (
          <>
            <div className="flex gap-2 mt-6 pt-5 border-t border-[#6a5858]">
              {(["register", "login"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`border px-4 py-1.5 text-[12px] cursor-pointer font-[inherit] ${tab === t ? "bg-[#e96050] border-[#e96050] text-white" : "bg-transparent border-[#6a5858] text-[#d8c9c5]"}`}>
                  {t === "register" ? "New account" : "Sign in"}
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

        {/* Products list per reel (for edit/delete) */}
        {automation?.mappings?.length && token ? (
          <div className={frm}>
            <h3 className="m-0 text-[16px]">Manage products</h3>
            {automation.mappings.map((m: Mapping) => (
              <ReelProducts key={m.slug} mapping={m} token={token} onEdit={setEditingProduct} API={API} />
            ))}
          </div>
        ) : null}
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
        <div className="max-h-[220px] overflow-auto bg-[#f4e8e3] p-3">
          {events.length === 0
            ? <p className="text-[12px] text-[#716966]">No events yet.</p>
            : events.slice(0, 12).map((e, i) => (
              <div key={i} className="border-b border-[#ebdfda] py-2">
                <b className="block text-[12px]">{e.type}</b>
                <small className="block text-[11px] text-[#716966] mt-0.5">{e.detail}</small>
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}

// Sub-component: loads and lists products for a reel with edit/delete buttons
function ReelProducts({
  mapping, token, onEdit, API,
}: {
  mapping: Mapping;
  token: string;
  onEdit: (p: Product & { slug: string }) => void;
  API: string;
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
      <p className="text-[11px] text-[#d8c9c5] mb-1">{mapping.title || mapping.slug}</p>
      {products.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-[12px] text-[#d8c9c5] py-1 border-b border-[#3a2e2e]">
          <span className="flex-1">{p.name}</span>
          <button onClick={() => onEdit({ ...p, slug: mapping.slug })}
            className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0 text-[13px]">✏️</button>
          <button onClick={() => remove(p.id)}
            className="bg-transparent border-0 cursor-pointer text-[#d8c9c5] hover:text-[#e96050] p-0 text-[13px]">🗑</button>
        </div>
      ))}
    </div>
  );
}
