import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, "");
const formatRupiah = (value) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value || 0));
const request = async (path, options = {}) => {
  const token = localStorage.getItem("kosku_token");
  let res;
  try {
    res = await fetch(API + path, {
      ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Tidak dapat terhubung ke server. Pastikan backend berjalan dan alamat API sudah benar.");
    }
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Permintaan gagal.");
  return data;
};

function App() {
  const [token, setToken] = useState(localStorage.getItem("kosku_token"));
  const [owner, setOwner] = useState(JSON.parse(localStorage.getItem("kosku_owner") || "null"));
  const [mode, setMode] = useState("login");
  const [page, setPage] = useState("rooms");
  const [theme, setTheme] = useState(() => localStorage.getItem("kosku_theme") === "dark" ? "dark" : "light");
  const [rooms, setRooms] = useState([]);
  const [invites, setInvites] = useState([]);
  const [payments, setPayments] = useState([]);
  const [midtransEnabled, setMidtransEnabled] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [applications, setApplications] = useState([]);
  const [applicationFilter, setApplicationFilter] = useState("ALL");
  const [selectedRoomIds, setSelectedRoomIds] = useState({});
  const loadVersion = useRef(0);
  const [message, setMessage] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const inviteCardRef = useRef(null);
  const inviteInputRef = useRef(null);
  const [editingRoom, setEditingRoom] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ applicationId: "", amount: "", billingMonth: new Date().toISOString().slice(0, 7), method: "", note: "" });
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [roomForm, setRoomForm] = useState({ name: "", price: "" });
  const path = window.location.pathname;
  const inviteToken = path.startsWith("/daftar/") ? path.split("/")[2] : null;
  const resetToken = path.startsWith("/reset-password/") ? path.split("/")[2] : null;
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (inviteUrl) inviteCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [inviteUrl]);

  useEffect(() => {
    if (!selectedRoom) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event) {
      if (event.key === "Escape") setSelectedRoom(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedRoom]);

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("kosku_theme", nextTheme);
  }
  
  async function load() {
    const version = ++loadVersion.current;
    try {
      const [nextRooms, nextApplications] = await Promise.all([
        request("/rooms"),
        request("/applications")
      ]);
      if (version !== loadVersion.current) return;
      setRooms(nextRooms);
      setApplications(nextApplications);
    } catch (e) {
      if (version === loadVersion.current) setMessage(e.message);
    }
  }
  useEffect(() => { if (token && !inviteToken && !resetToken) load(); }, [token]);
  useEffect(() => {
    if (!token) return;
    if (page === "payments") {
      Promise.all([request("/payments"), request("/payments/config")])
        .then(([nextPayments, config]) => {
          setPayments(nextPayments);
          setMidtransEnabled(config.midtransEnabled);
        })
        .catch(error => setMessage(error.message));
      return;
    }
    const loaders = {
      invites: ["/invites", setInvites],
      audit: ["/audit-logs", setAuditLogs]
    };
    const loader = loaders[page];
    if (loader) request(loader[0]).then(loader[1]).catch(error => setMessage(error.message));
  }, [page, token]);

  async function authSubmit(e) {
    e.preventDefault(); setMessage("");
    try {
      if (mode === "forgot") {
        const data = await request("/auth/password-reset", { method: "POST", body: JSON.stringify({ email: form.email }) });
        setMessage(data.message);
        return;
      }
      const data = await request(`/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
      localStorage.setItem("kosku_token", data.token); localStorage.setItem("kosku_owner", JSON.stringify(data.owner));
      setToken(data.token); setOwner(data.owner); setMessage("Berhasil masuk ke KosKu.");
    } catch (e) { setMessage(e.message); }
  }
  async function addRoom(e) {
    e.preventDefault();
    const price = Number(roomForm.price.replace(/\D/g, ""));
    try {
      const room = await request(editingRoom ? `/rooms/${editingRoom.id}` : "/rooms", {
        method: editingRoom ? "PUT" : "POST",
        body: JSON.stringify({ ...roomForm, price })
      });
      loadVersion.current += 1;
      setRooms(currentRooms => editingRoom
        ? currentRooms.map(current => current.id === room.id ? room : current)
        : [room, ...currentRooms]);
      setEditingRoom(null);
      setRoomForm({ name: "", price: "" });
      setMessage(editingRoom ? "Perubahan kamar berhasil disimpan." : "Kamar berhasil ditambahkan dan tersimpan.");
    }
    catch (e) { setMessage(e.message); }
  }
  function editRoom(room) {
    setEditingRoom(room);
    setRoomForm({ name: room.name, price: String(room.price).replace(/\B(?=(\d{3})+(?!\d))/g, ".") });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function createInvite() {
    try {
      const data = await request("/invites", { method: "POST" });
      const url = `${location.origin}/daftar/${data.token}`;
      setInviteUrl(url);
      setMessage("Link pendaftaran berhasil dibuat. Salin atau buka link di bawah.");
    }
    catch (e) { setMessage(e.message); }
  }
  async function copyUrl(url) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setMessage("Link disalin.");
        return;
      }
    } catch {
      // Try the compatibility fallback below.
    }
    const temporaryInput = document.createElement("textarea");
    temporaryInput.value = url;
    temporaryInput.setAttribute("readonly", "");
    temporaryInput.style.position = "fixed";
    temporaryInput.style.opacity = "0";
    document.body.appendChild(temporaryInput);
    temporaryInput.select();
    let copied = false;
    try { copied = document.execCommand("copy"); }
    catch { copied = false; }
    temporaryInput.remove();
    setMessage(copied ? "Link disalin." : "Pilih link lalu salin secara manual.");
  }
  async function copyInvite() {
    const input = inviteInputRef.current;
    if (!input) {
      setMessage("Link pendaftaran tidak tersedia.");
      return;
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setMessage("Link pendaftaran berhasil disalin.");
        return;
      } catch {
        // Continue with the selection-based fallback for browsers that block clipboard access.
      }
    }

    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    try {
      if (document.execCommand("copy")) {
        setMessage("Link pendaftaran berhasil disalin.");
        return;
      }
    } catch {
      // Leave the link selected so it can still be copied manually.
    }
    setMessage("Link sudah dipilih. Tekan Ctrl+C atau Cmd+C untuk menyalinnya.");
  }
  async function updateStatus(id, status, roomId) {
    try {
      const updatedApplication = await request(`/applications/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...(roomId ? { roomId } : {}) })
      });
      const previousApplication = applications.find(application => application.id === id);
      loadVersion.current += 1;
      setApplications(currentApplications => currentApplications.map(application =>
        application.id === id ? updatedApplication : application
      ));
      setRooms(currentRooms => currentRooms.map(room => {
        if (previousApplication?.roomId === room.id && updatedApplication.roomId !== room.id)
          return { ...room, status: "VACANT", tenant: null };
        if (updatedApplication.roomId === room.id)
          return { ...room, status: "OCCUPIED", tenant: { id, fullName: updatedApplication.fullName, whatsapp: updatedApplication.whatsapp } };
        return room;
      }));
      setSelectedRoomIds(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage(status === "APPROVED" ? `Pendaftar diterima dan ditempatkan di ${updatedApplication.room.name}.` : "Pendaftar ditolak.");
    }
    catch (e) { setMessage(e.message); }
  }
  async function deleteRoom(room) {
    if (!window.confirm(`Hapus kamar "${room.name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await request(`/rooms/${room.id}`, { method: "DELETE" });
      loadVersion.current += 1;
      setRooms(currentRooms => currentRooms.filter(item => item.id !== room.id));
      setMessage(`Kamar "${room.name}" berhasil dihapus.`);
    } catch (e) { setMessage(e.message); }
  }
  async function deleteApplication(application) {
    if (!window.confirm(`Hapus pengajuan dari "${application.fullName}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await request(`/applications/${application.id}`, { method: "DELETE" });
      loadVersion.current += 1;
      setApplications(currentApplications => currentApplications.filter(item => item.id !== application.id));
      if (application.roomId) {
        setRooms(currentRooms => currentRooms.map(room =>
          room.id === application.roomId ? { ...room, status: "VACANT", tenant: null } : room
        ));
      }
      setMessage(`Pengajuan dari "${application.fullName}" berhasil dihapus.`);
    } catch (e) { setMessage(e.message); }
  }
  async function toggleInvite(invite) {
    try {
      const updated = await request(`/invites/${invite.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active: !invite.active })
      });
      setInvites(current => current.map(item => item.id === updated.id ? updated : item));
      setMessage(updated.active ? "Link pendaftaran diaktifkan." : "Link pendaftaran dinonaktifkan.");
    } catch (e) { setMessage(e.message); }
  }
  async function addPayment(e) {
    e.preventDefault();
    try {
      const payment = await request("/payments", {
        method: "POST",
        body: JSON.stringify({ ...paymentForm, amount: Number(paymentForm.amount.replace(/\D/g, "")) })
      });
      setPayments(current => [payment, ...current]);
      setPaymentForm({ applicationId: "", amount: "", billingMonth: new Date().toISOString().slice(0, 7), method: "", note: "" });
      setMessage("Tagihan berhasil dicatat dan menunggu verifikasi pembayaran.");
    } catch (e) { setMessage(e.message); }
  }
  async function updatePayment(payment, status) {
    try {
      const updated = await request(`/payments/${payment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setPayments(current => current.map(item => item.id === updated.id ? updated : item));
      setMessage(status === "PAID" ? "Pembayaran ditandai lunas." : "Status pembayaran diperbarui.");
    } catch (e) { setMessage(e.message); }
  }
  async function checkoutPayment(payment) {
    try {
      const result = await request(`/payments/${payment.id}/checkout`, { method: "POST" });
      window.location.assign(result.paymentUrl);
    } catch (e) { setMessage(e.message); }
  }
  function logout() { loadVersion.current += 1; localStorage.removeItem("kosku_token"); localStorage.removeItem("kosku_owner"); setToken(null); setOwner(null); setRooms([]); setApplications([]); }

  if (resetToken) return <PasswordResetForm token={resetToken}/>;
  if (inviteToken) return <ApplicantForm token={inviteToken}/>;
  if (!token) return <main className="auth"><section className="auth-card"><div className="logo">K</div><p className="eyebrow">MANAJEMEN KOS LEBIH MUDAH</p><h1>{mode === "forgot" ? "Reset password" : "Selamat datang di KosKu"}</h1><p className="muted">{mode === "forgot" ? "Masukkan email akun untuk menerima instruksi reset password." : "Kelola kamar dan calon penghuni dalam satu tempat."}</p>
    <form onSubmit={authSubmit}>
      {mode === "register" && <><label>Nama pemilik kos</label><input required maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Nama lengkap"/></>}
      <label>Email</label><input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="nama@email.com"/>
      {mode !== "forgot" && <><label>Password</label>
      <div className="password-field">
        <input
          type={showPassword ? "text" : "password"}
          placeholder="Masukkan password"
          value={form.password}
          onChange={e=>setForm({...form,password:e.target.value})}
          required
        />
        <button
          type="button"
          className="toggle-password"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
        >
          {showPassword ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 9 5 9 7a9.5 9.5 0 0 1-2.1 3" />
              <path d="M6.2 6.2C3.9 7.7 3 10 3 12c0 2 4 7 9 7 1.2 0 2.3-.3 3.3-.8" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      </>}
      <button>{mode === "login" ? "Masuk" : mode === "register" ? "Buat akun pemilik" : "Kirim instruksi reset"}</button>
    </form>
    {mode === "login" && <p className="switch"><a onClick={() => { setMode("forgot"); setMessage(""); }}>Lupa password?</a></p>}
    {mode !== "forgot" && <p className="switch">{mode === "login" ? "Belum punya akun?" : "Sudah punya akun?"} <a onClick={()=>{setMode(mode==="login"?"register":"login");setMessage("");}}>{mode==="login"?"Daftar":"Masuk"}</a></p>}
    {mode === "forgot" && <p className="switch"><a onClick={() => { setMode("login"); setMessage(""); }}>Kembali ke login</a></p>}
    {message && <p className="notice" role="status">{message}</p>}</section></main>;

  const vacantRooms = rooms.filter((room) => room.status === "VACANT").length;
  const pendingApplications = applications.filter((application) => application.status === "PENDING").length;
  const approvedApplications = applications.filter((application) => application.status === "APPROVED").length;
  const rejectedApplications = applications.filter((application) => application.status === "REJECTED").length;
  const visibleApplications = applicationFilter === "ALL"
    ? applications
    : applications.filter(application => application.status === applicationFilter);

  return <div className={`app dashboard-shell theme-${theme}`}>
    <aside className="sidebar">
      <div className="brand"><span className="logo small">K</span><b>KosKu</b></div>
      <p className="eyebrow side-label">MENU UTAMA</p>
      <nav className="dashboard-nav" aria-label="Menu utama">
        <button className={page === "rooms" ? "nav active" : "nav"} onClick={() => setPage("rooms")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>Kamar</button>
        <button className={page === "applications" ? "nav active" : "nav"} onClick={() => setPage("applications")}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19z"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 13h.5a4 4 0 0 1 4 4v2h-4"/></svg>Pendaftar{pendingApplications > 0 && <span className="nav-count">{pendingApplications}</span>}</button>
        <button className={page === "invites" ? "nav active" : "nav"} onClick={() => setPage("invites")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>Link daftar</button>
        <button className={page === "payments" ? "nav active" : "nav"} onClick={() => setPage("payments")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>Pembayaran</button>
        <button className={page === "audit" ? "nav active" : "nav"} onClick={() => setPage("audit")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7"/></svg>Aktivitas</button>
        <button className="nav" onClick={createInvite}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Buat link daftar</button>
        <button className="nav theme-toggle" onClick={toggleTheme} aria-label={`Aktifkan tema ${theme === "light" ? "gelap" : "terang"}`}><svg viewBox="0 0 24 24" aria-hidden="true">{theme === "light" ? <><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5z"/></> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>}</svg>{theme === "light" ? "Tema gelap" : "Tema terang"}</button>
      </nav>
      <div className="side-bottom">
        <div className="profile-summary"><span className="profile-avatar">{(owner?.name || "P").charAt(0).toUpperCase()}</span><span className="profile-name">{owner?.name || "Pemilik Kos"}<small>Pemilik kos</small></span></div>
        <button className="nav logout-button" onClick={logout}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></svg>Keluar</button>
      </div>
    </aside>
    <main className="content">
      <header className="dashboard-header">
        <div><p className="eyebrow">DASHBOARD PEMILIK</p><h1>Halo, {owner?.name || "Pemilik Kos"} 👋</h1><p className="muted">Ringkasan dan aktivitas kosmu hari ini.</p></div>
        <button className="primary-action" onClick={createInvite}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Buat link pendaftaran</button>
      </header>
      {message && <p className="notice dashboard-notice" role="status">{message}</p>}
      {inviteUrl && <div className="invite" ref={inviteCardRef} role="status"><div className="invite-details"><b>Link pendaftaran siap dibagikan</b><input ref={inviteInputRef} className="invite-link" aria-label="Link pendaftaran" readOnly value={inviteUrl}/><a href={inviteUrl} target="_blank" rel="noreferrer">Buka formulir pendaftaran ↗</a></div><button className="outline" onClick={copyInvite}>Salin link</button></div>}
      <section className="stats" aria-label="Ringkasan kos">
        <article className="stat-card"><span className="stat-icon rooms-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V5a1 1 0 0 1 1-1h9v16M4 20h17M14 9h6v11M7 8h3M7 12h3M7 16h3M17 12h.01M17 16h.01"/></svg></span><div><span>Total kamar</span><strong>{rooms.length}</strong><small>kamar terdaftar</small></div></article>
        <article className="stat-card"><span className="stat-icon vacant-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 11V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M3 19v-5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5M3 16h18M6 19v-3M18 19v-3"/></svg></span><div><span>Kamar kosong</span><strong>{vacantRooms}</strong><small>dari {rooms.length} kamar</small></div></article>
        <article className="stat-card"><span className="stat-icon applicants-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19zM16 11a3 3 0 1 0 0-6M17 13h.5a4 4 0 0 1 4 4v2h-4"/></svg></span><div><span>Pengajuan masuk</span><strong>{pendingApplications}</strong><small>menunggu ditinjau</small></div></article>
      </section>
      {page === "rooms" ? <section className="panel dashboard-panel">
        <div className="panel-head"><div><h2>Daftar kamar</h2><p className="muted">Tambahkan kamar dan pantau ketersediaannya.</p></div><span className="section-count">{rooms.length} kamar</span></div>
        <form className="inline-form" onSubmit={addRoom}>
          <label className="room-input"><span>Nama kamar</span><input required maxLength={100} placeholder="Contoh: Kamar 01" value={roomForm.name} onChange={e => setRoomForm({ ...roomForm, name: e.target.value })}/></label>
          <label className="room-input"><span>Harga per bulan</span><div className="rupiah-input"><span>Rp</span><input required inputMode="numeric" placeholder="0" value={roomForm.price} onChange={e => setRoomForm({ ...roomForm, price: e.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".") })}/></div></label>
          <button>{editingRoom ? "Simpan perubahan" : "Tambah kamar"}</button>
          {editingRoom && <button type="button" className="outline" onClick={() => { setEditingRoom(null); setRoomForm({ name: "", price: "" }); }}>Batal</button>}
        </form>
        {rooms.length === 0 ? <p className="empty">Belum ada kamar. Tambahkan kamar pertamamu di atas.</p> : <div className="room-grid">{rooms.map(room => <article className="room" key={room.id}>
          <div className="room-top"><span className={room.status === "VACANT" ? "status vacant" : "status"}>{room.status === "VACANT" ? "Kosong" : "Terisi"}</span><div className="room-card-actions"><button className="outline small-action" aria-label={`Ubah kamar ${room.name}`} onClick={() => editRoom(room)}>Ubah</button><button className="delete-button" aria-label={`Hapus kamar ${room.name}`} title={room.status === "OCCUPIED" ? "Kamar terisi tidak dapat dihapus" : `Hapus kamar ${room.name}`} disabled={room.status === "OCCUPIED"} onClick={() => deleteRoom(room)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg></button></div></div>
          <button className="room-open" onClick={() => setSelectedRoom(room)} aria-label={`Lihat detail ${room.name}${room.tenant ? `, penghuni ${room.tenant.fullName}` : ""}`}>
            <span className="room-number" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V5a1 1 0 0 1 1-1h9v16M4 20h17M14 9h6v11M7 8h3M7 12h3M7 16h3"/></svg></span>
            <h3>{room.name}</h3>
            <strong>{formatRupiah(room.price)} <small>/ bulan</small></strong>
            {room.tenant ? <span className="room-tenant-summary"><span className="tenant-dot"/>Dihuni oleh <b>{room.tenant.fullName}</b></span> : <span className="room-tenant-summary vacant-summary">Belum ada penghuni</span>}
            <span className="room-details-hint">Lihat detail <span aria-hidden="true">→</span></span>
          </button>
        </article>)}</div>}
      </section> : page === "applications" ? <section className="panel dashboard-panel">
        <div className="panel-head"><div><h2>Pengajuan calon penghuni</h2><p className="muted">Periksa data calon penghuni, lalu tentukan statusnya.</p></div><span className="section-count">{applications.length} pengajuan</span></div>
        <div className="application-filters" role="group" aria-label="Filter status pendaftar">
          <button className={applicationFilter === "ALL" ? "application-filter active" : "application-filter"} aria-pressed={applicationFilter === "ALL"} onClick={() => setApplicationFilter("ALL")}>Semua <span>{applications.length}</span></button>
          <button className={applicationFilter === "PENDING" ? "application-filter active" : "application-filter"} aria-pressed={applicationFilter === "PENDING"} onClick={() => setApplicationFilter("PENDING")}>Menunggu <span>{pendingApplications}</span></button>
          <button className={applicationFilter === "APPROVED" ? "application-filter active" : "application-filter"} aria-pressed={applicationFilter === "APPROVED"} onClick={() => setApplicationFilter("APPROVED")}>Diterima <span>{approvedApplications}</span></button>
          <button className={applicationFilter === "REJECTED" ? "application-filter active" : "application-filter"} aria-pressed={applicationFilter === "REJECTED"} onClick={() => setApplicationFilter("REJECTED")}>Ditolak <span>{rejectedApplications}</span></button>
        </div>
        {visibleApplications.length === 0
          ? <p className="empty">{applications.length === 0 ? "Belum ada pengajuan masuk." : "Belum ada pendaftar dengan status ini."}</p>
          : <div className="application-list">{visibleApplications.map(application => <article className="application" key={application.id}><div className="application-info"><h3>{application.fullName}</h3><p>{application.whatsapp} · {application.occupation || "Pekerjaan belum diisi"}</p><span className={`status application-status ${application.status.toLowerCase()}`}>{application.status === "PENDING" ? "Menunggu" : application.status === "APPROVED" ? "Diterima" : "Ditolak"}</span><small className={`notification-status ${application.notificationStatus?.toLowerCase() || "not_configured"}`}>{application.notificationStatus === "SENT" ? "Email pemberitahuan terkirim" : application.notificationStatus === "FAILED" ? "Email gagal dikirim · periksa log server" : "Email belum dikonfigurasi"}</small>{application.room && <p className="assigned-room">Kamar: <strong>{application.room.name}</strong></p>}</div><div className="actions">{application.status !== "REJECTED" && !application.room && <div className="assign-room"><select aria-label={`Pilih kamar untuk ${application.fullName}`} value={selectedRoomIds[application.id] || ""} onChange={event => setSelectedRoomIds(current => ({ ...current, [application.id]: event.target.value }))}><option value="">Pilih kamar kosong</option>{rooms.filter(room => room.status === "VACANT").map(room => <option key={room.id} value={room.id}>{room.name} · {formatRupiah(room.price)}</option>)}</select><button disabled={!selectedRoomIds[application.id]} onClick={() => updateStatus(application.id, "APPROVED", selectedRoomIds[application.id])}>{application.status === "APPROVED" ? "Tempatkan" : "Terima & tempatkan"}</button></div>}{application.status === "PENDING" && <button className="danger" onClick={() => updateStatus(application.id, "REJECTED")}>Tolak</button>}<button className="delete-button" aria-label={`Hapus pengajuan ${application.fullName}`} title={`Hapus pengajuan ${application.fullName}`} onClick={() => deleteApplication(application)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg></button></div></article>)}</div>}
      </section> : page === "invites" ? <section className="panel dashboard-panel">
        <div className="panel-head"><div><h2>Link pendaftaran</h2><p className="muted">Kelola link yang pernah dibuat. Link nonaktif tidak bisa digunakan lagi.</p></div><button onClick={createInvite}>Buat link baru</button></div>
        {invites.length === 0 ? <p className="empty">Belum ada link pendaftaran.</p> : <div className="invite-list">{invites.map(invite => <article className="invite-row" key={invite.id}><div><strong>{invite.active ? "Aktif" : "Nonaktif"}</strong><input aria-label="URL pendaftaran" readOnly value={`${location.origin}/daftar/${invite.token}`} onFocus={event => event.target.select()}/><small>Dibuat {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invite.createdAt))}</small></div><div className="actions"><button className="outline" onClick={() => copyUrl(`${location.origin}/daftar/${invite.token}`)}>Salin</button><button className={invite.active ? "danger" : ""} onClick={() => toggleInvite(invite)}>{invite.active ? "Nonaktifkan" : "Aktifkan"}</button></div></article>)}</div>}
      </section> : page === "payments" ? <section className="panel dashboard-panel">
        <div className="panel-head"><div><h2>Pencatatan pembayaran</h2><p className="muted">Catat tagihan penghuni dan verifikasi pembayaran. {midtransEnabled ? "Pembayaran otomatis via Midtrans juga tersedia." : "Pembayaran otomatis tersedia setelah Midtrans dikonfigurasi."}</p></div><span className="section-count">{payments.length} catatan</span></div>
        <form className="payment-form" onSubmit={addPayment}>
          <label>Penghuni aktif<select required value={paymentForm.applicationId} onChange={event => setPaymentForm({ ...paymentForm, applicationId: event.target.value })}><option value="">Pilih penghuni</option>{applications.filter(application => application.status === "APPROVED" && application.roomId).map(application => <option key={application.id} value={application.id}>{application.fullName}{application.room ? ` · ${application.room.name}` : ""}</option>)}</select></label>
          <label>Bulan tagihan<input required type="month" value={paymentForm.billingMonth} onChange={event => setPaymentForm({ ...paymentForm, billingMonth: event.target.value })}/></label>
          <label>Nominal<input required inputMode="numeric" placeholder="Contoh: 1500000" value={paymentForm.amount} onChange={event => setPaymentForm({ ...paymentForm, amount: event.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".") })}/></label>
          <label>Metode pembayaran<input maxLength={50} placeholder="Transfer bank, tunai, QRIS..." value={paymentForm.method} onChange={event => setPaymentForm({ ...paymentForm, method: event.target.value })}/></label>
          <label className="payment-note">Catatan<textarea maxLength={500} value={paymentForm.note} onChange={event => setPaymentForm({ ...paymentForm, note: event.target.value })}/></label>
          <button disabled={!applications.some(application => application.status === "APPROVED" && application.roomId)}>Catat tagihan</button>
        </form>
        {payments.length === 0 ? <p className="empty">Belum ada catatan pembayaran.</p> : <div className="payment-list">{payments.map(payment => <article className="payment-row" key={payment.id}><div><h3>{payment.application.fullName} · {payment.application.room?.name || "Kamar"}</h3><p>{new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(payment.billingMonth))} · {formatRupiah(payment.amount)}</p><span className={`status ${payment.status.toLowerCase()}`}>{payment.status === "PAID" ? "Lunas" : payment.status === "REJECTED" ? "Ditolak" : "Menunggu verifikasi"}</span>{payment.method && <small className="payment-method">{payment.method}</small>}{payment.note && <small className="payment-method">{payment.note}</small>}</div><div className="actions">{payment.status === "PENDING" && midtransEnabled && <button onClick={() => checkoutPayment(payment)}>Bayar via Midtrans</button>}{!payment.isGatewayPayment && payment.status !== "PAID" && <button onClick={() => updatePayment(payment, "PAID")}>Tandai lunas</button>}{!payment.isGatewayPayment && payment.status !== "REJECTED" && <button className="danger" onClick={() => updatePayment(payment, "REJECTED")}>Tolak</button>}{!payment.isGatewayPayment && payment.status !== "PENDING" && <button className="outline" onClick={() => updatePayment(payment, "PENDING")}>Set menunggu</button>}</div></article>)}</div>}
      </section> : <section className="panel dashboard-panel">
        <div className="panel-head"><div><h2>Aktivitas akun</h2><p className="muted">Riwayat perubahan penting pada akun dan data kos.</p></div></div>
        {auditLogs.length === 0 ? <p className="empty">Belum ada aktivitas tercatat.</p> : <div className="audit-list">{auditLogs.map(log => <article className="audit-row" key={log.id}><div><strong>{log.action.replaceAll("_", " ")}</strong><span>{log.entity}{log.entityId ? ` · ${log.entityId}` : ""}</span></div><time>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.createdAt))}</time></article>)}</div>}
      </section>}
    </main>
    {selectedRoom && <div className="room-dialog-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) setSelectedRoom(null);
    }}>
      <section className="room-dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title">
        <button className="room-dialog-close" aria-label="Tutup detail kamar" onClick={() => setSelectedRoom(null)}>×</button>
        <div className="room-dialog-heading"><span className="room-number"><svg viewBox="0 0 24 24"><path d="M4 20V5a1 1 0 0 1 1-1h9v16M4 20h17M14 9h6v11M7 8h3M7 12h3M7 16h3"/></svg></span><div><span className={selectedRoom.status === "VACANT" ? "status vacant" : "status"}>{selectedRoom.status === "VACANT" ? "Kosong" : "Terisi"}</span><h2 id="room-dialog-title">{selectedRoom.name}</h2></div></div>
        <div className="room-dialog-price"><span>Harga sewa</span><strong>{formatRupiah(selectedRoom.price)} <small>/ bulan</small></strong></div>
        <div className="room-dialog-tenant"><h3>Informasi penghuni</h3>{selectedRoom.tenant ? <div className="tenant-details"><span className="tenant-avatar">{selectedRoom.tenant.fullName.charAt(0).toUpperCase()}</span><div><strong>{selectedRoom.tenant.fullName}</strong><span>{selectedRoom.tenant.occupation || "Pekerjaan belum diisi"}</span></div><a href={`https://wa.me/${selectedRoom.tenant.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{selectedRoom.tenant.whatsapp}</a></div> : <p className="muted">Kamar ini belum memiliki penghuni terdaftar.</p>}</div>
        {selectedRoom.tenant?.moveInDate && <div className="room-dialog-date"><span>Tanggal rencana masuk</span><strong>{new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(selectedRoom.tenant.moveInDate))}</strong></div>}
        {selectedRoom.tenant?.note && <div className="room-dialog-note"><span>Catatan pendaftar</span><p>{selectedRoom.tenant.note}</p></div>}
      </section>
    </div>}
  </div>;
}

function PasswordResetForm({ token }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setMessage("");
    try {
      const result = await request("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      setMessage(result.message);
      setDone(true);
    } catch (error) {
      setMessage(error.message);
    }
  }
  return <main className="auth"><section className="auth-card"><div className="logo">K</div><p className="eyebrow">PEMULIHAN AKUN</p><h1>Atur password baru</h1>{done ? <><p className="notice" role="status">{message}</p><p className="switch"><a href="/">Kembali ke login</a></p></> : <><p className="muted">Tautan ini hanya dapat digunakan sekali dan berlaku selama 30 menit.</p><form onSubmit={submit}><label>Password baru</label><input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/><button>Simpan password</button></form>{message && <p className="notice" role="alert">{message}</p>}</>}</section></main>;
}

function ApplicantForm({token}) {
  const [ownerName,setOwnerName]=useState(""); const [error,setError]=useState(""); const [done,setDone]=useState(false);
  const [form,setForm]=useState({fullName:"",whatsapp:"",occupation:"",moveInDate:"",note:""});
  useEffect(()=>{request(`/public/invites/${token}`).then(d=>setOwnerName(d.ownerName)).catch(e=>setError(e.message));},[token]);
  async function submit(e){e.preventDefault();setError("");try{await request(`/public/invites/${token}/applications`,{method:"POST",body:JSON.stringify(form)});setDone(true);}catch(e){setError(e.message);}}
  if(done)return <main className="auth"><section className="auth-card"><div className="logo">✓</div><h1>Pendaftaran terkirim!</h1><p className="muted">Terima kasih. Pemilik kos akan meninjau pengajuanmu.</p></section></main>;
  return <main className="auth"><section className="auth-card"><div className="logo">K</div><p className="eyebrow">FORMULIR CALON PENGHUNI</p><h1>Daftar ke kos</h1><p className="applicant-owner-name">{ownerName ? `Milik ${ownerName}` : "Memuat nama pemilik..."}</p><p className="muted">Isi data berikut dengan benar.</p><form onSubmit={submit}><label>Nama lengkap</label><input required maxLength={100} value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/><label>Nomor WhatsApp</label><input required maxLength={20} value={form.whatsapp} onChange={e=>setForm({...form,whatsapp:e.target.value})}/><label>Pekerjaan / pendidikan</label><input maxLength={100} value={form.occupation} onChange={e=>setForm({...form,occupation:e.target.value})}/><label>Rencana masuk</label><input type="date" value={form.moveInDate} onChange={e=>setForm({...form,moveInDate:e.target.value})}/><label>Catatan tambahan</label><textarea maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/><button>Kirim pendaftaran</button></form>{error&&<p className="notice">{error}</p>}</section></main>;
}
createRoot(document.getElementById("root")).render(<App/>);
