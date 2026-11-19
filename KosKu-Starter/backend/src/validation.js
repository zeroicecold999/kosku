const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+]?[\d\s()-]{8,20}$/;

function text(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function validateOwnerRegistration(body) {
  const name = text(body.name, 100);
  const email = text(body.email, 254)?.toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || !email || !EMAIL_PATTERN.test(email) || password.length < 8 || password.length > 128)
    return { error: "Nama wajib diisi, email harus valid, dan password harus 8–128 karakter." };
  return { data: { name, email, password } };
}

function validateLogin(body) {
  const email = text(body.email, 254)?.toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !EMAIL_PATTERN.test(email) || !password || password.length > 128)
    return { error: "Email atau password salah." };
  return { data: { email, password } };
}

function validateRoom(body) {
  const name = text(body.name, 100);
  if (!["string", "number"].includes(typeof body.price))
    return { error: "Nama kamar dan harga yang valid wajib diisi." };
  const price = Number(body.price);
  if (!name || !Number.isSafeInteger(price) || price < 0 || price > 2_000_000_000)
    return { error: "Nama kamar dan harga yang valid wajib diisi." };
  return { data: { name, price } };
}

function validateApplication(body) {
  const fullName = text(body.fullName, 100);
  const whatsapp = text(body.whatsapp, 20);
  const phoneDigits = whatsapp?.replace(/\D/g, "") || "";
  const occupation = body.occupation == null || body.occupation === "" ? null : text(body.occupation, 100);
  const note = body.note == null || body.note === "" ? null : text(body.note, 1000);
  let moveInDate = null;
  if (body.moveInDate) {
    if (typeof body.moveInDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.moveInDate))
      return { error: "Tanggal rencana masuk tidak valid." };
    moveInDate = new Date(`${body.moveInDate}T00:00:00.000Z`);
    if (Number.isNaN(moveInDate.getTime()) || moveInDate.toISOString().slice(0, 10) !== body.moveInDate)
      return { error: "Tanggal rencana masuk tidak valid." };
  }
  if (!fullName || !whatsapp || !PHONE_PATTERN.test(whatsapp) || phoneDigits.length < 8 || phoneDigits.length > 15 ||
      (body.occupation && !occupation) || (body.note && !note))
    return { error: "Nama dan WhatsApp yang valid wajib diisi; panjang data opsional melebihi batas." };
  return { data: { fullName, whatsapp, occupation, note, moveInDate } };
}

function validatePayment(body) {
  const applicationId = text(body.applicationId, 100);
  if (!["string", "number"].includes(typeof body.amount))
    return { error: "Penghuni, bulan tagihan, nominal, dan data pembayaran yang valid wajib diisi." };
  const amount = Number(body.amount);
  const method = body.method == null || body.method === "" ? null : text(body.method, 50);
  const note = body.note == null || body.note === "" ? null : text(body.note, 500);
  const billingMonth = typeof body.billingMonth === "string" && /^\d{4}-\d{2}$/.test(body.billingMonth)
    ? new Date(`${body.billingMonth}-01T00:00:00.000Z`)
    : null;
  if (!applicationId || !Number.isSafeInteger(amount) || amount <= 0 || amount > 2_000_000_000 ||
      !billingMonth || Number.isNaN(billingMonth.getTime()) ||
      (body.method && !method) || (body.note && !note))
    return { error: "Penghuni, bulan tagihan, nominal, dan data pembayaran yang valid wajib diisi." };
  return { data: { applicationId, amount, billingMonth, method, note } };
}

module.exports = { validateOwnerRegistration, validateLogin, validateRoom, validateApplication, validatePayment };
