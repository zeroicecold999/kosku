function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Email belum dikonfigurasi: RESEND_API_KEY dan EMAIL_FROM wajib diisi.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pengiriman email gagal (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.json();
}

function htmlText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

module.exports = { sendEmail, htmlText };
