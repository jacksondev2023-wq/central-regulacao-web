import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import XLSX from "xlsx";
import type { AppData, Attendance, AttendanceStatus, User } from "../server/types.js";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const dataFile = path.join(root, "server", "data", "central-regulacao.json");
const databaseUrl = process.env.DATABASE_URL;
const appStateId = process.env.APP_STATE_ID ?? "central-regulacao";
const pgPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require") || process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
    })
  : null;
const source = process.argv[2];
const keepNames = process.argv.includes("--keep-names");

if (!source) {
  console.error("Uso: npm run import:xlsm -- <caminho-da-planilha.xlsm> [--keep-names]");
  process.exit(1);
}

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDate(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text;
}

function normalizeTime(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  return text;
}

function normalizeStatus(value: unknown): AttendanceStatus {
  const text = clean(value);
  if (text.toLowerCase().startsWith("encaminhado")) return "Encaminhado para o setor responsável";
  return (text || "Pendente") as AttendanceStatus;
}

function initials(name: string) {
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

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findUser(users: User[], name: string) {
  const normalized = slug(name);
  const aliases: Record<string, string> = {
    grazielle: "grzi",
    grazi: "grzi",
    grzi: "grzi"
  };
  const alias = aliases[normalized];
  if (alias) return users.find((user) => user.id === alias || slug(user.name) === alias);
  return users.find((user) => slug(user.name) === normalized || normalized.includes(slug(user.name).split("-")[0]));
}

async function readSeedData() {
  return JSON.parse(await fs.readFile(dataFile, "utf8")) as AppData;
}

async function ensureDatabase(seed: AppData) {
  if (!pgPool) return;

  await pgPool.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  await pgPool.query(
    `insert into app_state (id, data)
     values ($1, $2::jsonb)
     on conflict (id) do nothing`,
    [appStateId, JSON.stringify(seed)]
  );
}

async function readStoredData() {
  const seed = await readSeedData();
  if (!pgPool) return seed;

  await ensureDatabase(seed);
  const result = await pgPool.query<{ data: AppData }>("select data from app_state where id = $1", [appStateId]);
  return result.rows[0]?.data ?? seed;
}

async function writeStoredData(data: AppData) {
  if (!pgPool) {
    await fs.writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return "arquivo local";
  }

  await ensureDatabase(data);
  await pgPool.query(
    `insert into app_state (id, data, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id)
     do update set data = excluded.data, updated_at = now()`,
    [appStateId, JSON.stringify(data)]
  );
  await pgPool.end();
  return "PostgreSQL";
}

const workbook = XLSX.readFile(source, { cellDates: true });
const data = await readStoredData();
const attendances: Attendance[] = [];

for (const sheetName of workbook.SheetNames) {
  if (!sheetName.startsWith("REGISTRO -")) continue;

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  const responsibleFromCell = clean(rows[2]?.[1] ?? sheetName.replace("REGISTRO -", ""));
  const user = findUser(data.users, responsibleFromCell) ?? findUser(data.users, sheetName.replace("REGISTRO -", ""));
  const responsibleName = user?.name ?? responsibleFromCell;
  let count = 0;

  for (let index = 5; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const date = normalizeDate(row[1]);
    const time = normalizeTime(row[2]);
    const client = clean(row[4]);
    const requestType = clean(row[5]);
    const status = normalizeStatus(row[6]);
    const attended = clean(row[7]) === "Sim" ? "Sim" : "Não";
    const finalDate = normalizeDate(row[8]);
    const finalTime = normalizeTime(row[9]);

    if (!client && !requestType) continue;

    count += 1;
    const day = (date || new Date().toISOString().slice(0, 10)).replaceAll("-", "");
    const id = `ATD-${day}-${initials(responsibleName)}-${String(count).padStart(3, "0")}`;

    attendances.push({
      id,
      date,
      time,
      responsibleId: user?.id ?? slug(responsibleName),
      responsibleName,
      patientName: keepNames ? client : `Paciente ${initials(responsibleName)}-${String(count).padStart(3, "0")}`,
      requestType: requestType || "Outros",
      status,
      attended,
      priority: status === "Pendente" || status === "Aguardando retorno" ? "Atenção" : "Rotina",
      origin: "Sistema",
      unit: "Home care",
      finalDate: finalDate || undefined,
      finalTime: finalTime || undefined,
      notes: "",
      pendingReason: status === "Concluído" ? undefined : "Importado da planilha.",
      createdBy: user?.id ?? slug(responsibleName),
      updatedAt: new Date().toISOString()
    });
  }
}

data.attendances = attendances;
const target = await writeStoredData(data);

console.log(`Importados ${attendances.length} atendimentos de ${source} em ${target}`);
console.log(keepNames ? "Nomes preservados." : "Nomes anonimizados. Use --keep-names para migração controlada.");
