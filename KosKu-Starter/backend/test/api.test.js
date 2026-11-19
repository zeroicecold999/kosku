const { before, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const request = require("supertest");
const { createApp } = require("../src/server");
const { validateApplication, validateOwnerRegistration, validatePayment, validateRoom } = require("../src/validation");

const owner = {
  id: "owner-1",
  name: "Pemilik Kos",
  email: "owner@example.com",
  passwordHash: "unused",
  tokenVersion: 0
};

before(() => {
  process.env.JWT_SECRET = "test-secret-with-more-than-thirty-two-characters";
  process.env.NODE_ENV = "test";
});

function createTestApp(overrides = {}) {
  const prismaClient = {
    owner: {
      findUnique: async () => owner,
      ...overrides.owner
    },
    room: {
      create: async ({ data }) => ({ id: "room-1", ...data }),
      findFirst: async () => null,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
      ...overrides.room
    },
    invite: {
      create: async () => ({ id: "invite-1", token: "token", active: true, createdAt: new Date() }),
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      ...overrides.invite
    },
    application: {
      create: async () => ({ id: "application-1" }),
      findFirst: async () => null,
      findMany: async () => [],
      ...overrides.application
    },
    payment: {
      create: async () => ({ id: "payment-1" }),
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      ...overrides.payment
    },
    passwordReset: {
      create: async () => ({}),
      findUnique: async () => null,
      deleteMany: async () => ({ count: 0 }),
      ...overrides.passwordReset
    },
    auditLog: {
      create: async ({ data }) => ({ id: "audit-1", ...data }),
      findMany: async () => [],
      ...overrides.auditLog
    },
    $transaction: async callback => callback({
      owner: { update: async () => ({ id: owner.id }) },
      passwordReset: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
      auditLog: { create: async () => ({}) },
      ...overrides.transaction
    })
  };
  const app = createApp({ prismaClient, emailSender: async () => ({ id: "email-1" }) });
  const token = jwt.sign({ ownerId: owner.id, tokenVersion: owner.tokenVersion }, process.env.JWT_SECRET);
  return { app, token, prismaClient };
}

test("validates registration, room, application, and payment inputs", () => {
  assert.equal(validateOwnerRegistration({ name: "Owner", email: "owner@example.com", password: "12345678" }).data.email, "owner@example.com");
  assert.ok(validateOwnerRegistration({ name: " ", email: "wrong", password: "short" }).error);
  assert.deepEqual(validateRoom({ name: "Kamar 1", price: "1500000" }).data, { name: "Kamar 1", price: 1500000 });
  assert.ok(validateRoom({ name: "Kamar 1", price: -1 }).error);
  assert.ok(validateRoom({ name: "Kamar 1", price: true }).error);
  assert.ok(validateApplication({ fullName: "Nama", whatsapp: "abc" }).error);
  assert.ok(validateApplication({ fullName: "Nama", whatsapp: "--------" }).error);
  assert.equal(validateApplication({ fullName: "Nama", whatsapp: "+628123456789" }).data.whatsapp, "+628123456789");
  assert.ok(validatePayment({ applicationId: "app-1", amount: 0, billingMonth: "2026-11" }).error);
  assert.ok(validatePayment({ applicationId: "app-1", amount: true, billingMonth: "2026-11" }).error);
  assert.equal(validatePayment({ applicationId: "app-1", amount: 1000, billingMonth: "2026-11" }).data.amount, 1000);
});

test("requires a valid authenticated owner for room routes", async () => {
  const { app, token } = createTestApp();
  const unauthorized = await request(app).get("/api/rooms");
  assert.equal(unauthorized.status, 401);
  const invalidRoom = await request(app).post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: " ", price: -1 });
  assert.equal(invalidRoom.status, 400);
});

test("CORS normalizes configured frontend URLs and rejects unknown origins", async () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://kosku.example/app/,https://preview.kosku.example/";
  try {
    const { app } = createTestApp();
    const allowed = await request(app).get("/api/health").set("Origin", "https://kosku.example");
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], "https://kosku.example");
    const rejected = await request(app).get("/api/health").set("Origin", "https://not-kosku.example");
    assert.equal(rejected.status, 403);
  } finally {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});

test("development CORS allows Vite on loopback or private LAN but rejects public origins", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.NODE_ENV = "development";
  process.env.FRONTEND_URL = "http://localhost:5173";
  try {
    const { app } = createTestApp();
    const lan = await request(app).get("/api/health").set("Origin", "http://192.168.1.25:5173");
    assert.equal(lan.status, 200);
    assert.equal(lan.headers["access-control-allow-origin"], "http://192.168.1.25:5173");
    const publicOrigin = await request(app).get("/api/health").set("Origin", "http://example.com:5173");
    assert.equal(publicOrigin.status, 403);
    const wrongPort = await request(app).get("/api/health").set("Origin", "http://192.168.1.25:3000");
    assert.equal(wrongPort.status, 403);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});

test("production requires an explicit frontend origin configuration", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.NODE_ENV = "production";
  delete process.env.FRONTEND_URL;
  try {
    assert.throws(() => createApp(), /FRONTEND_URL wajib diatur di production/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});

test("scopes invite deactivation to the authenticated owner", async () => {
  let where;
  const { app, token } = createTestApp({
    invite: { updateMany: async args => { where = args.where; return { count: 0 }; } }
  });
  const response = await request(app).patch("/api/invites/another-owners-link/active")
    .set("Authorization", `Bearer ${token}`)
    .send({ active: false });
  assert.equal(response.status, 404);
  assert.deepEqual(where, { id: "another-owners-link", ownerId: owner.id });
});

test("public application submission records notification delivery status", async () => {
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_FROM = "KosKu <test@example.com>";
  let savedNotificationStatus;
  const { app } = createTestApp({
    invite: { findUnique: async () => ({ id: "invite-1", ownerId: owner.id, active: true }) },
    owner: { findUnique: async () => owner },
    application: {
      create: async () => ({ id: "application-1" }),
      update: async ({ data }) => { savedNotificationStatus = data.notificationStatus; }
    }
  });
  const response = await request(app).post("/api/public/invites/valid-token/applications")
    .send({ fullName: "Calon Penghuni", whatsapp: "+628123456789" });
  assert.equal(response.status, 201);
  assert.equal(response.body.notificationStatus, "SENT");
  assert.equal(savedNotificationStatus, "SENT");
});

test("application approval claims an available room and records an audit event", async () => {
  let roomUpdate;
  let audit;
  const { app, token } = createTestApp({
    transaction: {
      application: {
        findFirst: async () => ({ id: "application-1", roomId: null }),
        update: async ({ data }) => ({
          id: "application-1",
          fullName: "Calon Penghuni",
          status: data.status,
          roomId: data.roomId,
          room: { id: data.roomId, name: "Kamar 1" }
        })
      },
      room: {
        updateMany: async args => { roomUpdate = args; return { count: 1 }; }
      },
      auditLog: {
        create: async ({ data }) => { audit = data; }
      }
    }
  });
  const response = await request(app).patch("/api/applications/application-1/status")
    .set("Authorization", `Bearer ${token}`)
    .send({ status: "APPROVED", roomId: "room-1" });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "APPROVED");
  assert.deepEqual(roomUpdate.where, { id: "room-1", ownerId: owner.id, status: "VACANT" });
  assert.equal(audit.action, "APPLICATION_APPROVED");
});

test("password reset request does not reveal whether an account exists", async () => {
  const { app } = createTestApp({ owner: { findUnique: async () => null } });
  const response = await request(app).post("/api/auth/password-reset").send({ email: "unknown@example.com" });
  assert.equal(response.status, 200);
  assert.equal(response.body.message, "Jika email terdaftar, instruksi reset password akan dikirim.");
});

test("manual payment creation only accepts an active tenant owned by the caller", async () => {
  let applicationWhere;
  let paymentData;
  const { app, token } = createTestApp({
    application: {
      findFirst: async args => {
        applicationWhere = args.where;
        return { id: "application-1" };
      }
    },
    payment: {
      create: async ({ data }) => {
        paymentData = data;
        return { id: "payment-1", ...data };
      }
    }
  });
  const response = await request(app).post("/api/payments")
    .set("Authorization", `Bearer ${token}`)
    .send({ applicationId: "application-1", amount: 1500000, billingMonth: "2026-11", method: "Transfer" });
  assert.equal(response.status, 201);
  assert.deepEqual(applicationWhere, {
    id: "application-1",
    ownerId: owner.id,
    status: "APPROVED",
    roomId: { not: null }
  });
  assert.equal(paymentData.ownerId, owner.id);
});

test("application deletion is blocked when payment history exists", async () => {
  const { app, token } = createTestApp({
    transaction: {
      application: {
        findFirst: async () => ({ id: "application-1", roomId: null })
      },
      payment: {
        count: async () => 1
      }
    }
  });
  const response = await request(app).delete("/api/applications/application-1")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(response.status, 409);
  assert.match(response.body.message, /riwayat pembayaran/);
});

test("Midtrans webhook verifies its signature and records a matching settlement", async () => {
  process.env.MIDTRANS_SERVER_KEY = "test-midtrans-server-key";
  let update;
  const { app } = createTestApp({
    payment: {
      findFirst: async () => ({ id: "payment-1", ownerId: owner.id, amount: 1500000, status: "PENDING" }),
      updateMany: async args => { update = args; return { count: 1 }; }
    }
  });
  const notification = {
    order_id: "kosku-payment-1",
    status_code: "200",
    gross_amount: "1500000.00",
    transaction_status: "settlement"
  };
  notification.signature_key = crypto.createHash("sha512")
    .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest("hex");
  const response = await request(app).post("/api/payments/midtrans/webhook").send(notification);
  assert.equal(response.status, 200);
  assert.deepEqual(update.where, { id: "payment-1", ownerId: owner.id, gatewayOrderId: notification.order_id });
  assert.equal(update.data.status, "PAID");
});
