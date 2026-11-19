require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { rateLimit } = require("express-rate-limit");
const { PrismaClient } = require("@prisma/client");
const { sendEmail, htmlText } = require("./email");
const { createSnapTransaction, isConfigured, mapTransactionStatus, verifyNotificationSignature } = require("./midtrans");
const {
  validateOwnerRegistration,
  validateLogin,
  validateRoom,
  validateApplication,
  validatePayment
} = require("./validation");

const prisma = new PrismaClient();
const genericResetMessage = "Jika email terdaftar, instruksi reset password akan dikirim.";

function isLocalDevelopmentOrigin(origin) {
  if (process.env.NODE_ENV === "production") return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || url.port !== "5173") return false;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255))
    return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function createApp({ prismaClient = prisma, emailSender = sendEmail } = {}) {
  const app = express();
  const configuredOrigins = process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === "production" && !configuredOrigins)
    throw new Error("FRONTEND_URL wajib diatur di production ke origin frontend yang diizinkan.");
  const allowedOrigins = (configuredOrigins || "http://localhost:5173")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(`Origin frontend tidak valid di FRONTEND_URL: ${value}`);
      }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error(`Origin frontend harus menggunakan HTTP/HTTPS: ${value}`);
      return parsed.origin;
    });

  app.disable("x-powered-by");
  const trustedProxy = process.env.TRUST_PROXY;
  app.set("trust proxy", trustedProxy === "true" ? 1 : trustedProxy && trustedProxy !== "false" ? trustedProxy : false);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin(origin))
        return callback(null, true);
      return callback(new Error("Origin tidak diizinkan oleh kebijakan CORS."));
    }
  }));

  const secureTransport = (req, res, next) => {
    if (process.env.NODE_ENV === "production" && !req.secure)
      return res.status(426).json({ message: "Gunakan koneksi HTTPS." });
    next();
  };
  app.use(secureTransport);
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    if (req.body !== undefined && (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)))
      return res.status(400).json({ message: "Body permintaan harus berupa objek JSON." });
    next();
  });

  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." }
  });
  const publicRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Terlalu banyak permintaan. Coba lagi nanti." }
  });

  async function writeAudit(ownerId, action, entity, entityId, details = {}) {
    await prismaClient.auditLog.create({
      data: { ownerId, action, entity, entityId, details }
    });
  }

  function sign(owner) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
      throw new Error("JWT_SECRET harus diatur dengan nilai acak minimal 32 karakter.");
    return jwt.sign({ ownerId: owner.id, tokenVersion: owner.tokenVersion }, process.env.JWT_SECRET, { expiresIn: "7d" });
  }

  async function auth(req, res, next) {
    let payload;
    try {
      if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET belum dikonfigurasi.");
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      payload = jwt.verify(token, process.env.JWT_SECRET);
      if (typeof payload.ownerId !== "string" || !Number.isInteger(payload.tokenVersion))
        return res.status(401).json({ message: "Silakan login kembali." });
    } catch {
      return res.status(401).json({ message: "Silakan login kembali." });
    }

    try {
      const owner = await prismaClient.owner.findUnique({
        where: { id: payload.ownerId },
        select: { id: true, tokenVersion: true }
      });
      if (!owner || owner.tokenVersion !== payload.tokenVersion)
        return res.status(401).json({ message: "Silakan login kembali." });
      req.ownerId = owner.id;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  app.get("/", (_req, res) => res.json({ message: "KosKu API berjalan", version: "1.0.0" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "kosku-backend" }));

  app.post("/api/auth/register", authRateLimit, async (req, res, next) => {
    const validated = validateOwnerRegistration(req.body);
    if (validated.error) return res.status(400).json({ message: validated.error });
    try {
      const passwordHash = await bcrypt.hash(validated.data.password, 12);
      const owner = await prismaClient.owner.create({
        data: { name: validated.data.name, email: validated.data.email, passwordHash },
        select: { id: true, name: true, email: true, tokenVersion: true }
      });
      await writeAudit(owner.id, "OWNER_REGISTERED", "Owner", owner.id);
      return res.status(201).json({
        token: sign(owner),
        owner: { id: owner.id, name: owner.name, email: owner.email }
      });
    } catch (error) {
      if (error.code === "P2002") return res.status(409).json({ message: "Email sudah terdaftar." });
      return next(error);
    }
  });

  app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
    const validated = validateLogin(req.body);
    if (validated.error) return res.status(401).json({ message: validated.error });
    try {
      const owner = await prismaClient.owner.findUnique({ where: { email: validated.data.email } });
      if (!owner || !(await bcrypt.compare(validated.data.password, owner.passwordHash)))
        return res.status(401).json({ message: "Email atau password salah." });
      return res.json({
        token: sign(owner),
        owner: { id: owner.id, name: owner.name, email: owner.email }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/password-reset", authRateLimit, async (req, res, next) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email.length > 254) return res.status(400).json({ message: "Email tidak valid." });
    try {
      const owner = email ? await prismaClient.owner.findUnique({ where: { email } }) : null;
      if (owner && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        await prismaClient.passwordReset.deleteMany({ where: { ownerId: owner.id } });
        await prismaClient.passwordReset.create({ data: { ownerId: owner.id, tokenHash, expiresAt } });
        const resetUrl = `${allowedOrigins[0]}/reset-password/${rawToken}`;
        try {
          await emailSender({
            to: owner.email,
            subject: "Reset password KosKu",
            text: `Gunakan tautan berikut dalam 30 menit untuk mengatur ulang password: ${resetUrl}\nJika Anda tidak meminta reset, abaikan email ini.`,
            html: `<p>Gunakan tautan berikut dalam 30 menit untuk mengatur ulang password:</p><p><a href="${resetUrl}">Atur ulang password</a></p><p>Jika Anda tidak meminta reset, abaikan email ini.</p>`
          });
        } catch (error) {
          console.error("Email reset password gagal dikirim:", error.message);
          await prismaClient.passwordReset.deleteMany({ where: { tokenHash } });
        }
      } else if (owner) {
        console.error("Reset password tidak dapat dikirim: RESEND_API_KEY atau EMAIL_FROM belum dikonfigurasi.");
      }
      return res.json({ message: genericResetMessage });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/password-reset/confirm", authRateLimit, async (req, res, next) => {
    const { token, password } = req.body;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) ||
        typeof password !== "string" || password.length < 8 || password.length > 128)
      return res.status(400).json({ message: "Tautan atau password tidak valid. Password harus 8–128 karakter." });
    try {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await prismaClient.$transaction(async tx => {
        const reset = await tx.passwordReset.findUnique({ where: { tokenHash } });
        if (!reset || reset.expiresAt <= new Date()) return null;
        const consumed = await tx.passwordReset.deleteMany({
          where: { id: reset.id, expiresAt: { gt: new Date() } }
        });
        if (!consumed.count) return null;
        const owner = await tx.owner.update({
          where: { id: reset.ownerId },
          data: { passwordHash, tokenVersion: { increment: 1 } },
          select: { id: true }
        });
        await tx.auditLog.create({
          data: { ownerId: owner.id, action: "PASSWORD_RESET", entity: "Owner", entityId: owner.id }
        });
        return owner;
      }, { isolationLevel: "Serializable" });
      if (!result) return res.status(400).json({ message: "Tautan reset tidak valid atau sudah kedaluwarsa." });
      return res.json({ message: "Password berhasil diperbarui. Silakan masuk kembali." });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/rooms", auth, async (req, res, next) => {
    try {
      const rooms = await prismaClient.room.findMany({
        where: { ownerId: req.ownerId },
        include: { tenant: { select: { id: true, fullName: true, whatsapp: true, occupation: true, moveInDate: true, note: true } } },
        orderBy: { createdAt: "desc" }
      });
      return res.json(rooms);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/rooms", auth, async (req, res, next) => {
    const validated = validateRoom(req.body);
    if (validated.error) return res.status(400).json({ message: validated.error });
    try {
      const room = await prismaClient.room.create({ data: { ...validated.data, ownerId: req.ownerId } });
      await writeAudit(req.ownerId, "ROOM_CREATED", "Room", room.id, { name: room.name });
      return res.status(201).json(room);
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/rooms/:id", auth, async (req, res, next) => {
    const validated = validateRoom(req.body);
    if (validated.error) return res.status(400).json({ message: validated.error });
    try {
      const result = await prismaClient.room.updateMany({
        where: { id: req.params.id, ownerId: req.ownerId },
        data: validated.data
      });
      if (!result.count) return res.status(404).json({ message: "Kamar tidak ditemukan." });
      const room = await prismaClient.room.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId },
        include: { tenant: { select: { id: true, fullName: true, whatsapp: true, occupation: true, moveInDate: true, note: true } } }
      });
      await writeAudit(req.ownerId, "ROOM_UPDATED", "Room", room.id, validated.data);
      return res.json(room);
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/rooms/:id", auth, async (req, res, next) => {
    try {
      const room = await prismaClient.room.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId },
        select: { id: true, name: true, status: true }
      });
      if (!room) return res.status(404).json({ message: "Kamar tidak ditemukan." });
      if (room.status === "OCCUPIED")
        return res.status(409).json({ message: "Kamar yang sedang terisi tidak dapat dihapus." });
      const result = await prismaClient.room.deleteMany({
        where: { id: req.params.id, ownerId: req.ownerId, status: "VACANT" }
      });
      if (!result.count) return res.status(409).json({ message: "Kamar baru saja ditempati dan tidak dapat dihapus." });
      await writeAudit(req.ownerId, "ROOM_DELETED", "Room", room.id, { name: room.name });
      return res.json({ message: "Kamar berhasil dihapus." });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/invites", auth, async (req, res, next) => {
    try {
      const invite = await prismaClient.invite.create({
        data: { token: crypto.randomBytes(24).toString("hex"), ownerId: req.ownerId }
      });
      await writeAudit(req.ownerId, "INVITE_CREATED", "Invite", invite.id);
      return res.status(201).json({ id: invite.id, token: invite.token, active: invite.active, createdAt: invite.createdAt });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/invites", auth, async (req, res, next) => {
    try {
      const invites = await prismaClient.invite.findMany({
        where: { ownerId: req.ownerId },
        select: { id: true, token: true, active: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return res.json(invites);
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/invites/:id/active", auth, async (req, res, next) => {
    if (typeof req.body.active !== "boolean")
      return res.status(400).json({ message: "Status link tidak valid." });
    try {
      const result = await prismaClient.invite.updateMany({
        where: { id: req.params.id, ownerId: req.ownerId },
        data: { active: req.body.active }
      });
      if (!result.count) return res.status(404).json({ message: "Link undangan tidak ditemukan." });
      const invite = await prismaClient.invite.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId },
        select: { id: true, token: true, active: true, createdAt: true }
      });
      await writeAudit(req.ownerId, req.body.active ? "INVITE_ACTIVATED" : "INVITE_DEACTIVATED", "Invite", invite.id);
      return res.json(invite);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/public/invites/:token", publicRateLimit, async (req, res, next) => {
    try {
      const invite = await prismaClient.invite.findUnique({
        where: { token: req.params.token },
        include: { owner: { select: { name: true } } }
      });
      if (!invite || !invite.active)
        return res.status(404).json({ message: "Link tidak ditemukan atau sudah dinonaktifkan." });
      return res.json({ ownerName: invite.owner.name });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/public/invites/:token/applications", publicRateLimit, async (req, res, next) => {
    const validated = validateApplication(req.body);
    if (validated.error) return res.status(400).json({ message: validated.error });
    try {
      const invite = await prismaClient.invite.findUnique({ where: { token: req.params.token } });
      if (!invite || !invite.active) return res.status(404).json({ message: "Link tidak valid." });
      const application = await prismaClient.application.create({
        data: { ...validated.data, ownerId: invite.ownerId }
      });
      let notificationStatus = "NOT_CONFIGURED";
      try {
        const owner = await prismaClient.owner.findUnique({
          where: { id: invite.ownerId },
          select: { email: true, name: true }
        });
        if (owner && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
          const subject = "Pengajuan calon penghuni baru";
          const text = `${validated.data.fullName} telah mengirim pengajuan untuk kos Anda.\nMasuk ke dashboard KosKu untuk meninjaunya.`;
          await emailSender({
            to: owner.email,
            subject,
            text,
            html: `<p><strong>${htmlText(validated.data.fullName)}</strong> telah mengirim pengajuan untuk kos Anda.</p><p>Masuk ke dashboard KosKu untuk meninjaunya.</p>`
          });
          notificationStatus = "SENT";
        } else {
          console.warn("Notifikasi pengajuan belum dikirim: konfigurasi email belum lengkap.");
        }
      } catch (error) {
        console.error("Notifikasi pengajuan gagal dikirim:", error.message);
        notificationStatus = "FAILED";
      }
      if (notificationStatus !== "NOT_CONFIGURED") {
        try {
          await prismaClient.application.update({
            where: { id: application.id },
            data: { notificationStatus }
          });
        } catch (error) {
          console.error("Status notifikasi pengajuan gagal disimpan:", error.message);
        }
      }
      return res.status(201).json({
        message: "Pendaftaran berhasil dikirim.",
        id: application.id,
        notificationStatus
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/applications", auth, async (req, res, next) => {
    try {
      const items = await prismaClient.application.findMany({
        where: { ownerId: req.ownerId },
        include: { room: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" }
      });
      return res.json(items);
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/applications/:id/status", auth, async (req, res, next) => {
    const { status, roomId } = req.body;
    if (!["APPROVED", "REJECTED"].includes(status))
      return res.status(400).json({ message: "Status tidak valid." });
    if (status === "APPROVED" && !roomId)
      return res.status(400).json({ message: "Pilih kamar kosong untuk menempatkan penghuni." });

    try {
      const application = await prismaClient.$transaction(async tx => {
        const current = await tx.application.findFirst({
          where: { id: req.params.id, ownerId: req.ownerId },
          select: { id: true, roomId: true }
        });
        if (!current) return null;
        if (status === "APPROVED" && current.roomId !== roomId) {
          const claimed = await tx.room.updateMany({
            where: { id: roomId, ownerId: req.ownerId, status: "VACANT" },
            data: { status: "OCCUPIED" }
          });
          if (!claimed.count) {
            const room = await tx.room.findFirst({
              where: { id: roomId, ownerId: req.ownerId },
              select: { id: true }
            });
            throw new Error(room ? "Kamar sudah terisi. Pilih kamar kosong lainnya." : "Kamar tidak ditemukan.");
          }
          if (current.roomId) {
            await tx.room.updateMany({
              where: { id: current.roomId, ownerId: req.ownerId },
              data: { status: "VACANT" }
            });
          }
        } else if (status === "REJECTED" && current.roomId) {
          await tx.room.updateMany({
            where: { id: current.roomId, ownerId: req.ownerId },
            data: { status: "VACANT" }
          });
        }
        const updated = await tx.application.update({
          where: { id: current.id },
          data: { status, roomId: status === "APPROVED" ? roomId : null },
          include: { room: { select: { id: true, name: true } } }
        });
        await tx.auditLog.create({
          data: {
            ownerId: req.ownerId,
            action: `APPLICATION_${status}`,
            entity: "Application",
            entityId: current.id,
            details: { roomId: status === "APPROVED" ? roomId : null }
          }
        });
        return updated;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 20000 });
      if (!application) return res.status(404).json({ message: "Pendaftar tidak ditemukan." });
      return res.json(application);
    } catch (error) {
      if (error.code === "P2034" || error.code === "P2002")
        return res.status(409).json({ message: "Kamar baru saja ditempati. Muat ulang daftar dan pilih kamar kosong lainnya." });
      if (error.code === "P2028")
        return res.status(503).json({ message: "Database sedang sibuk. Tunggu sebentar lalu coba lagi." });
      if (error.message === "Kamar sudah terisi. Pilih kamar kosong lainnya." || error.message === "Kamar tidak ditemukan.")
        return res.status(error.message === "Kamar tidak ditemukan." ? 404 : 409).json({ message: error.message });
      return next(error);
    }
  });

  app.delete("/api/applications/:id", auth, async (req, res, next) => {
    try {
      const deleted = await prismaClient.$transaction(async tx => {
        const application = await tx.application.findFirst({
          where: { id: req.params.id, ownerId: req.ownerId },
          select: { id: true, roomId: true }
        });
        if (!application) return false;
        const paymentCount = await tx.payment.count({ where: { applicationId: application.id } });
        if (paymentCount) return "PAYMENT_HISTORY";
        if (application.roomId) {
          await tx.room.updateMany({
            where: { id: application.roomId, ownerId: req.ownerId },
            data: { status: "VACANT" }
          });
        }
        await tx.application.delete({ where: { id: application.id } });
        await tx.auditLog.create({
          data: { ownerId: req.ownerId, action: "APPLICATION_DELETED", entity: "Application", entityId: application.id }
        });
        return true;
      }, { maxWait: 10000, timeout: 20000 });
      if (deleted === "PAYMENT_HISTORY")
        return res.status(409).json({ message: "Pengajuan ini memiliki riwayat pembayaran dan tidak dapat dihapus." });
      if (!deleted) return res.status(404).json({ message: "Pendaftar tidak ditemukan." });
      return res.json({ message: "Pengajuan calon penghuni berhasil dihapus." });
    } catch (error) {
      if (error.code === "P2028")
        return res.status(503).json({ message: "Database sedang sibuk. Tunggu sebentar lalu coba lagi." });
      return next(error);
    }
  });

  app.get("/api/payments", auth, async (req, res, next) => {
    try {
      const payments = await prismaClient.payment.findMany({
        where: { ownerId: req.ownerId },
        select: {
          id: true,
          amount: true,
          billingMonth: true,
          status: true,
          method: true,
          note: true,
          paidAt: true,
          gatewayOrderId: true,
          paymentUrl: true,
          createdAt: true,
          application: { select: { id: true, fullName: true, room: { select: { name: true } } } }
        },
        orderBy: [{ billingMonth: "desc" }, { createdAt: "desc" }]
      });
      return res.json(payments.map(({ gatewayOrderId, ...payment }) => ({
        ...payment,
        isGatewayPayment: Boolean(gatewayOrderId)
      })));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/payments/config", auth, (_req, res) => {
    res.json({ midtransEnabled: isConfigured() });
  });

  app.post("/api/payments", auth, async (req, res, next) => {
    const validated = validatePayment(req.body);
    if (validated.error) return res.status(400).json({ message: validated.error });
    try {
      const application = await prismaClient.application.findFirst({
        where: { id: validated.data.applicationId, ownerId: req.ownerId, status: "APPROVED", roomId: { not: null } },
        select: { id: true }
      });
      if (!application) return res.status(404).json({ message: "Penghuni aktif tidak ditemukan." });
      const payment = await prismaClient.payment.create({
        data: { ...validated.data, ownerId: req.ownerId },
        select: {
          id: true,
          amount: true,
          billingMonth: true,
          status: true,
          method: true,
          note: true,
          paidAt: true,
          applicationId: true,
          paymentUrl: true,
          createdAt: true,
          application: { select: { id: true, fullName: true, room: { select: { name: true } } } }
        }
      });
      await writeAudit(req.ownerId, "PAYMENT_CREATED", "Payment", payment.id, {
        applicationId: payment.applicationId,
        amount: payment.amount,
        billingMonth: payment.billingMonth.toISOString()
      });
      return res.status(201).json(payment);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/payments/midtrans/webhook", publicRateLimit, async (req, res, next) => {
    if (!verifyNotificationSignature(req.body))
      return res.status(403).json({ message: "Tanda tangan notifikasi pembayaran tidak valid." });
    const status = mapTransactionStatus(req.body);
    if (!status) return res.json({ received: true, ignored: true });
    try {
      const payment = await prismaClient.payment.findFirst({
        where: { gatewayOrderId: req.body.order_id },
        select: { id: true, ownerId: true, amount: true, status: true }
      });
      if (!payment) return res.status(404).json({ message: "Transaksi tidak ditemukan." });
      if (!Number.isFinite(Number(req.body.gross_amount)) ||
          Math.round(Number(req.body.gross_amount)) !== payment.amount)
        return res.status(400).json({ message: "Nominal notifikasi tidak sesuai dengan transaksi." });
      if (payment.status === "PAID" && status !== "PAID")
        return res.json({ received: true, ignored: true });
      await prismaClient.payment.updateMany({
        where: { id: payment.id, ownerId: payment.ownerId, gatewayOrderId: req.body.order_id },
        data: { status, paidAt: status === "PAID" ? new Date() : null }
      });
      await writeAudit(payment.ownerId, `PAYMENT_${status}_MIDTRANS`, "Payment", payment.id, {
        transactionStatus: req.body.transaction_status
      });
      return res.json({ received: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/payments/:id/checkout", auth, async (req, res, next) => {
    if (!isConfigured())
      return res.status(503).json({ message: "Pembayaran otomatis belum dikonfigurasi. Hubungi pemilik aplikasi." });
    try {
      const payment = await prismaClient.payment.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId },
        include: { application: { select: { fullName: true, room: { select: { name: true } } } } }
      });
      if (!payment) return res.status(404).json({ message: "Pembayaran tidak ditemukan." });
      if (payment.status === "PAID")
        return res.status(409).json({ message: "Pembayaran ini sudah lunas." });
      if (payment.gatewayOrderId && payment.status !== "PENDING")
        return res.status(409).json({ message: "Checkout ini sudah selesai atau kedaluwarsa. Buat catatan tagihan baru untuk percobaan berikutnya." });
      if (payment.status === "PENDING" && payment.paymentUrl)
        return res.json({ paymentUrl: payment.paymentUrl });
      const transaction = await createSnapTransaction(payment);
      await prismaClient.payment.update({
        where: { id: payment.id },
        data: {
          gatewayOrderId: transaction.orderId,
          gatewayToken: transaction.token,
          paymentUrl: transaction.paymentUrl,
          method: "Midtrans Snap"
        }
      });
      await writeAudit(req.ownerId, "PAYMENT_CHECKOUT_CREATED", "Payment", payment.id, {
        gateway: "Midtrans"
      });
      return res.json({ paymentUrl: transaction.paymentUrl });
    } catch (error) {
      console.error("Pembuatan checkout Midtrans gagal:", error.message);
      return res.status(502).json({ message: "Checkout pembayaran tidak dapat dibuat. Coba lagi nanti." });
    }
  });

  app.patch("/api/payments/:id/status", auth, async (req, res, next) => {
    const { status } = req.body;
    if (!["PAID", "REJECTED", "PENDING"].includes(status))
      return res.status(400).json({ message: "Status pembayaran tidak valid." });
    try {
      const current = await prismaClient.payment.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId },
        select: { id: true, gatewayOrderId: true }
      });
      if (!current) return res.status(404).json({ message: "Pembayaran tidak ditemukan." });
      if (current.gatewayOrderId)
        return res.status(409).json({ message: "Status transaksi Midtrans hanya dapat diperbarui melalui notifikasi terverifikasi." });
      const result = await prismaClient.payment.updateMany({
        where: { id: req.params.id, ownerId: req.ownerId },
        data: { status, paidAt: status === "PAID" ? new Date() : null }
      });
      if (!result.count) return res.status(404).json({ message: "Pembayaran tidak ditemukan." });
      const payment = await prismaClient.payment.findFirst({
        where: { id: req.params.id, ownerId: req.ownerId },
        select: {
          id: true,
          amount: true,
          billingMonth: true,
          status: true,
          method: true,
          note: true,
          paidAt: true,
          gatewayOrderId: true,
          paymentUrl: true,
          createdAt: true,
          application: { select: { id: true, fullName: true, room: { select: { name: true } } } }
        }
      });
      await writeAudit(req.ownerId, `PAYMENT_${status}`, "Payment", payment.id, { amount: payment.amount });
      const { gatewayOrderId, ...visiblePayment } = payment;
      return res.json({ ...visiblePayment, isGatewayPayment: Boolean(gatewayOrderId) });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/audit-logs", auth, async (req, res, next) => {
    try {
      const logs = await prismaClient.auditLog.findMany({
        where: { ownerId: req.ownerId },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return res.json(logs);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ message: "Format JSON tidak valid." });
    if (error.message === "Origin tidak diizinkan oleh kebijakan CORS.")
      return res.status(403).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ message: "Terjadi kesalahan pada server." });
  });

  return app;
}

const app = createApp();
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`KosKu API berjalan di http://localhost:${port}`));
}

module.exports = { app, createApp, prisma };
