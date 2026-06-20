export type Role = "atendente" | "regulador";

export type User = {
  id: string;
  name: string;
  role: Role;
  title: string;
  shift: string;
  pin: string;
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

export type AppData = {
  users: User[];
  lookups: {
    requestTypes: string[];
    statuses: AttendanceStatus[];
    attended: Array<"Sim" | "Não">;
    origins: Attendance["origin"][];
    priorities: Attendance["priority"][];
  };
  attendances: Attendance[];
  patients: Patient[];
  handovers: Handover[];
  auditLogs: AuditLog[];
};
