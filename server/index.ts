import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { AppData, Attendance, AttendanceStatus, AuditLog, Handover, Patient, User } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedDataFile = path.join(__dirname, "data", "central-regulacao.json");
const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : seedDataFile;
const databaseUrl = process.env.DATABASE_URL;
const appStateId = process.env.APP_STATE_ID ?? "central-regulacao";
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const clientDistDir = path.resolve(__dirname, "..", "dist");
const app = express();
const sessions = new Map<string, string>();
const pgPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require") || process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
    })
  : null;
let databaseReady = false;

type PublicUser = Omit<User, "pin">;
type AuthedRequest = Request & { user: User; data: AppData };
const openStatuses = new Set<AttendanceStatus>([
  "Pendente",
  "Em andamento",
  "Aguardando retorno",
  "Encaminhado para o setor responsável"
]);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

async function ensureDataFile() {
  try {
    await fs.access(dataFile);
  } catch {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.copyFile(seedDataFile, dataFile);
  }
}

async function readSeedData(): Promise<AppData> {
  const raw = await fs.readFile(seedDataFile, "utf8");
  return normalizeData(JSON.parse(raw) as Partial<AppData>);
}

async function ensureDatabase() {
  if (!pgPool || databaseReady) return;

  await pgPool.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  const seed = await readSeedData();
  await pgPool.query(
    `insert into app_state (id, data)
     values ($1, $2::jsonb)
     on conflict (id) do nothing`,
    [appStateId, JSON.stringify(seed)]
  );
  databaseReady = true;
}

async function readDatabaseData(): Promise<AppData> {
  if (!pgPool) throw new Error("Banco de dados não configurado.");
  await ensureDatabase();

  const result = await pgPool.query<{ data: Partial<AppData> }>("select data from app_state where id = $1", [appStateId]);
  const row = result.rows[0];
  if (!row) {
    const seed = await readSeedData();
    await writeDatabaseData(seed);
    return seed;
  }

  return normalizeData(row.data);
}

async function writeDatabaseData(data: AppData) {
  if (!pgPool) throw new Error("Banco de dados não configurado.");
  await ensureDatabase();

  await pgPool.query(
    `insert into app_state (id, data, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id)
     do update set data = excluded.data, updated_at = now()`,
    [appStateId, JSON.stringify(data)]
  );
}

async function readData(): Promise<AppData> {
  if (pgPool) return readDatabaseData();

  await ensureDataFile();
  const raw = await fs.readFile(dataFile, "utf8");
  return normalizeData(JSON.parse(raw) as Partial<AppData>);
}

async function writeData(data: AppData) {
  if (pgPool) {
    await writeDatabaseData(data);
    return;
  }

  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sanitizeUser(user: User): PublicUser {
  const { pin, ...publicUser } = user;
  return publicUser;
}

function normalizeStatus(status: string): AttendanceStatus {
  if (status.toLowerCase().startsWith("encaminhado")) {
    return "Encaminhado para o setor responsável";
  }
  return status as AttendanceStatus;
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function spNow() {
  return new Date();
}

function isoNow() {
  return spNow().toISOString();
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(spNow());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function minutesBetween(date: string, time: string, finalDate?: string, finalTime?: string) {
  if (!date || !time || !finalDate || !finalTime) return undefined;
  const started = new Date(`${date}T${time}:00-03:00`).getTime();
  const ended = new Date(`${finalDate}T${finalTime}:00-03:00`).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return undefined;
  return Math.round((ended - started) / 60000);
}

function startTimestamp(attendance: Pick<Attendance, "date" | "time">) {
  const time = attendance.time || "00:00";
  const timestamp = new Date(`${attendance.date}T${time}:00-03:00`).getTime();
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function isClosed(attendance: Attendance) {
  return attendance.status === "Concluído" || attendance.status === "Cancelado";
}

function slaMinutesFor(attendance: Pick<Attendance, "priority" | "requestType" | "status">) {
  const type = attendance.requestType.toLowerCase();
  if (attendance.priority === "Crítico" || type.includes("o2")) return 60;
  if (attendance.status === "Aguardando retorno") return 120;
  if (attendance.priority === "Atenção" || type.includes("queixa") || type.includes("reclama")) return 240;
  if (type.includes("administrativa")) return 1440;
  return 480;
}

function enrichAttendance(attendance: Attendance, now = Date.now()): Attendance {
  const slaMinutes = attendance.slaMinutes ?? slaMinutesFor(attendance);
  const startedAt = startTimestamp(attendance);
  const closedAt =
    attendance.closedAt ??
    (attendance.finalDate && attendance.finalTime ? new Date(`${attendance.finalDate}T${attendance.finalTime}:00-03:00`).toISOString() : undefined);
  const endAt = closedAt ? new Date(closedAt).getTime() : now;
  const minutesOpen = Math.max(0, Math.round((endAt - startedAt) / 60000));
  const targetAt = new Date(startedAt + slaMinutes * 60000).toISOString();
  const slaStatus = isClosed(attendance) ? "closed" : minutesOpen >= slaMinutes ? "overdue" : minutesOpen >= slaMinutes * 0.8 ? "due-soon" : "ok";

  return {
    ...attendance,
    slaMinutes,
    targetAt,
    closedAt,
    minutesOpen,
    slaStatus
  };
}

function ensureChecklist(handover: Partial<Handover>) {
  return {
    criticalReviewed: handover.checklist?.criticalReviewed ?? false,
    pendingAssigned: handover.checklist?.pendingAssigned ?? false,
    awaitingReturnReviewed: handover.checklist?.awaitingReturnReviewed ?? false,
    openCasesLinked: handover.checklist?.openCasesLinked ?? false
  };
}

function defaultLookups(): AppData["lookups"] {
  return {
    requestTypes: [
      "Reposição de O2",
      "Agendamento de remoções",
      "Atendimento domiciliar",
      "Reposição/Material",
      "Queixa/Reclamação",
      "Solicitação administrativa",
      "Outros"
    ],
    statuses: [
      "Pendente",
      "Em andamento",
      "Aguardando retorno",
      "Concluído",
      "Cancelado",
      "Encaminhado para o setor responsável"
    ],
    attended: ["Sim", "Não"],
    origins: ["Telefone", "WhatsApp", "E-mail", "Sistema", "Outro"],
    priorities: ["Rotina", "Atenção", "Crítico"]
  };
}

function normalizeData(raw: Partial<AppData>): AppData {
  const now = isoNow();
  const lookups = { ...defaultLookups(), ...(raw.lookups ?? {}) };
  const users = raw.users ?? [];
  const patientsById = new Map<string, Patient>();

  for (const patient of raw.patients ?? []) {
    patientsById.set(patient.id, {
      ...patient,
      active: patient.active ?? true,
      createdAt: patient.createdAt ?? now,
      updatedAt: patient.updatedAt ?? now
    });
  }

  const attendances = (raw.attendances ?? []).map((item) => {
    const legacy = item as Attendance & { clientName?: string };
    const patientName = legacy.patientName ?? legacy.clientName ?? "";
    const patientId = legacy.patientId ?? `pac-${slug(patientName || legacy.id)}`;
    const patient = patientsById.get(patientId) ?? {
      id: patientId,
      name: patientName,
      unit: legacy.unit || "Home care",
      active: true,
      createdAt: legacy.updatedAt ?? now,
      updatedAt: legacy.updatedAt ?? now
    };

    if (patientName && !patientsById.has(patientId)) patientsById.set(patientId, patient);

    return enrichAttendance({
      ...legacy,
      patientId,
      patientName,
      status: normalizeStatus(legacy.status ?? "Pendente"),
      attended: legacy.attended ?? "Não",
      priority: legacy.priority ?? "Rotina",
      origin: legacy.origin ?? "Sistema",
      unit: legacy.unit || patient.unit || "Home care",
      notes: legacy.notes ?? "",
      updatedAt: legacy.updatedAt ?? now
    });
  });

  const auditLogs = raw.auditLogs?.length
    ? raw.auditLogs
    : attendances.map<AuditLog>((attendance) => ({
        id: `aud-${attendance.id}-created`,
        attendanceId: attendance.id,
        action: "Criado",
        userId: attendance.createdBy,
        userName: users.find((user) => user.id === attendance.createdBy)?.name ?? attendance.responsibleName,
        at: attendance.updatedAt,
        summary: "Registro importado ou criado sem trilha anterior."
      }));

  const handovers = (raw.handovers ?? []).map((handover) => ({
    ...handover,
    situation: handover.situation ?? handover.summary ?? "",
    background: handover.background ?? "",
    assessment: handover.assessment ?? handover.criticalPoints ?? "",
    recommendation: handover.recommendation ?? handover.pendingActions ?? "",
    checklist: ensureChecklist(handover)
  }));

  return {
    users,
    lookups,
    attendances,
    patients: [...patientsById.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    handovers,
    auditLogs
  };
}

function userInitials(name: string) {
  const firstName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .at(0) ?? "XXX";

  return firstName
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, "X");
}

function createAttendanceId(data: AppData, date: string, responsibleName: string) {
  const day = date.replaceAll("-", "");
  const initials = userInitials(responsibleName);
  const count = data.attendances.filter((item) => item.id.startsWith(`ATD-${day}-${initials}`)).length + 1;
  return `ATD-${day}-${initials}-${String(count).padStart(3, "0")}`;
}

function canReadAttendance(_user: User, _attendance: Attendance) {
  return true;
}

function canEditAttendance(user: User, attendance: Attendance) {
  if (user.role === "regulador") return true;
  return attendance.responsibleId === user.id || attendance.createdBy === user.id;
}

function scopeAttendances(user: User, data: AppData) {
  return data.attendances.filter((attendance) => canReadAttendance(user, attendance));
}

function scopePatients(user: User, data: AppData) {
  if (user.active) return data.patients;
  return [];
}

function addAuditLog(data: AppData, user: User, attendanceId: string, action: AuditLog["action"], summary: string) {
  data.auditLogs.push({
    id: `aud-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    attendanceId,
    action,
    userId: user.id,
    userName: user.name,
    at: isoNow(),
    summary
  });
}

function upsertPatient(data: AppData, attendance: Attendance) {
  const patientId = attendance.patientId ?? `pac-${slug(attendance.patientName || attendance.id)}`;
  const existing = data.patients.find((patient) => patient.id === patientId);

  if (existing) {
    existing.name = attendance.patientName || existing.name;
    existing.unit = attendance.unit || existing.unit;
    existing.updatedAt = isoNow();
    attendance.patientId = existing.id;
    return existing;
  }

  const patient: Patient = {
    id: patientId,
    name: attendance.patientName,
    unit: attendance.unit || "Home care",
    active: true,
    createdAt: isoNow(),
    updatedAt: isoNow()
  };

  attendance.patientId = patient.id;
  data.patients.push(patient);
  return patient;
}

function summarizeAttendanceChanges(before: Attendance, after: Attendance) {
  const changes: string[] = [];
  if (before.status !== after.status) changes.push(`status de ${before.status} para ${after.status}`);
  if (before.priority !== after.priority) changes.push(`prioridade de ${before.priority} para ${after.priority}`);
  if (before.regulatorId !== after.regulatorId) changes.push("regulador vinculado/alterado");
  if (before.responsibleId !== after.responsibleId) changes.push("responsável alterado");
  if (before.patientName !== after.patientName) changes.push("paciente alterado");
  if (before.pendingReason !== after.pendingReason) changes.push("pendência atualizada");
  if (before.notes !== after.notes) changes.push("observações atualizadas");
  return changes.length ? changes.join("; ") : "registro atualizado";
}

function auditActionFor(before: Attendance, after: Attendance): AuditLog["action"] {
  if (before.status !== after.status) return after.status === "Concluído" ? "Concluído" : "Status alterado";
  if (before.regulatorId !== after.regulatorId && after.regulatorId) return "Assumido";
  return "Atualizado";
}

function buildDashboard(user: User, data: AppData) {
  const visible = scopeAttendances(user, data);
  const today = todayInSaoPaulo();
  const monthPrefix = today.slice(0, 7);
  const monthAttendances = visible.filter((attendance) => attendance.date.startsWith(monthPrefix));
  const openAttendances = visible.filter((attendance) => openStatuses.has(attendance.status));
  const concluded = monthAttendances.filter((attendance) => attendance.status === "Concluído");
  const durations = concluded
    .map((attendance) => attendance.durationMinutes)
    .filter((value): value is number => typeof value === "number");
  const avgDuration = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;

  const byStatus = data.lookups.statuses.map((status) => ({
    name: status,
    total: monthAttendances.filter((attendance) => attendance.status === status).length
  }));

  const byType = data.lookups.requestTypes.map((type) => ({
    name: type,
    total: monthAttendances.filter((attendance) => attendance.requestType.toLowerCase() === type.toLowerCase()).length
  }));

  const handovers = data.handovers;
  const patientsToday = visible.filter((attendance) => attendance.date === today).reduce<Record<string, number>>((acc, attendance) => {
    const key = attendance.patientId ?? attendance.patientName;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    stats: {
      monthTotal: monthAttendances.length,
      todayTotal: visible.filter((attendance) => attendance.date === today).length,
      openTotal: openAttendances.length,
      criticalOpen: openAttendances.filter((attendance) => attendance.priority === "Crítico").length,
      concludedTotal: concluded.length,
      avgDuration,
      dueSoon: openAttendances.filter((attendance) => attendance.slaStatus === "due-soon").length,
      overdue: openAttendances.filter((attendance) => attendance.slaStatus === "overdue").length,
      unassignedRegulator: openAttendances.filter((attendance) => !attendance.regulatorId).length,
      awaitingReturn: openAttendances.filter((attendance) => attendance.status === "Aguardando retorno").length,
      repeatPatientsToday: Object.values(patientsToday).filter((count) => count > 1).length
    },
    byStatus,
    byType,
    openAttendances: openAttendances
      .sort((a, b) => {
        const score = (attendance: Attendance) =>
          (attendance.slaStatus === "overdue" ? 4 : attendance.slaStatus === "due-soon" ? 3 : 0) +
          (attendance.priority === "Crítico" ? 3 : attendance.priority === "Atenção" ? 2 : 1);
        return score(b) - score(a) || b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 12),
    recentHandovers: handovers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
  };
}

function buildDailyReport(user: User, data: AppData, date = todayInSaoPaulo()) {
  const attendances = scopeAttendances(user, data).filter((attendance) => attendance.date === date);
  const open = attendances.filter((attendance) => openStatuses.has(attendance.status));
  const critical = open.filter((attendance) => attendance.priority === "Crítico" || attendance.slaStatus === "overdue");
  const awaitingReturn = open.filter((attendance) => attendance.status === "Aguardando retorno");
  const concluded = attendances.filter((attendance) => attendance.status === "Concluído");
  const byType = data.lookups.requestTypes
    .map((type) => ({ name: type, total: attendances.filter((attendance) => attendance.requestType.toLowerCase() === type.toLowerCase()).length }))
    .filter((item) => item.total > 0);
  const handovers = data.handovers
    .filter((handover) => handover.startedAt.startsWith(date))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const recommendations = [
    critical.length ? "Priorizar ocorrências críticas ou com SLA vencido antes das rotinas." : "",
    awaitingReturn.length ? "Revisar todos os casos aguardando retorno e registrar responsável pela cobrança." : "",
    open.some((attendance) => !attendance.regulatorId) ? "Vincular regulador nos casos abertos sem responsável clínico." : "",
    open.length ? "Manter passagem de plantão com todas as pendências abertas vinculadas." : "Plantão sem pendências abertas no período."
  ].filter(Boolean);

  return {
    date,
    generatedAt: isoNow(),
    generatedBy: sanitizeUser(user),
    stats: {
      total: attendances.length,
      concluded: concluded.length,
      open: open.length,
      critical: critical.length,
      overdue: open.filter((attendance) => attendance.slaStatus === "overdue").length,
      awaitingReturn: awaitingReturn.length
    },
    byType,
    critical,
    awaitingReturn,
    open,
    handovers,
    recommendations
  };
}

function createEmptyHandover(user: User, date = todayInSaoPaulo()): Handover {
  return {
    id: `PLT-${date.replaceAll("-", "")}-${userInitials(user.name)}`,
    userId: user.id,
    userName: user.name,
    role: user.role,
    shift: user.shift,
    startedAt: isoNow(),
    status: "Aberto",
    summary: "",
    criticalPoints: "",
    pendingActions: "",
    nextShiftMessage: "",
    situation: "",
    background: "",
    assessment: "",
    recommendation: "",
    checklist: {
      criticalReviewed: false,
      pendingAssigned: false,
      awaitingReturnReviewed: false,
      openCasesLinked: false
    },
    linkedAttendanceIds: [],
    updatedAt: isoNow()
  };
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token || !sessions.has(token)) {
    return res.status(401).json({ message: "Sessão inválida." });
  }

  const data = await readData();
  const user = data.users.find((item) => item.id === sessions.get(token) && item.active);

  if (!user) {
    sessions.delete(token);
    return res.status(401).json({ message: "Usuário não encontrado." });
  }

  (req as AuthedRequest).user = user;
  (req as AuthedRequest).data = data;
  return next();
}

app.get("/api/health", async (_req, res) => {
  try {
    if (pgPool) {
      await ensureDatabase();
      await pgPool.query("select 1");
    }

    res.json({ status: "ok", service: "central-regulacao-api", storage: pgPool ? "postgres" : "file" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao verificar armazenamento.";
    res.status(500).json({ status: "error", service: "central-regulacao-api", storage: "postgres", message });
  }
});

app.get("/api/users/public", async (_req, res) => {
  const data = await readData();
  res.json(data.users.filter((user) => user.active).map(sanitizeUser));
});

app.post("/api/login", async (req, res) => {
  const { userId, pin } = req.body as { userId?: string; pin?: string };
  const data = await readData();
  const user = data.users.find((item) => item.id === userId && item.active);

  if (!user || user.pin !== pin) {
    return res.status(401).json({ message: "Credenciais inválidas." });
  }

  const token = randomUUID();
  sessions.set(token, user.id);
  res.json({ token, user: sanitizeUser(user) });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  const { user, data } = req as AuthedRequest;
  const visibleAttendances = scopeAttendances(user, data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visibleIds = new Set(visibleAttendances.map((attendance) => attendance.id));
  const visibleHandovers = data.handovers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  res.json({
    user: sanitizeUser(user),
    users: data.users.map(sanitizeUser),
    lookups: data.lookups,
    attendances: visibleAttendances,
    patients: scopePatients(user, data),
    auditLogs: data.auditLogs.filter((log) => visibleIds.has(log.attendanceId)).sort((a, b) => b.at.localeCompare(a.at)),
    handovers: visibleHandovers,
    dashboard: buildDashboard(user, data)
  });
});

app.get("/api/attendances/:id/audit", requireAuth, (req, res) => {
  const { user, data } = req as AuthedRequest;
  const attendance = data.attendances.find((item) => item.id === req.params.id);
  if (!attendance) return res.status(404).json({ message: "Atendimento não encontrado." });
  if (!canReadAttendance(user, attendance)) return res.status(403).json({ message: "Sem permissão para visualizar este histórico." });
  res.json(data.auditLogs.filter((log) => log.attendanceId === attendance.id).sort((a, b) => b.at.localeCompare(a.at)));
});

app.get("/api/patients", requireAuth, (req, res) => {
  const { user, data } = req as AuthedRequest;
  res.json(scopePatients(user, data));
});

app.get("/api/reports/daily", requireAuth, (req, res) => {
  const { user, data } = req as AuthedRequest;
  const date = typeof req.query.date === "string" ? req.query.date : todayInSaoPaulo();
  res.json(buildDailyReport(user, data, date));
});

app.post("/api/patients", requireAuth, async (req, res) => {
  const { user, data } = req as AuthedRequest;
  const body = req.body as Partial<Patient>;
  if (!body.name?.trim()) return res.status(400).json({ message: "Informe o nome do paciente." });

  const existing = data.patients.find((patient) => slug(patient.name) === slug(body.name!));
  if (existing) {
    existing.unit = body.unit?.trim() || existing.unit;
    existing.referencePhone = body.referencePhone?.trim() || existing.referencePhone;
    existing.riskNotes = body.riskNotes?.trim() || existing.riskNotes;
    existing.updatedAt = isoNow();
    await writeData(data);
    return res.json(existing);
  }

  const patient: Patient = {
    id: `pac-${slug(body.name)}-${Date.now().toString(36)}`,
    name: body.name.trim(),
    unit: body.unit?.trim() || "Home care",
    referencePhone: body.referencePhone?.trim() || undefined,
    riskNotes: body.riskNotes?.trim() || undefined,
    active: true,
    createdAt: isoNow(),
    updatedAt: isoNow()
  };

  data.patients.push(patient);
  addAuditLog(data, user, "cadastro-paciente", "Comentário", `Paciente cadastrado: ${patient.name}.`);
  await writeData(data);
  res.status(201).json(patient);
});

app.get("/api/attendances", requireAuth, (req, res) => {
  const { user, data } = req as AuthedRequest;
  const { status, mine, open } = req.query;
  const openStatuses = new Set(["Pendente", "Em andamento", "Aguardando retorno", "Encaminhado para o setor responsável"]);

  let attendances = scopeAttendances(user, data);
  if (status && typeof status === "string") {
    attendances = attendances.filter((attendance) => attendance.status === normalizeStatus(status));
  }
  if (mine === "true") {
    attendances = attendances.filter((attendance) => attendance.responsibleId === user.id || attendance.createdBy === user.id);
  }
  if (open === "true") {
    attendances = attendances.filter((attendance) => openStatuses.has(attendance.status));
  }

  res.json(attendances.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

app.post("/api/attendances", requireAuth, async (req, res) => {
  const { user, data } = req as AuthedRequest;
  const body = req.body as Partial<Attendance>;
  const responsibleId = user.role === "regulador" ? body.responsibleId ?? user.id : user.id;
  const responsible = data.users.find((item) => item.id === responsibleId) ?? user;
  const selectedPatient = body.patientId ? data.patients.find((patient) => patient.id === body.patientId) : undefined;
  const status = normalizeStatus(body.status ?? "Pendente");
  const date = body.date ?? todayInSaoPaulo();
  const time = body.time ?? "00:00";
  const finalDate = body.finalDate || undefined;
  const finalTime = body.finalTime || undefined;
  const patientName = body.patientName?.trim() || selectedPatient?.name || "";

  if (!patientName) {
    return res.status(400).json({ message: "Informe o paciente." });
  }

  if (!body.requestType) {
    return res.status(400).json({ message: "Informe o tipo de solicitação." });
  }

  const attendance: Attendance = {
    id: createAttendanceId(data, date, responsible.name),
    date,
    time,
    patientId: selectedPatient?.id,
    responsibleId: responsible.id,
    responsibleName: responsible.name,
    patientName,
    requestType: body.requestType,
    status,
    attended: body.attended ?? (status === "Concluído" ? "Sim" : "Não"),
    priority: body.priority ?? "Rotina",
    origin: body.origin ?? "Telefone",
    unit: body.unit?.trim() || "Home care",
    regulatorId: body.regulatorId,
    finalDate,
    finalTime,
    durationMinutes: minutesBetween(date, time, finalDate, finalTime),
    notes: body.notes?.trim() ?? "",
    pendingReason: body.pendingReason?.trim() || undefined,
    createdBy: user.id,
    updatedAt: isoNow()
  };

  upsertPatient(data, attendance);
  const enriched = enrichAttendance(attendance);
  addAuditLog(data, user, enriched.id, "Criado", `Atendimento criado para ${enriched.patientName}.`);
  data.attendances.push(enriched);
  await writeData(data);
  res.status(201).json(enriched);
});

app.patch("/api/attendances/:id", requireAuth, async (req, res) => {
  const { user, data } = req as AuthedRequest;
  const index = data.attendances.findIndex((attendance) => attendance.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "Atendimento não encontrado." });

  const current = data.attendances[index];
  if (!canEditAttendance(user, current)) return res.status(403).json({ message: "Sem permissão para atualizar este atendimento." });

  const body = req.body as Partial<Attendance>;
  const allowedBody = user.role === "regulador" ? body : { ...body, responsibleId: current.responsibleId };
  const selectedPatient = allowedBody.patientId ? data.patients.find((patient) => patient.id === allowedBody.patientId) : undefined;
  const responsible = allowedBody.responsibleId ? data.users.find((item) => item.id === allowedBody.responsibleId) : undefined;
  const next: Attendance = {
    ...current,
    ...allowedBody,
    responsibleId: responsible?.id ?? current.responsibleId,
    responsibleName: responsible?.name ?? current.responsibleName,
    patientName: allowedBody.patientName?.trim() || selectedPatient?.name || current.patientName,
    status: allowedBody.status ? normalizeStatus(allowedBody.status) : current.status,
    updatedAt: isoNow()
  };

  next.durationMinutes = minutesBetween(next.date, next.time, next.finalDate, next.finalTime);
  if (next.status === "Concluído" && !next.finalDate) {
    next.finalDate = todayInSaoPaulo();
  }
  if (next.status === "Concluído" && !next.finalTime) {
    next.finalTime = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(spNow());
  }

  upsertPatient(data, next);
  const enriched = enrichAttendance(next);
  data.attendances[index] = enriched;
  addAuditLog(data, user, enriched.id, auditActionFor(current, enriched), summarizeAttendanceChanges(current, enriched));
  await writeData(data);
  res.json(enriched);
});

app.get("/api/handovers/current", requireAuth, async (req, res) => {
  const { user, data } = req as AuthedRequest;
  const today = todayInSaoPaulo();
  let handover = data.handovers.find((item) => item.userId === user.id && item.startedAt.startsWith(today) && item.status === "Aberto");

  if (!handover) {
    handover = createEmptyHandover(user, today);
    data.handovers.push(handover);
    await writeData(data);
  }

  res.json(handover);
});

app.patch("/api/handovers/current", requireAuth, async (req, res) => {
  const { user, data } = req as AuthedRequest;
  const body = req.body as Partial<Handover>;
  const today = todayInSaoPaulo();
  let index = data.handovers.findIndex((item) => item.userId === user.id && item.startedAt.startsWith(today) && item.status === "Aberto");

  if (index === -1) {
    data.handovers.push(createEmptyHandover(user, today));
    index = data.handovers.length - 1;
  }

  data.handovers[index] = {
    ...data.handovers[index],
    summary: body.summary ?? data.handovers[index].summary,
    criticalPoints: body.criticalPoints ?? data.handovers[index].criticalPoints,
    pendingActions: body.pendingActions ?? data.handovers[index].pendingActions,
    nextShiftMessage: body.nextShiftMessage ?? data.handovers[index].nextShiftMessage,
    situation: body.situation ?? data.handovers[index].situation,
    background: body.background ?? data.handovers[index].background,
    assessment: body.assessment ?? data.handovers[index].assessment,
    recommendation: body.recommendation ?? data.handovers[index].recommendation,
    checklist: body.checklist ? ensureChecklist(body) : ensureChecklist(data.handovers[index]),
    linkedAttendanceIds: body.linkedAttendanceIds ?? data.handovers[index].linkedAttendanceIds,
    updatedAt: isoNow()
  };

  await writeData(data);
  res.json(data.handovers[index]);
});

app.post("/api/handovers/current/send", requireAuth, async (req, res) => {
  const { user, data } = req as AuthedRequest;
  const today = todayInSaoPaulo();
  const index = data.handovers.findIndex((item) => item.userId === user.id && item.startedAt.startsWith(today) && item.status === "Aberto");

  if (index === -1) return res.status(404).json({ message: "Plantão aberto não encontrado." });

  const handover = data.handovers[index];
  const open = scopeAttendances(user, data).filter((attendance) => openStatuses.has(attendance.status));
  const critical = open.filter((attendance) => attendance.priority === "Crítico" || attendance.slaStatus === "overdue");
  const issues = [
    critical.length && !handover.checklist?.criticalReviewed ? "Revise ocorrências críticas ou com SLA vencido." : "",
    open.some((attendance) => !attendance.regulatorId) && !handover.checklist?.pendingAssigned
      ? "Vincule ou justifique pendências sem regulador/responsável clínico."
      : "",
    open.some((attendance) => attendance.status === "Aguardando retorno") && !handover.checklist?.awaitingReturnReviewed
      ? "Revise casos aguardando retorno."
      : "",
    open.length && (!handover.checklist?.openCasesLinked || handover.linkedAttendanceIds.length === 0)
      ? "Vincule as ocorrências abertas relevantes ao plantão."
      : ""
  ].filter(Boolean);

  if (issues.length) {
    return res.status(400).json({ message: issues.join(" ") });
  }

  data.handovers[index] = {
    ...handover,
    status: "Enviado",
    endedAt: isoNow(),
    updatedAt: isoNow()
  };

  await writeData(data);
  res.json(data.handovers[index]);
});

app.use(express.static(clientDistDir));

app.get("*", async (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ message: "Endpoint não encontrado." });
  }

  const indexFile = path.join(clientDistDir, "index.html");

  try {
    await fs.access(indexFile);
    res.sendFile(indexFile);
  } catch {
    res.status(404).send("Aplicação web não encontrada. Execute npm run build antes de compartilhar.");
  }
});

app.listen(port, host, () => {
  const visibleHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Central de Regulação disponível em http://${visibleHost}:${port}`);
});
