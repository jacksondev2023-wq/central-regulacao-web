export type Role = "atendente" | "regulador";

export type User = {
  id: string;
  name: string;
  role: Role;
  title: string;
  shift: string;
  active: boolean;
};

export type AttendanceStatus =
  | "Pendente"
  | "Em andamento"
  | "Aguardando retorno"
  | "Concluído"
  | "Cancelado"
  | "Encaminhado para o setor responsável";

export type Attendance = {
  id: string;
  date: string;
  time: string;
  patientId?: string;
  responsibleId: string;
  responsibleName: string;
  patientName: string;
  requestType: string;
  status: AttendanceStatus;
  attended: "Sim" | "Não";
  priority: "Rotina" | "Atenção" | "Crítico";
  origin: "Telefone" | "WhatsApp" | "E-mail" | "Sistema" | "Outro";
  unit: string;
  regulatorId?: string;
  finalDate?: string;
  finalTime?: string;
  durationMinutes?: number;
  notes: string;
  pendingReason?: string;
  createdBy: string;
  updatedAt: string;
  slaMinutes?: number;
  targetAt?: string;
  firstResponseAt?: string;
  closedAt?: string;
  minutesOpen?: number;
  slaStatus?: "ok" | "due-soon" | "overdue" | "closed";
};

export type Patient = {
  id: string;
  name: string;
  unit: string;
  referencePhone?: string;
  riskNotes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuditLog = {
  id: string;
  attendanceId: string;
  action: "Criado" | "Atualizado" | "Status alterado" | "Assumido" | "Concluído" | "Comentário";
  userId: string;
  userName: string;
  at: string;
  summary: string;
};

export type Handover = {
  id: string;
  userId: string;
  userName: string;
  role: Role;
  shift: string;
  startedAt: string;
  endedAt?: string;
  status: "Aberto" | "Enviado";
  summary: string;
  criticalPoints: string;
  pendingActions: string;
  nextShiftMessage: string;
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
  checklist?: {
    criticalReviewed: boolean;
    pendingAssigned: boolean;
    awaitingReturnReviewed: boolean;
    openCasesLinked: boolean;
  };
  linkedAttendanceIds: string[];
  updatedAt: string;
};

export type Lookups = {
  requestTypes: string[];
  statuses: AttendanceStatus[];
  attended: Array<"Sim" | "Não">;
  origins: Attendance["origin"][];
  priorities: Attendance["priority"][];
};

export type Dashboard = {
  stats: {
    monthTotal: number;
    todayTotal: number;
    openTotal: number;
    criticalOpen: number;
    concludedTotal: number;
      avgDuration: number;
      dueSoon: number;
      overdue: number;
      unassignedRegulator: number;
      awaitingReturn: number;
      repeatPatientsToday: number;
  };
  byStatus: Array<{ name: AttendanceStatus; total: number }>;
  byType: Array<{ name: string; total: number }>;
  openAttendances: Attendance[];
  recentHandovers: Handover[];
};

export type DailyReport = {
  date: string;
  generatedAt: string;
  generatedBy: User;
  stats: {
    total: number;
    concluded: number;
    open: number;
    critical: number;
    overdue: number;
    awaitingReturn: number;
  };
  byType: Array<{ name: string; total: number }>;
  critical: Attendance[];
  awaitingReturn: Attendance[];
  open: Attendance[];
  handovers: Handover[];
  recommendations: string[];
};

export type BootstrapResponse = {
  user: User;
  users: User[];
  lookups: Lookups;
  attendances: Attendance[];
  patients: Patient[];
  auditLogs: AuditLog[];
  handovers: Handover[];
  dashboard: Dashboard;
};

export type AttendanceDraft = Partial<
  Pick<
    Attendance,
    | "date"
    | "time"
    | "patientId"
    | "responsibleId"
    | "patientName"
    | "requestType"
    | "status"
    | "attended"
    | "priority"
    | "origin"
    | "unit"
    | "regulatorId"
    | "finalDate"
    | "finalTime"
    | "notes"
    | "pendingReason"
  >
>;

export type PatientDraft = Partial<Pick<Patient, "name" | "unit" | "referencePhone" | "riskNotes">>;
