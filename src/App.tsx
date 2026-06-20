import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Edit3,
  FileText,
  LogOut,
  Moon,
  Plus,
  Save,
  Search,
  Send,
  ShieldCheck,
  Stethoscope,
  Sun,
  TimerReset,
  UserPlus,
  UserRound,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  bootstrap,
  createPatient,
  createAttendance,
  fetchAttendanceAudit,
  fetchDailyReport,
  fetchCurrentHandover,
  fetchPublicUsers,
  login,
  logout,
  sendCurrentHandover,
  updateAttendance,
  updateCurrentHandover
} from "./api";
import type { Attendance, AttendanceDraft, AttendanceStatus, BootstrapResponse, Handover, Role, User } from "./types";
import type { AuditLog, DailyReport, PatientDraft } from "./types";

type View = "painel" | "atendimentos" | "plantao" | "pacientes" | "relatorio" | "equipe";
type Theme = "light" | "dark";
const themeKey = "central-regulacao-theme";

const closedStatuses = new Set<AttendanceStatus>(["Concluído", "Cancelado"]);

const statusTone: Record<AttendanceStatus, string> = {
  Pendente: "tone-warning",
  "Em andamento": "tone-info",
  "Aguardando retorno": "tone-waiting",
  Concluído: "tone-success",
  Cancelado: "tone-muted",
  "Encaminhado para o setor responsável": "tone-forwarded"
};

const priorityTone = {
  Rotina: "tone-muted",
  Atenção: "tone-warning",
  Crítico: "tone-danger"
};

const slaTone = {
  ok: "tone-success",
  "due-soon": "tone-warning",
  overdue: "tone-danger",
  closed: "tone-muted"
};

function slaLabel(attendance: Attendance) {
  if (attendance.slaStatus === "closed") return "Fechado";
  if (attendance.slaStatus === "overdue") return `SLA vencido ${attendance.minutesOpen ?? 0}min`;
  if (attendance.slaStatus === "due-soon") return `SLA a vencer ${attendance.minutesOpen ?? 0}min`;
  return `${attendance.minutesOpen ?? 0}min aberto`;
}

const chartColors = ["#1D4ED8", "#0F766E", "#B45309", "#BE123C", "#6D28D9", "#475569", "#0891B2"];

function dateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function todayInput() {
  const parts = dateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nowTimeInput() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function roleLabel(role: Role) {
  const labels: Record<Role, string> = {
    atendente: "Atendente",
    regulador: "Regulador"
  };
  return labels[role];
}

function makeDraft(user: User, data: BootstrapResponse): AttendanceDraft {
  return {
    date: todayInput(),
    time: nowTimeInput(),
    responsibleId: user.id,
    requestType: data.lookups.requestTypes[0],
    status: "Pendente",
    attended: "Não",
    priority: "Rotina",
    origin: "Telefone",
    unit: "Home care",
    notes: ""
  };
}

function isPrivileged(user: User) {
  return user.role === "regulador";
}

function initialViewFor(_user: User): View {
  return "painel";
}

function canAccessView(user: User, view: View) {
  if (view === "equipe") return isPrivileged(user);
  return true;
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("central-regulacao-token"));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(themeKey) === "dark" ? "dark" : "light"));
  const [publicUsers, setPublicUsers] = useState<User[]>([]);
  const [data, setData] = useState<BootstrapResponse | null>(null);
  const [activeView, setActiveView] = useState<View>("painel");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPublicUsers()
      .then(setPublicUsers)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    refresh(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function refresh(currentToken = token) {
    if (!currentToken) return;
    setLoading(true);
    setError("");

    try {
      const next = await bootstrap(currentToken);
      setData(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar dados.";
      setError(message);
      localStorage.removeItem("central-regulacao-token");
      setToken(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(userId: string, pin: string) {
    setError("");
    const session = await login(userId, pin);
    localStorage.setItem("central-regulacao-token", session.token);
    setToken(session.token);
  }

  async function handleLogout() {
    if (token) {
      await logout(token).catch(() => undefined);
    }
    localStorage.removeItem("central-regulacao-token");
    setToken(null);
    setData(null);
    setActiveView("painel");
  }

  if (!token || !data) {
    return (
      <LoginView
        users={publicUsers}
        loading={loading}
        error={error}
        onLogin={handleLogin}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
    );
  }

  const visibleView = canAccessView(data.user, activeView) ? activeView : initialViewFor(data.user);

  return (
    <AppShell
      user={data.user}
      activeView={visibleView}
      onChangeView={setActiveView}
      onLogout={handleLogout}
      theme={theme}
      onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
    >
      {error && <div className="alert alert-error">{error}</div>}
      {visibleView === "painel" && <DashboardView data={data} onOpenAttendances={() => setActiveView("atendimentos")} />}
      {visibleView === "atendimentos" && token && <AttendancesView data={data} token={token} onRefresh={refresh} />}
      {visibleView === "plantao" && token && <HandoverView data={data} token={token} onRefresh={refresh} />}
      {visibleView === "pacientes" && token && <PatientsView data={data} token={token} onRefresh={refresh} />}
      {visibleView === "relatorio" && token && <DailyReportView token={token} />}
      {visibleView === "equipe" && <TeamView data={data} />}
    </AppShell>
  );
}

function LoginView({
  users,
  loading,
  error,
  onLogin,
  theme,
  onToggleTheme
}: {
  users: User[];
  loading: boolean;
  error: string;
  onLogin: (userId: string, pin: string) => Promise<void>;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!userId && users[0]) setUserId(users[0].id);
  }, [users, userId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(userId, pin);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-identity">
        <div className="brand-mark">
          <Stethoscope size={28} />
        </div>
        <h1>Central de Regulação</h1>
        <p>Atendimentos, ocorrências e passagem de plantão em uma operação compartilhada.</p>
        <div className="login-metrics">
          <span>Perfis por plantão</span>
          <strong>{users.length || "-"}</strong>
        </div>
      </section>

      <form className="login-panel" onSubmit={submit}>
        <div className="login-heading">
          <div>
            <p className="eyebrow">Acesso operacional</p>
            <h2>Entrar no sistema</h2>
          </div>
          <button className="icon-button" type="button" title="Alternar tema" onClick={onToggleTheme}>
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>

        <label>
          Usuário
          <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={loading || submitting}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} - {roleLabel(user.role)}
              </option>
            ))}
          </select>
        </label>

        <label>
          PIN
          <input
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="PIN"
            disabled={loading || submitting}
          />
        </label>

        {error && <div className="alert alert-error">{error}</div>}

        <button className="primary-button" type="submit" disabled={!userId || !pin || submitting}>
          <ShieldCheck size={18} />
          {submitting ? "Validando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}

function AppShell({
  user,
  activeView,
  onChangeView,
  onLogout,
  theme,
  onToggleTheme,
  children
}: {
  user: User;
  activeView: View;
  onChangeView: (view: View) => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  const allNavItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
    { id: "painel", label: "Painel", icon: BarChart3 },
    { id: "atendimentos", label: "Atendimentos", icon: ClipboardList },
    { id: "plantao", label: "Plantão", icon: ArrowRightLeft },
    { id: "pacientes", label: "Pacientes", icon: UserPlus },
    { id: "relatorio", label: "Relatório", icon: FileText },
    { id: "equipe", label: "Equipe", icon: Users }
  ];
  const navItems = allNavItems.filter((item) => canAccessView(user, item.id));

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark small">
            <Stethoscope size={20} />
          </span>
          <div>
            <strong>Central</strong>
            <span>Regulação Home Care</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "nav-item active" : "nav-item"}
                onClick={() => onChangeView(item.id)}
                aria-current={activeView === item.id ? "page" : undefined}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">
            <UserRound size={18} />
          </div>
          <div>
            <strong>{user.name}</strong>
            <span>{roleLabel(user.role)} - {user.shift}</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Plantão {user.shift}</p>
            <h2>{viewTitle(activeView)}</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={onToggleTheme}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              {theme === "dark" ? "Claro" : "Escuro"}
            </button>
            <button className="ghost-button" onClick={onLogout}>
              <LogOut size={17} />
              Sair
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function viewTitle(view: View) {
  const titles: Record<View, string> = {
    painel: "Painel operacional",
    atendimentos: "Registro de atendimentos",
    plantao: "Passagem de plantão",
    pacientes: "Cadastro de pacientes",
    relatorio: "Relatório diário",
    equipe: "Equipe e acessos"
  };
  return titles[view];
}

function DashboardView({ data, onOpenAttendances }: { data: BootstrapResponse; onOpenAttendances: () => void }) {
  const statusData = data.dashboard.byStatus.filter((item) => item.total > 0);
  const typeData = data.dashboard.byType.filter((item) => item.total > 0);

  return (
    <div className="page-stack">
      <section className="kpi-grid" aria-label="Indicadores do mês">
        <KpiCard label="Total no mês" value={data.dashboard.stats.monthTotal} icon={Activity} tone="blue" />
        <KpiCard label="Hoje" value={data.dashboard.stats.todayTotal} icon={Clock3} tone="green" />
        <KpiCard label="Ocorrências abertas" value={data.dashboard.stats.openTotal} icon={AlertTriangle} tone="amber" />
        <KpiCard label="Críticas abertas" value={data.dashboard.stats.criticalOpen} icon={ShieldCheck} tone="red" />
        <KpiCard label="Concluídos" value={data.dashboard.stats.concludedTotal} icon={CheckCircle2} tone="teal" />
        <KpiCard label="SLA vencido" value={data.dashboard.stats.overdue} icon={TimerReset} tone="red" />
        <KpiCard label="SLA a vencer" value={data.dashboard.stats.dueSoon} icon={Clock3} tone="amber" />
        <KpiCard label="Sem regulador" value={data.dashboard.stats.unassignedRegulator} icon={ShieldCheck} tone="violet" />
        <KpiCard label="Aguardando retorno" value={data.dashboard.stats.awaitingReturn} icon={ArrowRightLeft} tone="blue" />
        <KpiCard label="Paciente repetido hoje" value={data.dashboard.stats.repeatPatientsToday} icon={UserRound} tone="green" />
      </section>

      <section className="analytics-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Status</p>
              <h3>Atendimentos do mês</h3>
            </div>
          </div>
          <div className="chart-box">
            {statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData} margin={{ top: 8, right: 12, left: -20, bottom: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" angle={-18} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" radius={[5, 5, 0, 0]} fill="#1D4ED8" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="Sem registros para o mês." />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Tipo</p>
              <h3>Distribuição das solicitações</h3>
            </div>
          </div>
          <div className="chart-box">
            {typeData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typeData}
                    dataKey="total"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={86}
                    paddingAngle={2}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {typeData.map((_, index) => (
                      <Cell key={index} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="Sem volume por tipo." />
            )}
          </div>
        </div>
      </section>

      <section className="split-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Fila ativa</p>
              <h3>Ocorrências abertas</h3>
            </div>
            <button className="ghost-button compact" onClick={onOpenAttendances}>
              <ClipboardList size={16} />
              Abrir lista
            </button>
          </div>
          <div className="compact-list">
            {data.dashboard.openAttendances.length ? (
              data.dashboard.openAttendances.map((attendance) => <AttendanceListItem key={attendance.id} attendance={attendance} />)
            ) : (
              <EmptyState text="Nenhuma ocorrência aberta." />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Plantões</p>
              <h3>Últimas passagens</h3>
            </div>
          </div>
          <div className="compact-list">
            {data.dashboard.recentHandovers.length ? (
              data.dashboard.recentHandovers.map((handover) => (
                <article className="handover-row" key={handover.id}>
                  <div>
                    <strong>{handover.userName}</strong>
                    <span>{handover.shift} - {formatDateTime(handover.updatedAt)}</span>
                  </div>
                  <span className={`badge ${handover.status === "Enviado" ? "tone-success" : "tone-info"}`}>{handover.status}</span>
                </article>
              ))
            ) : (
              <EmptyState text="Sem passagens registradas." />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: "blue" | "green" | "amber" | "red" | "teal" | "violet";
}) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <span className="kpi-icon">
        <Icon size={19} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function AttendancesView({
  data,
  token,
  onRefresh
}: {
  data: BootstrapResponse;
  token: string;
  onRefresh: (token?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AttendanceDraft>(() => makeDraft(data.user, data));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"Todos" | AttendanceStatus>("Todos");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const regulators = data.users.filter((user) => user.role === "regulador");
  const canAssignResponsible = isPrivileged(data.user);
  const responsibleOptions = canAssignResponsible ? data.users : [data.user];
  const selectedAudit = useMemo(
    () => (editingId ? data.auditLogs.filter((log) => log.attendanceId === editingId).sort((a, b) => b.at.localeCompare(a.at)) : []),
    [data.auditLogs, editingId]
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return data.attendances.filter((attendance) => {
      const statusOk = statusFilter === "Todos" || attendance.status === statusFilter;
      const searchOk =
        !search ||
        attendance.patientName.toLowerCase().includes(search) ||
        attendance.id.toLowerCase().includes(search) ||
        attendance.requestType.toLowerCase().includes(search) ||
        attendance.responsibleName.toLowerCase().includes(search);
      return statusOk && searchOk;
    });
  }, [data.attendances, query, statusFilter]);

  function updateDraft<K extends keyof AttendanceDraft>(key: K, value: AttendanceDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function selectPatient(patientId: string) {
    const patient = data.patients.find((item) => item.id === patientId);
    setDraft((current) => ({
      ...current,
      patientId: patient?.id,
      patientName: patient?.name ?? current.patientName,
      unit: patient?.unit ?? current.unit
    }));
  }

  function edit(attendance: Attendance) {
    setEditingId(attendance.id);
    setDraft({
      date: attendance.date,
      time: attendance.time,
      responsibleId: attendance.responsibleId,
      patientName: attendance.patientName,
      requestType: attendance.requestType,
      status: attendance.status,
      attended: attendance.attended,
      priority: attendance.priority,
      origin: attendance.origin,
      unit: attendance.unit,
      regulatorId: attendance.regulatorId,
      finalDate: attendance.finalDate,
      finalTime: attendance.finalTime,
      notes: attendance.notes,
      pendingReason: attendance.pendingReason
    });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(makeDraft(data.user, data));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      if (editingId) {
        await updateAttendance(token, editingId, draft);
        setMessage("Atendimento atualizado.");
      } else {
        await createAttendance(token, draft);
        setMessage("Atendimento registrado.");
      }
      await onRefresh(token);
      resetForm();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao salvar atendimento.");
    } finally {
      setSaving(false);
    }
  }

  async function quickUpdate(attendance: Attendance, patch: AttendanceDraft) {
    await updateAttendance(token, attendance.id, patch);
    await onRefresh(token);
  }

  return (
    <div className="page-stack">
      <section className="entry-layout">
        <form className="panel form-panel" onSubmit={submit}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{editingId ? "Edição" : "Novo registro"}</p>
              <h3>{editingId ? editingId : "Atendimento"}</h3>
            </div>
            {editingId && (
              <button className="ghost-button compact" type="button" onClick={resetForm}>
                <Plus size={16} />
                Novo
              </button>
            )}
          </div>

          <div className="form-grid">
            <label>
              Data
              <input type="date" value={draft.date ?? ""} onChange={(event) => updateDraft("date", event.target.value)} required />
            </label>
            <label>
              Hora
              <input type="time" value={draft.time ?? ""} onChange={(event) => updateDraft("time", event.target.value)} required />
            </label>
            <label className="span-2">
              Paciente cadastrado
              <select value={draft.patientId ?? ""} onChange={(event) => selectPatient(event.target.value)}>
                <option value="">Novo paciente ou não localizado</option>
                {data.patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name} - {patient.unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Paciente
              <input value={draft.patientName ?? ""} onChange={(event) => updateDraft("patientName", event.target.value)} required />
            </label>
            <label>
              Responsável
              <select
                value={draft.responsibleId ?? data.user.id}
                onChange={(event) => updateDraft("responsibleId", event.target.value)}
                disabled={!canAssignResponsible}
              >
                {responsibleOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Regulador
              <select value={draft.regulatorId ?? ""} onChange={(event) => updateDraft("regulatorId", event.target.value || undefined)}>
                <option value="">Sem vínculo</option>
                {regulators.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select value={draft.requestType ?? ""} onChange={(event) => updateDraft("requestType", event.target.value)} required>
                {data.lookups.requestTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={draft.status ?? "Pendente"} onChange={(event) => updateDraft("status", event.target.value as AttendanceStatus)}>
                {data.lookups.statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Atendido
              <select value={draft.attended ?? "Não"} onChange={(event) => updateDraft("attended", event.target.value as "Sim" | "Não")}>
                {data.lookups.attended.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridade
              <select value={draft.priority ?? "Rotina"} onChange={(event) => updateDraft("priority", event.target.value as Attendance["priority"])}>
                {data.lookups.priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Origem
              <select value={draft.origin ?? "Telefone"} onChange={(event) => updateDraft("origin", event.target.value as Attendance["origin"])}>
                {data.lookups.origins.map((origin) => (
                  <option key={origin} value={origin}>
                    {origin}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Data final
              <input type="date" value={draft.finalDate ?? ""} onChange={(event) => updateDraft("finalDate", event.target.value || undefined)} />
            </label>
            <label>
              Hora final
              <input type="time" value={draft.finalTime ?? ""} onChange={(event) => updateDraft("finalTime", event.target.value || undefined)} />
            </label>
            <label className="span-2">
              Unidade
              <input value={draft.unit ?? ""} onChange={(event) => updateDraft("unit", event.target.value)} />
            </label>
            <label className="span-2">
              Pendência
              <input value={draft.pendingReason ?? ""} onChange={(event) => updateDraft("pendingReason", event.target.value)} />
            </label>
            <label className="span-2">
              Observações
              <textarea value={draft.notes ?? ""} onChange={(event) => updateDraft("notes", event.target.value)} rows={4} />
            </label>
          </div>

          <div className="form-actions">
            {message && <span className="save-message">{message}</span>}
            <button className="primary-button" disabled={saving} type="submit">
              <Save size={17} />
              {saving ? "Salvando..." : "Salvar atendimento"}
            </button>
          </div>

          {editingId && (
            <div className="audit-panel">
              <p className="eyebrow">Histórico</p>
              {selectedAudit.length ? (
                selectedAudit.map((log) => (
                  <article className="audit-row" key={log.id}>
                    <strong>{log.action}</strong>
                    <span>{log.summary}</span>
                    <small>
                      {log.userName} - {formatDateTime(log.at)}
                    </small>
                  </article>
                ))
              ) : (
                <EmptyState text="Sem histórico para este atendimento." />
              )}
            </div>
          )}
        </form>

        <section className="panel list-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Consolidado</p>
              <h3>{filtered.length} registros</h3>
            </div>
          </div>

          <div className="filter-row">
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "Todos" | AttendanceStatus)}>
              <option value="Todos">Todos</option>
              {data.lookups.statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Paciente</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>SLA</th>
                  <th>Responsável</th>
                  <th>Prioridade</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((attendance) => (
                  <tr key={attendance.id}>
                    <td>
                      <strong>{formatDate(attendance.date)}</strong>
                      <span>{attendance.time}</span>
                    </td>
                    <td>
                      <strong>{attendance.patientName}</strong>
                      <span>{attendance.id}</span>
                    </td>
                    <td>{attendance.requestType}</td>
                    <td>
                      <span className={`badge ${statusTone[attendance.status]}`}>{attendance.status}</span>
                    </td>
                    <td>
                      <span className={`badge ${slaTone[attendance.slaStatus ?? "ok"]}`}>{slaLabel(attendance)}</span>
                    </td>
                    <td>{attendance.responsibleName}</td>
                    <td>
                      <span className={`badge ${priorityTone[attendance.priority]}`}>{attendance.priority}</span>
                    </td>
                    <td>
                      <div className="action-group">
                        <button className="icon-button" title="Editar" onClick={() => edit(attendance)}>
                          <Edit3 size={15} />
                        </button>
                        {!closedStatuses.has(attendance.status) && (
                          <button
                            className="icon-button success"
                            title="Concluir"
                            onClick={() =>
                              quickUpdate(attendance, {
                                status: "Concluído",
                                attended: "Sim",
                                finalDate: todayInput(),
                                finalTime: nowTimeInput()
                              })
                            }
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        {isPrivileged(data.user) && !attendance.regulatorId && (
                          <button
                            className="icon-button"
                            title="Assumir regulação"
                            onClick={() => quickUpdate(attendance, { regulatorId: data.user.id, status: "Em andamento" })}
                          >
                            <ShieldCheck size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function HandoverView({
  data,
  token,
  onRefresh
}: {
  data: BootstrapResponse;
  token: string;
  onRefresh: (token?: string) => Promise<void>;
}) {
  const [handover, setHandover] = useState<Handover | null>(null);
  const [form, setForm] = useState({
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
    linkedAttendanceIds: [] as string[]
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const openAttendances = data.attendances.filter((attendance) => !closedStatuses.has(attendance.status));
  const linkedAttendances = openAttendances.filter((attendance) => form.linkedAttendanceIds.includes(attendance.id));

  useEffect(() => {
    fetchCurrentHandover(token).then((current) => {
      setHandover(current);
      setForm({
        summary: current.summary,
        criticalPoints: current.criticalPoints,
        pendingActions: current.pendingActions,
        nextShiftMessage: current.nextShiftMessage,
        situation: current.situation ?? current.summary,
        background: current.background ?? "",
        assessment: current.assessment ?? current.criticalPoints,
        recommendation: current.recommendation ?? current.pendingActions,
        checklist: current.checklist ?? {
          criticalReviewed: false,
          pendingAssigned: false,
          awaitingReturnReviewed: false,
          openCasesLinked: false
        },
        linkedAttendanceIds: current.linkedAttendanceIds
      });
    });
  }, [token]);

  const generatedText = useMemo(() => {
    const lines = [
      `Passagem de plantão - ${data.user.name} (${data.user.shift})`,
      `S - Situação: ${form.situation || "Sem situação registrada."}`,
      `B - Breve histórico: ${form.background || "Sem histórico registrado."}`,
      `A - Avaliação: ${form.assessment || "Sem avaliação registrada."}`,
      `R - Recomendação: ${form.recommendation || "Sem recomendação registrada."}`,
      "",
      `Resumo: ${form.summary || "Sem resumo registrado."}`,
      `Pontos críticos: ${form.criticalPoints || "Sem pontos críticos registrados."}`,
      `Pendências: ${form.pendingActions || "Sem pendências registradas."}`,
      `Próximo plantão: ${form.nextShiftMessage || "Sem direcionamento adicional."}`,
      "",
      "Ocorrências abertas vinculadas:"
    ];

    if (!linkedAttendances.length) {
      lines.push("- Nenhuma ocorrência vinculada.");
    } else {
      linkedAttendances.forEach((attendance) => {
        lines.push(`- ${attendance.id} | ${attendance.patientName} | ${attendance.status} | ${attendance.pendingReason || attendance.notes || "Sem detalhe."}`);
      });
    }

    return lines.join("\n");
  }, [data.user.name, data.user.shift, form, linkedAttendances]);

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateChecklist(key: keyof NonNullable<Handover["checklist"]>, checked: boolean) {
    setForm((current) => ({
      ...current,
      checklist: {
        ...current.checklist,
        [key]: checked
      }
    }));
  }

  function toggleAttendance(id: string) {
    setForm((current) => ({
      ...current,
      linkedAttendanceIds: current.linkedAttendanceIds.includes(id)
        ? current.linkedAttendanceIds.filter((item) => item !== id)
        : [...current.linkedAttendanceIds, id]
    }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const next = await updateCurrentHandover(token, form);
      setHandover(next);
      setMessage("Plantão salvo.");
      await onRefresh(token);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao salvar plantão.");
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    try {
      await save();
      const next = await sendCurrentHandover(token);
      setHandover(next);
      setMessage("Passagem enviada.");
      await onRefresh(token);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Revise o checklist antes de enviar.");
    }
  }

  async function copyText() {
    await navigator.clipboard.writeText(generatedText);
    setMessage("Texto copiado.");
  }

  return (
    <div className="page-stack">
      <section className="handover-layout">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{handover?.status ?? "Aberto"}</p>
              <h3>{handover?.id ?? "Plantão atual"}</h3>
            </div>
            <span className="badge tone-info">{data.user.shift}</span>
          </div>

          <div className="form-grid one-column">
            <label>
              S - Situação
              <textarea value={form.situation} onChange={(event) => updateField("situation", event.target.value)} rows={3} />
            </label>
            <label>
              B - Breve histórico
              <textarea value={form.background} onChange={(event) => updateField("background", event.target.value)} rows={3} />
            </label>
            <label>
              A - Avaliação
              <textarea value={form.assessment} onChange={(event) => updateField("assessment", event.target.value)} rows={3} />
            </label>
            <label>
              R - Recomendação
              <textarea value={form.recommendation} onChange={(event) => updateField("recommendation", event.target.value)} rows={3} />
            </label>
            <label>
              Resumo do plantão
              <textarea value={form.summary} onChange={(event) => updateField("summary", event.target.value)} rows={4} />
            </label>
            <label>
              Pontos críticos
              <textarea value={form.criticalPoints} onChange={(event) => updateField("criticalPoints", event.target.value)} rows={4} />
            </label>
            <label>
              Pendências para continuidade
              <textarea value={form.pendingActions} onChange={(event) => updateField("pendingActions", event.target.value)} rows={4} />
            </label>
            <label>
              Orientação ao próximo plantão
              <textarea value={form.nextShiftMessage} onChange={(event) => updateField("nextShiftMessage", event.target.value)} rows={4} />
            </label>
          </div>

          <div className="handover-safety">
            <p className="eyebrow">Checklist de segurança</p>
            <label className="check-row compact-check">
              <input type="checkbox" checked={form.checklist.criticalReviewed} onChange={(event) => updateChecklist("criticalReviewed", event.target.checked)} />
              <span>Ocorrências críticas ou SLA vencido revisadas</span>
            </label>
            <label className="check-row compact-check">
              <input type="checkbox" checked={form.checklist.pendingAssigned} onChange={(event) => updateChecklist("pendingAssigned", event.target.checked)} />
              <span>Pendências com responsável/conduta definida</span>
            </label>
            <label className="check-row compact-check">
              <input
                type="checkbox"
                checked={form.checklist.awaitingReturnReviewed}
                onChange={(event) => updateChecklist("awaitingReturnReviewed", event.target.checked)}
              />
              <span>Casos aguardando retorno revisados</span>
            </label>
            <label className="check-row compact-check">
              <input type="checkbox" checked={form.checklist.openCasesLinked} onChange={(event) => updateChecklist("openCasesLinked", event.target.checked)} />
              <span>Ocorrências abertas relevantes vinculadas</span>
            </label>
          </div>

          <div className="form-actions">
            {message && <span className="save-message">{message}</span>}
            <button className="ghost-button" type="button" onClick={copyText}>
              <Copy size={17} />
              Copiar
            </button>
            <button className="secondary-button" type="button" disabled={saving} onClick={save}>
              <Save size={17} />
              Salvar
            </button>
            <button className="primary-button" type="button" disabled={saving} onClick={send}>
              <Send size={17} />
              Enviar passagem
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Vínculos</p>
              <h3>Ocorrências abertas</h3>
            </div>
          </div>
          <div className="handover-checklist">
            {openAttendances.length ? (
              openAttendances.map((attendance) => (
                <label key={attendance.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={form.linkedAttendanceIds.includes(attendance.id)}
                    onChange={() => toggleAttendance(attendance.id)}
                  />
                  <span>
                    <strong>{attendance.patientName}</strong>
                    <small>{attendance.status} - {attendance.requestType}</small>
                  </span>
                  <span className={`badge ${priorityTone[attendance.priority]}`}>{attendance.priority}</span>
                </label>
              ))
            ) : (
              <EmptyState text="Sem ocorrências abertas." />
            )}
          </div>

          <div className="handover-output">
            <p className="eyebrow">Texto do plantão</p>
            <pre>{generatedText}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}

function PatientsView({
  data,
  token,
  onRefresh
}: {
  data: BootstrapResponse;
  token: string;
  onRefresh: (token?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PatientDraft>({ unit: "Home care" });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const patients = useMemo(() => {
    const search = query.trim().toLowerCase();
    return data.patients.filter((patient) => !search || patient.name.toLowerCase().includes(search) || patient.unit.toLowerCase().includes(search));
  }, [data.patients, query]);

  function updateDraft<K extends keyof PatientDraft>(key: K, value: PatientDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await createPatient(token, draft);
      await onRefresh(token);
      setDraft({ unit: "Home care" });
      setMessage("Paciente salvo.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao salvar paciente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="entry-layout">
        <form className="panel form-panel" onSubmit={submit}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Cadastro mínimo</p>
              <h3>Paciente</h3>
            </div>
          </div>
          <div className="form-grid">
            <label className="span-2">
              Nome do paciente
              <input value={draft.name ?? ""} onChange={(event) => updateDraft("name", event.target.value)} required />
            </label>
            <label className="span-2">
              Unidade/carteira
              <input value={draft.unit ?? ""} onChange={(event) => updateDraft("unit", event.target.value)} />
            </label>
            <label className="span-2">
              Telefone de referência
              <input value={draft.referencePhone ?? ""} onChange={(event) => updateDraft("referencePhone", event.target.value)} />
            </label>
            <label className="span-2">
              Observações operacionais
              <textarea value={draft.riskNotes ?? ""} onChange={(event) => updateDraft("riskNotes", event.target.value)} rows={4} />
            </label>
          </div>
          <div className="form-actions">
            {message && <span className="save-message">{message}</span>}
            <button className="primary-button" type="submit" disabled={saving}>
              <Save size={17} />
              {saving ? "Salvando..." : "Salvar paciente"}
            </button>
          </div>
        </form>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Base operacional</p>
              <h3>{patients.length} pacientes</h3>
            </div>
          </div>
          <label className="search-field">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente" />
          </label>
          <div className="patient-grid">
            {patients.map((patient) => {
              const total = data.attendances.filter((attendance) => attendance.patientId === patient.id || attendance.patientName === patient.name).length;
              const open = data.attendances.filter(
                (attendance) => (attendance.patientId === patient.id || attendance.patientName === patient.name) && !closedStatuses.has(attendance.status)
              ).length;
              return (
                <article className="patient-card" key={patient.id}>
                  <div>
                    <strong>{patient.name}</strong>
                    <span>{patient.unit}</span>
                  </div>
                  <div className="row-badges">
                    <span className="badge tone-info">{total} registros</span>
                    <span className={open ? "badge tone-warning" : "badge tone-success"}>{open} abertos</span>
                  </div>
                  {patient.riskNotes && <p>{patient.riskNotes}</p>}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </div>
  );
}

function DailyReportView({ token }: { token: string }) {
  const [date, setDate] = useState(todayInput());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchDailyReport(token, date)
      .then(setReport)
      .catch((err: Error) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, [date, token]);

  const reportText = useMemo(() => {
    if (!report) return "";
    const lines = [
      `Relatório diário - ${formatDate(report.date)}`,
      `Gerado por: ${report.generatedBy.name}`,
      `Total: ${report.stats.total} | Concluídos: ${report.stats.concluded} | Abertos: ${report.stats.open} | Críticos: ${report.stats.critical}`,
      `SLA vencido: ${report.stats.overdue} | Aguardando retorno: ${report.stats.awaitingReturn}`,
      "",
      "Recomendações:",
      ...report.recommendations.map((item) => `- ${item}`),
      "",
      "Pendências abertas:",
      ...(report.open.length
        ? report.open.map((attendance) => `- ${attendance.id} | ${attendance.patientName} | ${attendance.status} | ${attendance.requestType}`)
        : ["- Sem pendências abertas."])
    ];
    return lines.join("\n");
  }, [report]);

  async function copyReport() {
    await navigator.clipboard.writeText(reportText);
    setMessage("Relatório copiado.");
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Resumo automático</p>
            <h3>Relatório diário</h3>
          </div>
          <div className="topbar-actions">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <button className="ghost-button" type="button" onClick={copyReport} disabled={!report}>
              <Copy size={17} />
              Copiar
            </button>
          </div>
        </div>
        {message && <div className="alert alert-info">{message}</div>}
        {loading && <EmptyState text="Gerando relatório..." />}
        {report && (
          <>
            <section className="kpi-grid report-kpis">
              <KpiCard label="Total" value={report.stats.total} icon={Activity} tone="blue" />
              <KpiCard label="Abertos" value={report.stats.open} icon={AlertTriangle} tone="amber" />
              <KpiCard label="Críticos" value={report.stats.critical} icon={ShieldCheck} tone="red" />
              <KpiCard label="SLA vencido" value={report.stats.overdue} icon={TimerReset} tone="red" />
              <KpiCard label="Concluídos" value={report.stats.concluded} icon={CheckCircle2} tone="teal" />
            </section>
            <div className="report-grid">
              <div className="handover-output">
                <p className="eyebrow">Texto executivo</p>
                <pre>{reportText}</pre>
              </div>
              <div className="compact-list">
                <p className="eyebrow">Recomendações</p>
                {report.recommendations.map((item) => (
                  <article className="attendance-row" key={item}>
                    <div>
                      <strong>{item}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TeamView({ data }: { data: BootstrapResponse }) {
  const rows = data.users.map((user) => {
    const userAttendances = data.attendances.filter((attendance) => attendance.responsibleId === user.id);
    return {
      user,
      total: userAttendances.length,
      open: userAttendances.filter((attendance) => !closedStatuses.has(attendance.status)).length
    };
  });

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Perfis</p>
            <h3>Acessos e plantões</h3>
          </div>
        </div>
        <div className="team-grid">
          {rows.map(({ user, total, open }) => (
            <article className="team-card" key={user.id}>
              <div className="avatar large">
                <UserRound size={22} />
              </div>
              <div>
                <strong>{user.name}</strong>
                <span>{user.title}</span>
              </div>
              <div className="team-meta">
                <span className="badge tone-info">{roleLabel(user.role)}</span>
                <span>{user.shift}</span>
              </div>
              <div className="team-counts">
                <span>{total} registros</span>
                <span>{open} abertos</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AttendanceListItem({ attendance }: { attendance: Attendance }) {
  return (
    <article className="attendance-row">
      <div>
        <strong>{attendance.patientName}</strong>
        <span>{attendance.requestType} - {attendance.responsibleName}</span>
      </div>
      <div className="row-badges">
        <span className={`badge ${priorityTone[attendance.priority]}`}>{attendance.priority}</span>
        <span className={`badge ${slaTone[attendance.slaStatus ?? "ok"]}`}>{slaLabel(attendance)}</span>
        <span className={`badge ${statusTone[attendance.status]}`}>{attendance.status}</span>
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
